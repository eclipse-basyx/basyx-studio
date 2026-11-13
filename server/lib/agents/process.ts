import type { AgentDefinition } from './catalog'
import type { AgentApp, Stream } from '@agentclientprotocol/sdk'
import { spawn } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import { ndJsonStream } from '@agentclientprotocol/sdk'
import { commandLaunch } from './environment'

// Starts an agent as a child process that speaks ACP on its stdio
// (ADR 0054). Tests open an in-process agent instead.

export interface AgentProcess {
  /** What the ACP client connects to. */
  target: Stream | AgentApp
  /** Ends the agent. */
  stop: () => void
  /** Settles when the agent ends, with the last lines it wrote to stderr. */
  exited: Promise<{ code: number | null, stderr: string }>
}

export interface OpenAgentOptions {
  definition: AgentDefinition
  /** The installed CLI. */
  cliPath: string
  /** The Node runtime for adapters: Studio's own (Electron's, with `ELECTRON_RUN_AS_NODE`). */
  nodePath: string
  folder: string
  env: NodeJS.ProcessEnv
}

export type OpenAgent = (options: OpenAgentOptions) => AgentProcess

const stderrLines = 40

export const openAgentProcess: OpenAgent = ({ definition, cliPath, nodePath, folder, env }) => {
  const { launch } = definition
  const [command, args] = launch.runner === 'adapter'
    ? [nodePath, [launch.adapterScript!, ...launch.args]]
    : [cliPath, launch.args]
  const childEnv = { ...env, ...launch.env(cliPath), ...(launch.runner === 'adapter' ? { ELECTRON_RUN_AS_NODE: '1' } : {}) }
  // npm's Windows shims (`opencode.cmd`) start through cmd.exe, with the path quoted for it.
  const started = commandLaunch(command, args, childEnv)
  const child = spawn(started.file, started.args, {
    cwd: folder,
    env: childEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    windowsVerbatimArguments: started.windowsVerbatimArguments,
  })
  const tail: string[] = []
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    tail.push(...chunk.split('\n').filter(Boolean))
    tail.splice(0, Math.max(0, tail.length - stderrLines))
  })
  const exited = new Promise<{ code: number | null, stderr: string }>(resolve => {
    child.once('error', error => {
      tail.push(error.message)
      resolve({ code: null, stderr: tail.join('\n') })
    })
    child.once('exit', code => resolve({ code, stderr: tail.join('\n') }))
  })
  const target = ndJsonStream(Writable.toWeb(child.stdin) as WritableStream<Uint8Array>, Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>)
  return {
    target,
    stop: () => {
      if (child.exitCode === null && !child.killed) {
        child.kill()
      }
    },
    exited,
  }
}
