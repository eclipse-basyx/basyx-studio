import type { AgentId, AppProjectOrigin, ConversationEventEnvelope } from '#shared/contract'
import type { StudioDatabase } from '../database/client'
import { asc, eq, max } from 'drizzle-orm'
import { appBuilderConversations, appBuilderEvents, appProjects } from '../../database/schema'

// Where the App Builder keeps its projects and chats (ADR 0054). The
// manager uses this interface, so tests can keep them in memory.

export interface ProjectRecord {
  id: string
  name: string
  appId: string
  folder: string
  origin: AppProjectOrigin
  source: string | null
  previewTargetId: string | null
  createdAt: Date
}

export interface ConversationRecord {
  id: string
  projectId: string
  agentId: AgentId
  title: string
  sessionId: string | null
  model: string | null
  createdAt: Date
  /** The number of its last event; 0 without events. */
  lastSeq: number
}

export interface ProjectStore {
  listProjects: () => Promise<ProjectRecord[]>
  insertProject: (project: ProjectRecord) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  listConversations: () => Promise<ConversationRecord[]>
  insertConversation: (conversation: Omit<ConversationRecord, 'lastSeq'>) => Promise<void>
  updateConversation: (id: string, values: Pick<ConversationRecord, 'title' | 'sessionId' | 'model'>) => Promise<void>
  deleteConversation: (id: string) => Promise<void>
  loadEvents: (conversationId: string) => Promise<ConversationEventEnvelope[]>
  appendEvents: (conversationId: string, envelopes: ConversationEventEnvelope[]) => Promise<void>
}

export class DatabaseProjectStore implements ProjectStore {
  readonly #db: StudioDatabase

  constructor (db: StudioDatabase) {
    this.#db = db
  }

  async listProjects (): Promise<ProjectRecord[]> {
    return await this.#db.select().from(appProjects).orderBy(asc(appProjects.createdAt))
  }

  async insertProject (project: ProjectRecord): Promise<void> {
    await this.#db.insert(appProjects).values(project)
  }

  async deleteProject (id: string): Promise<void> {
    await this.#db.delete(appProjects).where(eq(appProjects.id, id))
  }

  async listConversations (): Promise<ConversationRecord[]> {
    const lastSeqs = this.#db.select({ conversationId: appBuilderEvents.conversationId, lastSeq: max(appBuilderEvents.seq).as('last_seq') })
      .from(appBuilderEvents)
      .groupBy(appBuilderEvents.conversationId)
      .as('last_seqs')
    const rows = await this.#db.select({
      id: appBuilderConversations.id,
      projectId: appBuilderConversations.projectId,
      agentId: appBuilderConversations.agentId,
      title: appBuilderConversations.title,
      sessionId: appBuilderConversations.sessionId,
      model: appBuilderConversations.model,
      createdAt: appBuilderConversations.createdAt,
      lastSeq: lastSeqs.lastSeq,
    })
      .from(appBuilderConversations)
      .leftJoin(lastSeqs, eq(lastSeqs.conversationId, appBuilderConversations.id))
      .orderBy(asc(appBuilderConversations.createdAt))
    return rows.map(row => ({ ...row, lastSeq: row.lastSeq ?? 0 }))
  }

  async insertConversation (conversation: Omit<ConversationRecord, 'lastSeq'>): Promise<void> {
    await this.#db.insert(appBuilderConversations).values(conversation)
  }

  async updateConversation (id: string, values: Pick<ConversationRecord, 'title' | 'sessionId' | 'model'>): Promise<void> {
    await this.#db.update(appBuilderConversations).set({ ...values, updatedAt: new Date() }).where(eq(appBuilderConversations.id, id))
  }

  async deleteConversation (id: string): Promise<void> {
    await this.#db.delete(appBuilderConversations).where(eq(appBuilderConversations.id, id))
  }

  async loadEvents (conversationId: string): Promise<ConversationEventEnvelope[]> {
    const rows = await this.#db.select().from(appBuilderEvents).where(eq(appBuilderEvents.conversationId, conversationId)).orderBy(asc(appBuilderEvents.seq))
    return rows.map(row => ({ seq: row.seq, at: row.at.toISOString(), event: row.event }))
  }

  async appendEvents (conversationId: string, envelopes: ConversationEventEnvelope[]): Promise<void> {
    if (envelopes.length > 0) {
      await this.#db.insert(appBuilderEvents)
        .values(envelopes.map(envelope => ({ conversationId, seq: envelope.seq, at: new Date(envelope.at), event: envelope.event })))
        .onConflictDoNothing()
    }
  }
}

/** For tests: the same store in memory. */
export class MemoryProjectStore implements ProjectStore {
  readonly projects = new Map<string, ProjectRecord>()
  readonly conversations = new Map<string, Omit<ConversationRecord, 'lastSeq'>>()
  readonly events = new Map<string, ConversationEventEnvelope[]>()

  async listProjects () {
    return [...this.projects.values()]
  }

  async insertProject (project: ProjectRecord) {
    this.projects.set(project.id, project)
  }

  async deleteProject (id: string) {
    this.projects.delete(id)
    for (const [conversationId, conversation] of this.conversations) {
      if (conversation.projectId === id) {
        await this.deleteConversation(conversationId)
      }
    }
  }

  async listConversations () {
    return [...this.conversations.values()].map(conversation => ({ ...conversation, lastSeq: this.events.get(conversation.id)?.at(-1)?.seq ?? 0 }))
  }

  async insertConversation (conversation: Omit<ConversationRecord, 'lastSeq'>) {
    this.conversations.set(conversation.id, conversation)
  }

  async updateConversation (id: string, values: Pick<ConversationRecord, 'title' | 'sessionId' | 'model'>) {
    const conversation = this.conversations.get(id)
    if (conversation) {
      this.conversations.set(id, { ...conversation, ...values })
    }
  }

  async deleteConversation (id: string) {
    this.conversations.delete(id)
    this.events.delete(id)
  }

  async loadEvents (conversationId: string) {
    return [...this.events.get(conversationId) ?? []]
  }

  async appendEvents (conversationId: string, envelopes: ConversationEventEnvelope[]) {
    this.events.set(conversationId, [...this.events.get(conversationId) ?? [], ...envelopes])
  }
}

/**
 * Saves a chat's events in batches: a turn streams many small chunks, and
 * one insert per chunk would hold up the database for nothing.
 */
export class EventWriter {
  readonly #store: ProjectStore
  readonly #queue = new Map<string, ConversationEventEnvelope[]>()
  #timer: ReturnType<typeof setTimeout> | null = null
  #writing: Promise<void> = Promise.resolve()

  constructor (store: ProjectStore, readonly delayMs = 250) {
    this.#store = store
  }

  add (conversationId: string, envelope: ConversationEventEnvelope): void {
    const queue = this.#queue.get(conversationId) ?? []
    queue.push(envelope)
    this.#queue.set(conversationId, queue)
    this.#timer ??= setTimeout(() => void this.flush(), this.delayMs)
  }

  /** Writes what is queued; resolves when everything added so far is saved. */
  flush (): Promise<void> {
    if (this.#timer) {
      clearTimeout(this.#timer)
      this.#timer = null
    }
    const batches = [...this.#queue]
    this.#queue.clear()
    this.#writing = this.#writing.then(async () => {
      for (const [conversationId, envelopes] of batches) {
        try {
          await this.#store.appendEvents(conversationId, envelopes)
        } catch (error) {
          // A deleted chat's late events have nowhere to go.
          console.warn(`[app-builder] could not save events of ${conversationId}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    })
    return this.#writing
  }
}
