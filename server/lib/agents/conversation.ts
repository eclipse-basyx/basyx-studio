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
// permission requests waiting for the user.

/** Events kept per conversation for the page to read again after a reconnect. */
const maxEvents = 20_000

interface PendingApproval {
  ruleKey: string
  options: RequestPermissionRequest['options']
  event: Extract<ConversationEvent, { type: 'approval' }>
  resolve: (response: RequestPermissionResponse) => void
}

export interface ConversationOptions {
  id?: string
  definition: AgentDefinition
  folder: string
  /** Starts the agent; called once by `start`. */
  open: () => AgentProcess
  now?: () => Date
}

export class Conversation {
  readonly id: string
  readonly definition: AgentDefinition
  readonly folder: string
  readonly createdAt: Date
  #title = ''
  #state: ConversationState = 'starting'
  #model: AgentSetting | null = null
  #sessionId: string | null = null
  #connection: ClientConnection | null = null
  #process: AgentProcess | null = null
  #events: ConversationEventEnvelope[] = []
  #seq = 0
  #listeners = new Set<(envelope: ConversationEventEnvelope) => void>()
  #approvals = new Map<string, PendingApproval>()
  #allowedInChat = new Set<string>()
  readonly #open: () => AgentProcess
  readonly #now: () => Date

  constructor (options: ConversationOptions) {
    this.id = options.id ?? randomUUID()
    this.definition = options.definition
    this.folder = options.folder
    this.#open = options.open
    this.#now = options.now ?? (() => new Date())
    this.createdAt = this.#now()
  }

  get state (): ConversationState {
    return this.#state
  }

  summary (): ConversationSummary {
    return {
      id: this.id,
      agentId: this.definition.id,
      title: this.#title,
      folder: this.folder,
      state: this.#state,
      model: this.#model,
      createdAt: this.createdAt.toISOString(),
      lastSeq: this.#seq,
    }
  }

  /** Starts the agent and opens its session in the folder. */
  async start (): Promise<void> {
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
        for (const event of eventsFromUpdate(update)) {
          this.#emit(event)
        }
      })
    const { target } = agentProcess
    const connection = 'writable' in target ? app.connect(target) : app.connect(target)
    this.#connection = connection
    void agentProcess.exited.then(({ code, stderr }) => {
      if (this.#state === 'closed') {
        return
      }
      const last = stderr.split('\n').filter(Boolean).slice(-3).join('\n')
      this.#fail(`${this.definition.name} stopped${code === null ? '' : ` (exit code ${code})`}.${last ? `\n${last}` : ''}`)
      connection.close()
    })
    try {
      await connection.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: 'basyx-studio', title: 'BaSyx Studio', version: '1' },
      })
      const session = await connection.agent.request(methods.agent.session.new, { cwd: this.folder, mcpServers: [] })
      this.#sessionId = session.sessionId
      this.#model = modelSetting(session.configOptions)
      const editMode = this.definition.editMode
      if (editMode && session.modes?.availableModes.some(mode => mode.id === editMode)) {
        await connection.agent.request(methods.agent.session.setMode, { sessionId: session.sessionId, modeId: editMode })
      }
      this.#setState('idle')
    } catch (error) {
      this.#fail(`${this.definition.name} could not start: ${messageOf(error)}`)
      this.close()
      throw new StudioProblem('agent_unavailable', `${this.definition.name} could not start: ${messageOf(error)}`, { cause: error })
    }
  }

  /** Sends a prompt; the turn runs on, and its progress arrives as events. */
  prompt (text: string): void {
    const { connection, sessionId } = this.#ready()
    if (this.#state === 'working') {
      throw new StudioProblem('agent_busy', 'The agent is still working on the previous message.')
    }
    if (!this.#title) {
      this.#title = text.split('\n', 1)[0]!.slice(0, 80)
    }
    this.#emit({ type: 'userMessage', text })
    this.#setState('working')
    connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text }] }).then(
      result => this.#endTurn(result.stopReason),
      error => {
        if (this.#state !== 'working') {
          return
        }
        this.#emit({ type: 'error', message: authHint(error, this.definition) ?? messageOf(error) })
        this.#endTurn('error')
      },
    )
  }

  /** Stops the running turn; the agent ends it with `cancelled`. */
  async cancel (): Promise<void> {
    const { connection, sessionId } = this.#ready()
    if (this.#state !== 'working') {
      throw new StudioProblem('agent_busy', 'No turn is running.')
    }
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
    const { connection, sessionId } = this.#ready()
    if (!this.#model) {
      throw new StudioProblem('invalid_request', `${this.definition.name} offers no model choice.`)
    }
    if (!this.#model.options.some(option => option.value === value)) {
      throw new StudioProblem('invalid_request', `${this.definition.name} offers no model ${value}.`)
    }
    const result = await connection.agent.request(methods.agent.session.setConfigOption, { sessionId, configId: this.#model.id, value })
    this.#setModel(modelSetting(result.configOptions as SessionConfigOption[]) ?? { ...this.#model, current: value })
  }

  /** Ends the chat and the agent process. */
  close (): void {
    this.#cancelApprovals()
    if (this.#state !== 'failed') {
      this.#setState('closed')
    }
    this.#connection?.close()
    this.#process?.stop()
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

  #ready (): { connection: ClientConnection, sessionId: string } {
    if (!this.#connection || !this.#sessionId || this.#state === 'starting') {
      throw new StudioProblem('agent_busy', 'The agent is still starting.')
    }
    if (this.#state === 'closed' || this.#state === 'failed') {
      throw new StudioProblem('agent_unavailable', 'This conversation has ended. Start a new one.')
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

  #endTurn (stopReason: string): void {
    this.#cancelApprovals()
    this.#emit({ type: 'turnEnded', stopReason })
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
    this.#state = state
    this.#emit({ type: 'state', state, model: this.#model })
  }

  #setModel (model: AgentSetting | null): void {
    if (model) {
      this.#model = model
      this.#emit({ type: 'state', state: this.#state, model })
    }
  }

  #emit (event: ConversationEvent): void {
    const envelope: ConversationEventEnvelope = { seq: ++this.#seq, at: this.#now().toISOString(), event }
    this.#events.push(envelope)
    if (this.#events.length > maxEvents) {
      this.#events.splice(0, this.#events.length - maxEvents)
    }
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
  return code === -32_000 ? `${definition.name} is not signed in. Run \`${definition.signInCommand}\` in a terminal, then start a new chat.` : null
}
