import type { StudioConfig } from '~~/server/lib/config'
import type { DatabaseHandle } from '~~/server/lib/database/client'
import type { Actor, StudioDeps } from '~~/server/lib/deps'
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { previewAppId, ProjectPreviews } from '~~/server/lib/app-projects/previews'
import { parseManifest } from '~~/server/lib/apps/manifest'
import { findPreviewApp, installApp, installPreviewApp, listActiveInstallations, listInstallations, removeInstallation } from '~~/server/lib/apps/store'
import { emptyTrustStore } from '~~/server/lib/apps/trust'
import { SecretCipher } from '~~/server/lib/crypto/cipher'
import { openDatabase } from '~~/server/lib/database/client'
import { applyMigrations, loadMigrationsFromDirectory } from '~~/server/lib/database/migrate'
import { previewInstaller } from '~~/server/utils/app-builder'
import { manifestOf, zipApp } from './support'

const migrationsDirectory = new URL('../../server/database/migrations', import.meta.url).pathname
const admin: Actor = { subject: 'studio-admin', name: 'Admin', roles: ['studio-admin'], isAdmin: true, sessionId: 's1' }

function configWith (apps: Partial<StudioConfig['apps']>): StudioConfig {
  return {
    deploymentMode: 'hosted',
    publicUrl: 'http://localhost:3000',
    adminRole: 'studio-admin',
    deployment: { appInstalls: true },
    apps: { baseUrl: 'http://apps.localhost:3000/app/', allowUnsigned: true, trustStore: emptyTrustStore, packages: [], denoPath: null, capabilityUrl: 'http://127.0.0.1:3000', workDir: '/tmp', ...apps },
  } as StudioConfig
}

describe('App Builder previews in the app store (ADR 0054, plan B3)', () => {
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

  it('installs a preview under its own ID, replaces it in place, and keeps it out of Studio\'s views', async () => {
    const pkg = zipApp(manifestOf({ id: 'local.shell-list', version: '0.1.0' }))
    const { record, previous } = await installPreviewApp(deps, pkg, 'local.shell-list.preview', 'app-builder')
    expect(previous).toBeNull()
    expect(record).toMatchObject({ appId: 'local.shell-list.preview', preview: true, trust: 'unsigned', installedBy: 'app-builder' })
    expect(record.manifest.id).toBe('local.shell-list.preview')

    // The same version again, or a lower one: a preview follows the folder, not version rules.
    const again = await installPreviewApp(deps, zipApp(manifestOf({ id: 'local.shell-list', version: '0.0.1' })), 'local.shell-list.preview', 'app-builder')
    expect(again.record.id).toBe(record.id)
    expect(again.previous?.id).toBe(record.id)

    expect((await listInstallations(deps)).map(entry => entry.appId)).toContain('local.shell-list.preview')
    expect((await listActiveInstallations(deps)).map(entry => entry.appId)).not.toContain('local.shell-list.preview')
    expect((await findPreviewApp(deps, 'local.shell-list.preview'))?.id).toBe(record.id)

    await removeInstallation(deps, again.record, 'app-builder')
    expect(await findPreviewApp(deps, 'local.shell-list.preview')).toBeNull()
  })

  it('never replaces an installed app, and needs developer mode', async () => {
    await installApp(deps, admin, zipApp(manifestOf({ id: 'org.example.real' })), null, 'r1')
    expect(await findPreviewApp(deps, 'org.example.real')).toBeNull()
    await expect(installPreviewApp(deps, zipApp(manifestOf()), 'org.example.real', 'app-builder')).rejects.toMatchObject({ code: 'app_already_installed' })
    const signedOnly = { ...deps, config: configWith({ allowUnsigned: false }) }
    await expect(installPreviewApp(signedOnly, zipApp(manifestOf()), 'local.x.preview', 'app-builder')).rejects.toMatchObject({ code: 'app_unsigned_disabled' })
  })

  it('requires renewed consent for changed OpenAPI methods and paths, including after a restart', async () => {
    const project = { id: 'ce944cd4-0100-46dd-b234-c1c56a368108', appId: 'local.orders', folder: '/work/orders' }
    const manifest = manifestOf({
      id: project.appId,
      studioApi: '^0.1.6',
      permissions: ['studio.connections'],
      connections: [{ id: 'orders', title: { en: 'Orders' }, api: 'api/orders.json', operations: ['orders'] }],
    })
    const pack = (method: string, path: string) => zipApp(manifest, {
      'ui/index.html': '<!doctype html><title>Orders</title>',
      'api/orders.json': JSON.stringify({ openapi: '3.1.0', info: { title: 'Orders', version: '1' }, paths: { [path]: { [method]: { operationId: 'orders', responses: { 200: { description: 'ok' } } } } } }),
    })
    let bytes = pack('get', '/orders')
    const installer = previewInstaller({ ...deps, backends: null }, 'app-builder')!
    const build = async () => ({ ok: true, log: '', packageBytes: bytes })
    let previews = new ProjectPreviews({ installer, build })
    await previews.build(project)
    expect((await previews.describe(project)).consent?.added).toContain('operation orders orders GET /orders')
    await previews.approve(project)
    const original = await previews.describe(project)

    // Stable operation ID: the authority comes from its actual HTTP method and path.
    bytes = pack('delete', '/orders')
    previews = new ProjectPreviews({ installer, build })
    await previews.build(project)
    expect((await previews.describe(project)).consent?.added).toContain('operation orders orders DELETE /orders')
    expect((await previews.describe(project)).contributions).toEqual(original.contributions)
    await previews.approve(project)
    await previews.build(project)
    expect((await previews.describe(project)).consent).toBeNull()

    bytes = pack('delete', '/orders/all')
    await previews.build(project)
    expect((await previews.describe(project)).consent?.added).toContain('operation orders orders DELETE /orders/all')
    await previews.remove(project)
  })

  it('uses a valid bounded preview ID even for an app at the manifest ID length limit', async () => {
    const project = { id: '16ae257d-f729-4d76-af10-b31276dec482', appId: `local.${'a'.repeat(122)}`, folder: '/work/long-id' }
    const pkg = zipApp(manifestOf({ id: project.appId }))
    const installer = previewInstaller({ ...deps, backends: null }, 'app-builder')!
    const previews = new ProjectPreviews({ installer, build: async () => ({ ok: true, log: '', packageBytes: pkg }) })
    await previews.build(project)
    await previews.approve(project)
    const installed = (await installer.current(previewAppId(project.id)))!
    expect(installed.manifest.id.length).toBeLessThanOrEqual(128)
    expect(parseManifest(JSON.stringify(installed.manifest)).findings).toEqual([])
    await previews.remove(project)
  })

  it('does not confuse operation IDs and paths that have the same readable description', async () => {
    const project = { id: 'c46cbd76-a642-4424-9d20-beb940ae17c1', appId: 'local.spaced-operations', folder: '/work/spaced' }
    const pack = (operationId: string, method: string, path: string) => zipApp(manifestOf({
      id: project.appId,
      studioApi: '^0.1.6',
      permissions: ['studio.connections'],
      connections: [{ id: 'orders', title: { en: 'Orders' }, api: 'api/orders.json', operations: [operationId] }],
    }), {
      'ui/index.html': '<!doctype html><title>Orders</title>',
      'api/orders.json': JSON.stringify({ openapi: '3.1.0', info: { title: 'Orders', version: '1' }, paths: { [path]: { [method]: { operationId, responses: { 200: { description: 'ok' } } } } } }),
    })
    let bytes = pack('op', 'get', '/orders DELETE /all')
    const installer = previewInstaller({ ...deps, backends: null }, 'app-builder')!
    const previews = new ProjectPreviews({ installer, build: async () => ({ ok: true, log: '', packageBytes: bytes }) })
    await previews.build(project)
    await previews.approve(project)
    bytes = pack('op GET /orders', 'delete', '/all')
    await previews.build(project)
    expect((await previews.describe(project)).consent).toMatchObject({ first: false, added: ['operation orders op GET /orders DELETE /all'] })
    await previews.remove(project)
  })
})
