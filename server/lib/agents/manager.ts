import type { AgentId, AgentStatus, AppBuilderStatus, ApprovalDecision, ConversationSummary, ToolStatus } from '#shared/contract'
import type { AgentDefinition } from './catalog'
import type { RunCommand } from './environment'
import type { OpenAgent } from './process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { StudioProblem } from '../problem'
import { Conversation } from './conversation'
import { agentProcessEnv, findExecutable, loginShellPath, runCommand, versionFromOutput } from './environment'
import { openAgentProcess } from './process'

// The App Builder's agents and conversations on the desktop (ADR 0054).
// Phase A keeps conversations in memory, each in a scratch folder; projects
// with their own folders and saved chats follow in phase B.

export interface AgentManagerOptions {
  /** Studio's data folder for the App Builder. */
  dataDir: string
  agents: AgentDefinition[]
  /** The Node runtime for the adapters (Studio's own). */
  nodePath: string
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  run?: RunCommand
  open?: OpenAgent
  /** The PATH to search; read from the login shell when not given. */
  path?: () => Promise<string>
  now?: () => Date
}

interface Discovery {
  status: AppBuilderStatus
  path: string
  cliPaths: Partial<Record<AgentId, string>>
}

const checkTimeoutMs = 15_000

export class AgentManager {
  readonly #options: AgentManagerOptions
  readonly #conversations = new Map<string, Conversation>()
  #discovery: Promise<Discovery> | null = null

  constructor (options: AgentManagerOptions) {
    this.#options = options
  }

  /** Which agents and tools are installed; checked once, or again on `refresh`. */
  async status (refresh = false): Promise<AppBuilderStatus> {
    return (await this.#discover(refresh)).status
  }

  conversations (): ConversationSummary[] {
    return [...this.#conversations.values()]
      .filter(conversation => conversation.state !== 'closed')
      .map(conversation => conversation.summary())
  }

  get (conversationId: string): Conversation {
    const conversation = this.#conversations.get(conversationId)
    if (!conversation) {
      throw new StudioProblem('not_found', 'The conversation does not exist.')
    }
    return conversation
  }

  async start (agentId: AgentId): Promise<ConversationSummary> {
    let discovery = await this.#discover(false)
    let status = discovery.status.agents.find(agent => agent.id === agentId)
    if (status?.state !== 'ready') {
      // The user may have installed or signed in since the last check.
      discovery = await this.#discover(true)
      status = discovery.status.agents.find(agent => agent.id === agentId)
    }
    const definition = this.#options.agents.find(agent => agent.id === agentId)!
    const cliPath = discovery.cliPaths[agentId]
    if (status?.state !== 'ready' || !cliPath) {
      throw new StudioProblem('agent_unavailable', status?.state === 'signedOut'
        ? `${definition.name} is not signed in. Run \`${definition.signInCommand}\` in a terminal.`
        : `${definition.name} was not found on this computer.`)
    }
    const id = randomUUID()
    const folder = join(this.#options.dataDir, 'scratch', id)
    mkdirSync(folder, { recursive: true })
    const env = agentProcessEnv(this.#options.env ?? process.env, discovery.path)
    const open = this.#options.open ?? openAgentProcess
    const started = new Conversation({
      id,
      definition,
      folder,
      open: () => open({ definition, cliPath, nodePath: this.#options.nodePath, folder, env }),
      now: this.#options.now,
    })
    this.#conversations.set(started.id, started)
    try {
      await started.start()
    } catch (error) {
      this.#conversations.delete(started.id)
      throw error
    }
    return started.summary()
  }

  prompt (conversationId: string, text: string): void {
    this.get(conversationId).prompt(text)
  }

  async cancel (conversationId: string): Promise<void> {
    await this.get(conversationId).cancel()
  }

  answer (conversationId: string, approvalId: string, decision: ApprovalDecision): void {
    this.get(conversationId).answer(approvalId, decision)
  }

  async setModel (conversationId: string, value: string): Promise<ConversationSummary> {
    const conversation = this.get(conversationId)
    await conversation.setModel(value)
    return conversation.summary()
  }

  close (conversationId: string): void {
    this.get(conversationId).close()
    this.#conversations.delete(conversationId)
  }

  dispose (): void {
    for (const conversation of this.#conversations.values()) {
      conversation.close()
    }
    this.#conversations.clear()
  }

  #discover (refresh: boolean): Promise<Discovery> {
    if (!this.#discovery || refresh) {
      const discovery = this.#runDiscovery()
      this.#discovery = discovery
      // A failed check is tried again next time.
      discovery.catch(() => {
        if (this.#discovery === discovery) {
          this.#discovery = null
        }
      })
    }
    return this.#discovery
  }

  async #runDiscovery (): Promise<Discovery> {
    const platform = this.#options.platform ?? process.platform
    const sourceEnv = this.#options.env ?? process.env
    const path = await (this.#options.path ?? (() => loginShellPath({ platform, env: sourceEnv })))()
    const env = agentProcessEnv(sourceEnv, path)
    const run = this.#options.run ?? runCommand
    const find = (name: string) => findExecutable(name, path, { platform, pathExt: sourceEnv.PATHEXT })
    const version = async (file: string | null) => file ? versionFromOutput((await run(file, ['--version'], { env, timeoutMs: checkTimeoutMs })).stdout) : null

    const cliPaths: Partial<Record<AgentId, string>> = {}
    const agents = await Promise.all(this.#options.agents.map(async (definition): Promise<AgentStatus> => {
      const base = { id: definition.id, name: definition.name, signInCommand: definition.signInCommand, installUrl: definition.installUrl }
      const file = find(definition.cli) ?? (definition.id === 'opencode' ? opencodeDesktopCli(platform, sourceEnv) : null)
      if (!file) {
        return { ...base, state: 'missing', version: null, path: null, detail: null }
      }
      if (definition.launch.runner === 'adapter' && !definition.launch.adapterScript) {
        return { ...base, state: 'error', version: null, path: file, detail: 'Studio\'s ACP adapter for this agent is missing from this build.' }
      }
      cliPaths[definition.id] = file
      try {
        const [cliVersion, signedIn] = await Promise.all([
          version(file),
          definition.signInCheck
            ? run(file, definition.signInCheck.args, { env, timeoutMs: checkTimeoutMs }).then(result => definition.signInCheck!.signedIn(result))
            : Promise.resolve(true),
        ])
        return { ...base, state: signedIn ? 'ready' : 'signedOut', version: cliVersion, path: file, detail: null }
      } catch (error) {
        return { ...base, state: 'error', version: null, path: file, detail: error instanceof Error ? error.message : String(error) }
      }
    }))
    const tools = await Promise.all((['node', 'pnpm', 'git'] as const).map(async (name): Promise<ToolStatus> => {
      const file = find(name)
      return { name, path: file, version: await version(file).catch(() => null) }
    }))
    const now = this.#options.now?.() ?? new Date()
    return { status: { agents, tools, checkedAt: now.toISOString() }, path, cliPaths }
  }
}

/**
 * The CLI that the OpenCode desktop app keeps in its data folder, newest
 * version first; a link to it on the PATH breaks when the app updates.
 */
export function opencodeDesktopCli (platform: NodeJS.Platform, env: NodeJS.ProcessEnv, list: (path: string) => string[] = safeList): string | null {
  const home = env.HOME ?? homedir()
  const base = platform === 'darwin'
    ? join(home, 'Library', 'Application Support', 'ai.opencode.desktop', 'cli')
    : (platform === 'win32'
        ? join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'ai.opencode.desktop', 'cli')
        : join(env.XDG_DATA_HOME ?? join(home, '.local', 'share'), 'ai.opencode.desktop', 'cli'))
  const versions = list(base).toSorted((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  for (const version of versions) {
    const name = platform === 'win32' ? 'opencode-cli.exe' : 'opencode-cli'
    if (list(join(base, version)).includes(name)) {
      return join(base, version, name)
    }
  }
  return null
}

function safeList (path: string): string[] {
  try {
    return readdirSync(path)
  } catch {
    return []
  }
}
