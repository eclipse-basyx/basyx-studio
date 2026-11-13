import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listProjectDirectory, maxProjectFileBytes, readProjectFile, saveProjectFile } from '../../server/lib/app-projects/files'

describe('App Builder project files', () => {
  let root: string
  let folder: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'studio-project-files-'))
    folder = join(root, 'app')
    await mkdir(join(folder, 'ui', 'src'), { recursive: true })
    await writeFile(join(folder, 'ui', 'src', 'App.vue'), '<template>Hello</template>\n')
    await writeFile(join(folder, 'package.json'), '{}\n')
    await writeFile(join(folder, '.gitignore'), 'node_modules\n')
    await mkdir(join(folder, '.git'))
    await mkdir(join(folder, 'node_modules'))
    await writeFile(join(root, 'outside.txt'), 'private')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('lists one directory at a time, folders first, including source dotfiles', async () => {
    expect(await listProjectDirectory(folder)).toEqual([
      { name: 'ui', path: 'ui', kind: 'directory' },
      { name: '.gitignore', path: '.gitignore', kind: 'file' },
      { name: 'package.json', path: 'package.json', kind: 'file' },
    ])
    expect(await listProjectDirectory(folder, 'ui/src')).toEqual([{ name: 'App.vue', path: 'ui/src/App.vue', kind: 'file' }])
  })

  it('opens UTF-8 files, preserves a BOM, and saves atomically with their permissions', async () => {
    const path = join(folder, 'ui', 'src', 'App.vue')
    await writeFile(path, '\uFEFF<template>Grüße</template>\r\n')
    await chmod(path, 0o640)
    const before = await readProjectFile(folder, 'ui/src/App.vue')
    expect(before.content).toBe('\uFEFF<template>Grüße</template>\r\n')
    const saved = await saveProjectFile(folder, before.path, '<template>Updated</template>\n', before.revision)
    expect(saved.content).toBe('<template>Updated</template>\n')
    expect(saved.revision).not.toBe(before.revision)
    expect(await readFile(path, 'utf8')).toBe(saved.content)
    expect((await stat(path)).mode & 0o777).toBe(0o640)
  })

  it('detects changes by an agent and never overwrites a newer version', async () => {
    const opened = await readProjectFile(folder, 'package.json')
    await writeFile(join(folder, 'package.json'), '{"agent":true}')
    await expect(saveProjectFile(folder, opened.path, 'mine', opened.revision)).rejects.toMatchObject({ code: 'revision_conflict' })
    expect(await readFile(join(folder, 'package.json'), 'utf8')).toBe('{"agent":true}')
  })

  it('serializes simultaneous saves based on the same revision', async () => {
    const opened = await readProjectFile(folder, 'package.json')
    const results = await Promise.allSettled([
      saveProjectFile(folder, opened.path, 'first', opened.revision),
      saveProjectFile(folder, opened.path, 'second', opened.revision),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'revision_conflict' } })
  })

  it.each(['../outside.txt', '/etc/passwd', 'ui/../../outside.txt', String.raw`ui\src\App.vue`, '.git/config', 'node_modules/pkg/index.js', 'ui//src/App.vue'])('rejects paths outside the browsable source tree: %s', async path => {
    await expect(readProjectFile(folder, path)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(saveProjectFile(folder, path, 'overwrite', '0'.repeat(64))).rejects.toMatchObject({ code: 'forbidden' })
  })

  it.skipIf(process.platform === 'win32')('shows links without following them, including links to a directory or internal file', async () => {
    await symlink(join(root, 'outside.txt'), join(folder, 'outside.txt'))
    await symlink(root, join(folder, 'escape'))
    await symlink(join(folder, 'package.json'), join(folder, 'alias.json'))
    expect((await listProjectDirectory(folder)).find(entry => entry.name === 'outside.txt')?.kind).toBe('symlink')
    for (const path of ['outside.txt', 'alias.json', 'escape/outside.txt']) {
      await expect(readProjectFile(folder, path)).rejects.toMatchObject({ code: 'forbidden' })
    }
    await expect(listProjectDirectory(folder, 'escape')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(saveProjectFile(folder, 'outside.txt', 'overwrite', '0'.repeat(64))).rejects.toMatchObject({ code: 'forbidden' })
    expect(await readFile(join(root, 'outside.txt'), 'utf8')).toBe('private')
  })

  it('reports missing files and refuses binary, invalid UTF-8 and oversized files', async () => {
    await expect(readProjectFile(folder, 'missing.ts')).rejects.toMatchObject({ code: 'not_found' })
    for (const bytes of [Buffer.from([0, 1, 2]), Buffer.from([0xFF, 0xFE]), Buffer.alloc(maxProjectFileBytes + 1, 65)]) {
      await writeFile(join(folder, 'data.bin'), bytes)
      await expect(readProjectFile(folder, 'data.bin')).rejects.toMatchObject({ code: 'unsupported_operation' })
    }
    const opened = await readProjectFile(folder, 'package.json')
    await expect(saveProjectFile(folder, opened.path, 'ü'.repeat(maxProjectFileBytes), opened.revision)).rejects.toMatchObject({ code: 'unsupported_operation' })
    await expect(readProjectFile(folder, 'ui')).rejects.toMatchObject({ code: 'unsupported_operation' })
  })
})
