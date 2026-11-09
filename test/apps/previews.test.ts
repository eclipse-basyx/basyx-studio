import type { StudioConfig } from '~~/server/lib/config'
import type { DatabaseHandle } from '~~/server/lib/database/client'
import type { Actor, StudioDeps } from '~~/server/lib/deps'
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findPreviewApp, installApp, installPreviewApp, listActiveInstallations, listInstallations, removeInstallation } from '~~/server/lib/apps/store'
import { emptyTrustStore } from '~~/server/lib/apps/trust'
import { SecretCipher } from '~~/server/lib/crypto/cipher'
import { openDatabase } from '~~/server/lib/database/client'
import { applyMigrations, loadMigrationsFromDirectory } from '~~/server/lib/database/migrate'
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
})
