import type { ConversationEvent } from '#shared/contract'
import { describe, expect, it } from 'vitest'
import { applyEvent, emptyTranscript, pendingApprovals } from '../../app/components/app-builder/transcript'

function fold (events: ConversationEvent[]) {
  const transcript = emptyTranscript()
  for (const [index, event] of events.entries()) {
    applyEvent(transcript, { seq: index + 1, at: '2026-11-09T00:00:00Z', event })
  }
  return transcript
}

const approval = { type: 'approval', approvalId: 'a1', toolCallId: 't2', title: 'curl x', kind: 'execute', command: 'curl x', paths: [], denyEndsTurn: false } as const

describe('App Builder transcript (ADR 0054)', () => {
  it('joins streamed chunks and updates tool calls and approvals in place', () => {
    const transcript = fold([
      { type: 'state', state: 'idle', model: null },
      { type: 'userMessage', text: 'Build it' },
      { type: 'agentThought', text: 'Let me ' },
      { type: 'agentThought', text: 'think.' },
      { type: 'agentMessage', text: 'On ' },
      { type: 'agentMessage', text: 'it.' },
      { type: 'toolCall', toolCallId: 't1', title: 'write', kind: 'edit', status: 'pending' },
      { type: 'toolCall', toolCallId: 't1', status: 'completed', locations: ['/a/x.ts'], diffs: [{ path: '/a/x.ts', oldText: null, newText: 'x' }] },
      { ...approval, state: 'pending' },
      { type: 'plan', entries: [{ content: 'Write', status: 'in_progress' }] },
      { type: 'plan', entries: [{ content: 'Write', status: 'completed' }] },
      { ...approval, state: 'denied' },
      { type: 'turnEnded', stopReason: 'end_turn' },
    ])
    expect(transcript.items.map(item => item.kind)).toEqual(['user', 'thought', 'agent', 'tool', 'approval', 'plan'])
    expect(transcript.items[1]).toMatchObject({ text: 'Let me think.' })
    expect(transcript.items[2]).toMatchObject({ text: 'On it.' })
    expect(transcript.items[3]).toMatchObject({ title: 'write', toolKind: 'edit', status: 'completed', locations: ['/a/x.ts'], diffs: [{ newText: 'x' }] })
    expect(transcript.items[4]).toMatchObject({ state: 'denied' })
    expect(transcript.items[5]).toMatchObject({ entries: [{ status: 'completed' }] })
    expect(pendingApprovals(transcript)).toEqual([])
  })

  it('notes stopped turns and errors, but not a normal end', () => {
    const transcript = fold([
      { type: 'userMessage', text: 'a' },
      { type: 'turnEnded', stopReason: 'cancelled' },
      { type: 'error', message: 'Claude Code is not signed in.' },
      { type: 'state', state: 'failed', model: null },
    ])
    expect(transcript.items.map(item => item.kind)).toEqual(['user', 'notice', 'error'])
    expect(transcript.state).toBe('failed')
  })

  it('ignores events it has already folded in, as after a reconnect', () => {
    const transcript = fold([{ type: 'agentMessage', text: 'Hi' }])
    applyEvent(transcript, { seq: 1, at: '', event: { type: 'agentMessage', text: 'Hi' } })
    expect(transcript.items).toEqual([{ kind: 'agent', id: '1', text: 'Hi' }])
  })

  it('starts a new plan after the next prompt', () => {
    const transcript = fold([
      { type: 'userMessage', text: 'a' },
      { type: 'plan', entries: [{ content: 'one', status: 'completed' }] },
      { type: 'userMessage', text: 'b' },
      { type: 'plan', entries: [{ content: 'two', status: 'pending' }] },
    ])
    expect(transcript.items.filter(item => item.kind === 'plan')).toHaveLength(2)
  })
})
