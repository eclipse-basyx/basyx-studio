import type { Job, StackSpec } from '#shared/contract'
import type { StudioConfig } from '~~/server/lib/config'
import type { DatabaseHandle } from '~~/server/lib/database/client'
import type { Actor, StudioDeps } from '~~/server/lib/deps'
import { execFile } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { unzipSync } from 'fflate'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { infrastructures } from '~~/server/database/schema'
import { systemDiscoveryEnvironment } from '~~/server/lib/containers/discovery'
import { EngineClient } from '~~/server/lib/containers/engine'
import { ContainerManager } from '~~/server/lib/containers/manager'
import { stackLabel } from '~~/server/lib/containers/plan'
import { SecretCipher } from '~~/server/lib/crypto/cipher'
import { openDatabase } from '~~/server/lib/database/client'
import { applyMigrations, loadMigrationsFromDirectory } from '~~/server/lib/database/migrate'
import { FileGrantStore } from '~~/server/lib/desktop/grants'
import { presetSpec } from '#shared/contract'

// Runs real BaSyx stacks on the local Docker or Podman engine (ADR 0033).
// Downloads images on the first run and takes a few minutes:
//   STUDIO_CONTAINER_TESTS=1 pnpm vitest run test/integration/containers.test.ts

const enabled = process.env.STUDIO_CONTAINER_TESTS === '1'
const migrationsDirectory = new URL('../../server/database/migrations', import.meta.url).pathname
const fixture = new URL('../../test-setup/fixtures/open/IESEDriveMotorDM3000.aasx', import.meta.url).pathname
const aasxFilename = 'AAS preconfiguration completed.aasx'
const actor: Actor = { subject: 'desktop', name: 'Desktop', roles: [], isAdmin: true, sessionId: 's1' }

describe.runIf(enabled)('local BaSyx instances on the container engine', () => {
  let handle: DatabaseHandle
  let deps: StudioDeps
  let manager: ContainerManager
  let grants: FileGrantStore
  let directory: string
  const owned = new Set<string>()
  let quickId: string
  const registered: Array<{ name: string, spec: StackSpec }> = []
  const removedInfrastructures: string[] = []

  async function create (input: Parameters<ContainerManager['create']>[0], requestId: string) {
    const result = await manager.create(input, actor, requestId)
    owned.add(result.stack.id)
    return result
  }

  async function ownedStacks () {
    return (await manager.list()).items.filter(stack => owned.has(stack.id))
  }

  async function finished (job: Job): Promise<Job> {
    await manager.settle()
    return manager.job(job.id)
  }

  async function shells (url: string, token?: string): Promise<{ status: number, ids: string[] }> {
    const response = await fetch(`${url}/shells`, { headers: token ? { authorization: `Bearer ${token}` } : {} })
    const body = response.ok ? await response.json() as { result: Array<{ id: string }> } : { result: [] }
    return { status: response.status, ids: body.result.map(shell => shell.id) }
  }

  /** Exercises the same public PKCE client as Studio, without enabling password grants. */
  async function tokenFor (base: string, username: string, password: string): Promise<string> {
    const verifier = randomBytes(32).toString('base64url')
    const redirectUri = 'http://127.0.0.1:54321/api/studio/v1/auth/callback'
    const auth = new URL(`${base}/realms/basyx/protocol/openid-connect/auth`)
    auth.search = new URLSearchParams({ client_id: 'basyx-studio', response_type: 'code', scope: 'openid profile', redirect_uri: redirectUri, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString()
    const page = await fetch(auth, { redirect: 'manual' })
    expect(page.status).toBe(200)
    const html = await page.text()
    const action = /<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/.exec(html)?.[1]
    expect(action).toBeTruthy()
    const cookies = page.headers.getSetCookie().map(cookie => cookie.split(';', 1)[0]!).join('; ')
    const submitted = await fetch(action!.replaceAll('&amp;', '&'), { method: 'POST', redirect: 'manual', headers: { 'cookie': cookies, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username, password, credentialId: '' }) })
    const location = submitted.headers.get('location')
    expect(location).toContain(redirectUri)
    const code = new URL(location!).searchParams.get('code')!
    const response = await fetch(`${base}/realms/basyx/protocol/openid-connect/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', client_id: 'basyx-studio', redirect_uri: redirectUri, code, code_verifier: verifier }) })
    expect(response.status).toBe(200)
    return (await response.json() as { access_token: string }).access_token
  }

  function shellBody (id: string) {
    return { modelType: 'AssetAdministrationShell', id, idShort: 'IntegrationTest', assetInformation: { assetKind: 'Instance' } }
  }

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'studio-containers-'))
    handle = await openDatabase({ kind: 'memory' })
    await applyMigrations(handle.db, await loadMigrationsFromDirectory(migrationsDirectory))
    deps = { config: { deploymentMode: 'desktop', infrastructuresEditable: true } as StudioConfig, db: handle.db, cipher: new SecretCipher(randomBytes(32)) }
    grants = new FileGrantStore()
    manager = new ContainerManager({
      deps,
      dataDir: join(directory, 'data'),
      discovery: systemDiscoveryEnvironment(),
      grants,
      infrastructures: {
        create: async ({ name, spec }) => {
          registered.push({ name, spec })
          const id = `infra-${registered.length}`
          await handle.db.insert(infrastructures).values({ id, name, endpoints: [], security: { mode: 'unsecured' }, createdBy: actor.subject })
          return id
        },
        remove: async id => {
          removedInfrastructures.push(id)
        },
      },
    })
  })

  afterAll(async () => {
    // Leave nothing behind, also after a failure.
    const list = await ownedStacks().catch(() => [])
    for (const stack of list) {
      await manager.remove({ stackId: stack.id, deleteData: true, removeInfrastructure: false }, actor, 'cleanup').catch(() => {})
    }
    await manager.settle()
    await manager.dispose()
    await handle.close()
    await rm(directory, { recursive: true, force: true })
  })

  it('finds a running engine', async () => {
    const engines = await manager.engines(true)
    expect(engines.selected?.running).toBe(true)
  })

  it('starts a quick-start instance with an AASX file, keeps its data across stop and start, and registers it', async () => {
    const copy = join(directory, aasxFilename)
    await copyFile(fixture, copy)
    const { handle: aasx } = await grants.grant(copy, 'stack-aasx')
    const spec: StackSpec = { ...presetSpec('quick', 'Integration quick'), persistence: 'keep' }
    const plan = await manager.plan(spec)
    expect(plan.components).toEqual(['database', 'schema', 'environment'])
    expect(plan.spec.network.basePort).not.toBeNull()

    const created = await create({ spec, aasxFiles: [aasx] }, 'r1')
    const job = await finished(created.job)
    expect(job.problem).toBeNull()
    expect(job.state).toBe('succeeded')
    expect(registered.at(-1)?.name).toBe('Integration quick')

    quickId = created.stack.id
    const stack = await manager.get(created.stack.id)
    expect(stack.status).toBe('running')
    expect(stack.infrastructureId).toBe('infra-1')
    expect(stack.spec?.aasxFiles).toEqual([aasxFilename])
    const loaded = await shells(stack.urls.environment!)
    expect(loaded.ids.length).toBeGreaterThan(0)

    expect((await finished(await manager.stop(stack.id, actor, 'r2'))).state).toBe('succeeded')
    expect((await manager.get(stack.id)).status).toBe('stopped')
    expect((await finished(await manager.start(stack.id, actor, 'r3'))).state).toBe('succeeded')
    const health = await fetch(`${stack.urls.environment!}/health`)
    await health.body?.cancel()
    expect(health.status).toBe(200)
    expect((await shells(stack.urls.environment!)).ids).toEqual(loaded.ids)

    const logs = await manager.logs(stack.id, 'environment', 50)
    expect(logs.text.length).toBeGreaterThan(0)
  }, 900_000)

  it('exports live data and restores it into an imported instance', async () => {
    const stack = await manager.get(quickId)
    const addedId = `urn:studio:export-regression:${randomBytes(6).toString('hex')}`
    const response = await fetch(`${stack.urls.environment}/shells`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ modelType: 'AssetAdministrationShell', id: addedId, idShort: 'AfterStartup', assetInformation: { assetKind: 'Instance' } }) })
    expect(response.status).toBe(201)
    const target = join(directory, 'export.zip')
    const { handle: exportHandle } = await grants.grant(target, 'stack-export')
    await manager.export(stack!.id, grants.take(exportHandle, 'stack-export'), actor, 'r4')
    const imported = await manager.import(target, actor, 'r5')
    expect(imported.spec.name).toBe('Integration quick')
    expect(imported.aasxFiles).toEqual([aasxFilename])
    // The exported ports belong to the running instance.
    expect(imported.notes).toContain('ports_reassigned')
    expect(imported.notes).toContain('compose_ignored')
    const created = await create({ spec: imported.spec, importId: imported.importId }, 'import-create')
    expect((await finished(created.job)).problem).toBeNull()
    const restored = await manager.get(created.stack.id)
    expect((await shells(restored.urls.environment!)).ids).toContain(addedId)
    // Renaming and removing only containers preserve the same database.
    const changed = await manager.change({ stackId: restored.id, spec: { ...restored.spec!, name: 'Renamed imported instance' } }, actor, 'rename')
    expect((await finished(changed.job)).problem).toBeNull()
    expect((await shells(restored.urls.environment!)).ids).toContain(addedId)
    expect((await finished(await manager.remove({ stackId: restored.id, deleteData: false, removeInfrastructure: false }, actor, 'retain'))).problem).toBeNull()
    expect((await manager.get(restored.id)).status).toBe('missing')
    expect((await finished(await manager.start(restored.id, actor, 'recreate'))).problem).toBeNull()
    expect((await shells(restored.urls.environment!)).ids).toContain(addedId)
  }, 900_000)

  it('starts a secured instance with sharing and refuses anonymous reads', async () => {
    const spec: StackSpec = { ...presetSpec('secured', 'Integration secured'), security: { mode: 'keycloak', access: 'sharing' }, persistence: 'ephemeral' }
    const created = await create({ spec }, 'r6')
    const job = await finished(created.job)
    expect(job.problem).toBeNull()
    const stack = await manager.get(created.stack.id)
    expect(stack.status).toBe('running')
    const description = await fetch(`${stack.urls.environment}/description`)
    expect(description.status).toBe(200)
    const profiles = (await description.json() as { profiles: string[] }).profiles
    expect(profiles.some(profile => profile.includes('RelationshipBasedAccessControl'))).toBe(true)
    expect((await shells(stack.urls.environment!)).status).toBe(403)
    const discovery = await (await fetch(`${stack.urls.keycloak}/realms/basyx/.well-known/openid-configuration`)).json() as { issuer: string }
    expect(discovery.issuer).toBe(`${stack.urls.keycloak}/realms/basyx`)
    const signIn = await manager.signIn(stack.id, actor, 'r7')
    expect(signIn.users.map(user => user.username)).toEqual(['admin', 'alice', 'bob'])
    const alice = signIn.users.find(user => user.username === 'alice')!
    const bob = signIn.users.find(user => user.username === 'bob')!
    const aliceToken = await tokenFor(stack.urls.keycloak!, alice.username, alice.password)
    const bobToken = await tokenFor(stack.urls.keycloak!, bob.username, bob.password)
    const id = `urn:studio:rebac:${randomBytes(6).toString('hex')}`
    expect((await fetch(`${stack.urls.environment}/shells`, { method: 'POST', headers: { 'authorization': `Bearer ${aliceToken}`, 'content-type': 'application/json' }, body: JSON.stringify(shellBody(id)) })).status).toBe(201)
    const url = `${stack.urls.environment}/shells/${Buffer.from(id).toString('base64url')}`
    expect((await fetch(url, { headers: { authorization: `Bearer ${aliceToken}` } })).status).toBe(200)
    expect((await fetch(url, { headers: { authorization: `Bearer ${bobToken}` } })).status).toBe(403)
    const access = await fetch(`${url}/$access`, { headers: { authorization: `Bearer ${aliceToken}` } })
    expect(access.status).toBe(200)
    const document = await access.json() as { grants: Array<Record<string, string>> }
    const claims = JSON.parse(Buffer.from(bobToken.split('.', 2)[1]!, 'base64url').toString()) as { sub: string, iss: string }
    const shared = await fetch(`${url}/$access/grants`, { method: 'PUT', headers: { 'authorization': `Bearer ${aliceToken}`, 'content-type': 'application/json', 'If-Match': access.headers.get('etag')! }, body: JSON.stringify({ grants: [...document.grants.map(({ relation, subjectType, issuer, subject }) => ({ relation, subjectType, issuer, subject })), { relation: 'viewer', subjectType: 'user', issuer: claims.iss, subject: claims.sub }] }) })
    expect(shared.status, await shared.text()).toBe(200)
    expect((await fetch(url, { headers: { authorization: `Bearer ${bobToken}` } })).status).toBe(200)
  }, 900_000)

  it('enforces administrator and viewer roles through PKCE sign-in', async () => {
    const created = await create({ spec: presetSpec('secured', 'Integration roles') }, 'roles')
    expect((await finished(created.job)).problem).toBeNull()
    const stack = await manager.get(created.stack.id)
    const signIn = await manager.signIn(stack.id, actor, 'roles-users')
    const admin = signIn.users.find(user => user.username === 'admin')!
    const viewer = signIn.users.find(user => user.username === 'viewer')!
    const adminToken = await tokenFor(stack.urls.keycloak!, admin.username, admin.password)
    const viewerToken = await tokenFor(stack.urls.keycloak!, viewer.username, viewer.password)
    const id = `urn:studio:roles:${randomBytes(6).toString('hex')}`
    expect((await fetch(`${stack.urls.environment}/shells`, { method: 'POST', headers: { 'authorization': `Bearer ${adminToken}`, 'content-type': 'application/json' }, body: JSON.stringify(shellBody(id)) })).status).toBe(201)
    expect((await shells(stack.urls.environment!, viewerToken)).ids).toContain(id)
    expect((await fetch(`${stack.urls.environment}/shells`, { method: 'POST', headers: { 'authorization': `Bearer ${viewerToken}`, 'content-type': 'application/json' }, body: JSON.stringify(shellBody(`${id}:forbidden`)) })).status).toBe(403)
  }, 900_000)

  it('runs a full topology with separate registries and discovery', async () => {
    const created = await create({ spec: presetSpec('full', 'Integration full') }, 'full')
    expect((await finished(created.job)).problem).toBeNull()
    const stack = await manager.get(created.stack.id)
    const id = `urn:studio:full:${randomBytes(6).toString('hex')}`
    expect((await fetch(`${stack.urls.environment}/shells`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(shellBody(id)) })).status).toBe(201)
    const descriptors = await (await fetch(`${stack.urls.aasRegistry}/shell-descriptors`)).json() as { result: Array<{ id: string }> }
    expect(descriptors.result.map(descriptor => descriptor.id)).toContain(id)
    for (const url of [stack.urls.aasRegistry, stack.urls.submodelRegistry, stack.urls.discovery]) {
      expect((await fetch(`${url}/description`)).status).toBe(200)
    }
  }, 900_000)

  it.runIf(process.env.STUDIO_CONTAINER_COMPOSE_TESTS === '1')('starts the exported project independently with Docker Compose and restores data once', async () => {
    const stack = await manager.get(quickId)
    expect((await finished(await manager.stop(stack.id, actor, 'compose-stop'))).problem).toBeNull()
    const path = join(directory, 'compose-export.zip')
    await manager.export(stack.id, path, actor, 'compose-export')
    const entries = unzipSync(await readFile(path))
    // Colima shares the user's workspace, but not macOS /var/folders.
    const sharedParent = join(process.cwd(), '.data')
    await mkdir(sharedParent, { recursive: true })
    const composeDirectory = await mkdtemp(join(sharedParent, 'compose-regression-'))
    let composePath = ''
    for (const [name, content] of Object.entries(entries)) {
      const file = join(composeDirectory, name)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, content)
      if (name.endsWith('/docker-compose.yml')) {
        composePath = file
      }
    }
    expect(composePath).not.toBe('')
    const project = `studio-export-${randomBytes(6).toString('hex')}`
    const compose = (args: string[]) => promisify(execFile)('docker', ['compose', '--project-name', project, '-f', composePath, ...args], { cwd: dirname(composePath), timeout: 240_000, maxBuffer: 4 * 1024 * 1024 })
    try {
      await compose(['up', '-d', '--wait', '--wait-timeout', '180'])
      const before = (await shells(stack.urls.environment!)).ids
      expect(before.length).toBeGreaterThan(0)
      expect(before.some(id => id.startsWith('urn:studio:export-regression:'))).toBe(true)
      const added = `urn:studio:compose-live:${randomBytes(6).toString('hex')}`
      expect((await fetch(`${stack.urls.environment}/shells`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(shellBody(added)) })).status).toBe(201)
      await compose(['up', '-d', '--wait', '--wait-timeout', '180'])
      expect((await shells(stack.urls.environment!)).ids).toContain(added)
    } catch (error) {
      const logs = await compose(['logs', '--no-color', '--tail=40']).catch(() => ({ stdout: '' }))
      throw new Error(`${String(error)}\n${logs.stdout}`, { cause: error })
    } finally {
      await compose(['down', '-v'])
      await rm(composeDirectory, { recursive: true, force: true })
    }
  }, 600_000)

  it('removes instances with their data', async () => {
    for (const stack of await ownedStacks()) {
      expect((await finished(await manager.remove({ stackId: stack.id, deleteData: true, removeInfrastructure: true }, actor, 'r8'))).state).toBe('succeeded')
    }
    expect(await ownedStacks()).toEqual([])
    const engines = await manager.engines()
    const engine = new EngineClient(engines.selected!.host)
    await engine.version()
    expect((await engine.listContainers(stackLabel)).filter(container => owned.has(container.Labels[stackLabel]!))).toEqual([])
    expect((await engine.listVolumes(stackLabel)).filter(volume => owned.has(volume.Labels?.[stackLabel] ?? ''))).toEqual([])
    await engine.close()
    expect(removedInfrastructures).toHaveLength(registered.length)
  }, 300_000)
})
