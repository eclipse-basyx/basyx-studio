import type { ConversationEventEnvelope } from '#shared/contract'
import type { AgentDefinition } from '../../server/lib/agents/catalog'
import { agent, methods } from '@agentclientprotocol/sdk'
import { describe, expect, it } from 'vitest'
import { agentCatalog } from '../../server/lib/agents/catalog'
import { Conversation } from '../../server/lib/agents/conversation'
import { StudioProblem } from '../../server/lib/problem'

// A fake ACP agent in the test process: it edits a file, runs an allowed and
// a forbidden command, and reports what the client answered. CI needs no
// agent account (plan, Tests).

const folder = '/work/app'

interface Fake {
  modes: string[]
  prompts: string[]
  answers: string[]
  cancelled: number
  /** Resolves the prompt that waits for a cancel. */
  release?: () => void
}

function fakeAgent (fake: Fake) {
  return agent({ name: 'fake' })
    .onRequest(methods.agent.initialize, () => ({ protocolVersion: 1, agentCapabilities: { loadSession: true } }))
    .onRequest(methods.agent.session.new, () => ({
      sessionId: 's1',
      modes: { currentModeId: 'default', availableModes: [{ id: 'default', name: 'Default' }, { id: 'acceptEdits', name: 'Accept edits' }, { id: 'bypassPermissions', name: 'Bypass permissions' }] },
      configOptions: [{ id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'small', options: [{ value: 'small', name: 'Small' }, { value: 'large', name: 'Large' }] }],
    }))
    .onRequest(methods.agent.session.setMode, ({ params }) => {
      fake.modes.push(params.modeId)
      return {}
    })
    .onRequest(methods.agent.session.setConfigOption, ({ params }) => ({
      configOptions: [{ id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: String(params.value), options: [{ value: 'small', name: 'Small' }, { value: 'large', name: 'Large' }] }],
    }))
    .onNotification(methods.agent.session.cancel, () => {
      fake.cancelled++
      fake.release?.()
    })
    .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
      const text = params.prompt.map(block => block.type === 'text' ? block.text : '').join('')
      fake.prompts.push(text)
      const update = (value: Parameters<typeof client.notify<typeof methods.client.session.update>>[1]['update']) =>
        client.notify(methods.client.session.update, { sessionId: 's1', update: value })
      if (text === 'wait') {
        await new Promise<void>(resolve => {
          fake.release = resolve
        })
        return { stopReason: 'cancelled' as const }
      }
      await update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello ' } })
      await update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'there' } })
      await update({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Write ui/App.vue', kind: 'edit', status: 'in_progress', locations: [{ path: `${folder}/ui/App.vue` }] })
      await update({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed', content: [{ type: 'diff', path: `${folder}/ui/App.vue`, oldText: null, newText: '<template />' }] })
      for (const command of ['pnpm test', 'curl https://example.com']) {
        const answer = await client.request(methods.client.session.requestPermission, {
          sessionId: 's1',
          toolCall: { toolCallId: command, title: command, kind: 'execute', rawInput: { command } },
          options: [
            { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
            { optionId: 'always', name: 'Always', kind: 'allow_always' },
            { optionId: 'no', name: 'Reject', kind: 'reject_once' },
          ],
        })
        fake.answers.push(answer.outcome.outcome === 'selected' ? answer.outcome.optionId : 'cancelled')
      }
      return { stopReason: 'end_turn' as const }
    })
}

const claude = agentCatalog(specifier => specifier).find(entry => entry.id === 'claude')!

async function started (fake: Fake, definition: AgentDefinition = claude) {
  const conversation = new Conversation({
    projectId: 'p1',
    definition,
    folder,
    open: () => ({ target: fakeAgent(fake), stop: () => {}, exited: new Promise(() => {}) }),
  })
  const events: ConversationEventEnvelope[] = []
  conversation.subscribe(0, envelope => events.push(envelope))
  await conversation.start()
  return { conversation, events }
}

async function until (check: () => boolean) {
  for (let attempt = 0; attempt < 200 && !check(); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  expect(check()).toBe(true)
}

describe('App Builder conversation over ACP (ADR 0054)', () => {
  it('stops a pending saved-session load without reporting a fallback or reviving the agent', async () => {
    let loading = false
    let release: () => void = () => {}
    let stopped = 0
    const fake = agent({ name: 'loading-test' })
      .onRequest(methods.agent.initialize, () => ({ protocolVersion: 1, agentCapabilities: { loadSession: true } }))
      .onRequest(methods.agent.session.load, async () => {
        loading = true
        await new Promise<void>(resolve => {
          release = resolve
        })
        return {}
      })
    const conversation = new Conversation({
      projectId: 'p1', definition: claude, folder, sessionId: 'saved', history: [],
      open: () => ({ target: fake, stop: () => {
        stopped++
      }, exited: new Promise(() => {}) }),
    })
    const events: ConversationEventEnvelope[] = []
    conversation.subscribe(0, envelope => events.push(envelope))
    const starting = conversation.start()
    await expect.poll(() => loading).toBe(true)
    conversation.stop()
    const lastSeq = events.at(-1)!.seq
    release()
    await starting
    expect(stopped).toBe(1)
    expect(conversation.state).toBe('inactive')
    expect(events.at(-1)!.seq).toBe(lastSeq)
    expect(events.some(({ event }) => event.type === 'notice')).toBe(false)
  })

  it('ignores completion events from an after-turn hook that finishes after shutdown', async () => {
    let finishing = false
    let release: () => void = () => {}
    const fake = agent({ name: 'completion-test' })
      .onRequest(methods.agent.initialize, () => ({ protocolVersion: 1 }))
      .onRequest(methods.agent.session.new, () => ({ sessionId: 'session' }))
      .onRequest(methods.agent.session.prompt, async ({ params }) => {
        if (params.prompt.some(block => block.type === 'text' && block.text === 'wait')) {
          await new Promise<void>(() => {})
        }
        return { stopReason: 'end_turn' as const }
      })
    const conversation = new Conversation({
      projectId: 'p1', definition: claude, folder,
      open: () => ({ target: fake, stop: () => {}, exited: new Promise(() => {}) }),
      hooks: { afterTurn: async () => {
        finishing = true
        await new Promise<void>(resolve => {
          release = resolve
        })
        return [{ type: 'checkpoint', commit: 'a'.repeat(40), message: 'Done', files: [] }]
      } },
    })
    const events: ConversationEventEnvelope[] = []
    conversation.subscribe(0, envelope => events.push(envelope))
    await conversation.start()
    await conversation.prompt('Build it')
    await expect.poll(() => finishing).toBe(true)
    conversation.stop()
    expect(conversation.state).toBe('inactive')
    // A new process may already be working when the old hook returns.
    await conversation.prompt('wait')
    const lastSeq = events.at(-1)!.seq
    release()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(conversation.state).toBe('working')
    expect(events.at(-1)!.seq).toBe(lastSeq)
    expect(events.some(({ event }) => event.type === 'checkpoint')).toBe(false)
    conversation.stop()
  })

  it('starts in the agent\'s edit mode and reads its model choice', async () => {
    const fake: Fake = { modes: [], prompts: [], answers: [], cancelled: 0 }
    const { conversation } = await started(fake)
    expect(fake.modes).toEqual(['acceptEdits'])
    expect(conversation.summary()).toMatchObject({ state: 'idle', agentId: 'claude', folder, model: { current: 'small', options: [{ value: 'small' }, { value: 'large' }] } })
    await conversation.setModel('large')
    expect(conversation.summary().model?.current).toBe('large')
    await expect(conversation.setModel('huge')).rejects.toBeInstanceOf(StudioProblem)
  })

  it('streams a turn, allows what the policy allows and asks the user for the rest', async () => {
    const fake: Fake = { modes: [], prompts: [], answers: [], cancelled: 0 }
    const { conversation, events } = await started(fake)
    await conversation.prompt('Build it')
    expect(conversation.summary()).toMatchObject({ state: 'working', title: 'Build it', projectId: 'p1' })
    await expect(conversation.prompt('again')).rejects.toBeInstanceOf(StudioProblem)

    await until(() => events.some(({ event }) => event.type === 'approval' && event.state === 'pending'))
    const pending = events.map(({ event }) => event).find(event => event.type === 'approval' && event.state === 'pending')
    expect(pending).toMatchObject({ command: 'curl https://example.com', kind: 'execute', denyEndsTurn: false })
    conversation.answer((pending as { approvalId: string }).approvalId, 'deny')
    await until(() => conversation.state === 'idle')

    expect(fake.prompts).toEqual(['Build it'])
    expect(fake.answers).toEqual(['yes', 'no'])
    const types = events.map(({ event }) => event.type === 'approval' ? `approval:${event.state}` : event.type)
    expect(types).toEqual([
      'state', 'userMessage', 'state', 'agentMessage', 'agentMessage', 'toolCall', 'toolCall',
      'approval:autoAllowed', 'approval:pending', 'approval:denied', 'turnEnded', 'state',
    ])
    expect(events.map(envelope => envelope.seq)).toEqual(events.map((_, index) => index + 1))
    expect(events[6]?.event).toEqual({ type: 'toolCall', toolCallId: 't1', status: 'completed', diffs: [{ path: `${folder}/ui/App.vue`, oldText: null, newText: '<template />' }] })
  })

  it('switches the permission mode: the agent\'s own mode, waiting requests, and no unrestricted after a restart', async () => {
    const fake: Fake = { modes: [], prompts: [], answers: [], cancelled: 0 }
    const { conversation, events } = await started(fake)
    expect(conversation.summary().permissionMode).toBe('ask')
    await conversation.prompt('Build it')
    await until(() => events.some(({ event }) => event.type === 'approval' && event.state === 'pending'))

    // The waiting request is allowed at once, and the agent drops its own checks.
    await conversation.setPermissionMode('unrestricted')
    await until(() => conversation.state === 'idle')
    expect(fake.answers).toEqual(['yes', 'yes'])
    expect(fake.modes).toEqual(['acceptEdits', 'bypassPermissions'])
    expect(events.map(({ event }) => event).findLast(event => event.type === 'approval')).toMatchObject({ command: 'curl https://example.com', state: 'autoAllowed', reason: 'unrestricted' })
    expect(conversation.summary().permissionMode).toBe('unrestricted')

    await conversation.setPermissionMode('auto')
    expect(fake.modes.at(-1)).toBe('acceptEdits')
    expect(events.at(-1)?.event).toMatchObject({ type: 'state', permissionMode: 'auto' })

    // A saved chat keeps Auto, but not Unrestricted.
    const reopen = (history: ConversationEventEnvelope[]) => new Conversation({ projectId: 'p1', definition: claude, folder, history, open: () => ({ target: fakeAgent(fake), stop: () => {}, exited: new Promise(() => {}) }) })
    expect(reopen(events.slice()).summary().permissionMode).toBe('auto')
    await conversation.setPermissionMode('unrestricted')
    const saved = reopen(events.slice())
    const restored: ConversationEventEnvelope[] = []
    saved.subscribe(0, envelope => restored.push(envelope))
    expect(saved.summary().permissionMode).toBe('ask')
    expect(restored.map(({ event }) => event).slice(-2)).toMatchObject([{ type: 'notice' }, { type: 'state', permissionMode: 'ask' }])
  })

  it('replays events after a given number to a late subscriber', async () => {
    const fake: Fake = { modes: [], prompts: [], answers: [], cancelled: 0 }
    const { conversation, events } = await started(fake)
    await conversation.prompt('Build it')
    await until(() => events.some(({ event }) => event.type === 'approval' && event.state === 'pending'))
    const late: number[] = []
    const stop = conversation.subscribe(3, envelope => late.push(envelope.seq))
    expect(late[0]).toBe(4)
    expect(late.at(-1)).toBe(events.at(-1)!.seq)
    stop()
  })

  it('remembers "Allow in this chat" for the same command', async () => {
    const fake: Fake = { modes: [], prompts: [], answers: [], cancelled: 0 }
    const { conversation, events } = await started(fake)
    await conversation.prompt('one')
    await until(() => events.some(({ event }) => event.type === 'approval' && event.state === 'pending'))
    const pending = events.map(({ event }) => event).find(event => event.type === 'approval' && event.state === 'pending') as { approvalId: string }
    conversation.answer(pending.approvalId, 'allowInChat')
    await until(() => conversation.state === 'idle')
    await conversation.prompt('two')
    await until(() => conversation.state === 'idle' && fake.answers.length === 4)
    expect(fake.answers).toEqual(['yes', 'yes', 'yes', 'yes'])
    expect(events.filter(({ event }) => event.type === 'approval' && event.state === 'pending')).toHaveLength(1)
  })

  it('cancels a running turn', async () => {
    const fake: Fake = { modes: [], prompts: [], answers: [], cancelled: 0 }
    const { conversation, events } = await started(fake)
    await conversation.prompt('wait')
    await until(() => fake.prompts.length === 1)
    await conversation.cancel()
    await until(() => conversation.state === 'idle')
    expect(fake.cancelled).toBe(1)
    expect(events.at(-2)?.event).toEqual({ type: 'turnEnded', stopReason: 'cancelled' })
  })

  it('reports an agent that stops, and starts it again with the next prompt', async () => {
    let exit: (value: { code: number | null, stderr: string }) => void = () => {}
    let opened = 0
    const conversation = new Conversation({
      projectId: 'p1',
      definition: claude,
      folder,
      open: () => {
        opened++
        return {
          target: fakeAgent({ modes: [], prompts: [], answers: [], cancelled: 0 }),
          stop: () => {},
          exited: new Promise(resolve => {
            exit = resolve
          }),
        }
      },
    })
    const events: ConversationEventEnvelope[] = []
    conversation.subscribe(0, envelope => events.push(envelope))
    await conversation.start()
    exit({ code: 1, stderr: 'boom' })
    await until(() => conversation.state === 'failed')
    expect(events.find(({ event }) => event.type === 'error')?.event).toEqual({ type: 'error', message: 'Claude Code stopped (exit code 1).\nboom' })
    await conversation.prompt('wait')
    expect(opened).toBe(2)
    expect(conversation.state).toBe('working')
  })

  it('settles the turn of a saved chat that Studio interrupted', () => {
    const at = '2026-11-09T00:00:00Z'
    const history: ConversationEventEnvelope[] = [
      { seq: 1, at, event: { type: 'state', state: 'idle', model: null } },
      { seq: 2, at, event: { type: 'userMessage', text: 'Build it' } },
      { seq: 3, at, event: { type: 'state', state: 'working', model: null } },
      { seq: 4, at, event: { type: 'toolCall', toolCallId: 't1', kind: 'execute', status: 'completed' } },
      { seq: 5, at, event: { type: 'toolCall', toolCallId: 't2', kind: 'execute', status: 'in_progress' } },
      { seq: 6, at, event: { type: 'approval', approvalId: 'a1', toolCallId: 't2', title: 'pnpm i', kind: 'execute', command: 'pnpm i', paths: [], state: 'pending', denyEndsTurn: false } },
    ]
    const saved: ConversationEventEnvelope[] = []
    const conversation = new Conversation({
      projectId: 'p1',
      definition: claude,
      folder,
      history,
      open: () => {
        throw new Error('not started')
      },
      hooks: { onEvent: envelope => saved.push(envelope) },
    })
    expect(conversation.state).toBe('inactive')
    expect(saved.map(({ event }) => event.type === 'approval' ? `approval:${event.state}` : (event.type === 'toolCall' ? `toolCall:${event.toolCallId}:${event.status}` : event.type)))
      .toEqual(['approval:cancelled', 'toolCall:t2:failed', 'turnEnded', 'notice', 'state'])
    expect(saved.map(({ seq }) => seq)).toEqual([7, 8, 9, 10, 11])

    // A chat that ended cleanly is left as it was.
    const clean: ConversationEventEnvelope[] = []
    new Conversation({ projectId: 'p1', definition: claude, folder, history: [history[0]!], open: () => {
      throw new Error('not started')
    }, hooks: { onEvent: envelope => clean.push(envelope) } })
    expect(clean).toEqual([])
  })
})
