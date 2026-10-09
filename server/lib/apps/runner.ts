import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { StudioProblem } from '../problem'

/** The code and files of one installed backend. */
export interface BackendSource {
  installationId: string
  appId: string
  /** Package-relative path of the backend's ES module entry. */
  entry: string
  /** Module files to extract (JavaScript, JSON, WebAssembly). */
  files: Map<string, Uint8Array>
}

export interface BackendRunnerOptions {
  denoPath: string
  /** Directory for extracted backends and Deno's cache. */
  workDir: string
  /** The only address the backend may reach: this service on loopback. */
  capabilityUrl: string
  callTimeoutMs?: number
  startupTimeoutMs?: number
  idleTimeoutMs?: number
  /** V8 heap limit per backend process. */
  memoryMb?: number
  /** Most bytes of one answer from a backend. */
  maxMessageBytes?: number
}

const harnessFile = '__studio_host__.mjs'

/**
 * The Deno entry Studio writes next to the backend. It imports the backend
 * statically (no read permission needed), answers JSON-RPC over stdio, and
 * gives each call a Studio client that carries the call's capability token.
 * The backend's console output goes to stderr, so it cannot forge answers.
 */
function harnessSource (entry: string, capabilityUrl: string): string {
  return String.raw`import * as app from ${JSON.stringify(`./${entry}`)}
const endpoint = ${JSON.stringify(`${capabilityUrl}/api/studio/v1/app-calls`)}
const encoder = new TextEncoder()
const stdout = Deno.stdout
let queue = Promise.resolve()
const write = message => (queue = queue.then(async () => {
  let data = encoder.encode(JSON.stringify(message) + '\n')
  while (data.length > 0) {
    data = data.subarray(await stdout.write(data))
  }
}))
for (const level of ['log', 'info', 'debug', 'warn']) console[level] = (...args) => console.error(...args)
function studioFor (token) {
  return {
    async call (method, params) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: JSON.stringify({ method, params: params ?? {} }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        const error = new Error(body.detail ?? body.title ?? 'Studio refused the call.')
        error.problem = body
        throw error
      }
      return body.result
    },
  }
}
async function handle (line) {
  let message
  try { message = JSON.parse(line) } catch { return }
  const handler = Object.hasOwn(app, message.method) ? app[message.method] : undefined
  if (typeof handler !== 'function') {
    await write({ id: message.id, error: { code: 'method_not_found', message: 'The backend has no function ' + message.method + '.' } })
    return
  }
  try {
    const result = await handler(message.params, { studio: studioFor(message.token) })
    await write({ id: message.id, result: result ?? null })
  } catch (error) {
    await write({ id: message.id, error: { code: error?.problem?.code ?? 'error', message: String(error?.message ?? error).slice(0, 1000) } })
  }
}
await write({ type: 'ready' })
let buffer = ''
for await (const chunk of Deno.stdin.readable.pipeThrough(new TextDecoderStream())) {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index)
    buffer = buffer.slice(index + 1)
    handle(line)
  }
}
`
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

class BackendProcess {
  readonly ready: Promise<void>
  #child: ChildProcessWithoutNullStreams
  #pending = new Map<number, Pending>()
  #nextId = 1
  #stdout = ''
  #exited = false
  #killed = false

  constructor (
    child: ChildProcessWithoutNullStreams,
    private readonly appId: string,
    private readonly options: Required<BackendRunnerOptions>,
    onExit: () => void,
  ) {
    this.#child = child
    let markReady: () => void
    let failStart: (error: Error) => void
    this.ready = new Promise<void>((resolve, reject) => {
      markReady = resolve
      failStart = reject
    })
    const startup = setTimeout(() => {
      failStart(new StudioProblem('app_backend_unavailable', 'The backend did not start in time.'))
      this.kill()
    }, options.startupTimeoutMs)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      this.#stdout += chunk
      if (this.#stdout.length > options.maxMessageBytes) {
        this.#failAll('The backend sent an answer that is too large.')
        this.kill()
        return
      }
      let index
      while ((index = this.#stdout.indexOf('\n')) >= 0) {
        const line = this.#stdout.slice(0, index)
        this.#stdout = this.#stdout.slice(index + 1)
        let message: { type?: string, id?: number, result?: unknown, error?: { code?: string, message?: string } }
        try {
          message = JSON.parse(line)
        } catch {
          continue
        }
        if (message.type === 'ready') {
          clearTimeout(startup)
          markReady!()
          continue
        }
        const pending = typeof message.id === 'number' ? this.#pending.get(message.id) : undefined
        if (!pending) {
          continue
        }
        this.#pending.delete(message.id!)
        clearTimeout(pending.timer)
        if (message.error) {
          pending.reject(new StudioProblem('app_backend_failed', `${message.error.message ?? 'The backend failed.'}`.slice(0, 1000)))
        } else {
          pending.resolve(message.result ?? null)
        }
      }
    })

    // App logs are untrusted: bounded, tagged, and kept apart from audit records.
    let logged = 0
    const logWindow = setInterval(() => {
      logged = 0
    }, 60_000)
    logWindow.unref()
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      for (const line of chunk.split('\n').filter(Boolean)) {
        if (logged++ < 100) {
          console.info(`[app ${this.appId}] ${line.slice(0, 500)}`)
        }
      }
    })

    child.on('exit', () => {
      this.#exited = true
      clearTimeout(startup)
      clearInterval(logWindow)
      failStart!(new StudioProblem('app_backend_unavailable', 'The backend exited during startup.'))
      this.#failAll('The backend process exited.')
      onExit()
    })
    child.on('error', () => {
      failStart!(new StudioProblem('app_backend_unavailable', 'The backend process could not be started.'))
      this.#failAll('The backend process could not be started.')
    })
    // Writing to a process that just died fails asynchronously (EPIPE); the
    // exit handler already fails its calls, and the service must not crash.
    child.stdin.on('error', () => {})
  }

  get pid (): number | undefined {
    return this.#child.pid
  }

  /** Exited, or killed and about to exit: no longer accepts calls. */
  get exited (): boolean {
    return this.#exited || this.#killed
  }

  call (method: string, params: unknown, token: string): Promise<unknown> {
    const id = this.#nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new StudioProblem('app_backend_unavailable', `The backend did not answer within ${Math.round(this.options.callTimeoutMs / 1000)} s and was stopped.`))
        this.kill()
      }, this.options.callTimeoutMs)
      this.#pending.set(id, { resolve, reject, timer })
      this.#child.stdin.write(`${JSON.stringify({ id, method, params: params ?? null, token })}\n`)
    })
  }

  kill (): void {
    if (!this.#exited && !this.#killed) {
      this.#killed = true
      this.#child.kill('SIGKILL')
    }
  }

  #failAll (detail: string) {
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer)
      pending.reject(new StudioProblem('app_backend_unavailable', detail))
      this.#pending.delete(id)
    }
  }
}

/**
 * Runs backend apps in Deno with deny-by-default permissions (ADR 0019): one
 * process per installation, started on demand, stopped when idle or
 * uninstalled, and killed when a call exceeds its time limit. A crash
 * affects only that backend; the next call starts it again.
 */
export class BackendRunner {
  readonly #options: Required<BackendRunnerOptions>
  #processes = new Map<string, { process: BackendProcess, idle: NodeJS.Timeout | undefined }>()
  #starting = new Map<string, Promise<BackendProcess>>()

  constructor (options: BackendRunnerOptions) {
    this.#options = {
      callTimeoutMs: 30_000,
      startupTimeoutMs: 10_000,
      idleTimeoutMs: 5 * 60_000,
      memoryMb: 256,
      maxMessageBytes: 16 * 1024 * 1024,
      ...options,
    }
  }

  /** The process ID of a running backend, for supervision and tests. */
  pid (installationId: string): number | undefined {
    return this.#processes.get(installationId)?.process.pid
  }

  async call (installationId: string, load: () => Promise<BackendSource>, method: string, params: unknown, token: string): Promise<unknown> {
    const process = await this.#ensure(installationId, load)
    this.#touch(installationId)
    return process.call(method, params, token)
  }

  /** Stops the backend and removes its extracted files. */
  async stop (installationId: string): Promise<void> {
    const entry = this.#processes.get(installationId)
    this.#processes.delete(installationId)
    if (entry) {
      clearTimeout(entry.idle)
      entry.process.kill()
    }
    await rm(this.#directory(installationId), { recursive: true, force: true })
  }

  dispose (): void {
    for (const [installationId, entry] of this.#processes) {
      clearTimeout(entry.idle)
      entry.process.kill()
      this.#processes.delete(installationId)
    }
  }

  #directory (installationId: string): string {
    return join(this.#options.workDir, installationId)
  }

  #touch (installationId: string) {
    const entry = this.#processes.get(installationId)
    if (!entry) {
      return
    }
    clearTimeout(entry.idle)
    entry.idle = setTimeout(() => void this.stop(installationId), this.#options.idleTimeoutMs)
    entry.idle.unref()
  }

  async #ensure (installationId: string, load: () => Promise<BackendSource>): Promise<BackendProcess> {
    const running = this.#processes.get(installationId)
    if (running && !running.process.exited) {
      return running.process
    }
    let starting = this.#starting.get(installationId)
    if (!starting) {
      starting = this.#start(installationId, load).finally(() => this.#starting.delete(installationId))
      this.#starting.set(installationId, starting)
    }
    return starting
  }

  async #start (installationId: string, load: () => Promise<BackendSource>): Promise<BackendProcess> {
    if (!existsSync(this.#options.denoPath)) {
      throw new StudioProblem('app_backend_unavailable', 'The Deno runtime for backend apps is not installed.')
    }
    const source = await load()
    const directory = this.#directory(installationId)
    await rm(directory, { recursive: true, force: true })
    for (const [path, content] of source.files) {
      const file = join(directory, path)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, content)
    }
    await writeFile(join(directory, harnessFile), harnessSource(source.entry, this.#options.capabilityUrl))

    const port = new URL(this.#options.capabilityUrl).port
    const child = spawn(this.#options.denoPath, [
      'run',
      '--no-prompt',
      '--no-remote',
      '--no-npm',
      '--no-config',
      '--no-lock',
      '--cached-only',
      `--allow-net=127.0.0.1:${port}`,
      `--v8-flags=--max-old-space-size=${this.#options.memoryMb}`,
      harnessFile,
    ], {
      cwd: directory,
      // Nothing from Studio's environment (it holds the data key).
      env: {
        DENO_DIR: join(this.#options.workDir, '.deno'),
        DENO_NO_UPDATE_CHECK: '1',
        NO_COLOR: '1',
        ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot ?? String.raw`C:\Windows` } : {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const backend = new BackendProcess(child, source.appId, this.#options, () => {
      const entry = this.#processes.get(installationId)
      if (entry?.process === backend) {
        clearTimeout(entry.idle)
        this.#processes.delete(installationId)
      }
    })
    this.#processes.set(installationId, { process: backend, idle: undefined })
    await backend.ready
    return backend
  }
}
