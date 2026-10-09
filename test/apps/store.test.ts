import type { StudioConfig } from '~~/server/lib/config'
import type { DatabaseHandle } from '~~/server/lib/database/client'
import type { Actor, StudioDeps } from '~~/server/lib/deps'
import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { appBlobs, appFiles, auditEvents } from '~~/server/database/schema'
import { contributionsFor } from '~~/server/lib/apps/contributions'
import { getInstallation, installApp, listInstallations, readAppFile, toAppInstallation, uninstallApp } from '~~/server/lib/apps/store'
import { SecretCipher } from '~~/server/lib/crypto/cipher'
import { openDatabase } from '~~/server/lib/database/client'
import { applyMigrations, loadMigrationsFromDirectory } from '~~/server/lib/database/migrate'
import { StudioProblem } from '~~/server/lib/problem'
import { manifestOf, zipApp } from './support'

const migrationsDirectory = new URL('../../server/database/migrations', import.meta.url).pathname
const admin: Actor = { subject: 'studio-admin', name: 'Admin', roles: ['studio-admin'], isAdmin: true, sessionId: 's1' }

function configWith (apps: Partial<StudioConfig['apps']>): StudioConfig {
  return {
    deploymentMode: 'hosted',
    publicUrl: 'http://localhost:3000',
    adminRole: 'studio-admin',
    apps: { baseUrl: 'http://apps.localhost:3000/app/', allowUnsigned: true, denoPath: null, capabilityUrl: 'http://127.0.0.1:3000', workDir: '/tmp', ...apps },
  } as StudioConfig
}

async function failure (promise: Promise<unknown>): Promise<StudioProblem> {
  try {
    await promise
  } catch (error) {
    if (error instanceof StudioProblem) {
      return error
    }
    throw error
  }
  throw new Error('Expected a problem.')
}

describe('app installations', () => {
  let handle: DatabaseHandle
  let deps: StudioDeps

  beforeAll(async () => {
    handle = await openDatabase({ kind: 'memory' })
    await applyMigrations(handle.db, await loadMigrationsFromDirectory(migrationsDirectory))
    deps = { config: configWith({}), db: handle.db, cipher: new SecretCipher(randomBytes(32)) }
  })

  afterAll(async () => {
    await handle.close()
  })

  it('installs a package, serves its files by digest, and audits the install', async () => {
    const record = await installApp(deps, admin, zipApp(manifestOf(), { 'ui/index.html': '<p>hello</p>', 'ui/shared.js': 'export const shared = 1' }), 'r1')
    expect(record.id).toMatch(/^app-[0-9a-f]{16}$/)
    expect(toAppInstallation(record)).toMatchObject({ appId: 'org.example.test', unsigned: true, permissions: ['studio.aas.read'], submodelViews: 1, modules: 0, backend: false })

    const file = await readAppFile(deps, record.id, 'ui/index.html')
    expect(new TextDecoder().decode(file!.content)).toBe('<p>hello</p>')
    expect(file!.contentType).toBe('text/html; charset=utf-8')
    expect(await readAppFile(deps, record.id, 'ui/missing.html')).toBeNull()
    expect(await readAppFile(deps, 'app-0000000000000000', 'ui/index.html')).toBeNull()
    expect(await readAppFile(deps, '../etc', 'ui/index.html')).toBeNull()

    const [audit] = await handle.db.select().from(auditEvents).where(eq(auditEvents.appInstallationId, record.id))
    expect(audit).toMatchObject({ action: 'app.install', outcome: 'success', actorSubject: 'studio-admin' })
  })

  it('refuses a second installation of the same app ID', async () => {
    const problem = await failure(installApp(deps, admin, zipApp(manifestOf({ version: '2.0.0' })), 'r2'))
    expect(problem.code).toBe('app_already_installed')
  })

  it('refuses unsigned installs when disabled, and installs when apps have no origin', async () => {
    const disabled = { ...deps, config: configWith({ allowUnsigned: false }) }
    expect((await failure(installApp(disabled, admin, zipApp(manifestOf({ id: 'org.example.other' })), 'r3'))).code).toBe('app_unsigned_disabled')
    const noOrigin = { ...deps, config: configWith({ baseUrl: null }) }
    expect((await failure(installApp(noOrigin, admin, zipApp(manifestOf({ id: 'org.example.other' })), 'r4'))).code).toBe('unsupported_operation')
  })

  it('leaves nothing behind when a package is rejected', async () => {
    const before = (await listInstallations(deps)).length
    const blobs = (await handle.db.select().from(appBlobs)).length
    await failure(installApp(deps, admin, zipApp(manifestOf({ id: 'org.example.bad', studioApi: '^9.0.0' })), 'r5'))
    expect((await listInstallations(deps)).length).toBe(before)
    expect((await handle.db.select().from(appBlobs)).length).toBe(blobs)
  })

  it('offers submodel views only for an exactly matching semantic ID, and modules always', async () => {
    const record = await installApp(deps, admin, zipApp(manifestOf({
      id: 'org.example.modules',
      contributes: {
        submodelViews: [{ id: 'np', title: { en: 'Nameplate' }, entry: 'ui/index.html', semanticIds: ['https://admin-shell.io/idta/nameplate/3/0/Nameplate'] }],
        modules: [{ id: 'explorer', title: { en: 'Explorer' }, entry: 'ui/index.html', route: 'explorer', context: 'target', icon: 'mdi-compass' }],
      },
    })), 'r6')
    const installations = await listInstallations(deps)
    const baseUrl = 'http://apps.localhost:3000/app/'
    const matching = contributionsFor(installations, baseUrl, 'https://admin-shell.io/idta/nameplate/3/0/Nameplate')
    expect(matching.submodelViews).toEqual([expect.objectContaining({
      installationId: record.id,
      id: 'np',
      entryUrl: `${baseUrl}${record.id}/ui/index.html`,
      reason: { semanticId: 'https://admin-shell.io/idta/nameplate/3/0/Nameplate' },
    })])
    expect(contributionsFor(installations, baseUrl, 'https://admin-shell.io/idta/nameplate/3/0/Nameplate/').submodelViews).toEqual([])
    expect(contributionsFor(installations, baseUrl, undefined).submodelViews).toEqual([])
    expect(matching.modules).toEqual([expect.objectContaining({ id: 'explorer', route: 'explorer', context: 'target', icon: 'mdi-compass' })])
  })

  it('uninstalls and removes only blobs that no other installation uses', async () => {
    const shared = 'export const shared = 1'
    const first = (await listInstallations(deps)).find(record => record.appId === 'org.example.test')!
    const second = await installApp(deps, admin, zipApp(manifestOf({ id: 'org.example.second' }), { 'ui/index.html': '<p>second</p>', 'ui/shared.js': shared }), 'r7')

    await uninstallApp(deps, admin, first.id, 'r8')
    expect((await failure(getInstallation(deps, first.id))).code).toBe('app_not_found')
    expect(await handle.db.select().from(appFiles).where(eq(appFiles.installationId, first.id))).toEqual([])
    expect(new TextDecoder().decode((await readAppFile(deps, second.id, 'ui/shared.js'))!.content)).toBe(shared)
    const remaining = await handle.db.select({ digest: appBlobs.digest }).from(appBlobs)
    const used = await handle.db.select({ digest: appFiles.digest }).from(appFiles)
    expect(new Set(remaining.map(row => row.digest))).toEqual(new Set(used.map(row => row.digest)))
  })

  it('refuses to serve a file whose content no longer matches its digest', async () => {
    const record = await installApp(deps, admin, zipApp(manifestOf({ id: 'org.example.tamper' }), { 'ui/index.html': '<p>original, never served before</p>' }), 'r9')
    const [file] = await handle.db.select().from(appFiles).where(eq(appFiles.installationId, record.id))
    await handle.db.update(appBlobs).set({ content: new TextEncoder().encode('<script>evil()</script>') }).where(eq(appBlobs.digest, file!.digest))
    expect((await failure(readAppFile(deps, record.id, 'ui/index.html'))).code).toBe('internal_error')
  })
})
