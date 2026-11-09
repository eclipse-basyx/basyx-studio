import { execFile } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

// Finds the tools the App Builder needs (ADR 0054). A GUI app on macOS and
// Linux does not get the user's shell PATH, so it is read once from the
// login shell, as a terminal would set it up.

export interface CommandResult {
  code: number | null
  stdout: string
  stderr: string
}

export type RunCommand = (file: string, args: string[], options: { env: NodeJS.ProcessEnv, timeoutMs: number }) => Promise<CommandResult>

export const runCommand: RunCommand = (file, args, { env, timeoutMs }) => new Promise(resolve => {
  execFile(file, args, { env, timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
    const code = error ? (typeof error.code === 'number' ? error.code : null) : 0
    resolve({ code, stdout: String(stdout), stderr: String(stderr) })
  })
})

const startMarker = '__STUDIO_PATH_START__'
const endMarker = '__STUDIO_PATH_END__'

/** The PATH between the markers, ignoring what the shell's start files print. */
export function pathFromShellOutput (output: string): string | null {
  const start = output.lastIndexOf(startMarker)
  const end = output.indexOf(endMarker, start)
  if (start === -1 || end === -1) {
    return null
  }
  const path = output.slice(start + startMarker.length, end).trim()
  return path.length > 0 ? path : null
}

/** Folders where installers put CLIs, for when the login shell gives nothing. */
export function fallbackPathEntries (platform: NodeJS.Platform, home: string): string[] {
  if (platform === 'win32') {
    return []
  }
  return [join(home, '.local', 'bin'), join(home, 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']
}

/** Joins PATH lists, keeping the first of each entry. */
export function mergePaths (...lists: (string | null | undefined)[]): string {
  const seen = new Set<string>()
  for (const list of lists) {
    for (const entry of (list ?? '').split(delimiter)) {
      if (entry && !seen.has(entry)) {
        seen.add(entry)
      }
    }
  }
  return [...seen].join(delimiter)
}

/**
 * The PATH of the user's login shell. Windows GUI apps get the full PATH, so
 * this only asks the shell on macOS and Linux.
 */
export async function loginShellPath (options: { platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv, run?: RunCommand } = {}): Promise<string> {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const run = options.run ?? runCommand
  const home = env.HOME ?? homedir()
  if (platform === 'win32') {
    return env.PATH ?? env.Path ?? ''
  }
  const shell = env.SHELL || '/bin/sh'
  // -i loads the files that version managers (nvm, asdf) hook into; stdin is
  // closed by execFile, so the shell does not wait for input.
  const result = await run(shell, ['-ilc', `printf '%s%s%s' '${startMarker}' "$PATH" '${endMarker}'`], {
    env: { HOME: home, USER: env.USER, LOGNAME: env.LOGNAME, SHELL: shell, TERM: 'dumb', PATH: env.PATH ?? '/usr/bin:/bin' },
    timeoutMs: 10_000,
  })
  return mergePaths(pathFromShellOutput(result.stdout), env.PATH, fallbackPathEntries(platform, home).join(delimiter))
}

function isExecutable (path: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(path).isFile()) {
      return false
    }
    if (platform !== 'win32') {
      accessSync(path, constants.X_OK)
    }
    return true
  } catch {
    return false
  }
}

/** The first executable named `name` on `path`, as a shell would find it. */
export function findExecutable (name: string, path: string, options: { platform?: NodeJS.Platform, pathExt?: string, exists?: (path: string) => boolean } = {}): string | null {
  const platform = options.platform ?? process.platform
  const exists = options.exists ?? (candidate => isExecutable(candidate, platform))
  const extensions = platform === 'win32' ? ['', ...(options.pathExt ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map(extension => extension.toLowerCase())] : ['']
  for (const directory of path.split(platform === 'win32' ? ';' : ':')) {
    if (!directory) {
      continue
    }
    for (const extension of extensions) {
      const candidate = join(directory, `${name}${extension}`)
      if (exists(candidate)) {
        return candidate
      }
    }
  }
  return null
}

/** The first line of `<tool> --version`, without the tool's name where it repeats it. */
export function versionFromOutput (output: string): string | null {
  const line = output.split('\n').map(entry => entry.trim()).find(Boolean)
  if (!line) {
    return null
  }
  const match = /\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?/.exec(line)
  return match ? match[0] : line.slice(0, 80)
}

/**
 * The environment of every process the App Builder starts: what tools need to
 * run, and nothing of Studio's own secrets (`STUDIO_DATA_KEY` and others) or
 * of an agent session Studio itself might run in.
 */
export function agentProcessEnv (source: NodeJS.ProcessEnv, path: string): NodeJS.ProcessEnv {
  const passed = /^(?:HOME|USER|LOGNAME|SHELL|LANG|LANGUAGE|LC_\w+|TMPDIR|TMP|TEMP|TZ|HTTPS?_PROXY|NO_PROXY|https?_proxy|no_proxy|XDG_\w+|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|PROGRAMDATA|ProgramData|PROGRAMFILES|ProgramFiles|ProgramFiles\(x86\)|SystemRoot|SYSTEMROOT|windir|WINDIR|ComSpec|COMSPEC|PATHEXT|USERNAME|COMPUTERNAME|OS|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && passed.test(key)) {
      env[key] = value
    }
  }
  env.PATH = path
  return env
}
