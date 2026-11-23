import type { ComponentState, EngineInfo, Engines, Job, Problem, Stack, StackComponent, StackComponentId, StackImport, StackList, StackLogs, StackPlan, StackSignIn, StackSpec, StackStatus } from '#shared/contract'
import type { Actor, StudioDeps } from '../deps'
import type { FileGrantStore } from '../desktop/grants'
import type { DiscoveryEnvironment } from './discovery'
import type { ContainerSummary } from './engine'
import type { ParsedImport } from './import'
import type { PlannedContainer, StackDetails } from './plan'
import type { IsPortFree } from './ports'
import type { StackSecrets } from './security'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { eq } from 'drizzle-orm'
import { containerSettings, containerStacks } from '../../database/schema'
import { recordAudit } from '../audit'
import { StudioProblem } from '../problem'
import { AasxStore } from './aasx'
import { basyxServices, catalogImages, componentImages, imageReference, longRunning } from './catalog'
import { engineCandidates, probeEngine } from './discovery'
import { EngineClient, EngineUnreachable } from './engine'
import { exportArchive } from './export'
import { readImport } from './import'
import { addStep, JobRunner, newId, runOptionalStep, runStep } from './jobs'
import { componentLabel, componentsOf, containerConfig, nameLabel, normalizeSpec, planStack, portOf, portsOf, slugOf, stackLabel, urlsOf } from './plan'
import { PortAllocator } from './ports'
import { generateSecrets, keycloakAdminUser, realmName } from './security'
import { createTar } from './tar'

// Lifecycle of local BaSyx instances (ADR 0033, BaSyx Docker plan E1–E8).
// Long operations run as jobs that the app polls (jobs.ts); the engine is
// the source of truth for what runs, the database for what the user chose.

type StackRecord = typeof containerStacks.$inferSelect

const secretsPurpose = 'container-stack-secrets'
const settingsId = 'default'
const importTtlMs = 15 * 60 * 1000

/** Studio's side of a stack: its infrastructure. Provided by the service, so this module stays free of HTTP. */
export interface InfrastructureHooks {
  create: (input: { name: string, spec: StackSpec, actor: Actor, requestId: string }) => Promise<string>
  remove: (id: string, actor: Actor, requestId: string) => Promise<void>
}

export interface ContainerManagerOptions {
  deps: StudioDeps
  /** Where AASX files of stacks are kept, one folder per stack. */
  dataDir: string
  discovery: DiscoveryEnvironment
  grants: FileGrantStore
  infrastructures: InfrastructureHooks
  /** Whether a URL answers with HTTP 200; replaceable in tests. */
  isReady?: (url: string) => Promise<boolean>
  /** Whether a port is free on this computer; replaceable in tests. */
  isPortFree?: IsPortFree
  timeouts?: Partial<Timeouts>
}

interface Timeouts {
  databaseMs: number
  schemaMs: number
  keycloakMs: number
  serviceMs: number
  pollMs: number
}

// Readiness gives each component up to five minutes (plan E4).
/** What aasenvironment-go logs once it has imported its preconfiguration (AASX files). */
const preconfigurationCompleted = 'AAS preconfiguration completed'

const defaultTimeouts: Timeouts = { databaseMs: 120_000, schemaMs: 180_000, keycloakMs: 300_000, serviceMs: 300_000, pollMs: 1000 }

interface StagedImport {
  parsed: ParsedImport
  expiresAt: number
}

async function defaultIsReady (url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000), redirect: 'manual' })
    await response.body?.cancel()
    return response.status === 200
  } catch {
    return false
  }
}

function sleep (ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Maps engine failures onto the problems the app explains (plan U2). */
export function engineProblem (error: unknown, fallback = 'The container engine refused the operation.'): StudioProblem {
  if (error instanceof StudioProblem) {
    return error
  }
  if (error instanceof EngineUnreachable) {
    return new StudioProblem('container_engine_unavailable', 'The container engine does not answer. Start Docker Desktop or Podman and try again.', { cause: error })
  }
  const message = error instanceof Error ? error.message : String(error)
  if (/no space left on device/i.test(message)) {
    return new StudioProblem('container_disk_full', message, { cause: error })
  }
  if (/port is already allocated|address already in use|bind: /i.test(message)) {
    return new StudioProblem('container_port_in_use', message, { cause: error })
  }
  return new StudioProblem('container_operation_failed', `${fallback} ${message}`.trim(), { cause: error })
}

function toProblem (error: unknown): Problem {
  const problem = engineProblem(error)
  return {
    type: 'about:blank',
    title: problem.title,
    status: problem.status,
    code: problem.code,
    detail: problem.detail,
    requestId: '',
    retryable: problem.retryable,
    ...(problem.violations ? { violations: problem.violations } : {}),
  }
}

/** `Up 5 seconds (healthy)`, `Exited (1) 3 minutes ago` → a component state. */
export function componentState (summary: ContainerSummary | undefined): { state: ComponentState, exitCode: number | null } {
  if (!summary) {
    return { state: 'missing', exitCode: null }
  }
  const exit = /Exited \((-?\d+)\)/.exec(summary.Status)
  switch (summary.State) {
    case 'running': {
      if (/\(unhealthy\)/.test(summary.Status)) {
        return { state: 'unhealthy', exitCode: null }
      }
      return { state: /health: starting/.test(summary.Status) ? 'starting' : 'running', exitCode: null }
    }
    case 'restarting': {
      return { state: 'unhealthy', exitCode: exit ? Number(exit[1]) : null }
    }
    case 'exited':
    case 'dead': {
      return { state: 'exited', exitCode: exit ? Number(exit[1]) : null }
    }
    default: {
      return { state: 'stopped', exitCode: null }
    }
  }
}

/** The stack's status from its components (plan E6). */
export function stackStatus (components: StackComponent[], busy: boolean, lastJobFailed: boolean): StackStatus {
  if (busy) {
    return 'busy'
  }
  if (components.every(component => component.state === 'missing')) {
    return 'missing'
  }
  const relevant = components.filter(component => longRunning.includes(component.id))
  const up = relevant.filter(component => component.state === 'running' || component.state === 'starting')
  if (lastJobFailed && up.length < relevant.length) {
    return 'error'
  }
  if (relevant.some(component => component.state === 'unhealthy')) {
    return 'error'
  }
  if (up.length === relevant.length) {
    return 'running'
  }
  return up.length === 0 ? 'stopped' : 'partial'
}

function stripAnsi (text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replaceAll(/\u001B\[[0-9;?]*[A-Z]/gi, '')
}

export class ContainerManager {
  readonly #options: ContainerManagerOptions
  readonly #timeouts: Timeouts
  readonly #isReady: (url: string) => Promise<boolean>
  readonly #jobs = new JobRunner(toProblem)
  readonly #ports: PortAllocator
  readonly #aasx: AasxStore
  /** Stacks being exported; an export holds the stack like a job. */
  readonly #exports = new Set<string>()
  readonly #imports = new Map<string, StagedImport>()
  readonly #clients = new Map<string, EngineClient>()
  #engineCache: { at: number, engines: Engines } | null = null

  constructor (options: ContainerManagerOptions) {
    this.#options = options
    this.#timeouts = { ...defaultTimeouts, ...options.timeouts }
    this.#isReady = options.isReady ?? defaultIsReady
    this.#ports = new PortAllocator(options.deps.db, options.isPortFree)
    this.#aasx = new AasxStore(options.dataDir, options.grants)
  }

  get #db () {
    return this.#options.deps.db
  }

  async dispose (): Promise<void> {
    await Promise.all([...this.#clients.values()].map(client => client.close()))
    this.#clients.clear()
  }

  /** Waits for running jobs; for tests and shutdown. */
  settle (): Promise<void> {
    return this.#jobs.settle()
  }

  async engines (fresh = false): Promise<Engines> {
    if (!fresh && this.#engineCache && Date.now() - this.#engineCache.at < 10_000) {
      return this.#engineCache.engines
    }
    const configured = await this.#configuredHost()
    const candidates = await engineCandidates(this.#options.discovery, configured)
    const probed = await Promise.all(candidates.map(candidate => probeEngine(candidate)))
    const selected = configured
      ? (probed.find(engine => engine.host === configured) ?? null)
      : (probed.find(engine => engine.running) ?? probed[0] ?? null)
    const engines: Engines = { selected, candidates: probed, configured }
    this.#engineCache = { at: Date.now(), engines }
    return engines
  }

  async selectEngine (host: string | null): Promise<Engines> {
    await this.#db.insert(containerSettings).values({ id: settingsId, engineHost: host }).onConflictDoUpdate({ target: containerSettings.id, set: { engineHost: host, updatedAt: new Date() } })
    return this.engines(true)
  }

  async list (): Promise<StackList> {
    const records = await this.#db.select().from(containerStacks).orderBy(containerStacks.createdAt)
    const engines = await this.engines()
    const hosts = new Set(records.map(record => record.engineHost))
    if (engines.selected?.running) {
      hosts.add(engines.selected.host)
    }
    const byHost = new Map<string, ContainerSummary[] | null>()
    await Promise.all([...hosts].map(async host => byHost.set(host, await this.#containersOn(host))))
    const items: Stack[] = records.map(record => {
      const containers = byHost.get(record.engineHost) ?? null
      return this.#toStack(record, record.id, record.name, containers?.filter(container => container.Labels[stackLabel] === record.id) ?? null)
    })
    // Labelled containers without a stored stack, on the engine in use.
    const known = new Set(records.map(record => record.id))
    const selectedContainers = engines.selected?.running ? byHost.get(engines.selected.host) : null
    const orphans = new Map<string, ContainerSummary[]>()
    for (const container of selectedContainers ?? []) {
      const id = container.Labels[stackLabel]
      if (id && !known.has(id)) {
        orphans.set(id, [...(orphans.get(id) ?? []), container])
      }
    }
    for (const [id, containers] of orphans) {
      items.push(this.#toStack(null, id, containers[0]?.Labels[nameLabel] ?? id, containers))
    }
    return { engineAvailable: Boolean(engines.selected?.running), items }
  }

  async get (id: string): Promise<Stack> {
    const list = await this.list()
    const stack = list.items.find(item => item.id === id)
    if (!stack) {
      throw new StudioProblem('not_found', 'This BaSyx instance does not exist (anymore).')
    }
    return stack
  }

  async plan (input: StackSpec, stackId?: string): Promise<StackPlan> {
    let spec = normalizeSpec(input)
    const engine = await this.#connected((await this.#selectedEngine()).host).catch(() => null)
    const record = stackId ? await this.#record(stackId) : null
    if (record && spec.network.basePort === null) {
      spec = { ...spec, network: { ...spec.network, basePort: record.spec.network.basePort } }
    }
    let portsInUse: number[] = []
    if (spec.network.basePort === null) {
      spec = await this.#ports.allocate(spec, stackId ?? null, engine)
    } else {
      portsInUse = await this.#ports.inUse(spec, stackId ?? null, engine, new Set(record ? portsOf(record.spec) : []))
    }
    const references = [...new Set(componentsOf(spec).map(component => componentImages[component]))]
    const images = await Promise.all(references.map(async id => {
      const reference = imageReference(catalogImages[id], spec.images.channel)
      const present = engine ? await engine.imageExists(reference).catch(() => false) : false
      return { reference, present, downloadMb: catalogImages[id].downloadMb }
    }))
    return {
      spec,
      components: componentsOf(spec),
      urls: urlsOf(spec),
      images,
      downloadMb: engine ? images.filter(image => !image.present).reduce((sum, image) => sum + image.downloadMb, 0) : null,
      portsInUse,
    }
  }

  async create (input: { spec: StackSpec, aasxFiles?: string[], importId?: string }, actor: Actor, requestId: string): Promise<{ stack: Stack, job: Job }> {
    const id = newId()
    const job = this.#jobs.claim(id, 'create')
    try {
      const engineInfo = await this.#selectedEngine()
      const engine = await this.#connected(engineInfo.host)
      const staged = input.importId ? this.#takeImport(input.importId) : null
      let spec = normalizeSpec(input.spec)
      if (spec.network.basePort === null) {
        spec = await this.#ports.allocate(spec, null, engine)
      } else {
        await this.#ports.requireFree(spec, null, engine)
      }
      const access = spec.security.mode === 'keycloak' ? spec.security.access : null
      const generated = generateSecrets(access)
      const importedUsers = staged?.parsed.secrets.users
      const secrets: StackSecrets = {
        databasePassword: staged?.parsed.secrets.databasePassword ?? generated.databasePassword,
        keycloakAdminPassword: access ? (staged?.parsed.secrets.keycloakAdminPassword ?? generated.keycloakAdminPassword) : null,
        users: access ? (importedUsers && importedUsers.length > 0 ? importedUsers : generated.users) : [],
      }
      const record = await this.#stored(id, async () => {
        spec = { ...spec, aasxFiles: await this.#aasx.add(id, input.aasxFiles ?? [], staged?.parsed.aasx ?? new Map(), []) }
        if (staged?.parsed.database) {
          await writeFile(this.#pendingDump(id), staged.parsed.database, { mode: 0o600 })
        }
        const [inserted] = await this.#db.insert(containerStacks).values({
          id,
          name: spec.name,
          spec,
          secretsCiphertext: this.#encryptSecrets(secrets),
          engineHost: engineInfo.host,
          createdBy: actor.subject,
        }).returning()
        return inserted!
      })
      this.#run(job, actor, requestId, { preset: spec.preset, engine: engineInfo.name }, () => this.#up(job, record, { recreate: true, pull: 'missing' }, actor, requestId))
      return { stack: this.#toStack(record, id, record.name, []), job }
    } catch (error) {
      this.#jobs.release(job)
      throw error
    }
  }

  async change (input: { stackId: string, spec: StackSpec, aasxFiles?: string[] }, actor: Actor, requestId: string): Promise<{ stack: Stack, job: Job }> {
    const job = this.#claim(input.stackId, 'change')
    try {
      const record = await this.#record(input.stackId)
      const engine = await this.#connected(record.engineHost).catch(error => {
        throw engineProblem(error)
      })
      let spec = normalizeSpec(input.spec)
      if (spec.images.channel !== record.spec.images.channel) {
        spec = { ...spec, images: { channel: spec.images.channel } }
      }
      if (spec.network.basePort === null) {
        spec = { ...spec, network: { ...spec.network, basePort: record.spec.network.basePort } }
      }
      await this.#ports.requireFree(spec, record.id, engine, new Set(portsOf(record.spec)))
      // New files come as handles; files no longer listed are deleted only
      // once the new ones are stored and the change is saved.
      const keep = spec.aasxFiles.filter(name => record.spec.aasxFiles.includes(name))
      const dropped = record.spec.aasxFiles.filter(name => !keep.includes(name))
      spec = { ...spec, aasxFiles: await this.#aasx.add(record.id, input.aasxFiles ?? [], new Map(), keep, dropped) }
      let secrets = this.#secrets(record)
      const access = spec.security.mode === 'keycloak' ? spec.security.access : null
      const previousAccess = record.spec.security.mode === 'keycloak' ? record.spec.security.access : null
      if (access !== previousAccess) {
        const generated = generateSecrets(access)
        secrets = { databasePassword: secrets.databasePassword, keycloakAdminPassword: access ? (secrets.keycloakAdminPassword ?? generated.keycloakAdminPassword) : null, users: generated.users }
      }
      // The infrastructure follows endpoints and security; it is registered again.
      const reRegister = JSON.stringify(urlsOf(spec)) !== JSON.stringify(urlsOf(record.spec)) || access !== previousAccess || spec.topology !== record.spec.topology
      const [updated] = await this.#db.update(containerStacks).set({
        name: spec.name,
        spec,
        secretsCiphertext: this.#encryptSecrets(secrets),
        updatedAt: new Date(),
      }).where(eq(containerStacks.id, record.id)).returning()
      await this.#aasx.remove(record.id, dropped)
      const previousNetwork = this.#details(record).network
      this.#run(job, actor, requestId, {}, async () => {
        if (reRegister && updated!.infrastructureId) {
          await this.#unregister(job, updated!, actor, requestId)
        }
        await this.#removeContainers(record.id, record.engineHost, false)
        if (this.#details(updated!).network !== previousNetwork) {
          await engine.removeNetwork(previousNetwork).catch(() => {})
        }
        await this.#up(job, updated!, { recreate: true, pull: 'missing' }, actor, requestId)
      })
      return { stack: this.#toStack(updated!, record.id, updated!.name, []), job }
    } catch (error) {
      this.#jobs.release(job)
      throw error
    }
  }

  async start (id: string, actor: Actor, requestId: string): Promise<Job> {
    return this.#lifecycle(id, 'start', actor, requestId, (job, record) => this.#up(job, record, { recreate: false, pull: 'missing' }, actor, requestId))
  }

  async stop (id: string, actor: Actor, requestId: string): Promise<Job> {
    return this.#lifecycle(id, 'stop', actor, requestId, (job, record) => this.#down(job, record))
  }

  async update (id: string, actor: Actor, requestId: string): Promise<Job> {
    return this.#lifecycle(id, 'update', actor, requestId, async (job, record) => {
      record.spec = { ...record.spec, images: { channel: record.spec.images.channel } }
      await this.#removeContainers(id, record.engineHost, false)
      await this.#up(job, record, { recreate: true, pull: record.spec.images.channel === 'latest' ? 'always' : 'missing' }, actor, requestId)
    })
  }

  async remove (input: { stackId: string, deleteData: boolean, removeInfrastructure: boolean }, actor: Actor, requestId: string): Promise<Job> {
    const id = input.stackId
    const job = this.#claim(id, 'remove')
    try {
      const [record] = await this.#db.select().from(containerStacks).where(eq(containerStacks.id, id))
      const host = record?.engineHost ?? (await this.#selectedEngine()).host
      return this.#run(job, actor, requestId, { deleteData: input.deleteData, removeInfrastructure: input.removeInfrastructure }, async () => {
        await runStep(job, 'remove', async () => {
          await this.#removeContainers(id, host, true)
          const engine = await this.#connected(host)
          for (const network of await engine.listNetworks(`${stackLabel}=${id}`)) {
            await engine.removeNetwork(network.Name)
          }
          if (input.deleteData) {
            for (const volume of await engine.listVolumes(`${stackLabel}=${id}`)) {
              await engine.removeVolume(volume.Name)
            }
          }
        })
        if (!record) {
          return
        }
        if (input.removeInfrastructure && record.infrastructureId) {
          await this.#unregister(job, record, actor, requestId)
        }
        if (input.deleteData || record.spec.persistence === 'ephemeral') {
          await this.#db.delete(containerStacks).where(eq(containerStacks.id, id))
          await this.#aasx.removeStack(id)
        }
        // Keep the spec, secrets and AASX files with a retained database. The
        // missing instance stays in the list and can be recreated or deleted.
      })
    } catch (error) {
      this.#jobs.release(job)
      throw error
    }
  }

  job (id: string): Job {
    return this.#jobs.get(id)
  }

  async logs (id: string, component: StackComponentId, tail: number): Promise<StackLogs> {
    const record = await this.#record(id)
    const engine = await this.#connected(record.engineHost).catch(error => {
      throw engineProblem(error)
    })
    const container = (await engine.listContainers(`${stackLabel}=${id}`)).find(item => item.Labels[componentLabel] === component)
    if (!container) {
      return { component, text: '', truncated: false }
    }
    const text = stripAnsi(await engine.logs(container.Id, tail))
    return { component, text, truncated: text.split('\n').length >= tail }
  }

  async saveLogs (id: string, component: StackComponentId, path: string, actor: Actor, requestId: string): Promise<{ fileName: string }> {
    const logs = await this.logs(id, component, 500)
    await writeFile(path, logs.text, { mode: 0o600 })
    await recordAudit(this.#options.deps, { action: 'containers.logs.save', outcome: 'success', requestId, actorSubject: actor.subject, details: { stackId: id, component } })
    return { fileName: basename(path) }
  }

  async signIn (id: string, actor: Actor, requestId: string): Promise<StackSignIn> {
    const record = await this.#record(id)
    const port = portOf(record.spec, 'keycloak')
    if (record.spec.security.mode !== 'keycloak' || port === null) {
      throw new StudioProblem('not_found', 'This instance has no sign-in.')
    }
    const secrets = this.#secrets(record)
    await recordAudit(this.#options.deps, { action: 'containers.signin.reveal', outcome: 'success', requestId, actorSubject: actor.subject, details: { stackId: id } })
    const base = `http://127.0.0.1:${port}`
    return {
      issuer: `${base}/realms/${realmName}`,
      accountUrl: `${base}/realms/${realmName}/account`,
      users: secrets.users.map(({ username, password, role }) => ({ username, password, role })),
      console: { url: `${base}/admin/`, username: keycloakAdminUser, password: secrets.keycloakAdminPassword ?? '' },
    }
  }

  async export (id: string, path: string, actor: Actor, requestId: string): Promise<{ fileName: string }> {
    if (this.#jobs.holder(id) || this.#exports.has(id)) {
      throw new StudioProblem('container_busy', 'Another operation is running for this instance. Wait until it has finished.')
    }
    this.#exports.add(id)
    try {
      const record = await this.#record(id)
      const engine = await this.#connected(record.engineHost)
      const running = await engine.listContainers(`${stackLabel}=${id}`)
      const database = running.find(container => container.Labels[componentLabel] === 'database')
      if (!database) {
        throw new StudioProblem('container_operation_failed', 'Recreate the retained instance before exporting its data.')
      }
      // Inspect the actual containers, including stacks created by older builds
      // whose stored specs did not yet have an image lock.
      const digests: Partial<Record<StackComponentId, string>> = {}
      for (const component of componentsOf(record.spec)) {
        const container = running.find(item => item.Labels[componentLabel] === component)
        if (!container) {
          throw new StudioProblem('container_operation_failed', 'Recreate all missing parts before exporting this instance.')
        }
        const inspected = await engine.inspectContainer(container.Id)
        const repository = catalogImages[componentImages[component]].repository
        digests[component] = await engine.imageDigest(inspected?.Image ?? container.Image, repository)
      }
      const exportedSpec = { ...record.spec, images: { ...record.spec.images, digests } }
      const details = planStack({ id: record.id, slug: slugOf(record.name) }, exportedSpec, this.#secrets(record))
      const wasRunning = database.State === 'running'
      let snapshot: Uint8Array
      try {
        await this.#startComponent(engine, database.Id, details.containers.find(container => container.component === 'database')!, record)
        snapshot = await engine.dumpDatabase(database.Id)
      } finally {
        if (!wasRunning) {
          await engine.stopContainer(database.Id)
        }
      }
      const aasx = new Map<string, Uint8Array>()
      for (const name of record.spec.aasxFiles) {
        aasx.set(name, new Uint8Array(await this.#aasx.read(id, name)))
      }
      await writeFile(path, exportArchive(details, exportedSpec, this.#secrets(record), slugOf(record.name), aasx, snapshot), { mode: 0o600 })
      await recordAudit(this.#options.deps, { action: 'containers.export', outcome: 'success', requestId, actorSubject: actor.subject, details: { stackId: id } })
      return { fileName: basename(path) }
    } finally {
      this.#exports.delete(id)
    }
  }

  async import (path: string, actor: Actor, requestId: string): Promise<StackImport> {
    const parsed = await readImport(path)
    const notes: StackImport['notes'] = []
    if (parsed.composeIgnored) {
      notes.push('compose_ignored')
    }
    if (parsed.spec.aasxFiles.some(name => !parsed.aasx.has(name))) {
      notes.push('aasx_missing')
    }
    const secured = parsed.spec.security.mode === 'keycloak'
    if (!parsed.secrets.databasePassword || (secured && (!parsed.secrets.keycloakAdminPassword || !parsed.secrets.users?.length))) {
      notes.push('secrets_generated')
    }
    let spec: StackSpec = { ...parsed.spec, aasxFiles: [...parsed.aasx.keys()] }
    // Without an engine, the exported ports are kept and checked on create.
    const engine = await this.#connected((await this.#selectedEngine()).host).catch(() => null)
    if (spec.network.basePort !== null && (await this.#ports.inUse(spec, null, engine)).length > 0) {
      spec = { ...spec, network: { ...spec.network, basePort: null } }
      notes.push('ports_reassigned')
    }
    const importId = newId()
    const now = Date.now()
    for (const [key, staged] of this.#imports) {
      if (staged.expiresAt < now) {
        this.#imports.delete(key)
      }
    }
    this.#imports.set(importId, { parsed: { ...parsed, spec }, expiresAt: now + importTtlMs })
    await recordAudit(this.#options.deps, { action: 'containers.import', outcome: 'success', requestId, actorSubject: actor.subject, details: { importId } })
    return { importId, spec, aasxFiles: [...parsed.aasx.keys()], notes }
  }

  /** Claims a stack for a job; an export holds it too. */
  #claim (stackId: string, kind: Job['kind']): Job {
    return this.#jobs.claim(stackId, kind, this.#exports.has(stackId))
  }

  /** Start, stop and update: claim the stack, read it, run the job. */
  async #lifecycle (id: string, kind: 'start' | 'stop' | 'update', actor: Actor, requestId: string, work: (job: Job, record: StackRecord) => Promise<void>): Promise<Job> {
    const job = this.#claim(id, kind)
    try {
      const record = await this.#record(id)
      return this.#run(job, actor, requestId, {}, () => work(job, record))
    } catch (error) {
      this.#jobs.release(job)
      throw error
    }
  }

  /** Runs a claimed job and audits its outcome when it ends (ADR 0033). */
  #run (job: Job, actor: Actor, requestId: string, details: Record<string, unknown>, work: () => Promise<void>): Job {
    return this.#jobs.run(job, work, finished => recordAudit(this.#options.deps, {
      action: `containers.${finished.kind}`,
      outcome: finished.state === 'succeeded' ? 'success' : 'failure',
      requestId,
      actorSubject: actor.subject,
      details: { stackId: finished.stackId, jobId: finished.id, ...details, ...(finished.problem ? { code: finished.problem.code } : {}) },
    }))
  }

  /** Stores a new stack; what was written is removed again when a part fails. */
  async #stored (id: string, store: () => Promise<StackRecord>): Promise<StackRecord> {
    try {
      return await store()
    } catch (error) {
      await this.#db.delete(containerStacks).where(eq(containerStacks.id, id)).catch(() => {})
      await this.#aasx.removeStack(id)
      throw error
    }
  }

  /** Removes the stack's infrastructure from Studio; a failure is noted on the step, not fatal. */
  async #unregister (job: Job, record: StackRecord, actor: Actor, requestId: string): Promise<void> {
    const infrastructureId = record.infrastructureId
    if (!infrastructureId) {
      return
    }
    await runOptionalStep(job, 'unregister', async () => {
      await this.#options.infrastructures.remove(infrastructureId, actor, requestId)
      await this.#db.update(containerStacks).set({ infrastructureId: null }).where(eq(containerStacks.id, record.id))
      record.infrastructureId = null
    })
  }

  #client (host: string): EngineClient {
    let client = this.#clients.get(host)
    if (!client) {
      client = new EngineClient(host)
      this.#clients.set(host, client)
    }
    return client
  }

  /** A client that knows the engine's API version. */
  async #connected (host: string): Promise<EngineClient> {
    const client = this.#client(host)
    await client.connect()
    return client
  }

  async #configuredHost (): Promise<string | null> {
    const [row] = await this.#db.select().from(containerSettings).where(eq(containerSettings.id, settingsId))
    return row?.engineHost ?? null
  }

  /** The engine new stacks are created on; it must be running. */
  async #selectedEngine (): Promise<EngineInfo> {
    let engines = await this.engines()
    if (!engines.selected?.running) {
      engines = await this.engines(true)
    }
    if (!engines.selected?.running) {
      throw new StudioProblem('container_engine_unavailable', engines.selected
        ? `${engines.selected.name} is not running. Start it and try again.`
        : 'No Docker or Podman engine was found on this computer.')
    }
    return engines.selected
  }

  async #record (id: string): Promise<StackRecord> {
    const [record] = await this.#db.select().from(containerStacks).where(eq(containerStacks.id, id))
    if (!record) {
      throw new StudioProblem('not_found', 'This BaSyx instance does not exist (anymore).')
    }
    return record
  }

  #secrets (record: StackRecord): StackSecrets {
    return JSON.parse(this.#options.deps.cipher.decrypt(record.secretsCiphertext, secretsPurpose)) as StackSecrets
  }

  #encryptSecrets (secrets: StackSecrets): string {
    return this.#options.deps.cipher.encrypt(JSON.stringify(secrets), secretsPurpose)
  }

  /** A database snapshot of an import, restored at the stack's first start. */
  #pendingDump (stackId: string): string {
    return join(this.#aasx.stackDirectory(stackId), 'database.pending.dump')
  }

  #details (record: StackRecord, secrets = this.#secrets(record)): StackDetails {
    return planStack({ id: record.id, slug: slugOf(record.name) }, record.spec, secrets)
  }

  #toStack (record: StackRecord | null, id: string, name: string, containers: ContainerSummary[] | null): Stack {
    const spec = record?.spec ?? null
    const byComponent = new Map(containers?.map(container => [container.Labels[componentLabel] as StackComponentId, container]))
    const ids = spec ? componentsOf(spec) : [...byComponent.keys()]
    const urls = spec ? urlsOf(spec) : { environment: null, aasRegistry: null, submodelRegistry: null, discovery: null, keycloak: null }
    const components: StackComponent[] = ids.map(component => {
      const summary = byComponent.get(component)
      const { state, exitCode } = containers === null ? { state: 'missing' as const, exitCode: null } : componentState(summary)
      const port = spec ? portOf(spec, component) : null
      return {
        id: component,
        state,
        exitCode,
        url: port === null ? null : `http://127.0.0.1:${port}`,
        image: summary?.Image ?? record?.images[component] ?? (spec ? imageReference(catalogImages[componentImages[component]], spec.images.channel) : ''),
      }
    })
    const jobId = this.#jobs.holder(id)?.id ?? null
    let status: StackStatus
    if (!record) {
      status = 'orphan'
    } else if (containers === null) {
      status = jobId ? 'busy' : 'unknown'
    } else {
      status = stackStatus(components, jobId !== null, this.#jobs.lastFailed(id))
    }
    const updateAvailable = Boolean(spec && spec.images.channel === 'tested' && componentsOf(spec).some(component =>
      record?.images[component] && record.images[component] !== imageReference(catalogImages[componentImages[component]], 'tested')))
    return {
      id,
      name,
      spec,
      status,
      components,
      urls,
      infrastructureId: record?.infrastructureId ?? null,
      engineHost: record?.engineHost ?? null,
      jobId,
      updateAvailable,
      createdAt: record?.createdAt.toISOString() ?? null,
    }
  }

  async #containersOn (host: string): Promise<ContainerSummary[] | null> {
    try {
      const client = await this.#connected(host)
      return await client.listContainers(stackLabel)
    } catch {
      return null
    }
  }

  async #removeContainers (id: string, host: string, removeAnonymousVolumes: boolean): Promise<void> {
    const engine = await this.#connected(host)
    const containers = await engine.listContainers(`${stackLabel}=${id}`)
    // Services first, the database last.
    const order = (container: ContainerSummary) => container.Labels[componentLabel] === 'database' ? 1 : 0
    for (const container of containers.toSorted((a, b) => order(a) - order(b))) {
      await engine.removeContainer(container.Id, removeAnonymousVolumes)
    }
  }

  async #down (job: Job, record: StackRecord): Promise<void> {
    await runStep(job, 'stop', async () => {
      const engine = await this.#connected(record.engineHost)
      const containers = await engine.listContainers(`${stackLabel}=${record.id}`)
      const tier = (container: ContainerSummary) => {
        const component = container.Labels[componentLabel] as StackComponentId
        return component === 'database' ? 2 : (component === 'keycloak' ? 1 : 0)
      }
      for (const level of [0, 1, 2]) {
        await Promise.all(containers.filter(container => tier(container) === level).map(container => engine.stopContainer(container.Id)))
      }
    })
  }

  /** Creates what is missing and starts everything in order (plan E3, E4). */
  async #up (job: Job, record: StackRecord, options: { recreate: boolean, pull: 'missing' | 'always' }, actor: Actor, requestId: string): Promise<void> {
    const secrets = this.#secrets(record)
    const details = this.#details(record, secrets)
    const components = details.containers.map(container => container.component)
    // Show the whole plan from the start.
    addStep(job, 'prepare')
    const references = [...new Set(details.containers.map(container => container.image))]
    for (const reference of references) {
      addStep(job, `download:${reference}`)
    }
    addStep(job, 'create')
    for (const component of components) {
      addStep(job, `start:${component}`)
    }
    if (!record.infrastructureId) {
      addStep(job, 'register')
    }

    const engine = await this.#connected(record.engineHost).catch(error => {
      throw engineProblem(error)
    })
    await runStep(job, 'prepare', async () => {
      if (!(await engine.networkExists(details.network))) {
        await engine.createNetwork(details.network, details.labels)
      }
      const existingVolumes = new Set((await engine.listVolumes(`${stackLabel}=${record.id}`)).map(volume => volume.Name))
      // Older builds named volumes after the display name. Adopt the labelled
      // volume rather than starting an empty database after a rename/upgrade.
      if (details.volumes.length > 0 && !existingVolumes.has(details.volumes[0]!) && existingVolumes.size > 0) {
        if (existingVolumes.size !== 1) {
          throw new StudioProblem('container_operation_failed', 'Several retained database volumes exist. No data was changed; select the database to recover before starting.')
        }
        const volume = [...existingVolumes][0]!
        details.volumes = [volume]
        details.containers.find(container => container.component === 'database')!.volume!.name = volume
      }
      for (const volume of details.volumes) {
        if (!existingVolumes.has(volume)) {
          await engine.createVolume(volume, details.labels)
        }
      }
    })

    // Tested images fail closed: choosing latest is an explicit user decision.
    for (const reference of references) {
      await runStep(job, `download:${reference}`, async step => {
        if (options.pull === 'missing' && await engine.imageExists(reference)) {
          step.state = 'skipped'
          return
        }
        try {
          await engine.pullImage(reference, progress => {
            step.progress = progress.total > 0 ? progress : null
          })
        } catch (error) {
          throw this.#pullProblem(reference, error)
        }
      })
    }
    const images: Partial<Record<StackComponentId, string>> = {}
    const digests: Partial<Record<StackComponentId, string>> = {}
    for (const container of details.containers) {
      const digest = await engine.imageDigest(container.image)
      container.image = `${catalogImages[componentImages[container.component]].repository}@${digest}`
      images[container.component] = container.image
      digests[container.component] = digest
    }
    record.spec = { ...record.spec, images: { ...record.spec.images, digests } }
    await this.#db.update(containerStacks).set({ images, spec: record.spec, updatedAt: new Date() }).where(eq(containerStacks.id, record.id))
    record.images = images

    // Create missing containers; the schema setup runs fresh every time, and
    // an ephemeral database starts empty.
    const ids = new Map<StackComponentId, string>()
    await runStep(job, 'create', async () => {
      const existing = new Map((await engine.listContainers(`${stackLabel}=${record.id}`)).map(container => [container.Labels[componentLabel] as StackComponentId, container]))
      for (const [component, container] of existing) {
        if (!components.includes(component)) {
          await engine.removeContainer(container.Id, true)
        }
      }
      for (const container of details.containers) {
        const current = existing.get(container.component)
        const fresh = options.recreate || container.component === 'schema' || (container.component === 'database' && record.spec.persistence === 'ephemeral')
        if (current && !fresh) {
          ids.set(container.component, current.Id)
          continue
        }
        if (current) {
          await engine.removeContainer(current.Id, true)
        }
        const id = await engine.createContainer(container.name, containerConfig(details, container, secrets, slugOf(record.name)))
        await this.#upload(engine, id, container, record.id)
        ids.set(container.component, id)
      }
    })

    // Ports of containers that do not run yet must be free (plan U2).
    const running = new Set((await engine.listContainers(`${stackLabel}=${record.id}`)).filter(container => container.State === 'running').map(container => portOf(record.spec, container.Labels[componentLabel] as StackComponentId)).filter((port): port is number => port !== null))
    await this.#ports.requireFree(record.spec, record.id, engine, running)

    for (const container of details.containers.filter(container => !basyxServices.includes(container.component))) {
      await runStep(job, `start:${container.component}`, () => this.#startComponent(engine, ids.get(container.component)!, container, record))
      if (container.component === 'database') {
        await this.#restorePending(engine, ids.get('database')!, record.id)
      }
    }
    // The BaSyx services start together once their database and sign-in are there.
    const services = details.containers.filter(container => basyxServices.includes(container.component))
    for (const container of services) {
      await runStep(job, `start:${container.component}`, async () => {
        await engine.startContainer(ids.get(container.component)!)
      })
    }
    for (const container of services) {
      await runStep(job, `start:${container.component}`, () => this.#waitForService(engine, ids.get(container.component)!, container, record))
    }

    if (!record.infrastructureId) {
      // The instance runs; if Studio cannot add it, the step says so instead of failing.
      await runOptionalStep(job, 'register', async () => {
        const infrastructureId = await this.#options.infrastructures.create({ name: record.name, spec: record.spec, actor, requestId })
        await this.#db.update(containerStacks).set({ infrastructureId }).where(eq(containerStacks.id, record.id))
        record.infrastructureId = infrastructureId
      })
    }
  }

  #pullProblem (reference: string, error: unknown): StudioProblem {
    if (error instanceof EngineUnreachable) {
      return engineProblem(error)
    }
    const message = error instanceof Error ? error.message : String(error)
    if (/no space left on device/i.test(message)) {
      return new StudioProblem('container_disk_full', message)
    }
    return new StudioProblem('container_image_unavailable', `${reference} could not be downloaded: ${message}`, {
      violations: [{ path: reference, message }],
    })
  }

  async #restorePending (engine: EngineClient, databaseId: string, stackId: string): Promise<void> {
    const path = this.#pendingDump(stackId)
    const snapshot = await readFile(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return null
      }
      throw error
    })
    if (snapshot) {
      await engine.restoreDatabase(databaseId, createTar([{ path: 'studio-database.dump', content: snapshot }]))
      await rename(path, join(this.#aasx.stackDirectory(stackId), 'database.restored.dump'))
    }
  }

  async #upload (engine: EngineClient, id: string, container: PlannedContainer, stackId: string): Promise<void> {
    const byDirectory = new Map<string, Array<{ path: string, content: Uint8Array | string }>>()
    for (const file of container.files) {
      const content = file.content.kind === 'text'
        ? file.content.text
        : new Uint8Array(await this.#aasx.read(stackId, file.content.name))
      byDirectory.set(file.directory, [...(byDirectory.get(file.directory) ?? []), { path: file.path, content }])
    }
    for (const [directory, entries] of byDirectory) {
      await engine.putArchive(id, directory, createTar(entries))
    }
  }

  async #failure (engine: EngineClient, id: string, component: StackComponentId, detail: string): Promise<StudioProblem> {
    const log = await engine.logs(id, 30).then(text => stripAnsi(text).trim().split('\n').slice(-5).join('\n')).catch(() => '')
    return new StudioProblem('container_start_failed', `${detail}${log ? `\n${log}` : ''}`, { violations: [{ path: component, message: detail }] })
  }

  async #startComponent (engine: EngineClient, id: string, container: PlannedContainer, record: StackRecord): Promise<void> {
    const component = container.component
    try {
      await engine.startContainer(id)
    } catch (error) {
      throw engineProblem(error, `${component} could not be started.`)
    }
    if (component === 'schema') {
      const code = await engine.waitContainer(id, this.#timeouts.schemaMs)
      if (code !== 0) {
        throw await this.#failure(engine, id, component, `The database setup ended with code ${code}.`)
      }
      return
    }
    const deadline = Date.now() + (component === 'database' ? this.#timeouts.databaseMs : this.#timeouts.keycloakMs)
    const keycloakUrl = component === 'keycloak' ? `http://127.0.0.1:${portOf(record.spec, 'keycloak')}/realms/${realmName}/.well-known/openid-configuration` : null
    while (Date.now() < deadline) {
      const details = await engine.inspectContainer(id)
      if (!details || (!details.State.Running && details.State.Status !== 'created')) {
        throw await this.#failure(engine, id, component, `${component} stopped while starting.`)
      }
      if (component === 'database' ? details.State.Health?.Status === 'healthy' : await this.#isReady(keycloakUrl!)) {
        return
      }
      await sleep(this.#timeouts.pollMs)
    }
    throw await this.#failure(engine, id, component, `${component} did not get ready in time.`)
  }

  async #waitForService (engine: EngineClient, id: string, container: PlannedContainer, record: StackRecord): Promise<void> {
    const url = `http://127.0.0.1:${portOf(record.spec, container.component)}/description`
    const deadline = Date.now() + this.#timeouts.serviceMs
    // The environment answers while it still imports the AASX files of
    // GENERAL_AAS_PRECONFIG_PATHS: until it says it has, it is empty or partly filled.
    const preconfiguring = container.component === 'environment' && record.spec.aasxFiles.length > 0
    while (Date.now() < deadline) {
      if (await this.#isReady(url) && (!preconfiguring || await this.#preconfigured(engine, id))) {
        return
      }
      const details = await engine.inspectContainer(id)
      if (!details) {
        throw await this.#failure(engine, id, container.component, `${container.component} was removed while starting.`)
      }
      await sleep(this.#timeouts.pollMs)
    }
    throw await this.#failure(engine, id, container.component, `${container.component} did not answer in time.`)
  }

  /**
   * Whether this start of the environment has imported its AASX files. The
   * pinned aasenvironment-go image (catalog.ts) logs it once per start; only
   * the output since the container's current start counts, so a restart
   * waits again.
   */
  async #preconfigured (engine: EngineClient, id: string): Promise<boolean> {
    const startedAt = Date.parse((await engine.inspectContainer(id))?.State.StartedAt ?? '')
    const text = await engine.logs(id, 'all', Number.isNaN(startedAt) ? undefined : Math.floor(startedAt / 1000))
    return text.includes(preconfigurationCompleted)
  }

  #takeImport (id: string): StagedImport {
    const staged = this.#imports.get(id)
    this.#imports.delete(id)
    if (!staged || staged.expiresAt < Date.now()) {
      throw new StudioProblem('invalid_request', 'The import expired. Import the file again.')
    }
    return staged
  }
}
