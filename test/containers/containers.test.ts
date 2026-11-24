import type { StudioConfig } from '~~/server/lib/config'
import type { DiscoveryEnvironment } from '~~/server/lib/containers/discovery'
import type { ContainerSummary, CreateContainerConfig } from '~~/server/lib/containers/engine'
import type { DatabaseHandle } from '~~/server/lib/database/client'
import type { Actor, StudioDeps } from '~~/server/lib/deps'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { auditEvents, containerStacks, infrastructures } from '~~/server/database/schema'
import { authorizeAppCall } from '~~/server/lib/apps/calls'
import { installApp, installBundledApp, listInstallations } from '~~/server/lib/apps/store'
import { emptyTrustStore } from '~~/server/lib/apps/trust'
import { canonicalRepository, EngineClient, execOutput } from '~~/server/lib/containers/engine'
import { parseImport, readImport } from '~~/server/lib/containers/import'
import { ContainerManager } from '~~/server/lib/containers/manager'
import { componentLabel, containerConfig, planStack } from '~~/server/lib/containers/plan'
import { generateSecrets } from '~~/server/lib/containers/security'
import { SecretCipher } from '~~/server/lib/crypto/cipher'
import { openDatabase } from '~~/server/lib/database/client'
import { applyMigrations, loadMigrationsFromDirectory } from '~~/server/lib/database/migrate'
import { FileGrantStore } from '~~/server/lib/desktop/grants'
import { appMethodParamsSchemas, isExternalUrl, presetSpec, stackSpecSchema } from '#shared/contract'
import { cloneSpec } from '../../app/components/basyx-docker/support'
import { manifestOf, zipApp } from '../apps/support'

vi.mock('~~/server/lib/containers/discovery', () => ({
  engineCandidates: async () => [{ host: 'unix:///test-engine.sock', source: 'default' }],
  probeEngine: async () => ({ host: 'unix:///test-engine.sock', source: 'default', kind: 'docker', name: 'Test engine', running: true, version: '29', apiVersion: '1.54', os: 'linux', arch: 'arm64', error: null }),
}))

const actor: Actor = { subject: 'desktop', name: 'Desktop', roles: [], isAdmin: true, sessionId: 'test' }
const digest = `sha256:${'a'.repeat(64)}`
const snapshot = strToU8('PGDMP-test-database-with-post-start-edits')
let database: DatabaseHandle
let deps: StudioDeps
let manager: ContainerManager
let directory: string
let containers: Map<string, ContainerSummary>
let configs: Map<string, CreateContainerConfig>
let volumes: Array<{ Name: string, Labels: Record<string, string> }>
let networks: Array<{ Id: string, Name: string, Labels: Record<string, string> }>

async function finish (job: { id: string }) {
  await manager.settle()
  const result = manager.job(job.id)
  expect(result.problem).toBeNull()
  expect(result.state).toBe('succeeded')
}

beforeAll(async () => {
  database = await openDatabase({ kind: 'memory' })
  await applyMigrations(database.db, await loadMigrationsFromDirectory(new URL('../../server/database/migrations', import.meta.url).pathname))
  deps = { db: database.db, cipher: new SecretCipher(randomBytes(32)), config: { deploymentMode: 'desktop', infrastructuresEditable: true, deployment: { appInstalls: true }, apps: { baseUrl: 'http://apps.localhost/app/', allowUnsigned: true, trustStore: emptyTrustStore, packages: [] } } as StudioConfig }
})
afterAll(async () => database.close())

beforeEach(async () => {
  await database.db.delete(containerStacks)
  await database.db.delete(infrastructures)
  directory = await mkdtemp(join(tmpdir(), 'studio-container-unit-'))
  containers = new Map()
  configs = new Map()
  volumes = []
  networks = []
  const engine = EngineClient.prototype
  vi.spyOn(engine, 'version').mockResolvedValue({ version: '29', apiVersion: '1.54', os: 'linux', arch: 'arm64', podman: false })
  vi.spyOn(engine, 'close').mockResolvedValue()
  vi.spyOn(engine, 'imageExists').mockResolvedValue(true)
  vi.spyOn(engine, 'imageDigest').mockImplementation(async reference => reference.includes('@') ? reference.split('@', 2)[1]! : digest)
  vi.spyOn(engine, 'pullImage').mockResolvedValue()
  vi.spyOn(engine, 'publishedPorts').mockResolvedValue([])
  const matches = (labels: Record<string, string>, filter: string) => filter.includes('=') ? labels[filter.split('=', 1)[0]!] === filter.split('=', 2)[1] : Boolean(labels[filter])
  vi.spyOn(engine, 'listContainers').mockImplementation(async filter => [...containers.values()].filter(item => matches(item.Labels, filter)))
  vi.spyOn(engine, 'listVolumes').mockImplementation(async filter => volumes.filter(item => matches(item.Labels, filter)))
  vi.spyOn(engine, 'createVolume').mockImplementation(async (name, labels) => {
    volumes.push({ Name: name, Labels: labels })
  })
  vi.spyOn(engine, 'removeVolume').mockImplementation(async name => {
    volumes = volumes.filter(item => item.Name !== name)
  })
  vi.spyOn(engine, 'networkExists').mockImplementation(async name => networks.some(item => item.Name === name))
  vi.spyOn(engine, 'createNetwork').mockImplementation(async (name, labels) => {
    networks.push({ Id: name, Name: name, Labels: labels })
  })
  vi.spyOn(engine, 'listNetworks').mockImplementation(async filter => networks.filter(item => matches(item.Labels, filter)))
  vi.spyOn(engine, 'removeNetwork').mockImplementation(async name => {
    networks = networks.filter(item => item.Name !== name)
  })
  vi.spyOn(engine, 'createContainer').mockImplementation(async (name, config) => {
    configs.set(name, config)
    containers.set(name, { Id: name, Names: [name], Image: config.Image, State: 'created', Status: 'Created', Labels: config.Labels })
    return name
  })
  vi.spyOn(engine, 'putArchive').mockResolvedValue()
  vi.spyOn(engine, 'startContainer').mockImplementation(async id => {
    containers.get(id)!.State = 'running'
    containers.get(id)!.Status = 'Up (healthy)'
  })
  vi.spyOn(engine, 'stopContainer').mockImplementation(async id => {
    containers.get(id)!.State = 'exited'
    containers.get(id)!.Status = 'Exited (0)'
  })
  vi.spyOn(engine, 'removeContainer').mockImplementation(async id => {
    containers.delete(id)
  })
  vi.spyOn(engine, 'waitContainer').mockImplementation(async id => {
    containers.get(id)!.State = 'exited'
    return 0
  })
  vi.spyOn(engine, 'inspectContainer').mockImplementation(async id => {
    const item = containers.get(id)
    return item ? { Id: id, Name: id, Config: { Image: item.Image, Labels: item.Labels }, State: { Status: item.State, Running: item.State === 'running', ExitCode: 0, Health: { Status: 'healthy' } }, RestartCount: 0 } : null
  })
  vi.spyOn(engine, 'dumpDatabase').mockResolvedValue(snapshot)
  vi.spyOn(engine, 'restoreDatabase').mockResolvedValue()
  vi.spyOn(engine, 'logs').mockResolvedValue('hello\nworld\n')
  manager = new ContainerManager({
    deps, dataDir: directory, discovery: {} as DiscoveryEnvironment, grants: new FileGrantStore(), isPortFree: async () => true, isReady: async () => true,
    infrastructures: {
      create: async ({ name }) => {
        const id = `infra-${randomBytes(6).toString('hex')}`
        await database.db.insert(infrastructures).values({ id, name, endpoints: [], security: { mode: 'unsecured' }, createdBy: actor.subject })
        return id
      },
      remove: async id => {
        await database.db.delete(infrastructures).where(eq(infrastructures.id, id))
      },
    },
  })
})
afterEach(async () => {
  await manager.settle()
  await manager.dispose()
  vi.restoreAllMocks()
  await rm(directory, { recursive: true, force: true })
})

describe('container regressions', () => {
  it('copies nested reactive wizard and imported specs without DataCloneError', () => {
    const spec = reactive(presetSpec('secured', 'Wizard'))
    const clone = cloneSpec(spec)
    expect(clone).toEqual(spec)
    clone.network.basePort = 19_000
    expect(spec.network.basePort).toBeNull()
    expect(cloneSpec(reactive({ spec }).spec)).toEqual(spec)
  })

  it('keeps persistent resource names independent of the display name', () => {
    const spec = { ...presetSpec('quick', 'Before'), persistence: 'keep' as const, network: { basePort: 18_100, exposure: 'local' as const } }
    const secrets = generateSecrets(null)
    const before = planStack({ id: 'unique-id', slug: 'before' }, spec, secrets)
    const after = planStack({ id: 'unique-id', slug: 'after' }, { ...spec, name: 'After' }, secrets)
    expect(after.volumes).toEqual(before.volumes)
    expect(after.network).toBe(before.network)
  })

  it('adopts a legacy labelled volume after a rename', async () => {
    const created = await manager.create({ spec: { ...presetSpec('quick', 'Before'), persistence: 'keep' } }, actor, 'create')
    await finish(created.job)
    volumes[0]!.Name = 'basyx-before-legacy-database'
    vi.mocked(EngineClient.prototype.createVolume).mockClear()
    await finish((await manager.change({ stackId: created.stack.id, spec: { ...(await manager.get(created.stack.id)).spec!, name: 'After' } }, actor, 'change')).job)
    expect(EngineClient.prototype.createVolume).not.toHaveBeenCalled()
    const db = [...configs.values()].findLast(item => item.Labels[componentLabel] === 'database')!
    expect(db.HostConfig.Mounts?.[0]?.Source).toBe('basyx-before-legacy-database')
  })

  it('keeps a recoverable record and credentials when removing containers but keeping data', async () => {
    const created = await manager.create({ spec: { ...presetSpec('secured', 'Retained'), persistence: 'keep' } }, actor, 'create')
    await finish(created.job)
    const signIn = await manager.signIn(created.stack.id, actor, 'reveal')
    await finish(await manager.remove({ stackId: created.stack.id, deleteData: false, removeInfrastructure: true }, actor, 'remove'))
    expect((await manager.get(created.stack.id)).status).toBe('missing')
    expect((await manager.get(created.stack.id)).infrastructureId).toBeNull()
    expect(volumes).toHaveLength(1)
    await finish(await manager.start(created.stack.id, actor, 'recreate'))
    expect(await manager.signIn(created.stack.id, actor, 'reveal-again')).toEqual(signIn)
    expect(volumes).toHaveLength(1)
  })

  it('never substitutes SNAPSHOT when a tested digest cannot be downloaded', async () => {
    vi.mocked(EngineClient.prototype.imageExists).mockResolvedValue(false)
    vi.mocked(EngineClient.prototype.pullImage).mockRejectedValue(new Error('digest unavailable'))
    const created = await manager.create({ spec: presetSpec('quick', 'Pinned') }, actor, 'create')
    await manager.settle()
    expect(manager.job(created.job.id).problem?.code).toBe('container_image_unavailable')
    expect(EngineClient.prototype.pullImage).toHaveBeenCalledTimes(1)
    expect(vi.mocked(EngineClient.prototype.pullImage).mock.calls[0]![0]).toContain('@sha256:')
  })

  it('locks latest images for restart and exports the lock with a database snapshot', async () => {
    const created = await manager.create({ spec: { ...presetSpec('quick', 'Snapshot'), images: { channel: 'latest' } } }, actor, 'create')
    await finish(created.job)
    const stack = await manager.get(created.stack.id)
    expect(stack.spec?.images.digests?.environment).toBe(digest)
    const path = join(directory, 'snapshot.zip')
    await manager.export(stack.id, path, actor, 'export')
    const bytes = await readFile(path)
    const imported = await parseImport(bytes, 'snapshot.zip')
    expect(imported.database).toEqual(snapshot)
    expect(imported.spec.images.digests).toEqual(stack.spec!.images.digests)
    const entries = unzipSync(bytes)
    const compose = new TextDecoder().decode(Object.entries(entries).find(([name]) => name.endsWith('docker-compose.yml'))![1])
    expect(compose).toContain('database-restore')
    expect(compose).toContain('/restore-state/done')
    expect(compose).not.toContain(':SNAPSHOT')
    await finish(await manager.stop(stack.id, actor, 'stop'))
    await manager.export(stack.id, path, actor, 'export-stopped')
    expect((await manager.get(stack.id)).status).toBe('stopped')
    const staged = await manager.import(path, actor, 'import')
    const recreated = await manager.create({ spec: staged.spec, importId: staged.importId }, actor, 'create-imported')
    await finish(recreated.job)
    expect(EngineClient.prototype.restoreDatabase).toHaveBeenCalledTimes(1)
    await finish(await manager.stop(recreated.stack.id, actor, 'stop-imported'))
    await finish(await manager.start(recreated.stack.id, actor, 'start-imported'))
    expect(EngineClient.prototype.restoreDatabase).toHaveBeenCalledTimes(1)
  })

  it('locks exports to the actual container image, including specs from older builds', async () => {
    const created = await manager.create({ spec: presetSpec('quick', 'Legacy image lock') }, actor, 'create')
    await finish(created.job)
    const actualDigest = `sha256:${'b'.repeat(64)}`
    vi.mocked(EngineClient.prototype.imageDigest).mockResolvedValue(actualDigest)
    const path = join(directory, 'legacy-export.zip')
    await manager.export(created.stack.id, path, actor, 'export')
    const imported = await parseImport(await readFile(path), 'legacy-export.zip')
    expect(imported.spec.images.digests?.environment).toBe(actualDigest)
  })

  it('saves logs and accepts only a matching, single-use native grant', async () => {
    const created = await manager.create({ spec: presetSpec('quick', 'Logs') }, actor, 'create')
    await finish(created.job)
    const path = join(directory, 'logs.txt')
    const grants = new FileGrantStore()
    const grant = await grants.grant(path, 'stack-logs')
    await manager.saveLogs(created.stack.id, 'environment', grants.take(grant.handle, 'stack-logs'), actor, 'save-logs')
    expect(await readFile(path, 'utf8')).toBe('hello\nworld\n')
    expect(() => grants.take(grant.handle, 'stack-logs')).toThrow('expired')
    await expect(grants.grant(join(directory, 'bad.zip'), 'stack-logs')).rejects.toMatchObject({ code: 'invalid_request' })
  })

  it('refuses arbitrary repositories and commands in image locks', () => {
    expect(stackSpecSchema.safeParse({ ...presetSpec('quick', 'Bad'), images: { channel: 'tested', digests: { environment: 'evil/repo:latest' } } }).success).toBe(false)
  })

  it('uses only labelled objects for stop and deletion', async () => {
    containers.set('unrelated', { Id: 'unrelated', Names: ['unrelated'], Image: 'other', Labels: {}, State: 'running', Status: 'Up' })
    const created = await manager.create({ spec: presetSpec('quick', 'Isolated') }, actor, 'create')
    await finish(created.job)
    await finish(await manager.remove({ stackId: created.stack.id, deleteData: true, removeInfrastructure: true }, actor, 'remove'))
    expect([...containers.keys()]).toEqual(['unrelated'])
    expect(volumes).toEqual([])
  })

  it('refuses uploaded apps requesting container authority and skips the desktop bundle on hosted Studio', async () => {
    const manifest = manifestOf({ id: 'org.example.container-test', runtimes: ['desktop'], permissions: ['studio.containers'] })
    await expect(installApp(deps, actor, zipApp(manifest), null, 'install')).rejects.toMatchObject({ code: 'app_package_rejected' })
    const hosted = { ...deps, config: { ...deps.config, deploymentMode: 'hosted' as const } }
    expect(await installBundledApp(hosted, zipApp(manifest))).toBe('skipped')
    await installBundledApp(deps, zipApp(manifest))
    const record = (await listInstallations(deps)).find(item => item.appId === manifest.id)!
    expect(() => authorizeAppCall(record, 'studio.containers.listStacks', 'host', emptyTrustStore)).not.toThrow()
    expect(() => authorizeAppCall({ ...record, bundled: false }, 'studio.containers.listStacks', 'host', emptyTrustStore)).toThrow('reserved')
    expect(() => authorizeAppCall(record, 'studio.containers.listStacks', 'backend', emptyTrustStore)).toThrow('not available')
    expect(() => authorizeAppCall({ ...record, manifest: { ...record.manifest, permissions: [] } }, 'studio.containers.listStacks', 'host', emptyTrustStore)).toThrow('permission')
  })

  it('recognizes Docker canonical names for official and publisher images', () => {
    expect(canonicalRepository('docker.io/library/postgres')).toBe(canonicalRepository('postgres'))
    expect(canonicalRepository('docker.io/keycloak/keycloak')).toBe(canonicalRepository('keycloak/keycloak'))
    expect(canonicalRepository('docker.io/eclipsebasyx/aasenvironment-go')).not.toBe('other/aasenvironment-go')
  })

  it('separates binary stdout from stderr and rejects truncated exec frames', () => {
    const frame = (type: number, content: Uint8Array) => {
      const header = Buffer.alloc(8)
      header[0] = type
      header.writeUInt32BE(content.length, 4)
      return Buffer.concat([header, content])
    }
    const output = execOutput(Buffer.concat([frame(1, snapshot.subarray(0, 7)), frame(2, strToU8('notice')), frame(1, snapshot.subarray(7))]))
    expect(output.stdout).toEqual(snapshot)
    expect(output.stderr).toBe('notice')
    expect(() => execOutput(frame(1, snapshot).subarray(0, 10))).toThrow('Incomplete')
  })
})

describe('container jobs', () => {
  it('runs one job per stack, also when two calls arrive together', async () => {
    const created = await manager.create({ spec: presetSpec('quick', 'Twice') }, actor, 'create')
    await finish(created.job)
    const results = await Promise.allSettled([
      manager.stop(created.stack.id, actor, 'stop-1'),
      manager.stop(created.stack.id, actor, 'stop-2'),
    ])
    expect(results.map(result => result.status).toSorted()).toEqual(['fulfilled', 'rejected'])
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'container_busy' } })
    await manager.settle()
    const changes = await Promise.allSettled([
      manager.change({ stackId: created.stack.id, spec: { ...created.stack.spec!, name: 'One' } }, actor, 'change-1'),
      manager.change({ stackId: created.stack.id, spec: { ...created.stack.spec!, name: 'Two' } }, actor, 'change-2'),
    ])
    expect(changes.filter(result => result.status === 'rejected')).toHaveLength(1)
  })

  it('frees the stack when a call fails before its job runs', async () => {
    const created = await manager.create({ spec: presetSpec('quick', 'Freed') }, actor, 'create')
    await finish(created.job)
    const spec = { ...created.stack.spec!, network: { exposure: 'local' as const, basePort: 18_200 } }
    const ports = { taken: true }
    const blocked = new ContainerManager({ deps, dataDir: directory, discovery: {} as DiscoveryEnvironment, grants: new FileGrantStore(), isPortFree: async () => !ports.taken, isReady: async () => true, infrastructures: { create: async () => 'x', remove: async () => {} } })
    await expect(blocked.change({ stackId: created.stack.id, spec }, actor, 'change')).rejects.toMatchObject({ code: 'container_port_in_use' })
    ports.taken = false
    await blocked.settle()
    expect((await blocked.stop(created.stack.id, actor, 'stop')).state).toBe('running')
    await blocked.settle()
    await blocked.dispose()
  })

  it('audits a job when it ends, with its outcome', async () => {
    vi.mocked(EngineClient.prototype.imageExists).mockResolvedValue(false)
    vi.mocked(EngineClient.prototype.pullImage).mockRejectedValue(new Error('offline'))
    const created = await manager.create({ spec: presetSpec('quick', 'Audited') }, actor, 'create-audited')
    await manager.settle()
    const [event] = await database.db.select().from(auditEvents).where(eq(auditEvents.requestId, 'create-audited'))
    expect(event).toMatchObject({ action: 'containers.create', outcome: 'failure', details: { stackId: created.stack.id, jobId: created.job.id, code: 'container_image_unavailable' } })
  })

  it('notes a failed unregister without failing the removal', async () => {
    const failing = new ContainerManager({
      deps, dataDir: directory, discovery: {} as DiscoveryEnvironment, grants: new FileGrantStore(), isPortFree: async () => true, isReady: async () => true,
      infrastructures: {
        create: async ({ name }) => {
          const id = `infra-${randomBytes(6).toString('hex')}`
          await database.db.insert(infrastructures).values({ id, name, endpoints: [], security: { mode: 'unsecured' }, createdBy: actor.subject })
          return id
        },
        remove: async () => {
          throw Object.assign(new Error('gone'), { code: 'internal_error' })
        },
      },
    })
    const created = await failing.create({ spec: presetSpec('quick', 'Kept infrastructure') }, actor, 'create')
    await failing.settle()
    const job = await failing.remove({ stackId: created.stack.id, deleteData: true, removeInfrastructure: true }, actor, 'remove')
    await failing.settle()
    expect(failing.job(job.id).state).toBe('succeeded')
    expect(failing.job(job.id).steps.find(step => step.id === 'unregister')).toMatchObject({ state: 'done', note: 'internal_error' })
    await failing.dispose()
  })

  it('reports downloads it skipped as skipped', async () => {
    const created = await manager.create({ spec: presetSpec('quick', 'Cached') }, actor, 'create')
    await finish(created.job)
    expect(manager.job(created.job.id).steps.filter(step => step.id.startsWith('download:')).every(step => step.state === 'skipped')).toBe(true)
  })
})

describe('container files', () => {
  async function aasxGrant (grants: FileGrantStore, name: string, content = 'aasx') {
    const path = join(directory, name)
    await writeFile(path, content)
    return (await grants.grant(path, 'stack-aasx')).handle
  }

  it('waits for an AASX-backed environment to become healthy before reporting it started', async () => {
    const filename = 'AAS preconfiguration completed.aasx'
    vi.mocked(EngineClient.prototype.logs).mockResolvedValue(`level=INFO msg="importing AAS preconfiguration file" file="/app/preconfiguration/${filename}"\n`)
    let healthStatus = 503
    let healthChecks = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      if (new URL(String(input)).pathname === '/health') {
        healthChecks++
        return new Response(null, { status: healthStatus })
      }
      // /description is already available while the import runs.
      return new Response(null, { status: 200 })
    })
    const grants = new FileGrantStore()
    const local = new ContainerManager({ deps, dataDir: directory, discovery: {} as DiscoveryEnvironment, grants, isPortFree: async () => true, infrastructures: { create: async () => 'x', remove: async () => {} }, timeouts: { pollMs: 5 } })
    const created = await local.create({ spec: presetSpec('quick', 'Preconfigured'), aasxFiles: [await aasxGrant(grants, filename)] }, actor, 'create')
    try {
      await vi.waitFor(() => {
        expect(local.job(created.job.id).state).toBe('running')
        expect(healthChecks).toBeGreaterThan(1)
      })
    } finally {
      healthStatus = 200
      await local.settle()
      await local.dispose()
    }
    expect(local.job(created.job.id).state).toBe('succeeded')
  })

  it('keeps the stored files and settings when a change cannot take its new files', async () => {
    const grants = new FileGrantStore()
    const local = new ContainerManager({ deps, dataDir: directory, discovery: {} as DiscoveryEnvironment, grants, isPortFree: async () => true, isReady: async () => true, infrastructures: { create: async () => 'x', remove: async () => {} } })
    const created = await local.create({ spec: presetSpec('quick', 'Files'), aasxFiles: [await aasxGrant(grants, 'old.aasx')] }, actor, 'create')
    await local.settle()
    await expect(local.change({ stackId: created.stack.id, spec: { ...created.stack.spec!, aasxFiles: [] }, aasxFiles: ['x'.repeat(32)] }, actor, 'change')).rejects.toMatchObject({ code: 'invalid_request' })
    expect((await local.get(created.stack.id)).spec!.aasxFiles).toEqual(['old.aasx'])
    expect(await readFile(join(directory, created.stack.id, 'aasx', 'old.aasx'), 'utf8')).toBe('aasx')
    await local.settle()
    await local.dispose()
  })

  it('does not delete a new file that has the name of a dropped one', async () => {
    const grants = new FileGrantStore()
    const local = new ContainerManager({ deps, dataDir: directory, discovery: {} as DiscoveryEnvironment, grants, isPortFree: async () => true, isReady: async () => true, infrastructures: { create: async () => 'x', remove: async () => {} } })
    const created = await local.create({ spec: presetSpec('quick', 'Same name'), aasxFiles: [await aasxGrant(grants, 'plant.aasx', 'old')] }, actor, 'create')
    await local.settle()
    const replacement = await aasxGrant(grants, 'plant.aasx', 'new')
    const changed = await local.change({ stackId: created.stack.id, spec: { ...created.stack.spec!, aasxFiles: [] }, aasxFiles: [replacement] }, actor, 'change')
    await local.settle()
    expect(changed.stack.spec!.aasxFiles).toEqual(['plant (2).aasx'])
    expect(await readFile(join(directory, created.stack.id, 'aasx', 'plant (2).aasx'), 'utf8')).toBe('new')
    await local.dispose()
  })

  it('grants only existing files of the right kind, once', async () => {
    const grants = new FileGrantStore()
    const handle = await aasxGrant(grants, 'once.aasx')
    expect(() => grants.take(handle, 'stack-import')).toThrow('expired')
    const again = await aasxGrant(grants, 'twice.aasx')
    expect(grants.take(again, 'stack-aasx')).toBe(join(directory, 'twice.aasx'))
    expect(() => grants.take(again, 'stack-aasx')).toThrow('expired')
    await expect(grants.grant(join(directory, 'missing.aasx'), 'stack-aasx')).rejects.toMatchObject({ code: 'not_found' })
    await expect(grants.grant('relative.aasx', 'stack-aasx')).rejects.toMatchObject({ code: 'invalid_request' })
    await expect(grants.grant(join(directory, 'missing-folder', 'export.zip'), 'stack-export')).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('container import limits (DATA-006)', () => {
  const spec = strToU8(JSON.stringify(presetSpec('quick', 'Imported')))

  it('rejects archives with too many entries', async () => {
    const files: Record<string, Uint8Array> = { 'basyx-stack.json': spec }
    for (let index = 0; index < 201; index++) {
      files[`aasx/file-${index}.aasx`] = strToU8('x')
    }
    await expect(parseImport(zipSync(files), 'many.zip')).rejects.toMatchObject({ code: 'package_rejected' })
  })

  it('rejects entries that are compressed suspiciously well', async () => {
    const bomb = zipSync({ 'basyx-stack.json': spec, 'data/database.dump': new Uint8Array(20 * 1024 * 1024) }, { level: 9 })
    await expect(parseImport(bomb, 'bomb.zip')).rejects.toMatchObject({ code: 'package_rejected' })
  })

  it('rejects unsafe entry names and files that are not ZIP files', async () => {
    await expect(parseImport(zipSync({ '../basyx-stack.json': spec }), 'traversal.zip')).rejects.toMatchObject({ code: 'package_rejected' })
    await expect(parseImport(strToU8('not a zip'), 'plain.zip')).rejects.toMatchObject({ code: 'package_rejected' })
  })

  it('refuses a spec file that is too large before reading it', async () => {
    const path = join(directory, 'basyx-stack.json')
    await writeFile(path, ' '.repeat(2 * 1024 * 1024))
    await expect(readImport(path)).rejects.toMatchObject({ code: 'invalid_request' })
  })

  it('reads an export it can accept', async () => {
    const imported = await parseImport(zipSync({ 'demo/basyx-stack.json': spec, 'demo/docker-compose.yml': strToU8('services: {}') }), 'demo.zip')
    expect(imported.spec.name).toBe('Imported')
    expect(imported.composeIgnored).toBe(true)
  })
})

describe('container settings', () => {
  it('keeps names on one line, so exports cannot gain compose content', () => {
    expect(stackSpecSchema.safeParse(presetSpec('quick', 'Line one\ninclude: [oci://evil/x]')).success).toBe(false)
    expect(stackSpecSchema.safeParse(presetSpec('quick', 'Tab\tseparated')).success).toBe(false)
    expect(stackSpecSchema.safeParse(presetSpec('quick', 'Linie 3 – Halle Ost')).success).toBe(true)
  })

  it('publishes ports on 127.0.0.1 unless the user chose the network', () => {
    const local = { ...presetSpec('quick', 'Ports'), network: { exposure: 'local' as const, basePort: 18_100 } }
    const secrets = generateSecrets(null)
    const bindings = (spec: typeof local | ReturnType<typeof presetSpec>) => {
      const details = planStack({ id: 'ports', slug: 'ports' }, spec, secrets)
      return details.containers.flatMap(container => Object.values(containerConfig(details, container, secrets, 'ports').HostConfig.PortBindings ?? {}).flat())
    }
    expect(bindings(local).length).toBeGreaterThan(0)
    expect(bindings(local).every(binding => binding.HostIp === '127.0.0.1')).toBe(true)
    expect(bindings({ ...local, network: { exposure: 'network', basePort: 18_100 } }).every(binding => binding.HostIp === '0.0.0.0')).toBe(true)
  })

  it('lets apps open https anywhere and http only on this computer', () => {
    expect(isExternalUrl('https://www.docker.com/products/docker-desktop/')).toBe(true)
    expect(isExternalUrl('http://127.0.0.1:18100/description')).toBe(true)
    expect(isExternalUrl('http://localhost:18101/admin/')).toBe(true)
    expect(isExternalUrl('http://example.com/')).toBe(false)
    expect(isExternalUrl('file:///etc/passwd')).toBe(false)
    expect(appMethodParamsSchemas['studio.ui.openExternal'].safeParse({ url: 'http://192.168.0.10/' }).success).toBe(false)
  })
})
