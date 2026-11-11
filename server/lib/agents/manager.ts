import type { AgentId, AgentSetting, AgentStatus, AppBuilderOperationResults, AppBuilderStatus, AppInstallation, AppPreview, AppProject, ApprovalDecision, ConversationEvent, ConversationEventEnvelope, ConversationSummary, PermissionMode, ReleaseInfo, ReleaseSigning, ToolStatus } from '#shared/contract'
import type { PreviewInstaller } from '../app-projects/previews'
import type { PreparedRelease, ReleaseCaller, ReleaseInstaller, VersionBump } from '../app-projects/release'
import type { ProjectRecord, ProjectStore } from '../app-projects/store'
import type { TemplateFiles } from '../app-projects/template'
import type { AgentDefinition } from './catalog'
import type { RunCommand } from './environment'
import type { OpenAgent } from './process'
import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import semver from 'semver'
import { buildProject } from '../app-projects/build'
import { ProjectGit } from '../app-projects/git'
import { ProjectPreviews } from '../app-projects/previews'
import { bumpVersion, readIdentity, setVersion } from '../app-projects/release'
import { EventWriter } from '../app-projects/store'
import { agentInstructions, bundledAppInfo, copyFiles, gitignore, localAppId, scaffoldFiles, slugOf } from '../app-projects/template'
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
  /** The sources of the bundled apps (apps/), by folder. */
  bundledSources: () => Promise<Map<string, TemplateFiles>>
  /** Folders the user chose in a native dialog (`app-project` grants). */
  takeFolder: (handle: string) => string
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
  /** Signs and installs releases; `null` when apps are off. */
  releases: ReleaseInstaller | null
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
  /** Built packages waiting for the install dialog's consent, by project. */
  readonly #prepared = new Map<string, PreparedRelease>()
  /** The models each agent offered in its last chat; null when its chats offered none. */
  readonly #models = new Map<AgentId, AgentSetting | null>()
  /** Agents asked for their models with a session of their own, so each is asked once. */
  readonly #probes = new Map<AgentId, Promise<AgentSetting | null>>()

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
    const { status } = await this.#discover(refresh)
    return { ...status, agents: await Promise.all(status.agents.map(async agent => ({ ...agent, model: await this.#knownModel(agent.id) }))) }
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
          permissionMode: 'ask',
          createdAt: record.createdAt.toISOString(),
          lastSeq: record.lastSeq,
        }),
    }))
  }

  /** The bundled apps a project can start from (plan P4). */
  async bundledApps (): Promise<AppBuilderOperationResults['listBundledApps']> {
    return [...await this.#options.bundledSources()]
      .flatMap(([source, files]) => bundledAppInfo(source, files) ?? [])
      .toSorted((a, b) => a.title.localeCompare(b.title))
  }

  /**
   * The models an agent offers, for a new chat: those of its last chat, else
   * asked once from a session of its own. Agents name their models only in a
   * session; that session gets no prompt, so it costs nothing, and runs in an
   * empty folder that is removed afterwards.
   */
  async agentModels (agentId: AgentId): Promise<AgentSetting | null> {
    const known = await this.#knownModel(agentId)
    if (known) {
      return known
    }
    let probe = this.#probes.get(agentId)
    if (!probe) {
      probe = this.#probeModels(agentId)
      this.#probes.set(agentId, probe)
      // A failed start (not signed in, say) may work next time.
      probe.then(model => {
        if (!model) {
          this.#probes.delete(agentId)
        }
      }, () => this.#probes.delete(agentId))
    }
    return await probe
  }

  /**
   * Creates a project from the template, or as a copy of a bundled app
   * (`source`), commits it, and starts a chat in it; a prompt starts its
   * first turn.
   */
  async createProject (name: string, agentId: AgentId, prompt: string | null, source: string | null = null, model: string | null = null): Promise<AppBuilderOperationResults['createProject']> {
    const discovery = await this.#ready(agentId)
    const slug = await this.#freeSlug(slugOf(name))
    const folder = join(this.#options.projectsDir, slug)
    const appId = localAppId(slug)
    const template = await this.#options.template()
    let files: TemplateFiles
    let from: string | null = null
    if (source) {
      const sources = await this.#options.bundledSources()
      const sourceFiles = sources.get(source)
      if (!sourceFiles) {
        throw new StudioProblem('not_found', `Studio ships no app ${source}.`)
      }
      from = bundledAppInfo(source, sourceFiles)?.appId ?? source
      files = copyFiles(sourceFiles, template, { name, slug, appId, studioVersion: this.#options.studioVersion, from: bundledAppInfo(source, sourceFiles)?.title ?? source })
    } else {
      files = scaffoldFiles(template, { name, slug, appId, studioVersion: this.#options.studioVersion })
    }
    await mkdir(folder, { recursive: true })
    for (const [path, content] of files) {
      await mkdir(dirname(join(folder, path)), { recursive: true })
      await writeFile(join(folder, path), content)
    }
    await this.#git(folder, discovery).init(from ? `Copy ${from} as ${name}` : `Create ${name} from the BaSyx Studio template`)
    const project: ProjectRecord = { id: randomUUID(), name, appId, folder, origin: source ? 'copy' : 'new', source: from, createdAt: this.#now() }
    await this.#store.insertProject(project)
    return await this.#startWith(project, agentId, prompt, model)
  }

  /**
   * Registers an app's folder where it is (plan P5). Without git, Studio
   * creates a repository and commits what is there; in a repository, the
   * folder must have no uncommitted changes, so the first turn's commit holds
   * only what the agent did.
   */
  async addFolder (handle: string, agentId: AgentId, name: string | null, model: string | null = null): Promise<AppBuilderOperationResults['addFolder']> {
    const discovery = await this.#ready(agentId)
    const folder = await realpath(this.#options.takeFolder(handle))
    let manifest: { id?: unknown, title?: { en?: unknown } }
    try {
      manifest = JSON.parse(await readFile(join(folder, 'studio-app.json'), 'utf8')) as typeof manifest
    } catch {
      throw new StudioProblem('invalid_request', 'The folder has no studio-app.json: choose the folder of a Studio app.')
    }
    if (typeof manifest.id !== 'string') {
      throw new StudioProblem('invalid_request', 'The studio-app.json in this folder has no app ID.')
    }
    if ((await this.#store.listProjects()).some(project => project.folder === folder)) {
      throw new StudioProblem('invalid_request', 'This folder is a project of the App Builder already.')
    }
    const title = name ?? (typeof manifest.title?.en === 'string' ? manifest.title.en : manifest.id)
    const git = this.#git(folder, discovery)
    if (await git.isRepository()) {
      if (!await git.isClean()) {
        throw new StudioProblem('invalid_request', 'The folder has changes that are not committed. Commit or stash them first, so each of the agent\'s turns is a commit of its own.')
      }
    } else {
      if (!existsSync(join(folder, '.gitignore'))) {
        await writeFile(join(folder, '.gitignore'), gitignore)
      }
      await git.init(`Add ${title} to the BaSyx Studio App Builder`)
    }
    const project: ProjectRecord = { id: randomUUID(), name: title, appId: manifest.id, folder, origin: 'folder', source: null, createdAt: this.#now() }
    await this.#store.insertProject(project)
    return await this.#startWith(project, agentId, null, model)
  }

  /** Removes a project from Studio, with its preview; its folder only when asked (plan P6). */
  async removeProject (projectId: string, deleteFolder: boolean): Promise<void> {
    const project = await this.#project(projectId)
    if (deleteFolder && project.origin === 'folder') {
      throw new StudioProblem('invalid_request', 'Studio does not delete a folder it did not create.')
    }
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

  /** A new chat in a project's folder; its agent starts now, with `model` when the agent offers it. */
  async startConversation (projectId: string, agentId: AgentId, model: string | null = null): Promise<ConversationSummary> {
    const project = await this.#project(projectId)
    const discovery = await this.#ready(agentId)
    const id = randomUUID()
    const createdAt = this.#now()
    await this.#store.insertConversation({ id, projectId, agentId, title: '', sessionId: null, model, createdAt })
    const conversation = this.#create(project, agentId, discovery, { id, createdAt, model })
    this.#conversations.set(id, conversation)
    if (project.origin === 'folder') {
      // A folder keeps its own files: Studio's rules come with the first prompt (plan P5).
      conversation.noteForAgent(agentInstructions({ name: project.name, appId: project.appId }, 'You work in a folder the user chose. It has no AGENTS.md from Studio; these are Studio\'s rules for it.'))
    }
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

  /** Switches a chat's permission mode; `unrestricted` only when the user acknowledged the risk. */
  async setPermissionMode (conversationId: string, mode: PermissionMode, acknowledgeRisk: boolean): Promise<ConversationSummary> {
    if (mode === 'unrestricted' && !acknowledgeRisk) {
      throw new StudioProblem('invalid_request', 'The unrestricted mode needs the user to acknowledge the risk first.')
    }
    const conversation = await this.conversation(conversationId)
    await conversation.setPermissionMode(mode)
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

  /** What installing the project's app would replace, and the versions it could take (plan B5). */
  async releaseInfo (projectId: string): Promise<ReleaseInfo> {
    const project = await this.#project(projectId)
    const releases = this.#requireReleases()
    const { id, version } = await readIdentity(project.folder)
    const installed = await releases.installed(id)
    return {
      projectId,
      appId: id,
      version,
      installed,
      newVersion: installed === null || (semver.valid(installed.version) !== null && semver.valid(version) !== null && semver.gt(version, installed.version)),
      patch: bumpVersion(version, 'patch'),
      minor: bumpVersion(version, 'minor'),
      machineKey: await releases.machineKey(false),
      machineKeyApplies: id.startsWith('local.'),
    }
  }

  /**
   * Raises the version if asked (and commits it), builds, signs, and checks
   * the package as an upload is checked (plan B5–B8); the result is what the
   * install dialog shows. Nothing is installed yet.
   */
  async inspectRelease (projectId: string, options: { bump: VersionBump, signing: ReleaseSigning, keyHandle: string | null, passphrase: string | null }): Promise<AppBuilderOperationResults['inspectRelease']> {
    const project = await this.#project(projectId)
    const releases = this.#requireReleases()
    const busy = [...this.#conversations.values()].some(conversation => conversation.projectId === projectId && (conversation.state === 'working' || conversation.state === 'starting'))
    if (busy) {
      throw new StudioProblem('agent_busy', 'Wait until the agent has finished its turn.')
    }
    if (options.signing === 'own' && !options.keyHandle) {
      throw new StudioProblem('invalid_request', 'Choose the key to sign with.')
    }
    if (options.bump !== 'none') {
      const { version } = await readIdentity(project.folder)
      const next = bumpVersion(version, options.bump)
      await setVersion(project.folder, next)
      await this.#git(project.folder, await this.#discover(false)).commitAll(`Release ${next}`)
    }
    const built = await this.#buildFolder(project.folder)
    if (!built.ok || !built.packageBytes) {
      throw new StudioProblem('app_package_rejected', `The build failed:\n${built.log.split('\n').slice(-20).join('\n')}`)
    }
    const signature = await releases.sign(built.packageBytes, options.signing, options.keyHandle, options.passphrase)
    const inspection = await releases.inspect(built.packageBytes, signature)
    this.#prepared.set(projectId, { digest: inspection.digest, bytes: built.packageBytes, signature, version: inspection.version })
    return { inspection, digest: inspection.digest, version: inspection.version, signed: signature !== null }
  }

  /** Installs the package the user consented to in the install dialog. */
  async installRelease (projectId: string, digest: string, caller: ReleaseCaller): Promise<AppInstallation> {
    const prepared = this.#prepared.get(projectId)
    if (prepared?.digest !== digest) {
      throw new StudioProblem('not_found', 'Build and check the app again: this package is no longer prepared.')
    }
    const installed = await this.#requireReleases().install(prepared.bytes, prepared.signature, caller)
    this.#prepared.delete(projectId)
    return installed
  }

  /** Saves the checked package, and its signature, where the user chose (plan B8). */
  async exportRelease (projectId: string, digest: string, fileHandle: string): Promise<{ fileName: string }> {
    const prepared = this.#prepared.get(projectId)
    if (prepared?.digest !== digest) {
      throw new StudioProblem('not_found', 'Build and check the app again: this package is no longer prepared.')
    }
    return { fileName: await this.#requireReleases().save(prepared.bytes, prepared.signature, fileHandle) }
  }

  /** This computer's key, made on first use, to give its public key to other Studios (plan B7). */
  async machineKey (): Promise<{ publicKey: string, fingerprint: string }> {
    return (await this.#requireReleases().machineKey(true))!
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

  async #startWith (project: ProjectRecord, agentId: AgentId, prompt: string | null, model: string | null): Promise<{ project: AppProject, conversation: ConversationSummary }> {
    const started = await this.startConversation(project.id, agentId, model)
    if (prompt) {
      await this.prompt(started.id, prompt)
    }
    const conversation = this.#conversations.get(started.id)!.summary()
    return { project: { ...describeProject(project), conversations: [conversation] }, conversation }
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
        onEvent: envelope => {
          if (envelope.event.type === 'state' && envelope.event.model) {
            this.#models.set(agentId, envelope.event.model)
          }
          this.#writer.add(saved.id, envelope)
        },
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

  async #probeModels (agentId: AgentId): Promise<AgentSetting | null> {
    const discovery = await this.#ready(agentId)
    const definition = this.#options.agents.find(agent => agent.id === agentId)!
    const folder = await mkdtemp(join(tmpdir(), 'basyx-studio-models-'))
    const open = this.#options.open ?? openAgentProcess
    const session = new Conversation({
      projectId: '',
      definition,
      folder,
      now: this.#options.now,
      open: () => open({ definition, cliPath: discovery.cliPaths[agentId]!, nodePath: this.#options.nodePath, folder, env: agentProcessEnv(this.#options.env ?? process.env, discovery.path) }),
    })
    try {
      await session.start()
      const model = session.summary().model
      if (model) {
        this.#models.set(agentId, model)
      }
      return model
    } finally {
      session.close()
      await rm(folder, { recursive: true, force: true })
    }
  }

  /**
   * The models an agent offered in its last chat: from a chat in memory, else
   * from the saved events of its newest chat. An agent tells its models only
   * in a session, so before its first chat there are none.
   */
  async #knownModel (agentId: AgentId): Promise<AgentSetting | null> {
    if (this.#models.has(agentId)) {
      return this.#models.get(agentId)!
    }
    let model: AgentSetting | null = null
    const newest = (await this.#store.listConversations()).filter(record => record.agentId === agentId).toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
    if (newest) {
      model = this.#conversations.get(newest.id)?.summary().model ?? null
      if (!model) {
        for (const { event } of (await this.#store.loadEvents(newest.id)).toReversed()) {
          if (event.type === 'state' && event.model) {
            model = event.model
            break
          }
        }
      }
    }
    // A chat that reports models meanwhile has set them.
    if (!this.#models.has(agentId)) {
      this.#models.set(agentId, model)
    }
    return this.#models.get(agentId)!
  }

  #requireReleases (): ReleaseInstaller {
    if (!this.#options.releases) {
      throw new StudioProblem('unsupported_operation', 'Installing apps needs apps to be enabled (STUDIO_APPS_URL).')
    }
    return this.#options.releases
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
      const base = { id: definition.id, name: definition.name, signInCommand: definition.signInCommand, installUrl: definition.installUrl, model: null }
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
