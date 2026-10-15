import type { StudioConfig } from '~~/server/lib/config'
import type { DatabaseHandle } from '~~/server/lib/database/client'
import type { StudioDeps } from '~~/server/lib/deps'
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { infrastructures, targetCredentials } from '~~/server/database/schema'
import { SecretCipher } from '~~/server/lib/crypto/cipher'
import { openDatabase } from '~~/server/lib/database/client'
import { applyMigrations, loadMigrationsFromDirectory } from '~~/server/lib/database/migrate'
import { getInfrastructure, targetPolicy } from '~~/server/lib/infrastructures'
import { ensureDesktopSession } from '~~/server/lib/sessions'
import { CredentialBroker } from '~~/server/lib/targets/credentials'
import { LiveAasTarget } from '~~/server/lib/targets/live-target'
import { securedTargetUrl, testenvAvailable, testenvIssuer } from '../support/testenv'

const migrationsDirectory = new URL('../../server/database/migrations', import.meta.url).pathname

describe.runIf(testenvAvailable)('CredentialBroker against the test environment', () => {
  let handle: DatabaseHandle
  let deps: StudioDeps

  beforeAll(async () => {
    handle = await openDatabase({ kind: 'memory' })
    await applyMigrations(handle.db, await loadMigrationsFromDirectory(migrationsDirectory))
    const config = {
      deploymentMode: 'desktop',
      publicUrl: 'http://127.0.0.1:45000',
      adminRole: 'studio-admin',
      allowPrivateNetworkTargets: true,
    } as StudioConfig
    deps = { config, db: handle.db, cipher: new SecretCipher(randomBytes(32)) }
    await ensureDesktopSession(deps)
    process.env.STUDIO_TEST_SERVICE_SECRET = 'studio-service-test-secret'
    await handle.db.insert(infrastructures).values([
      {
        id: 'service',
        name: 'Secured (as Studio)',
        endpoints: [{ type: 'aasRepository', url: securedTargetUrl }, { type: 'submodelRepository', url: securedTargetUrl }],
        security: { mode: 'deployment_client_credentials', issuer: testenvIssuer, clientId: 'studio-service', scopes: ['basyx-api'], clientSecret: { kind: 'env', ref: 'STUDIO_TEST_SERVICE_SECRET' } },
        allowPrivateNetwork: true,
        createdBy: 'test',
      },
      {
        id: 'delegated',
        name: 'Secured (as user)',
        endpoints: [{ type: 'aasRepository', url: securedTargetUrl }, { type: 'submodelRepository', url: securedTargetUrl }],
        security: { mode: 'delegated_user', issuer: testenvIssuer, clientId: 'studio-desktop', scopes: ['openid', 'basyx-api'], clientSecret: null, desktopLoopbackHost: '127.0.0.1' },
        allowPrivateNetwork: true,
        createdBy: 'test',
      },
    ])
  })

  afterAll(async () => {
    await handle.close()
  })

  it('obtains and caches a client-credentials token and reads with the Studio identity', async () => {
    const broker = new CredentialBroker(deps)
    const record = await getInfrastructure(deps, 'service')
    const first = await broker.access(record, 'desktop-local')
    const second = await broker.access(record, 'desktop-local')
    expect(first.accessToken).toBeTruthy()
    expect(second.accessToken).toBe(first.accessToken)
    expect(first.downstreamIdentity).toBe('client:studio-service')

    const target = new LiveAasTarget({ record, access: first, policy: targetPolicy(deps, record), requestId: 'test', onUnauthorized: async () => {} })
    expect((await target.listShells(10, undefined)).items).toHaveLength(2)
  })

  it('writes with the Studio identity of a client-credentials target', async () => {
    const broker = new CredentialBroker(deps)
    const record = await getInfrastructure(deps, 'service')
    const target = new LiveAasTarget({ record, access: await broker.access(record, 'desktop-local'), policy: targetPolicy(deps, record), requestId: 'test', onUnauthorized: async () => {} })
    const submodelId = 'urn:studio:test:secured:sm:public-nameplate'
    const before = await target.element(submodelId, 'ManufacturerName')
    const after = await target.setElementValue(submodelId, 'ManufacturerName', 'Written as Studio', before.revision)
    try {
      expect(after.value.value).toBe('Written as Studio')
    } finally {
      await target.setElementValue(submodelId, 'ManufacturerName', before.value.value as string, after.revision)
    }
  })

  it('requires per-user authorization and starts it with a loopback redirect for the public desktop client', async () => {
    const broker = new CredentialBroker(deps)
    const record = await getInfrastructure(deps, 'delegated')
    expect(await broker.authenticationState(record, 'desktop-local')).toBe('required')
    await expect(broker.access(record, 'desktop-local')).rejects.toMatchObject({ code: 'target_auth_required' })

    const start = await broker.startAuthorization(record, 'desktop-local', '/targets/delegated')
    expect(start.mode).toBe('external')
    const url = new URL(start.authorizationUrl)
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:45000/api/studio/v1/auth/callback')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('client_id')).toBe('studio-desktop')

    // The IdP accepts this loopback redirect and shows its login page.
    const response = await fetch(url, { redirect: 'manual' })
    expect(response.status).toBe(200)
  })

  it('asks for authorization again when the stored refresh token is rejected', async () => {
    const broker = new CredentialBroker(deps)
    const record = await getInfrastructure(deps, 'delegated')
    await handle.db.insert(targetCredentials).values({
      sessionId: 'desktop-local',
      targetId: 'delegated',
      accessTokenCiphertext: deps.cipher.encrypt('expired-access-token', 'target_credentials.access_token'),
      refreshTokenCiphertext: deps.cipher.encrypt('revoked-refresh-token', 'target_credentials.refresh_token'),
      accessTokenExpiresAt: new Date(Date.now() - 60_000),
    })

    // Stored, the credentials look usable; tried, the IdP rejects the refresh.
    expect(await broker.authenticationState(record, 'desktop-local')).toBe('authenticated')
    expect(await broker.verifiedAuthenticationState(record, 'desktop-local')).toBe('required')
    expect(await broker.authenticationState(record, 'desktop-local')).toBe('required')
  })
})
