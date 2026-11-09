import type { FileGrantKind } from '#shared/file-grant-kinds'
import { randomBytes } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute } from 'node:path'
import { fileGrantExtensions, isFolderKind, isSaveKind } from '#shared/file-grant-kinds'
import { StudioProblem } from '../problem'

// Single-use handles for files the user chose in a native dialog of the
// Electron main process (ADR 0015), for the BaSyx Docker app (ADR 0033).
// AASX workspaces keep their own grants in the WorkspaceManager.

const ttlMs = 5 * 60 * 1000

interface Grant {
  path: string
  kind: FileGrantKind
  expiresAt: number
}

export class FileGrantStore {
  readonly #grants = new Map<string, Grant>()

  /** Registers a path from the main process; files to read must exist, a file to write needs its folder. */
  async grant (path: string, kind: FileGrantKind): Promise<{ handle: string, fileName: string }> {
    const extensions = fileGrantExtensions[kind].map(extension => `.${extension}`)
    const folder = isFolderKind(kind)
    if (!isAbsolute(path) || (!folder && !extensions.includes(extname(path).toLowerCase()))) {
      throw new StudioProblem('invalid_request', folder ? 'Only absolute paths of folders can be granted.' : `Only absolute paths of ${extensions.join(' or ')} files can be granted.`)
    }
    const writing = isSaveKind(kind)
    const checked = await stat(writing ? dirname(path) : path).catch(() => null)
    if (!checked || (writing || folder ? !checked.isDirectory() : !checked.isFile())) {
      throw new StudioProblem('not_found', 'The file or folder does not exist.')
    }
    const now = Date.now()
    for (const [handle, grant] of this.#grants) {
      if (grant.expiresAt < now) {
        this.#grants.delete(handle)
      }
    }
    const handle = randomBytes(24).toString('base64url')
    this.#grants.set(handle, { path, kind, expiresAt: now + ttlMs })
    return { handle, fileName: basename(path) }
  }

  /** The path behind a handle; the handle is used up. */
  take (handle: string, kind: FileGrantKind): string {
    const grant = this.#grants.get(handle)
    this.#grants.delete(handle)
    if (!grant || grant.kind !== kind || grant.expiresAt < Date.now()) {
      throw new StudioProblem('invalid_request', 'The file selection expired. Choose the file again.')
    }
    return grant.path
  }
}
