import type { RunCommand } from '../agents/environment'
import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// Studio builds a project itself (ADR 0054, plan B1): fixed commands in the
// project's folder, so what it installs as a preview is what the folder
// holds, not what an agent said it built.

export interface BuildOptions {
  pnpm: string
  env: NodeJS.ProcessEnv
  run: RunCommand
}

export interface BuildResult {
  ok: boolean
  /** The commands and the end of their output. */
  log: string
  /** The package `studio-app pack` wrote. */
  packageBytes: Uint8Array | null
}

const maxLogLines = 200

const steps = {
  // No prompts: pnpm would otherwise ask before it replaces node_modules.
  install: { args: ['install', '--config.confirm-modules-purge=false'], timeoutMs: 10 * 60_000 },
  build: { args: ['build'], timeoutMs: 5 * 60_000 },
  pack: { args: ['exec', 'studio-app', 'pack'], timeoutMs: 2 * 60_000 },
} as const

function modifiedAt (path: string): number {
  try {
    return statSync(path).mtimeMs
  } catch {
    return 0
  }
}

/** Whether `pnpm install` must run: no installed packages, or a newer manifest or lockfile. */
export function needsInstall (folder: string): boolean {
  const installed = modifiedAt(join(folder, 'node_modules', '.modules.yaml'))
  return installed === 0 || Math.max(modifiedAt(join(folder, 'package.json')), modifiedAt(join(folder, 'pnpm-lock.yaml'))) > installed
}

/** The file `studio-app pack` writes: `<id>-<version>.zip` from the manifest. */
export async function packageFileName (folder: string): Promise<string> {
  const manifest = JSON.parse(await readFile(join(folder, 'studio-app.json'), 'utf8')) as { id?: unknown, version?: unknown }
  if (typeof manifest.id !== 'string' || typeof manifest.version !== 'string') {
    throw new TypeError('studio-app.json has no id or version.')
  }
  return `${manifest.id}-${manifest.version}.zip`
}

export async function buildProject (folder: string, options: BuildOptions): Promise<BuildResult> {
  const log: string[] = []
  const order: (keyof typeof steps)[] = needsInstall(folder) ? ['install', 'build', 'pack'] : ['build', 'pack']
  for (const name of order) {
    const step = steps[name]
    log.push(`$ pnpm ${step.args.join(' ')}`)
    const result = await options.run(options.pnpm, [...step.args], { env: options.env, timeoutMs: step.timeoutMs, cwd: folder })
    log.push(...stripAnsi(`${result.stdout}\n${result.stderr}`).split('\n').filter(line => line.trim().length > 0))
    if (result.code !== 0) {
      log.push(result.code === null ? `pnpm ${name} did not finish in time.` : `pnpm ${name} failed with exit code ${result.code}.`)
      return { ok: false, log: tail(log), packageBytes: null }
    }
  }
  try {
    const path = join(folder, await packageFileName(folder))
    if (!existsSync(path)) {
      log.push(`${path} is missing after studio-app pack.`)
      return { ok: false, log: tail(log), packageBytes: null }
    }
    return { ok: true, log: tail(log), packageBytes: new Uint8Array(await readFile(path)) }
  } catch (error) {
    log.push(error instanceof Error ? error.message : String(error))
    return { ok: false, log: tail(log), packageBytes: null }
  }
}

/** Without terminal colours, which the chat cannot show. */
export function stripAnsi (text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replaceAll(/\u001B\[[\d;?]*[A-Z]/gi, '')
}

function tail (lines: string[]): string {
  return (lines.length > maxLogLines ? ['…', ...lines.slice(-maxLogLines)] : lines).join('\n')
}
