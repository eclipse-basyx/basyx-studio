import { describe, expect, it } from 'vitest'
import { FileWorkspace } from '../../app/components/app-builder/file-workspace'

describe('App Builder editor tabs', () => {
  const file = (path: string, content = 'original') => ({ path, content, revision: 'a'.repeat(64) })

  it('keeps multiple open files and preserves drafts when another file or project is opened', () => {
    const workspace = new FileWorkspace()
    const first = workspace.open('app-a', file('ui/App.vue'))
    first.draft = 'my unsaved edit'
    workspace.open('app-a', file('package.json'))
    workspace.open('app-b', file('ui/App.vue', 'another app'))
    expect(workspace.tabs('app-a')).toHaveLength(2)
    expect(workspace.active('app-b')?.draft).toBe('another app')
    expect(workspace.open('app-a', file('ui/App.vue', 'changed on disk')).draft).toBe('my unsaved edit')
    expect(workspace.active('app-a')?.path).toBe('ui/App.vue')
    expect(workspace.dirty).toBe(true)
  })

  it('requires explicit discard to close a dirty tab and selects a remaining tab', () => {
    const workspace = new FileWorkspace()
    const first = workspace.open('a', file('first.ts'))
    const second = workspace.open('a', file('second.ts'))
    second.draft = 'edited'
    expect(workspace.close(second)).toBe(false)
    expect(workspace.tabs('a')).toHaveLength(2)
    expect(workspace.close(second, true)).toBe(true)
    expect(workspace.active('a')).toBe(first)
    expect(workspace.dirty).toBe(false)
    expect(workspace.close(first)).toBe(true)
    expect(workspace.active('a')).toBeNull()
  })

  it('marks saved content as the baseline without replacing edits typed during the save', () => {
    const workspace = new FileWorkspace()
    const document = workspace.open('a', file('first.ts'))
    document.draft = 'latest typing'
    workspace.saved(document, { ...file('first.ts', 'saved version'), revision: 'b'.repeat(64) })
    expect(document.draft).toBe('latest typing')
    expect(document.content).toBe('saved version')
    expect(document.revision).toBe('b'.repeat(64))
    expect(workspace.dirty).toBe(true)
  })
})
