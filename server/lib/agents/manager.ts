import type { AgentId, AgentStatus, AppBuilderOperationResults, AppBuilderStatus, AppPreview, AppProject, ApprovalDecision, ConversationEvent, ConversationEventEnvelope, ConversationSummary, ToolStatus } from '#shared/contract'
import type { PreviewInstaller } from '../app-projects/previews'
import type { ProjectRecord, ProjectStore } from '../app-projects/store'
import type { TemplateFiles } from '../app-projects/template'
import type { AgentDefinition } from './catalog'
import type { RunCommand } from './environment'
import type { OpenAgent } from './process'
import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { buildProject } from '../app-projects/build'
import { ProjectGit } from '../app-projects/git'
import { ProjectPreviews } from '../app-projects/previews'
import { EventWriter } from '../app-projects/store'
import { localAppId, scaffoldFiles, slugOf } from '../app-projects/template'
import { StudioProblem } from '../problem'
import { Conversation } from './conversation'
import { agentProcessEnv, findExecutable, loginShellPath, openInFileManager, runCommand, versionFromOutput } from './environment'
import { openAgentProcess } from './process'

// The App Builder on the desktop (ADR 0054): which agents are installed,
// the projects with their folders, and the chats in them. Chats are saved
// and start their agent only when the user writes; an agent that has been
// idle for a while is stopped and resumes its session on the next prompt.

export interface AgentManagerOptions {
  /** Where new projects go (plan P1). */
  projectsDir: string
  agents: AgentDefinition[]
  /** The Node runtime for the adapters (Studio's own). */
  nodePath: string
  store: ProjectStore
  /** The files of the starter app (examples/apps/starter). */
  template: () => Promise<TemplateFiles>
  /** The running Studio's version, for the template's package versions. */
  studioVersion: string
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  run?: RunCommand
  open?: OpenAgent
  /** The PATH to search; read from the login shell when not given. */
  path?: () => Promise<string>
  openFolder?: (folder: string) => Promise<void>
  now?: () => Date
  /** Idle agents are stopped after this long; 0 keeps them. */
  idleStopMs?: number
  /** Installs the projects' previews; `null` when apps are off. */
  previews: PreviewInstaller | null
}

interface Discovery {
  status: AppBuilderStatus
  path: string
  cliPaths: Partial<Record<AgentId, string>>
  git: string | null
}

interface SavedConversation {
  id: string
  createdAt: Date
  title?: string
  sessionId?: string | null
  model?: string | null
  history?: ConversationEventEnvelope[]
}

const checkTimeoutMs = 15_000

/** The default projects folder: in the user's documents, where they can find it (plan P1). */
export function defaultProjectsDir (home = homedir()): string {
  return join(home, 'Documents', 'BaSyx Studio', 'Apps')
}

export class AgentManager {
  readonly #options: AgentManagerOptions
  readonly #store: ProjectStore
  readonly #writer: EventWriter
  readonly #conversations = new Map<string, Conversation>()
  readonly #loading = new Map<string, Promise<Conversation>>()
  #discovery: Promise<Discovery> | null = null
  #lastDiscovery: Discovery | null = null
  #sweeper: ReturnType<typeof setInterval> | null = null
  readonly #previews: ProjectPreviews | null

  constructor (options: AgentManagerOptions) {
    this.#options = options
    this.#store = options.store
    this.#writer = new EventWriter(options.store)
    this.#previews = options.previews
      ? new ProjectPreviews({ installer: options.previews, build: folder => this.#buildFolder(folder), now: options.now })
      : null
    const idleStopMs = options.idleStopMs ?? 15 * 60_000
    if (idleStopMs > 0) {
      this.#sweeper = setInterval(() => this.#stopIdle(idleStopMs), Math.min(idleStopMs, 60_000))
      this.#sweeper.unref?.()
    }
  }

  /** Which agents and tools are installed; checked once, or again on `refresh`. */
  async status (refresh = false): Promise<AppBuilderStatus> {
    return (await this.#discover(refresh)).status
  }

  /** The projects, newest first, each with its chats, newest first. */
  async projects (): Promise<AppProject[]> {
    const [projects, conversations] = await Promise.all([this.#store.listProjects(), this.#store.listConversations()])
    return projects.toReversed().map(project => ({
      ...describeProject(project),
      conversations: conversations
        .filter(conversation => conversation.projectId === project.id)
        .toReversed()
        .map(record => this.#conversations.get(record.id)?.summary() ?? {
          id: record.id,
          projectId: record.projectId,
          agentId: record.agentId,
          title: record.title,
          folder: project.folder,
          state: 'inactive',
          model: null,
          createdAt: record.createdAt.toISOString(),
          lastSeq: record.lastSeq,
        }),
    }))
  }

  /** Creates a project from the template, commits it, and starts a chat in it with the first prompt. */
  async createProject (name: string, agentId: AgentId, prompt: string): Promise<AppBuilderOperationResults['createProject']> {
    const discovery = await this.#ready(agentId)
    const slug = await this.#freeSlug(slugOf(name))
    const folder = join(this.#options.projectsDir, slug)
    const appId = localAppId(slug)
    const files = scaffoldFiles(await this.#options.template(), { name, slug, appId, studioVersion: this.#options.studioVersion })
    await mkdir(folder, { recursive: true })
    for (const [path, content] of files) {
      await mkdir(dirname(join(folder, path)), { recursive: true })
      await writeFile(join(folder, path), content)
    }
    await this.#git(folder, discovery).init(`Create ${name} from the BaSyx Studio template`)
    const project: ProjectRecord = { id: randomUUID(), name, appId, folder, origin: 'new', source: null, createdAt: this.#now() }
    await this.#store.insertProject(project)
    const started = await this.startConversation(project.id, agentId)
    await this.prompt(started.id, prompt)
    const conversation = this.#conversations.get(started.id)!.summary()
    return { project: { ...describeProject(project), conversations: [conversation] }, conversation }
  }

  /** Removes a project from Studio, with its preview; its folder only when asked (plan P6). */
  async removeProject (projectId: string, deleteFolder: boolean): Promise<void> {
    const project = await this.#project(projectId)
    await this.#previews?.remove(project)
    for (const conversation of this.#conversations.values()) {
      if (conversation.projectId === projectId) {
        conversation.close()
        this.#conversations.delete(conversation.id)
      }
    }
    await this.#writer.flush()
    await this.#store.deleteProject(projectId)
    if (deleteFolder) {
      await rm(project.folder, { recursive: true, force: true })
    }
  }

  async openFolder (projectId: string): Promise<void> {
    const project = await this.#project(projectId)
    await (this.#options.openFolder ?? (folder => openInFileManager(folder, this.#options.platform ?? process.platform)))(project.folder)
  }

  /** A new chat in a project's folder; its agent starts now. */
  async startConversation (projectId: string, agentId: AgentId): Promise<ConversationSummary> {
    const project = await this.#project(projectId)
    const discovery = await this.#ready(agentId)
    const id = randomUUID()
    const createdAt = this.#now()
    await this.#store.insertConversation({ id, projectId, agentId, title: '', sessionId: null, model: null, createdAt })
    const conversation = this.#create(project, agentId, discovery, { id, createdAt })
    this.#conversations.set(id, conversation)
    try {
      await conversation.start()
    } catch (error) {
      // The chat stays; its next prompt tries again.
      if (!(error instanceof StudioProblem)) {
        throw error
      }
    }
    return conversation.summary()
  }

  async deleteConversation (conversationId: string): Promise<void> {
    const conversation = await this.conversation(conversationId)
    conversation.close()
    this.#conversations.delete(conversationId)
    await this.#writer.flush()
    await this.#store.deleteConversation(conversationId)
  }

  /** A chat, loaded with its events when it is not in memory. */
  async conversation (conversationId: string): Promise<Conversation> {
    const loaded = this.#conversations.get(conversationId)
    if (loaded) {
      return loaded
    }
    let loading = this.#loading.get(conversationId)
    if (!loading) {
      loading = this.#load(conversationId).finally(() => this.#loading.delete(conversationId))
      this.#loading.set(conversationId, loading)
    }
    return await loading
  }

  async prompt (conversationId: string, text: string): Promise<void> {
    const conversation = await this.conversation(conversationId)
    if (conversation.state === 'inactive' || conversation.state === 'failed') {
      await this.#ready(conversation.definition.id)
    }
    await conversation.prompt(text)
  }

  async cancel (conversationId: string): Promise<void> {
    await (await this.conversation(conversationId)).cancel()
  }

  async answer (conversationId: string, approvalId: string, decision: ApprovalDecision): Promise<void> {
    (await this.conversation(conversationId)).answer(approvalId, decision)
  }

  async setModel (conversationId: string, value: string): Promise<ConversationSummary> {
    const conversation = await this.conversation(conversationId)
    await conversation.setModel(value)
    return conversation.summary()
  }

  /** A turn's commit as a patch. */
  async changes (projectId: string, commit: string): Promise<AppBuilderOperationResults['getChanges']> {
    const project = await this.#project(projectId)
    return await this.#git(project.folder, await this.#discover(false)).show(commit)
  }

  /** The project's last build and its preview installation (plan B3). */
  async preview (projectId: string): Promise<AppPreview> {
    return await this.#requirePreviews().describe(await this.#project(projectId))
  }

  /** Builds the project now and updates its preview. */
  async buildPreview (projectId: string): Promise<AppPreview> {
    const project = await this.#project(projectId)
    await this.#requirePreviews().build(project)
    return await this.#requirePreviews().describe(project)
  }

  /** Installs the preview that waits for the user's OK (plan B4). */
  async approvePreview (projectId: string): Promise<AppPreview> {
    const project = await this.#project(projectId)
    await this.#requirePreviews().approve(project)
    return await this.#requirePreviews().describe(project)
  }

  /** Undoes a turn and the turns after it (plan A5), and tells the agent with the next prompt. */
  async undo (conversationId: string, commit: string): Promise<void> {
    const conversation = await this.conversation(conversationId)
    if (conversation.state === 'working' || conversation.state === 'starting') {
      throw new StudioProblem('agent_busy', 'Wait until the agent has finished its turn.')
    }
    const project = await this.#project(conversation.projectId)
    const git = this.#git(project.folder, await this.#discover(false))
    const undone = await git.undo(commit, `Undo the agent's changes since ${commit.slice(0, 7)}`)
    conversation.record({ type: 'checkpointUndone', commit })
    if (undone) {
      conversation.record({ type: 'checkpoint', commit: undone.commit, message: `Undo since ${commit.slice(0, 7)}`, files: undone.files })
    }
    conversation.noteForAgent(`The user undid the changes made in this folder since commit ${commit.slice(0, 7)}. The files are back as they were before; read them again before you change anything.`)
  }

  /** Stops every agent and saves what is still queued. */
  async dispose (): Promise<void> {
    if (this.#sweeper) {
      clearInterval(this.#sweeper)
    }
    for (const conversation of this.#conversations.values()) {
      conversation.stop()
    }
    this.#conversations.clear()
    await this.#writer.flush()
  }

  /** Waits until every event so far is saved (tests, shutdown). */
  async flush (): Promise<void> {
    await this.#writer.flush()
  }

  async #load (conversationId: string): Promise<Conversation> {
    const record = (await this.#store.listConversations()).find(entry => entry.id === conversationId)
    if (!record) {
      throw new StudioProblem('not_found', 'The chat does not exist.')
    }
    const project = await this.#project(record.projectId)
    const history = await this.#store.loadEvents(conversationId)
    const conversation = this.#create(project, record.agentId, null, {
      id: record.id,
      createdAt: record.createdAt,
      title: record.title,
      sessionId: record.sessionId,
      model: record.model,
      history,
    })
    this.#conversations.set(conversationId, conversation)
    return conversation
  }

  #create (project: ProjectRecord, agentId: AgentId, discovery: Discovery | null, saved: SavedConversation): Conversation {
    const definition = this.#options.agents.find(agent => agent.id === agentId)!
    const open = this.#options.open ?? openAgentProcess
    const conversation: Conversation = new Conversation({
      ...saved,
      projectId: project.id,
      definition,
      folder: project.folder,
      now: this.#options.now,
      open: () => {
        // Prompts to saved or stopped chats check the agent first (`#ready`), so the last discovery is current.
        const current = this.#lastDiscovery ?? discovery
        const cliPath = current?.cliPaths[agentId]
        if (!current || !cliPath) {
          throw new StudioProblem('agent_unavailable', `${definition.name} was not found on this computer.`)
        }
        return open({ definition, cliPath, nodePath: this.#options.nodePath, folder: project.folder, env: agentProcessEnv(this.#options.env ?? process.env, current.path) })
      },
      hooks: {
        onEvent: envelope => this.#writer.add(saved.id, envelope),
        onSession: values => void this.#store.updateConversation(saved.id, values).catch(() => {}),
        afterTurn: async prompt => {
          const events = await this.#commitTurn(project, definition, prompt)
          if (events.some(event => event.type === 'checkpoint') && this.#previews) {
            // The build runs on; its events follow the turn's in the chat.
            setTimeout(() => void this.#previews!.build(project, event => conversation.record(event)), 0)
          }
          return events
        },
      },
    })
    return conversation
  }

  #requirePreviews (): ProjectPreviews {
    if (!this.#previews) {
      throw new StudioProblem('unsupported_operation', 'Previews need apps to be enabled (STUDIO_APPS_URL).')
    }
    return this.#previews
  }

  /** Builds a project's folder with fixed commands (plan B1). */
  async #buildFolder (folder: string) {
    const discovery = await this.#discover(false)
    const pnpm = discovery.status.tools.find(tool => tool.name === 'pnpm')?.path
    if (!pnpm) {
      throw new StudioProblem('agent_unavailable', 'pnpm was not found on this computer. Install it (for example with `corepack enable pnpm`), then check again.')
    }
    return await buildProject(folder, { pnpm, env: agentProcessEnv(this.#options.env ?? process.env, discovery.path), run: this.#options.run ?? runCommand })
  }

  /** Commits what the turn changed (plan A5); nothing when nothing changed. */
  async #commitTurn (project: ProjectRecord, definition: AgentDefinition, prompt: string): Promise<ConversationEvent[]> {
    const discovery = await this.#discover(false)
    if (!discovery.git) {
      return []
    }
    const message = `${definition.name}: ${prompt.split('\n', 1)[0]!.slice(0, 72)}`
    const committed = await this.#git(project.folder, discovery).commitAll(message)
    return committed ? [{ type: 'checkpoint', commit: committed.commit, message, files: committed.files }] : []
  }

  #git (folder: string, discovery: Discovery): ProjectGit {
    if (!discovery.git) {
      throw new StudioProblem('agent_unavailable', 'git was not found on this computer. Install git, then check again.')
    }
    return new ProjectGit(folder, { git: discovery.git, env: agentProcessEnv(this.#options.env ?? process.env, discovery.path), run: this.#options.run ?? runCommand })
  }

  async #project (projectId: string): Promise<ProjectRecord> {
    const project = (await this.#store.listProjects()).find(entry => entry.id === projectId)
    if (!project) {
      throw new StudioProblem('not_found', 'The project does not exist.')
    }
    return project
  }

  /** The discovery, after checking that the agent and git can run; checks again once if they could not. */
  async #ready (agentId: AgentId): Promise<Discovery> {
    let discovery = await this.#discover(false)
    let status = discovery.status.agents.find(agent => agent.id === agentId)
    if (status?.state !== 'ready' || !discovery.git) {
      // The user may have installed or signed in since the last check.
      discovery = await this.#discover(true)
      status = discovery.status.agents.find(agent => agent.id === agentId)
    }
    const definition = this.#options.agents.find(agent => agent.id === agentId)!
    if (status?.state !== 'ready' || !discovery.cliPaths[agentId]) {
      throw new StudioProblem('agent_unavailable', status?.state === 'signedOut'
        ? `${definition.name} is not signed in. Run \`${definition.signInCommand}\` in a terminal.`
        : `${definition.name} was not found on this computer.`)
    }
    if (!discovery.git) {
      throw new StudioProblem('agent_unavailable', 'git was not found on this computer. Install git, then check again.')
    }
    return discovery
  }

  async #freeSlug (base: string): Promise<string> {
    const taken = new Set((await this.#store.listProjects()).map(project => project.folder))
    for (let index = 1; ; index++) {
      const slug = index === 1 ? base : `${base}-${index}`
      const folder = join(this.#options.projectsDir, slug)
      if (!taken.has(folder) && !existsSync(folder)) {
        return slug
      }
    }
  }

  #stopIdle (idleStopMs: number): void {
    for (const conversation of this.#conversations.values()) {
      if (conversation.state === 'idle' && conversation.idleFor() > idleStopMs) {
        conversation.stop()
      }
    }
  }

  #now (): Date {
    return this.#options.now?.() ?? new Date()
  }

  #discover (refresh: boolean): Promise<Discovery> {
    if (!this.#discovery || refresh) {
      const discovery = this.#runDiscovery()
      this.#discovery = discovery
      discovery.then(value => {
        this.#lastDiscovery = value
      }, () => {
        // A failed check is tried again next time.
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
    return { status: { agents, tools, checkedAt: this.#now().toISOString() }, path, cliPaths, git: tools.find(tool => tool.name === 'git')?.path ?? null }
  }
}

function describeProject (project: ProjectRecord): Omit<AppProject, 'conversations'> {
  return { id: project.id, name: project.name, appId: project.appId, folder: project.folder, origin: project.origin, source: project.source, createdAt: project.createdAt.toISOString() }
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
