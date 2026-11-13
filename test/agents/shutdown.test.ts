import type { ConversationEventEnvelope } from '#shared/contract'
import { basename, dirname } from 'node:path'
import { agent, methods } from '@agentclientprotocol/sdk'
import { describe, expect, it } from 'vitest'
import { agentCatalog } from '../../server/lib/agents/catalog'
import { AgentManager } from '../../server/lib/agents/manager'
import { MemoryProjectStore } from '../../server/lib/app-projects/store'

async function setup (starting = false) {
  let stopped = 0
  let initialized = false
  let releaseStart: () => void = () => {}
  const store = new MemoryProjectStore()
  await store.insertProject({ id: 'project', name: 'App', appId: 'local.app', folder: '/work/app', origin: 'new', source: null, previewTargetId: null, createdAt: new Date() })
  const fake = agent({ name: 'shutdown-test' })
    .onRequest(methods.agent.initialize, async () => {
      initialized = true
      if (starting) {
        await new Promise<void>(resolve => {
          releaseStart = resolve
        })
      }
      return { protocolVersion: 1 }
    })
    .onRequest(methods.agent.session.new, () => ({ sessionId: 'session' }))
    .onRequest(methods.agent.session.prompt, async ({ client }) => {
      await client.request(methods.client.session.requestPermission, {
        sessionId: 'session',
        toolCall: { toolCallId: 'command', title: 'External command', kind: 'execute', rawInput: { command: 'curl https://example.com' } },
        options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
      })
      return { stopReason: 'end_turn' as const }
    })
  const definition = { ...agentCatalog(x => x).find(entry => entry.id === 'opencode')!, cli: basename(process.execPath) }
  const manager = new AgentManager({
    projectsDir: '/work', agents: [definition], nodePath: process.execPath, store,
    template: async () => new Map(), bundledSources: async () => new Map(), takeFolder: x => x, studioVersion: '0.2.2',
    path: async () => `${dirname(process.execPath)}:/usr/bin:/bin`, run: async () => ({ code: 0, stdout: '1.0.0', stderr: '' }),
    open: () => ({ target: fake, stop: () => {
      stopped++
    }, exited: new Promise(() => {}) }), idleStopMs: 0, previews: null, releases: null,
  })
  return { manager, store, stopped: () => stopped, initialized: () => initialized, releaseStart: () => releaseStart() }
}

describe('App Builder shutdown', () => {
  it('terminates a working agent, cancels approvals and persists the final events', async () => {
    const { manager, store, stopped } = await setup()
    const summary = await manager.startConversation('project', 'opencode')
    const conversation = await manager.conversation(summary.id)
    const events: ConversationEventEnvelope[] = []
    conversation.subscribe(0, envelope => events.push(envelope))
    await manager.prompt(summary.id, 'Build the app')
    await expect.poll(() => events.some(({ event }) => event.type === 'approval' && event.state === 'pending')).toBe(true)
    try {
      await manager.dispose()
      expect(stopped()).toBe(1)
      expect(conversation.state).toBe('inactive')
      expect(events.findLast(({ event }) => event.type === 'approval')?.event).toMatchObject({ state: 'cancelled' })
      const lastSeq = events.at(-1)!.seq
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(events.at(-1)!.seq).toBe(lastSeq)
      expect(store.events.get(summary.id)?.at(-1)?.seq).toBe(lastSeq)
    } finally {
      conversation.stop()
    }
  })

  it('terminates an agent during startup without allowing a late startup to revive it', async () => {
    const { manager, store, stopped, initialized, releaseStart } = await setup(true)
    const starting = manager.startConversation('project', 'opencode')
    await expect.poll(initialized).toBe(true)
    const id = [...store.conversations.keys()][0]!
    const conversation = await manager.conversation(id)
    const events: ConversationEventEnvelope[] = []
    conversation.subscribe(0, envelope => events.push(envelope))
    try {
      await manager.dispose()
      expect(stopped()).toBe(1)
      const lastSeq = events.at(-1)!.seq
      releaseStart()
      await starting
      expect(conversation.state).toBe('inactive')
      expect(events.at(-1)!.seq).toBe(lastSeq)
    } finally {
      releaseStart()
      await starting
      conversation.stop()
    }
  })
})
