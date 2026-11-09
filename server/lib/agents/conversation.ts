import type { AgentSetting, ApprovalDecision, ConversationEvent, ConversationEventEnvelope, ConversationState, ConversationSummary } from '#shared/contract'
import type { AgentDefinition } from './catalog'
import type { AgentProcess } from './process'
import type { ClientConnection, RequestPermissionRequest, RequestPermissionResponse, SessionConfigOption } from '@agentclientprotocol/sdk'
import { randomUUID } from 'node:crypto'
import { client, methods, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { StudioProblem } from '../problem'
import { eventsFromUpdate, modelSetting } from './events'
import { chatRuleKey, decidePermission, permissionSubject, pickOption } from './policy'

// One chat with one coding agent over ACP (ADR 0054): the agent process, its
// session in the project folder, the events the page reads, and the
// permission requests waiting for the user. A saved chat starts `inactive`
// and starts its agent on the next prompt, resuming the agent's session
// where the agent supports it.

/** Events kept in memory per conversation for the page to read again after a reconnect. */
const maxEvents = 20_000

interface PendingApproval {
  ruleKey: string
  options: RequestPermissionRequest['options']
  event: Extract<ConversationEvent, { type: 'approval' }>
  resolve: (response: RequestPermissionResponse) => void
}

export interface ConversationHooks {
  /** Each new event, to save it. */
  onEvent?: (envelope: ConversationEventEnvelope) => void
  /** The agent's session and the chosen model, to save them. */
  onSession?: (session: { sessionId: string | null, model: string | null, title: string }) => void
  /** Runs when a turn ends, before the conversation is idle again; its events follow the turn's. */
  afterTurn?: (prompt: string) => Promise<ConversationEvent[]>
}

export interface ConversationOptions {
  id?: string
  projectId: string
  definition: AgentDefinition
  folder: string
  /** Starts the agent; called by every `start`. */
  open: () => AgentProcess
  now?: () => Date
  createdAt?: Date
  title?: string
  /** A saved chat: its events, its agent session and model. */
  history?: ConversationEventEnvelope[]
  sessionId?: string | null
  model?: string | null
  hooks?: ConversationHooks
}

export class Conversation {
  readonly id: string
  readonly projectId: string
  readonly definition: AgentDefinition
  readonly folder: string
  readonly createdAt: Date
  #title: string
  #state: ConversationState
  #model: AgentSetting | null = null
  #preferredModel: string | null
  #sessionId: string | null
  #connection: ClientConnection | null = null
  #process: AgentProcess | null = null
  #events: ConversationEventEnvelope[]
  #seq: number
  #listeners = new Set<(envelope: ConversationEventEnvelope) => void>()
  #approvals = new Map<string, PendingApproval>()
  #allowedInChat = new Set<string>()
  /** Updates the agent replays during `session/load`: the chat has them already. */
  #replaying = false
  #starting: Promise<void> | null = null
  /** Told to the agent with the next prompt, e.g. that the user undid its changes. */
  #notes: string[] = []
  #lastActive: number
  readonly #open: () => AgentProcess
  readonly #now: () => Date
  readonly #hooks: ConversationHooks

  constructor (options: ConversationOptions) {
    this.id = options.id ?? randomUUID()
    this.projectId = options.projectId
    this.definition = options.definition
    this.folder = options.folder
    this.#open = options.open
    this.#now = options.now ?? (() => new Date())
    this.#hooks = options.hooks ?? {}
    this.createdAt = options.createdAt ?? this.#now()
    this.#title = options.title ?? ''
    this.#events = options.history?.slice(-maxEvents) ?? []
    this.#seq = options.history?.at(-1)?.seq ?? 0
    this.#sessionId = options.sessionId ?? null
    this.#preferredModel = options.model ?? null
    this.#state = options.history ? 'inactive' : 'starting'
    this.#lastActive = this.#now().getTime()
    // The model list of a saved chat, as it was last shown.
    for (const { event } of this.#events) {
      if (event.type === 'state' && event.model) {
        this.#model = event.model
      }
    }
  }

  get state (): ConversationState {
    return this.#state
  }

  /** Milliseconds since the last prompt, answer or event. */
  idleFor (): number {
    return this.#now().getTime() - this.#lastActive
  }

  summary (): ConversationSummary {
    return {
      id: this.id,
      projectId: this.projectId,
      agentId: this.definition.id,
      title: this.#title,
      folder: this.folder,
      state: this.#state,
      model: this.#model,
      createdAt: this.createdAt.toISOString(),
      lastSeq: this.#seq,
    }
  }

  /** Starts the agent, once at a time; a saved or stopped chat resumes its session. */
  start (): Promise<void> {
    this.#starting ??= this.#start().finally(() => {
      this.#starting = null
    })
    return this.#starting
  }

  /** Sends a prompt; the turn runs on, and its progress arrives as events. Starts a saved chat's agent first. */
  async prompt (text: string): Promise<void> {
    if (this.#state === 'working' || this.#state === 'starting') {
      throw new StudioProblem('agent_busy', 'The agent is still working on the previous message.')
    }
    if (this.#state === 'inactive' || this.#state === 'failed') {
      await this.start()
    }
    const { connection, sessionId } = this.#ready()
    if (!this.#title) {
      this.#title = text.split('\n', 1)[0]!.slice(0, 80)
      this.#saveSession()
    }
    this.#emit({ type: 'userMessage', text })
    this.#setState('working')
    const notes = this.#notes.splice(0)
    const sent = notes.length > 0 ? `${notes.map(note => `(Note from BaSyx Studio: ${note})`).join('\n')}\n\n${text}` : text
    connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: sent }] }).then(
      result => this.#endTurn(text, result.stopReason),
      error => {
        if (this.#state !== 'working') {
          return
        }
        this.#emit({ type: 'error', message: authHint(error, this.definition) ?? messageOf(error) })
        return this.#endTurn(text, 'error')
      },
    )
  }

  /** Stops the running turn; the agent ends it with `cancelled`. */
  async cancel (): Promise<void> {
    if (this.#state !== 'working') {
      throw new StudioProblem('agent_busy', 'No turn is running.')
    }
    const { connection, sessionId } = this.#ready()
    this.#cancelApprovals()
    await connection.agent.notify(methods.agent.session.cancel, { sessionId })
  }

  /** The user's answer to a permission request. */
  answer (approvalId: string, decision: ApprovalDecision): void {
    const pending = this.#approvals.get(approvalId)
    if (!pending) {
      throw new StudioProblem('not_found', 'The request was answered already, or its turn has ended.')
    }
    this.#approvals.delete(approvalId)
    if (decision === 'allowInChat') {
      this.#allowedInChat.add(pending.ruleKey)
    }
    const allow = decision !== 'deny'
    const optionId = pickOption(pending.options, allow)
    this.#emit({ ...pending.event, state: allow ? 'allowed' : 'denied' })
    pending.resolve(optionId ? { outcome: { outcome: 'selected', optionId } } : { outcome: { outcome: 'cancelled' } })
  }

  async setModel (value: string): Promise<void> {
    if (!this.#model?.options.some(option => option.value === value)) {
      throw new StudioProblem('invalid_request', `${this.definition.name} offers no model ${value}.`)
    }
    this.#preferredModel = value
    if (this.#state === 'inactive' || this.#state === 'failed') {
      // Applied when the agent starts.
      this.#model = { ...this.#model, current: value }
      this.#saveSession()
      this.#emit({ type: 'state', state: this.#state, model: this.#model })
      return
    }
    const { connection, sessionId } = this.#ready()
    const result = await connection.agent.request(methods.agent.session.setConfigOption, { sessionId, configId: this.#model.id, value })
    this.#setModel(modelSetting(result.configOptions as SessionConfigOption[]) ?? { ...this.#model, current: value })
    this.#saveSession()
  }

  /** Adds an event that Studio itself reports, such as an undone turn. */
  record (event: ConversationEvent): void {
    this.#emit(event)
  }

  /** Tells the agent something with the next prompt. */
  noteForAgent (note: string): void {
    this.#notes.push(note)
  }

  /** Stops the agent; the chat stays and starts it again on the next prompt. */
  stop (): void {
    if (this.#state === 'idle' || this.#state === 'failed') {
      this.#setState('inactive')
      this.#stopProcess()
    }
  }

  /** Ends the chat and the agent process for good. */
  close (): void {
    this.#cancelApprovals()
    this.#setState('closed')
    this.#stopProcess()
  }

  /** Calls `listener` with every event after `afterSeq`, then with each new one. */
  subscribe (afterSeq: number, listener: (envelope: ConversationEventEnvelope) => void): () => void {
    for (const envelope of this.#events) {
      if (envelope.seq > afterSeq) {
        listener(envelope)
      }
    }
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async #start (): Promise<void> {
    if (this.#state === 'closed') {
      throw new StudioProblem('agent_unavailable', 'This chat was deleted.')
    }
    if (this.#connection && (this.#state === 'idle' || this.#state === 'working')) {
      return
    }
    this.#setState('starting')
    const agentProcess = this.#open()
    this.#process = agentProcess
    const app = client({ name: 'basyx-studio' })
      .onRequest(methods.client.session.requestPermission, ({ params, signal }) => this.#requestPermission(params, signal))
      .onNotification(methods.client.session.update, ({ params }) => {
        const { update } = params
        if (update.sessionUpdate === 'config_option_update') {
          this.#setModel(modelSetting(update.configOptions))
          return
        }
        if (this.#replaying) {
          return
        }
        for (const event of eventsFromUpdate(update)) {
          this.#emit(event)
        }
      })
    const { target } = agentProcess
    const connection = 'writable' in target ? app.connect(target) : app.connect(target)
    this.#connection = connection
    void agentProcess.exited.then(({ code, stderr }) => {
      if (this.#process !== agentProcess) {
        return
      }
      this.#connection = null
      this.#process = null
      if (this.#state === 'closed' || this.#state === 'inactive') {
        return
      }
      const last = stderr.split('\n').filter(Boolean).slice(-3).join('\n')
      this.#fail(`${this.definition.name} stopped${code === null ? '' : ` (exit code ${code})`}.${last ? `\n${last}` : ''}`)
      connection.close()
    })
    try {
      const init = await connection.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: 'basyx-studio', title: 'BaSyx Studio', version: '1' },
      })
      const session = await this.#openSession(connection, init.agentCapabilities?.loadSession === true)
      const editMode = this.definition.editMode
      if (editMode && session.modes?.availableModes.some(mode => mode.id === editMode)) {
        await connection.agent.request(methods.agent.session.setMode, { sessionId: session.sessionId, modeId: editMode })
      }
      this.#model = modelSetting(session.configOptions) ?? this.#model
      // The agent starts with the model of the user's own configuration; the
      // chat keeps the one chosen in Studio (Phase 0: Codex after a load).
      if (this.#preferredModel && this.#model && this.#model.current !== this.#preferredModel && this.#model.options.some(option => option.value === this.#preferredModel)) {
        const result = await connection.agent.request(methods.agent.session.setConfigOption, { sessionId: session.sessionId, configId: this.#model.id, value: this.#preferredModel })
        this.#model = modelSetting(result.configOptions as SessionConfigOption[]) ?? { ...this.#model, current: this.#preferredModel }
      }
      this.#sessionId = session.sessionId
      this.#saveSession()
      this.#setState('idle')
    } catch (error) {
      this.#fail(`${this.definition.name} could not start: ${messageOf(error)}`)
      this.#stopProcess()
      throw new StudioProblem('agent_unavailable', `${this.definition.name} could not start: ${messageOf(error)}`, { cause: error })
    }
  }

  async #openSession (connection: ClientConnection, canLoad: boolean): Promise<{ sessionId: string, modes?: { availableModes: { id: string }[] } | null, configOptions?: SessionConfigOption[] | null }> {
    if (this.#sessionId && canLoad) {
      this.#replaying = true
      try {
        const loaded = await connection.agent.request(methods.agent.session.load, { sessionId: this.#sessionId, cwd: this.folder, mcpServers: [] })
        return { sessionId: this.#sessionId, ...loaded }
      } catch (error) {
        this.#emit({ type: 'notice', text: `${this.definition.name} could not continue the earlier session (${messageOf(error)}), so it starts a new one in the same folder. It does not remember this chat.` })
      } finally {
        this.#replaying = false
      }
    } else if (this.#sessionId) {
      this.#emit({ type: 'notice', text: `${this.definition.name} cannot continue earlier sessions, so it starts a new one in the same folder. It does not remember this chat.` })
    }
    return await connection.agent.request(methods.agent.session.new, { cwd: this.folder, mcpServers: [] })
  }

  #stopProcess (): void {
    const agentProcess = this.#process
    this.#process = null
    this.#connection?.close()
    this.#connection = null
    agentProcess?.stop()
  }

  #ready (): { connection: ClientConnection, sessionId: string } {
    if (this.#state === 'closed') {
      throw new StudioProblem('agent_unavailable', 'This chat was deleted.')
    }
    if (!this.#connection || !this.#sessionId || this.#state === 'starting') {
      throw new StudioProblem('agent_busy', 'The agent is still starting.')
    }
    return { connection: this.#connection, sessionId: this.#sessionId }
  }

  #requestPermission (params: RequestPermissionRequest, signal: AbortSignal): Promise<RequestPermissionResponse> {
    const subject = permissionSubject(params.toolCall, this.folder)
    const decision = decidePermission(subject, this.folder, this.#allowedInChat)
    const event: Extract<ConversationEvent, { type: 'approval' }> = {
      type: 'approval',
      approvalId: randomUUID(),
      toolCallId: params.toolCall.toolCallId ?? null,
      title: params.toolCall.title ?? subject.command ?? subject.kind,
      kind: subject.kind,
      command: subject.command,
      paths: subject.paths,
      state: 'pending',
      denyEndsTurn: this.definition.denyEndsTurn,
    }
    if (decision.answer === 'allow') {
      const optionId = pickOption(params.options, true)
      if (optionId) {
        this.#emit({ ...event, state: 'autoAllowed' })
        return Promise.resolve({ outcome: { outcome: 'selected', optionId } })
      }
    }
    return new Promise(resolve => {
      this.#approvals.set(event.approvalId, { ruleKey: chatRuleKey(subject), options: params.options, event, resolve })
      this.#emit(event)
      signal.addEventListener('abort', () => {
        if (this.#approvals.delete(event.approvalId)) {
          this.#emit({ ...event, state: 'cancelled' })
          resolve({ outcome: { outcome: 'cancelled' } })
        }
      }, { once: true })
    })
  }

  #cancelApprovals (): void {
    for (const [id, pending] of this.#approvals) {
      this.#approvals.delete(id)
      this.#emit({ ...pending.event, state: 'cancelled' })
      pending.resolve({ outcome: { outcome: 'cancelled' } })
    }
  }

  async #endTurn (prompt: string, stopReason: string): Promise<void> {
    this.#cancelApprovals()
    this.#emit({ type: 'turnEnded', stopReason })
    try {
      for (const event of await this.#hooks.afterTurn?.(prompt) ?? []) {
        this.#emit(event)
      }
    } catch (error) {
      this.#emit({ type: 'error', message: messageOf(error) })
    }
    if (this.#state === 'working') {
      this.#setState('idle')
    }
  }

  #fail (message: string): void {
    if (this.#state === 'failed' || this.#state === 'closed') {
      return
    }
    this.#cancelApprovals()
    this.#emit({ type: 'error', message })
    this.#setState('failed')
  }

  #setState (state: ConversationState): void {
    if (this.#state === state) {
      return
    }
    this.#state = state
    this.#emit({ type: 'state', state, model: this.#model })
  }

  #setModel (model: AgentSetting | null): void {
    if (model) {
      this.#model = model
      this.#emit({ type: 'state', state: this.#state, model })
    }
  }

  #saveSession (): void {
    this.#hooks.onSession?.({ sessionId: this.#sessionId, model: this.#preferredModel ?? this.#model?.current ?? null, title: this.#title })
  }

  #emit (event: ConversationEvent): void {
    this.#lastActive = this.#now().getTime()
    const envelope: ConversationEventEnvelope = { seq: ++this.#seq, at: this.#now().toISOString(), event }
    this.#events.push(envelope)
    if (this.#events.length > maxEvents) {
      this.#events.splice(0, this.#events.length - maxEvents)
    }
    this.#hooks.onEvent?.(envelope)
    for (const listener of this.#listeners) {
      listener(envelope)
    }
  }
}

function messageOf (error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return String(error)
}

/** ACP's `authRequired` (-32000), in words the user can act on. */
function authHint (error: unknown, definition: AgentDefinition): string | null {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  return code === -32_000 ? `${definition.name} is not signed in. Run \`${definition.signInCommand}\` in a terminal, then send the message again.` : null
}
