import type { DatabaseHandle } from '~~/server/lib/database/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDatabase } from '~~/server/lib/database/client'
import { applyMigrations, loadMigrationsFromDirectory } from '~~/server/lib/database/migrate'
import { getPreferences, savePreferences } from '~~/server/lib/preferences'
import { StudioProblem } from '~~/server/lib/problem'
import { defaultPreferences } from '#shared/contract'

const migrationsDirectory = new URL('../../server/database/migrations', import.meta.url).pathname

describe('user preferences', () => {
  let handle: DatabaseHandle

  beforeAll(async () => {
    handle = await openDatabase({ kind: 'memory' })
    await applyMigrations(handle.db, await loadMigrationsFromDirectory(migrationsDirectory))
  })

  afterAll(async () => {
    await handle.close()
  })

  it('returns defaults, stores per user, and replaces on save', async () => {
    const deps = { db: handle.db }
    expect(await getPreferences(deps, 'alice')).toEqual(defaultPreferences)
    await savePreferences(deps, 'alice', { recent: { t1: [{ key: 'a2V5', title: 'Motor' }] }, refreshIntervalSeconds: 10 })
    await savePreferences(deps, 'bob', { valueLanguage: 'de' })
    expect(await getPreferences(deps, 'alice')).toMatchObject({ recent: { t1: [{ key: 'a2V5', title: 'Motor' }] }, refreshIntervalSeconds: 10, valueLanguage: 'en' })
    expect(await getPreferences(deps, 'bob')).toMatchObject({ recent: {}, valueLanguage: 'de' })
    await savePreferences(deps, 'alice', { autoRefresh: true })
    expect(await getPreferences(deps, 'alice')).toMatchObject({ recent: {}, autoRefresh: true })
  })

  it('drops favorites stored by earlier versions', async () => {
    const deps = { db: handle.db }
    await savePreferences(deps, 'dave', { favorites: { t1: ['a2V5'] }, theme: 'light' })
    const stored = await getPreferences(deps, 'dave')
    expect(stored).toMatchObject({ theme: 'light' })
    expect(stored).not.toHaveProperty('favorites')
  })

  it('keeps recent shells stored before titles were remembered', async () => {
    const deps = { db: handle.db }
    await savePreferences(deps, 'carol', { recent: { t1: ['a2V5', { key: 'b3RoZXI', title: 'Other shell' }] }, theme: 'dark' })
    expect(await getPreferences(deps, 'carol')).toMatchObject({
      recent: { t1: [{ key: 'a2V5', title: null }, { key: 'b3RoZXI', title: 'Other shell' }] },
      theme: 'dark',
    })
  })

  it('rejects invalid values', async () => {
    await expect(savePreferences({ db: handle.db }, 'alice', { refreshIntervalSeconds: 0 })).rejects.toThrow(StudioProblem)
  })

  describe('with a deployment\'s defaults and locks (ADR 0055)', () => {
    const policy = { defaults: { theme: 'dark' as const, shape: 'rounded' as const, accent: 'basyx' }, locked: ['theme' as const], languages: ['de', 'en'] }

    it('gives users the deployment\'s defaults until they choose, and follows a changed default', async () => {
      const deps = { db: handle.db }
      expect(await getPreferences(deps, 'erin', policy)).toMatchObject({ theme: 'dark', shape: 'rounded' })
      // Saving the default stores nothing for it, so the user keeps following the deployment.
      await savePreferences(deps, 'erin', { ...(await getPreferences(deps, 'erin', policy)), autoRefresh: true }, policy)
      expect(await getPreferences(deps, 'erin', { ...policy, defaults: { ...policy.defaults, shape: 'normal' as const } })).toMatchObject({ shape: 'normal', autoRefresh: true })
      await savePreferences(deps, 'erin', { shape: 'normal' }, policy)
      expect(await getPreferences(deps, 'erin', policy)).toMatchObject({ shape: 'normal' })
    })

    it('keeps locked settings at the deployment\'s value, whatever the request says, and restores the user\'s when unlocked', async () => {
      const deps = { db: handle.db }
      await savePreferences(deps, 'frank', { theme: 'light' })
      expect(await savePreferences(deps, 'frank', { theme: 'system', valueLanguage: 'fr' }, policy)).toMatchObject({ theme: 'dark', valueLanguage: 'fr' })
      expect(await getPreferences(deps, 'frank', policy)).toMatchObject({ theme: 'dark' })
      expect(await getPreferences(deps, 'frank', { ...policy, locked: [] })).toMatchObject({ theme: 'light', valueLanguage: 'fr' })
    })

    it('offers only the deployment\'s languages', async () => {
      const deps = { db: handle.db }
      expect(await savePreferences(deps, 'gina', { uiLanguage: 'ja' }, { ...policy, defaults: { ...policy.defaults, uiLanguage: 'de' as const } })).toMatchObject({ uiLanguage: 'de' })
      expect(await getPreferences(deps, 'gina', policy)).toMatchObject({ uiLanguage: null })
    })
  })
})
