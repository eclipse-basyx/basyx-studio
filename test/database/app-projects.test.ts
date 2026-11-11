import type { DatabaseHandle } from '~~/server/lib/database/client'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DatabaseProjectStore } from '~~/server/lib/app-projects/store'
import { openDatabase } from '~~/server/lib/database/client'
import { applyMigrations, loadMigrationsFromDirectory } from '~~/server/lib/database/migrate'
import { appBuilderOperationSchemas } from '#shared/contract'

const migrationsDirectory = new URL('../../server/database/migrations', import.meta.url).pathname

describe('App Builder default preview target', () => {
  let handle: DatabaseHandle

  beforeAll(async () => {
    handle = await openDatabase({ kind: 'memory' })
    const migrations = await loadMigrationsFromDirectory(migrationsDirectory)
    // An app created before preview targets were stored still opens after migration.
    const before = migrations.findIndex(migration => migration.tag === '0013_app_preview_target')
    expect(before).toBeGreaterThan(0)
    await applyMigrations(handle.db, migrations.slice(0, before))
    await handle.db.execute(sql`insert into app_projects (id, name, app_id, folder, origin) values ('old', 'Old', 'local.old', '/apps/old', 'new')`)
    await applyMigrations(handle.db, migrations)
  })

  afterAll(async () => {
    await handle.close()
  })

  it('migrates existing projects and persists the chosen target on new projects', async () => {
    const store = new DatabaseProjectStore(handle.db)
    expect((await store.listProjects())[0]?.previewTargetId).toBeNull()
    await store.insertProject({ id: 'new', name: 'New', appId: 'local.new', folder: '/apps/new', origin: 'new', source: null, previewTargetId: 'target-a', createdAt: new Date() })
    expect((await new DatabaseProjectStore(handle.db).listProjects()).find(project => project.id === 'new')?.previewTargetId).toBe('target-a')
  })

  it.each(['createProject', 'addFolder'] as const)('validates the optional preview target for %s', operation => {
    const schema = appBuilderOperationSchemas[operation]
    const params = operation === 'createProject' ? { name: 'New', agentId: 'opencode' } : { folderHandle: 'folder', agentId: 'opencode' }
    expect(schema.parse({ ...params, previewTargetId: 'target-a' })).toHaveProperty('previewTargetId', 'target-a')
    expect(schema.safeParse({ ...params, previewTargetId: '' }).success).toBe(false)
    expect(schema.safeParse({ ...params, previewTargetId: 'a'.repeat(201) }).success).toBe(false)
    expect(schema.safeParse(params).success).toBe(true)
    expect(schema.safeParse({ ...params, previewTargetId: null }).success).toBe(true)
  })
})
