import type { AgentSetting, AgentSettingKind, ApprovalDecision, ConversationEvent, ConversationEventEnvelope, ConversationState, ConversationSummary, PermissionMode } from '#shared/contract'
import type { AgentDefinition } from './catalog'
import type { PermissionSubject } from './policy'
import type { AgentProcess } from './process'
import type { ClientConnection, RequestPermissionRequest, RequestPermissionResponse, SessionConfigOption } from '@agentclientprotocol/sdk'
import { randomUUID } from 'node:crypto'
import { client, methods, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { agentSettingKinds } from '#shared/contract'
import { StudioProblem } from '../problem'
import { effortSetting, eventsFromUpdate, mergeSetting, modelSetting, speedSetting } from './events'
import { chatRuleKey, decidePermission, isReading, permissionSubject, pickOption } from './policy'

// One chat with one coding agent over ACP (ADR 0054): the agent process, its
// session in the project folder, the events the page reads, and the
// permission requests waiting for the user. A saved chat starts `inactive`
// and starts its agent on the next prompt, resuming the agent's session
// where the agent supports it.

/** Events kept in memory per conversation for the page to read again after a reconnect. */
const maxEvents = 20_000

interface PendingApproval {
  ruleKey: string
  subject: PermissionSubject
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
  /** The permission mode a new chat starts in; a saved chat takes it from its history. */
  permissionMode?: PermissionMode
  /**
   * A chat that only reads (the planning chat): Studio allows reading and
   * searching in the folder and denies every other request.
   */
  readOnly?: boolean
  hooks?: ConversationHooks
}

export class Conversation {
  readonly id: string
  readonly projectId: string
  readonly definition: AgentDefinition
  readonly folder: string
  readonly readOnly: boolean
  readonly createdAt: Date
  #title: string
  #state: ConversationState
  #model: AgentSetting | null = null
  #effort: AgentSetting | null = null
  #speed: AgentSetting | null = null
  /** The settings chosen in Studio, applied when the agent starts; the model is saved with the chat. */
  #preferred: Partial<Record<AgentSettingKind, string>> = {}
  #permissionMode: PermissionMode
  /** The session modes the running agent offers. */
  #agentModes: string[] = []
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
    this.readOnly = options.readOnly ?? false
    this.#open = options.open
    this.#now = options.now ?? (() => new Date())
    this.#hooks = options.hooks ?? {}
    this.createdAt = options.createdAt ?? this.#now()
    this.#title = options.title ?? ''
    this.#events = options.history?.slice(-maxEvents) ?? []
    this.#seq = options.history?.at(-1)?.seq ?? 0
    this.#sessionId = options.sessionId ?? null
    if (options.model) {
      this.#preferred.model = options.model
    }
    this.#state = options.history ? 'inactive' : 'starting'
    this.#lastActive = this.#now().getTime()
    // The model list and permission mode of a saved chat, as it was last shown.
    let savedMode: PermissionMode = 'ask'
    for (const { event } of this.#events) {
      if (event.type === 'state') {
        this.#model = event.model ?? this.#model
        this.#effort = event.effort ?? this.#effort
        this.#speed = event.speed ?? this.#speed
      }
      if (event.type === 'state' && event.permissionMode) {
        savedMode = event.permissionMode
      }
    }
    // Unrestricted is not kept when Studio restarts: the chat asks again.
    this.#permissionMode = options.permissionMode ?? (savedMode === 'unrestricted' ? 'ask' : savedMode)
    if (options.history) {
      this.#settleInterruptedTurn()
      if (savedMode === 'unrestricted') {
        this.#emit({ type: 'notice', text: `Studio restarted, so ${this.definition.name} asks again: the unrestricted mode is not kept.` })
        this.#emit(this.#stateEvent())
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
      effort: this.#effort,
      speed: this.#speed,
      permissionMode: this.#permissionMode,
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

  /**
   * Sends a prompt; the turn runs on, and its progress arrives as events.
   * Starts a saved chat's agent first. `shown` is what the chat shows of it,
   * when Studio wrapped the user's words in a longer prompt.
   */
  async prompt (text: string, shown = text): Promise<void> {
    if (this.#state === 'working' || this.#state === 'starting') {
      throw new StudioProblem('agent_busy', 'The agent is still working on the previous message.')
    }
    if (this.#state === 'inactive' || this.#state === 'failed') {
      await this.start()
    }
    const { connection, sessionId } = this.#ready()
    if (!this.#title && shown) {
      this.#title = shown.split('\n', 1)[0]!.slice(0, 80)
      this.#saveSession()
    }
    if (shown) {
      this.#emit({ type: 'userMessage', text: shown })
    }
    this.#setState('working')
    const notes = this.#notes.splice(0)
    const sent = notes.length > 0 ? `${notes.map(note => `(Note from BaSyx Studio: ${note})`).join('\n')}\n\n${text}` : text
    connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: sent }] }).then(
      result => this.#endTurn(text, result.stopReason, connection),
      error => {
        if (this.#state !== 'working' || this.#connection !== connection) {
          return
        }
        this.#emit({ type: 'error', message: authHint(error, this.definition) ?? messageOf(error) })
        return this.#endTurn(text, 'error', connection)
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
    await this.setSetting('model', value)
  }

  /** Sets the model, effort or speed; a stopped agent takes it when it starts. */
  async setSetting (kind: AgentSettingKind, value: string): Promise<void> {
    const setting = this.#setting(kind)
    if (!setting?.options.some(option => option.value === value)) {
      throw new StudioProblem('invalid_request', `${this.definition.name} offers no ${kind} ${value}.`)
    }
    this.#preferred[kind] = value
    if (this.#state === 'inactive' || this.#state === 'failed') {
      this.#assign(kind, { ...setting, current: value })
    } else {
      const { connection, sessionId } = this.#ready()
      const result = await connection.agent.request(methods.agent.session.setConfigOption, { sessionId, configId: setting.id, value })
      if (!this.#applyOptions(result.configOptions as SessionConfigOption[])) {
        this.#assign(kind, { ...setting, current: value })
      }
    }
    if (kind === 'model') {
      this.#saveSession()
    }
    this.#emit(this.#stateEvent())
  }

  /**
   * Switches the chat's permission mode. A running agent switches its own
   * session mode with it; requests waiting for the user are decided again.
   * The manager checks that `unrestricted` was acknowledged.
   */
  async setPermissionMode (mode: PermissionMode): Promise<void> {
    if (this.#state === 'closed') {
      throw new StudioProblem('agent_unavailable', 'This chat was deleted.')
    }
    this.#permissionMode = mode
    this.#emit(this.#stateEvent())
    if (this.#connection && this.#sessionId && this.#state !== 'starting') {
      const agentMode = this.#agentMode()
      if (agentMode) {
        await this.#connection.agent.request(methods.agent.session.setMode, { sessionId: this.#sessionId, modeId: agentMode })
      }
    }
    if (mode === 'unrestricted' && this.definition.unrestrictedMode && this.#agentModes.length > 0 && !this.#agentModes.includes(this.definition.unrestrictedMode)) {
      this.#emit({ type: 'notice', text: `${this.definition.name} does not offer its mode without checks here (its settings may turn it off), so it keeps its own checks. Studio allows everything it is asked.` })
    }
    for (const [id, pending] of this.#approvals) {
      const decision = decidePermission(pending.subject, this.folder, this.#allowedInChat, mode)
      const optionId = decision.answer === 'allow' ? pickOption(pending.options, true) : null
      if (decision.answer === 'allow' && optionId) {
        this.#approvals.delete(id)
        this.#emit({ ...pending.event, state: 'autoAllowed', reason: decision.reason })
        pending.resolve({ outcome: { outcome: 'selected', optionId } })
      }
    }
  }

  /** Settings the chat has not shown yet, as its agent reported them elsewhere; the agent's own replace them when it starts. */
  adoptSettings (settings: { effort: AgentSetting | null, speed: AgentSetting | null }): void {
    if (this.#state === 'closed' || this.#connection) {
      return
    }
    const effort = this.#effort ?? settings.effort
    const speed = this.#speed ?? settings.speed
    if (effort !== this.#effort || speed !== this.#speed) {
      this.#effort = effort
      this.#speed = speed
      this.#emit(this.#stateEvent())
    }
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
    if (this.#state === 'closed') {
      return
    }
    this.#cancelApprovals()
    if (this.#state === 'working') {
      this.#emit({ type: 'turnEnded', stopReason: 'cancelled' })
    }
    this.#setState('inactive')
    this.#stopProcess()
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
        if (this.#process !== agentProcess) {
          return
        }
        const { update } = params
        if (update.sessionUpdate === 'config_option_update') {
          if (this.#applyOptions(update.configOptions)) {
            this.#emit(this.#stateEvent())
          }
          return
        }
        // The chat has the replayed history already; the context it fills is new.
        if (this.#replaying && update.sessionUpdate !== 'usage_update') {
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
      if (this.#process !== agentProcess) {
        return
      }
      const session = await this.#openSession(connection, init.agentCapabilities?.loadSession === true)
      if (this.#process !== agentProcess) {
        return
      }
      this.#agentModes = session.modes?.availableModes.map(mode => mode.id) ?? []
      const agentMode = this.#agentMode()
      if (agentMode) {
        await connection.agent.request(methods.agent.session.setMode, { sessionId: session.sessionId, modeId: agentMode })
      }
      if (this.#process !== agentProcess) {
        return
      }
      this.#applyOptions(session.configOptions)
      // The agent starts with the settings of the user's own configuration;
      // the chat keeps those chosen in Studio (Phase 0: Codex after a load).
      for (const kind of agentSettingKinds) {
        const wanted = this.#preferred[kind]
        const setting = this.#setting(kind)
        if (wanted && setting && setting.current !== wanted && setting.options.some(option => option.value === wanted)) {
          const result = await connection.agent.request(methods.agent.session.setConfigOption, { sessionId: session.sessionId, configId: setting.id, value: wanted })
          if (this.#process !== agentProcess) {
            return
          }
          if (!this.#applyOptions(result.configOptions as SessionConfigOption[])) {
            this.#assign(kind, { ...setting, current: wanted })
          }
        }
      }
      this.#sessionId = session.sessionId
      this.#saveSession()
      this.#setState('idle')
    } catch (error) {
      if (this.#process !== agentProcess) {
        return
      }
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
        if (this.#connection !== connection) {
          throw error
        }
        this.#emit({ type: 'notice', text: `${this.definition.name} could not continue the earlier session (${messageOf(error)}), so it starts a new one in the same folder. It does not remember this chat.` })
      } finally {
        this.#replaying = false
      }
    } else if (this.#sessionId) {
      this.#emit({ type: 'notice', text: `${this.definition.name} cannot continue earlier sessions, so it starts a new one in the same folder. It does not remember this chat.` })
    }
    return await connection.agent.request(methods.agent.session.new, { cwd: this.folder, mcpServers: [] })
  }

  /**
   * A saved chat whose agent ended mid-turn (Studio restarted): its open
   * permission requests have nobody to answer them, and its running tool
   * calls will not finish. Settles them, so the chat shows what happened.
   */
  #settleInterruptedTurn (): void {
    const approvals = new Map<string, Extract<ConversationEvent, { type: 'approval' }>>()
    const tools = new Map<string, string>()
    let working = false
    for (const { event } of this.#events) {
      if (event.type === 'approval') {
        approvals.set(event.approvalId, event)
      } else if (event.type === 'toolCall' && event.status) {
        tools.set(event.toolCallId, event.status)
      } else if (event.type === 'state') {
        working = event.state === 'working' || event.state === 'starting'
      }
    }
    for (const approval of approvals.values()) {
      if (approval.state === 'pending') {
        this.#emit({ ...approval, state: 'cancelled' })
      }
    }
    for (const [toolCallId, status] of tools) {
      if (status === 'pending' || status === 'in_progress') {
        this.#emit({ type: 'toolCall', toolCallId, status: 'failed' })
      }
    }
    if (working) {
      this.#emit({ type: 'turnEnded', stopReason: 'cancelled' })
      this.#emit({ type: 'notice', text: `Studio restarted while ${this.definition.name} was working, so the turn stopped. Send a message to go on; the agent continues its session.` })
      this.#emit(this.#stateEvent('inactive'))
    }
  }

  /** The agent's session mode for the chat's permission mode, where the agent offers it. */
  #agentMode (): string | null {
    const { editMode, unrestrictedMode, readOnlyMode } = this.definition
    if (this.readOnly) {
      return readOnlyMode && this.#agentModes.includes(readOnlyMode) ? readOnlyMode : null
    }
    const wanted = this.#permissionMode === 'unrestricted' && unrestrictedMode && this.#agentModes.includes(unrestrictedMode) ? unrestrictedMode : editMode
    return wanted && this.#agentModes.includes(wanted) ? wanted : null
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
    if (this.readOnly) {
      const optionId = pickOption(params.options, isReading(subject, this.folder))
      return Promise.resolve(optionId ? { outcome: { outcome: 'selected', optionId } } : { outcome: { outcome: 'cancelled' } })
    }
    const decision = decidePermission(subject, this.folder, this.#allowedInChat, this.#permissionMode)
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
        this.#emit({ ...event, state: 'autoAllowed', reason: decision.reason })
        return Promise.resolve({ outcome: { outcome: 'selected', optionId } })
      }
    }
    return new Promise(resolve => {
      this.#approvals.set(event.approvalId, { ruleKey: chatRuleKey(subject), subject, options: params.options, event, resolve })
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

  async #endTurn (prompt: string, stopReason: string, connection: ClientConnection): Promise<void> {
    if (this.#state !== 'working' || this.#connection !== connection) {
      return
    }
    this.#cancelApprovals()
    this.#emit({ type: 'turnEnded', stopReason })
    try {
      for (const event of await this.#hooks.afterTurn?.(prompt) ?? []) {
        if (this.#state !== 'working' || this.#connection !== connection) {
          return
        }
        this.#emit(event)
      }
    } catch (error) {
      if (this.#state !== 'working' || this.#connection !== connection) {
        return
      }
      this.#emit({ type: 'error', message: messageOf(error) })
    }
    if (this.#state === 'working' && this.#connection === connection) {
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
    this.#emit(this.#stateEvent())
  }

  /** Takes the settings the agent reports; true when it reported any. */
  #applyOptions (options: SessionConfigOption[] | null | undefined): boolean {
    const model = modelSetting(options)
    const effort = effortSetting(options)
    const speed = speedSetting(options)
    if (model) {
      this.#model = mergeSetting(this.#model, model)
    }
    if (effort) {
      this.#effort = mergeSetting(this.#effort, effort)
    }
    if (speed) {
      this.#speed = mergeSetting(this.#speed, speed)
    }
    return model !== null || effort !== null || speed !== null
  }

  #setting (kind: AgentSettingKind): AgentSetting | null {
    return kind === 'model' ? this.#model : (kind === 'effort' ? this.#effort : this.#speed)
  }

  #assign (kind: AgentSettingKind, setting: AgentSetting): void {
    if (kind === 'model') {
      this.#model = setting
    } else if (kind === 'effort') {
      this.#effort = setting
    } else {
      this.#speed = setting
    }
  }

  #stateEvent (state: ConversationState = this.#state): ConversationEvent {
    return { type: 'state', state, model: this.#model, effort: this.#effort, speed: this.#speed, permissionMode: this.#permissionMode }
  }

  #saveSession (): void {
    this.#hooks.onSession?.({ sessionId: this.#sessionId, model: this.#preferred.model ?? this.#model?.current ?? null, title: this.#title })
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
