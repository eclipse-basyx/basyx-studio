import type { StudioConfig } from '~~/server/lib/config'
import type { DatabaseHandle } from '~~/server/lib/database/client'
import type { Actor, StudioDeps } from '~~/server/lib/deps'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ensureMachineKey, findMachineKey, machinePublisherName, signWithMachineKey, trustMachineKey } from '~~/server/lib/app-projects/keys'
import { bumpVersion, readIdentity, setVersion } from '~~/server/lib/app-projects/release'
import { installApp } from '~~/server/lib/apps/store'
import { SecretCipher } from '~~/server/lib/crypto/cipher'
import { openDatabase } from '~~/server/lib/database/client'
import { applyMigrations, loadMigrationsFromDirectory } from '~~/server/lib/database/migrate'
import { manifestOf, zipApp } from './support'

const migrationsDirectory = new URL('../../server/database/migrations', import.meta.url).pathname
const admin: Actor = { subject: 'local-user', name: 'Local user', roles: ['studio-admin'], isAdmin: true, sessionId: 's1' }

function config (): StudioConfig {
  return {
    deploymentMode: 'desktop',
    publicUrl: 'http://localhost:3000',
    adminRole: 'studio-admin',
    deployment: { appInstalls: true },
    apps: { baseUrl: 'http://apps.localhost:3000/app/', allowUnsigned: false, trustStore: { publishers: [] }, packages: [], denoPath: null, capabilityUrl: 'http://127.0.0.1:3000', workDir: '/tmp', installationOrigins: false },
  } as unknown as StudioConfig
}

describe('App Builder machine key (ADR 0054, plan B7)', () => {
  let handle: DatabaseHandle
  let deps: StudioDeps

  beforeAll(async () => {
    handle = await openDatabase({ kind: 'memory' })
    await applyMigrations(handle.db, await loadMigrationsFromDirectory(migrationsDirectory))
    deps = { config: config(), db: handle.db, cipher: new SecretCipher(randomBytes(32)) }
  })

  afterAll(async () => {
    await handle.close()
  })

  it('is created once, stored encrypted, and trusted for local apps only', async () => {
    expect(await findMachineKey(deps)).toBeNull()
    const key = await ensureMachineKey(deps)
    expect(key.publicKey).toContain('BEGIN PUBLIC KEY')
    expect(key.fingerprint).toMatch(/^sha256:[\da-f]{64}$/)
    expect((await ensureMachineKey(deps)).fingerprint).toBe(key.fingerprint)
    expect(deps.config.apps.trustStore.publishers).toHaveLength(1)
    expect(deps.config.apps.trustStore.publishers[0]).toMatchObject({ name: machinePublisherName, appIds: ['local.*'], permissions: [], remoteCode: false })
    trustMachineKey(deps.config.apps.trustStore, key.publicKey)
    expect(deps.config.apps.trustStore.publishers).toHaveLength(1)
  })

  it('signs packages Studio installs as signed, and updates only with the same key', async () => {
    const first = zipApp(manifestOf({ id: 'local.shell-list', version: '0.1.0' }))
    const { record } = await installApp(deps, admin, first, await signWithMachineKey(deps, first), 'r1')
    expect(record).toMatchObject({ trust: 'signed', publisher: machinePublisherName })

    const update = zipApp(manifestOf({ id: 'local.shell-list', version: '0.1.1' }))
    expect((await installApp(deps, admin, update, await signWithMachineKey(deps, update), 'r2')).record.version).toBe('0.1.1')
    // Unsigned installs are off here, and an unsigned package cannot replace a signed one anyway.
    await expect(installApp(deps, admin, zipApp(manifestOf({ id: 'local.shell-list', version: '0.1.2' })), null, 'r3')).rejects.toMatchObject({ code: 'app_unsigned_disabled' })
  })

  it('does not sign apps outside local.*', async () => {
    const other = zipApp(manifestOf({ id: 'org.example.app' }))
    await expect(installApp(deps, admin, other, await signWithMachineKey(deps, other), 'r4')).rejects.toMatchObject({ code: 'app_signer_not_allowed' })
  })
})

describe('App Builder release versions (plan B5)', () => {
  it('raises the version in the manifest and the package', async () => {
    expect(bumpVersion('0.1.0', 'none')).toBe('0.1.0')
    expect(bumpVersion('0.1.0', 'patch')).toBe('0.1.1')
    expect(bumpVersion('0.1.9', 'minor')).toBe('0.2.0')
    expect(() => bumpVersion('one', 'patch')).toThrow()

    const folder = mkdtempSync(join(tmpdir(), 'app-release-'))
    try {
      writeFileSync(join(folder, 'studio-app.json'), JSON.stringify({ id: 'local.a', version: '0.1.0', permissions: ['studio.aas.read'] }))
      writeFileSync(join(folder, 'package.json'), JSON.stringify({ name: 'a', version: '0.1.0', scripts: { build: 'vite build' } }))
      await setVersion(folder, '0.1.1')
      expect(await readIdentity(folder)).toEqual({ id: 'local.a', version: '0.1.1' })
      expect(JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'))).toEqual({ name: 'a', version: '0.1.1', scripts: { build: 'vite build' } })
      expect(JSON.parse(readFileSync(join(folder, 'studio-app.json'), 'utf8')).permissions).toEqual(['studio.aas.read'])
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
})
