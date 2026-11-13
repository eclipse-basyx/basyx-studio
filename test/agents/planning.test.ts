import { describe, expect, it } from 'vitest'
import { splitReply } from '#shared/app-builder-planning'
import { buildFromPlanPrompt, planningPrompt } from '../../server/lib/agents/planning'
import { isReading, permissionSubject } from '../../server/lib/agents/policy'

describe('App Builder planning chat (ADR 0054)', () => {
  it('splits a reply into what the chat shows and the document', () => {
    const reply = 'I added R3.\n\nShould the list refresh?\n\n````studio-requirements\n# Shell List\n\n```ts\nconst a = 1\n```\n\n1. R1 lists shells\n````\n'
    expect(splitReply(reply, 'requirements')).toEqual({
      reply: 'I added R3.\n\nShould the list refresh?',
      document: '# Shell List\n\n```ts\nconst a = 1\n```\n\n1. R1 lists shells',
      partial: false,
    })
    // Another stage's block is not this stage's document.
    expect(splitReply(reply, 'plan').document).toBeNull()
    // While the agent writes, the open block is the document so far.
    expect(splitReply('Here it is.\n````studio-plan\n# Plan\n1. Scaffold', 'plan')).toEqual({ reply: 'Here it is.', document: '# Plan\n1. Scaffold', partial: true })
    // The last block counts.
    expect(splitReply('```studio-plan\nold\n```\nBetter:\n```studio-plan\nnew\n```', 'plan').document).toBe('new')
    expect(splitReply('Just a question?', 'plan')).toEqual({ reply: 'Just a question?', document: null, partial: false })
  })

  it('asks for a stage\'s first draft, and passes the user\'s edits and message on', () => {
    const first = planningPrompt({ stage: 'requirements', message: '', name: 'Shell List', idea: 'List the shells', requirements: '', plan: '' })
    expect(first).toContain('App name: Shell List')
    expect(first).toContain('List the shells')
    expect(first).toContain('`studio-requirements`')
    expect(first).toContain('Write the first draft of the requirements')
    expect(first).toContain('Do not create, edit or delete files')
    expect(first).toContain('Do not write the app ID or package name into the documents')

    const plan = planningPrompt({ stage: 'plan', message: 'Use a table', name: 'Shell List', idea: 'List the shells', requirements: '1. R1 lists shells', plan: '1. Scaffold' })
    expect(plan).toContain('`studio-plan`')
    expect(plan).toContain('agreed; do not change them here):\n\n1. R1 lists shells')
    expect(plan).toContain('The plan as it stands, with the user\'s own edits')
    expect(plan).toMatch(/The user writes:\nUse a table$/)
    expect(buildFromPlanPrompt('List the shells')).toMatch(/^Build this app as described in docs\/requirements\.md, following docs\/plan\.md\./)
    expect(buildFromPlanPrompt('List the shells')).toContain('The app ID and package name in studio-app.json and package.json are the right ones')
  })

  it('lets a planning chat read and search in its folder, and nothing else', () => {
    const folder = '/tmp/draft'
    expect(isReading(permissionSubject({ kind: 'read', locations: [{ path: '/tmp/draft/AGENTS.md' }] }, folder), folder)).toBe(true)
    expect(isReading(permissionSubject({ kind: 'search', rawInput: { path: 'ui' } }, folder), folder)).toBe(true)
    expect(isReading(permissionSubject({ kind: 'read', locations: [{ path: '/etc/passwd' }] }, folder), folder)).toBe(false)
    expect(isReading(permissionSubject({ kind: 'edit', locations: [{ path: '/tmp/draft/a.ts' }] }, folder), folder)).toBe(false)
    expect(isReading(permissionSubject({ kind: 'execute', rawInput: { command: 'ls' } }, folder), folder)).toBe(false)
  })
})
