import type { ProjectFileEntry, ProjectTextFile } from '#shared/contract'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readdir, realpath, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { StudioProblem } from '../problem'

export const maxProjectFileBytes = 2 * 1024 * 1024
const hiddenDirectories = new Set(['.git', 'node_modules'])
const saves = new Map<string, Promise<ProjectTextFile>>()

/** Every component must stay in the source tree; links are shown but never followed. */
async function checkedPath (folder: string, path: string): Promise<string> {
  const parts = path === '' ? [] : path.split('/')
  if (path.length > 4000 || /[\\\p{Cc}]/u.test(path) || parts.some(part => !part || part === '.' || part === '..' || hiddenDirectories.has(part))) {
    throw new StudioProblem('forbidden', 'Choose a file inside the app source folder.')
  }
  let current = await realpath(folder)
  if ((await lstat(folder)).isSymbolicLink()) {
    throw new StudioProblem('forbidden', 'Symbolic links cannot be opened in the source editor.')
  }
  for (const part of parts) {
    current = join(current, part)
    if ((await lstat(current)).isSymbolicLink()) {
      throw new StudioProblem('forbidden', 'Symbolic links cannot be opened in the source editor.')
    }
  }
  return current
}

function fileError (error: unknown): never {
  if (error instanceof StudioProblem) {
    throw error
  }
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    throw new StudioProblem('not_found', 'This file or folder no longer exists. Refresh the file tree.')
  }
  if (['EACCES', 'EPERM', 'ELOOP'].includes(code ?? '')) {
    throw new StudioProblem('forbidden', 'This file or folder cannot be opened.')
  }
  throw error
}

export async function listProjectDirectory (folder: string, path = ''): Promise<ProjectFileEntry[]> {
  try {
    const entries = await readdir(await checkedPath(folder, path), { withFileTypes: true })
    const visible = entries.filter(entry => !hiddenDirectories.has(entry.name) && !entry.name.startsWith('.studio-edit-'))
    if (visible.length > 2000) {
      throw new StudioProblem('unsupported_operation', 'This folder has too many entries to display (maximum 2000).')
    }
    return visible.filter(entry => entry.isDirectory() || entry.isFile() || entry.isSymbolicLink())
      .map((entry): ProjectFileEntry => ({ name: entry.name, path: path ? `${path}/${entry.name}` : entry.name, kind: entry.isSymbolicLink() ? 'symlink' : (entry.isDirectory() ? 'directory' : 'file') }))
      .toSorted((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name, 'en', { numeric: true }))
  } catch (error) {
    return fileError(error)
  }
}

async function read (folder: string, path: string): Promise<{ file: ProjectTextFile, mode: number }> {
  const absolute = await checkedPath(folder, path)
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > maxProjectFileBytes) {
      throw new StudioProblem('unsupported_operation', 'The editor opens UTF-8 text files up to 2 MiB.')
    }
    const bytes = Buffer.alloc(maxProjectFileBytes + 1)
    let length = 0
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null)
      if (bytesRead === 0) {
        break
      }
      length += bytesRead
    }
    if (length > maxProjectFileBytes) {
      throw new StudioProblem('unsupported_operation', 'The editor opens UTF-8 text files up to 2 MiB.')
    }
    const contentBytes = bytes.subarray(0, length)
    let content: string
    try {
      // Keep a UTF-8 BOM in the model so a save preserves it.
      content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(contentBytes)
      if (content.includes('\0')) {
        throw new Error('binary')
      }
    } catch {
      throw new StudioProblem('unsupported_operation', 'This file is binary or is not UTF-8 text.')
    }
    return { file: { path, content, revision: createHash('sha256').update(contentBytes).digest('hex') }, mode: info.mode & 0o777 }
  } finally {
    await handle.close()
  }
}

export async function readProjectFile (folder: string, path: string): Promise<ProjectTextFile> {
  try {
    return (await read(folder, path)).file
  } catch (error) {
    return fileError(error)
  }
}

/** Serializes Studio saves; the revision also detects edits by an agent or another editor. */
export async function saveProjectFile (folder: string, path: string, content: string, revision: string): Promise<ProjectTextFile> {
  const key = `${folder}\0${path}`
  const saving = (saves.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
    let temporary: string | undefined
    try {
      if (Buffer.byteLength(content, 'utf8') > maxProjectFileBytes || content.includes('\0')) {
        throw new StudioProblem('unsupported_operation', 'The editor saves UTF-8 text files up to 2 MiB.')
      }
      const before = await read(folder, path)
      if (before.file.revision !== revision) {
        throw new StudioProblem('revision_conflict', 'This file changed since you opened it. Reload it before saving.')
      }
      const absolute = await checkedPath(folder, path)
      temporary = join(dirname(absolute), `.studio-edit-${randomUUID()}`)
      const handle = await open(temporary, 'wx', before.mode)
      try {
        await handle.writeFile(content, 'utf8')
        await handle.chmod(before.mode)
      } finally {
        await handle.close()
      }
      if ((await read(folder, path)).file.revision !== revision) {
        throw new StudioProblem('revision_conflict', 'This file changed since you opened it. Reload it before saving.')
      }
      await checkedPath(folder, path)
      await rename(temporary, absolute)
      return { path, content, revision: createHash('sha256').update(content, 'utf8').digest('hex') }
    } catch (error) {
      return fileError(error)
    } finally {
      if (temporary) {
        await rm(temporary, { force: true })
      }
    }
  })
  saves.set(key, saving)
  try {
    return await saving
  } finally {
    if (saves.get(key) === saving) {
      saves.delete(key)
    }
  }
}
