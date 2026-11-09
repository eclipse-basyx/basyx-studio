import type { ChangedFile } from '#shared/contract'
import type { RunCommand } from '../agents/environment'

// The project's git repository (ADR 0054, plan A5): Studio, not the agent,
// commits what each turn changed, shows a commit's changes, and undoes
// turns with a new commit that restores the files of an earlier one.

/** Who commits when the user has no git identity of their own. */
const fallbackIdentity = ['-c', 'user.name=BaSyx Studio App Builder', '-c', 'user.email=app-builder@basyx-studio.invalid']

export class GitError extends Error {}

export interface GitOptions {
  git: string
  env: NodeJS.ProcessEnv
  run: RunCommand
}

export class ProjectGit {
  readonly #options: GitOptions
  readonly #folder: string

  constructor (folder: string, options: GitOptions) {
    this.#folder = folder
    this.#options = options
  }

  async isRepository (): Promise<boolean> {
    const result = await this.#options.run(this.#options.git, ['-C', this.#folder, 'rev-parse', '--is-inside-work-tree'], { env: this.#options.env, timeoutMs: 10_000 })
    return result.code === 0 && result.stdout.trim() === 'true'
  }

  async init (message: string): Promise<string> {
    await this.#git(['init', '--quiet', '--initial-branch=main'])
    return (await this.commitAll(message))?.commit ?? await this.head() ?? ''
  }

  async head (): Promise<string | null> {
    const result = await this.#options.run(this.#options.git, ['-C', this.#folder, 'rev-parse', '--verify', '--quiet', 'HEAD'], { env: this.#options.env, timeoutMs: 10_000 })
    return result.code === 0 ? result.stdout.trim() : null
  }

  /** Commits everything that changed; `null` when nothing did. */
  async commitAll (message: string): Promise<{ commit: string, files: ChangedFile[] } | null> {
    await this.#git(['add', '--all'])
    const staged = await this.#git(['diff', '--cached', '--name-status', '-z'])
    const files = parseNameStatus(staged)
    if (files.length === 0) {
      return null
    }
    await this.#git([...await this.#identity(), 'commit', '--quiet', '--no-verify', '--message', message])
    return { commit: (await this.head())!, files }
  }

  /** A commit as a patch, with its changed files. */
  async show (commit: string): Promise<{ patch: string, files: ChangedFile[] }> {
    const files = parseNameStatus(await this.#git(['show', '--format=', '--name-status', '-z', commit]))
    const patch = await this.#git(['show', '--format=%s%n', '--patch', '--no-color', '--no-ext-diff', commit])
    return { patch, files }
  }

  /**
   * Undoes `commit` and every commit after it: the files return to the
   * state before it, in a new commit, so nothing in the history is lost.
   */
  async undo (commit: string, message: string): Promise<{ commit: string, files: ChangedFile[] } | null> {
    await this.#git(['rev-parse', '--verify', '--quiet', `${commit}^{commit}`])
    await this.#git(['restore', `--source=${commit}^`, '--staged', '--worktree', '--', ':/'])
    return await this.commitAll(message)
  }

  async #git (args: string[], timeoutMs = 60_000): Promise<string> {
    const result = await this.#options.run(this.#options.git, ['-C', this.#folder, ...args], { env: this.#options.env, timeoutMs })
    if (result.code !== 0) {
      throw new GitError(`git ${args[0]} failed: ${(result.stderr || result.stdout).trim().split('\n').slice(-3).join('\n')}`)
    }
    return result.stdout
  }

  /** The `-c` options that give commits an author when the user configured none. */
  async #identity (): Promise<string[]> {
    const result = await this.#options.run(this.#options.git, ['-C', this.#folder, 'config', 'user.email'], { env: this.#options.env, timeoutMs: 10_000 })
    return result.code === 0 && result.stdout.trim() ? [] : fallbackIdentity
  }
}

const statuses: Record<string, ChangedFile['status']> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'added', T: 'modified' }

/** `git … --name-status -z`: status, NUL, path (renames: status, NUL, old, NUL, new). */
export function parseNameStatus (output: string): ChangedFile[] {
  const parts = output.split('\0').filter(Boolean)
  const files: ChangedFile[] = []
  for (let index = 0; index < parts.length; index++) {
    const code = parts[index]![0]!
    const status = statuses[code] ?? 'modified'
    index += code === 'R' || code === 'C' ? 2 : 1
    const path = parts[index]
    if (path) {
      files.push({ path, status })
    }
  }
  return files
}
