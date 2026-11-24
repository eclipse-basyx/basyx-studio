import type { StudioConfig } from '~~/server/lib/config'
import type { DatabaseHandle } from '~~/server/lib/database/client'
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assetContentType, brandingAdminView, deleteAdminAsset, replaceAdminBranding, resolveBranding, saveAdminAsset, saveAdminSettings } from '~~/server/lib/branding'
import { loadStudioConfig } from '~~/server/lib/config'
import { openDatabase } from '~~/server/lib/database/client'
import { applyMigrations, loadMigrationsFromDirectory } from '~~/server/lib/database/migrate'
import { StudioProblem } from '~~/server/lib/problem'

const migrationsDirectory = new URL('../../server/database/migrations', import.meta.url).pathname

const env = {
  STUDIO_PUBLIC_URL: 'https://studio.example.org',
  STUDIO_DATA_KEY: randomBytes(32).toString('base64url'),
  STUDIO_OIDC_ISSUER: 'https://idp.example.org/realms/x',
  STUDIO_OIDC_CLIENT_ID: 'studio',
}

describe('branding set by administrators (ADR 0055)', () => {
  let handle: DatabaseHandle
  let config: StudioConfig

  beforeAll(async () => {
    handle = await openDatabase({ kind: 'memory' })
    await applyMigrations(handle.db, await loadMigrationsFromDirectory(migrationsDirectory))
    config = loadStudioConfig({ ...env, STUDIO_PRODUCT_NAME: 'Env Studio' }, 'hosted')
  })

  afterAll(async () => {
    await handle.close()
  })

  it('stores settings and files below what the deployment sets', async () => {
    const deps = { db: handle.db, config }
    await saveAdminSettings(deps, { productName: 'Admin Studio', organisation: 'ACME GmbH', locked: ['shape'] }, 'admin-1')
    await saveAdminAsset(deps, 'favicon', new Uint8Array([0x89, 0x50]), 'image/png', 'admin-1')
    const resolved = await resolveBranding(deps)
    expect(resolved.settings).toMatchObject({ productName: 'Env Studio', organisation: 'ACME GmbH', locked: ['shape'] })
    expect(resolved.sources).toMatchObject({ 'productName': 'env', 'organisation': 'admin', 'asset.favicon': 'admin' })

    const view = await brandingAdminView(deps)
    expect(view.admin.productName).toBe('Admin Studio')
    expect(view.assets.favicon).toMatchObject({ source: 'admin', contentType: 'image/png', size: 2 })
    expect(view.assets['logo-light'].source).toBe('default')
    expect(view.updatedBy).toBe('admin-1')

    await deleteAdminAsset(deps, 'favicon')
    expect((await resolveBranding(deps)).assets.favicon).toBeUndefined()
  })

  it('refuses invalid settings and files of the wrong type or size', async () => {
    const deps = { db: handle.db, config }
    await expect(saveAdminSettings(deps, { accent: 'blue' }, 'admin-1')).rejects.toThrow(StudioProblem)
    await expect(saveAdminSettings(deps, { legal: { imprint: { en: { url: 'javascript:alert(1)' } } } }, 'admin-1')).rejects.toThrow(StudioProblem)
    await expect(saveAdminAsset(deps, 'font', new Uint8Array([1]), 'image/png', 'admin-1')).rejects.toThrow(/font/)
    await expect(saveAdminAsset(deps, 'logo-light', new Uint8Array(3 * 1024 * 1024), 'image/png', 'admin-1')).rejects.toThrow(/MB/)
    expect(assetContentType('favicon', 'image/vnd.microsoft.icon')).toBe('image/x-icon')
    expect(assetContentType('logo-light', 'text/html')).toBeNull()
  })

  it('replaces everything with an import', async () => {
    const deps = { db: handle.db, config }
    await replaceAdminBranding(deps, { settings: { helpUrl: 'https://acme.example/help' }, assets: { 'logo-compact': { bytes: new Uint8Array([1]), contentType: 'image/svg+xml' } } }, 'admin-2')
    const view = await brandingAdminView(deps)
    expect(view.admin).toEqual({ helpUrl: 'https://acme.example/help' })
    expect(view.assets['logo-compact'].source).toBe('admin')
  })

  it('ignores and refuses administrators\' branding where the deployment fixes it', async () => {
    const fixed = { db: handle.db, config: loadStudioConfig({ ...env, STUDIO_BRANDING_EDITABLE: 'false' }, 'hosted') }
    expect((await resolveBranding(fixed)).settings.helpUrl).toBeUndefined()
    await expect(saveAdminSettings(fixed, {}, 'admin-1')).rejects.toThrow(/STUDIO_BRANDING_EDITABLE/)
  })
})
