import type { AppManifest, AppSetting } from '@basyx/studio-sdk/protocol'
import type { DatabaseHandle } from '~~/server/lib/database/client'
import type { Actor, StudioDeps } from '~~/server/lib/deps'
import { randomBytes } from 'node:crypto'
import { checkSettingValue, checkSettingValues } from '@basyx/studio-app-kit/manifest'
import { checkPackage } from '@basyx/studio-app-kit/package'
import { connectionsHandler, createTestStudio, testContext } from '@basyx/studio-sdk/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { appInstallations, auditEvents, infrastructures } from '~~/server/database/schema'
import { targetContext, updateInstallationSettings, userTargetContext } from '~~/server/lib/apps/settings'
import { describeInstallation, getInstallation, inspectAppPackage, installApp, installPreviewApp } from '~~/server/lib/apps/store'
import { loadStudioConfig } from '~~/server/lib/config'
import { SecretCipher } from '~~/server/lib/crypto/cipher'
import { openDatabase } from '~~/server/lib/database/client'
import { applyMigrations, loadMigrationsFromDirectory } from '~~/server/lib/database/migrate'
import { parseInfrastructureFile } from '~~/server/lib/infrastructure-file'
import { createInfrastructure, exportInfrastructures, importInfrastructures, reconcileManagedInfrastructures, toInfrastructure } from '~~/server/lib/infrastructures'
import { StudioProblem } from '~~/server/lib/problem'
import { manifestOf, zipApp } from './support'

// Declared app settings and connection status per installation (ADR 0048).

const migrationsDirectory = new URL('../../server/database/migrations', import.meta.url).pathname
const admin: Actor = { subject: 'studio-admin', name: 'Admin', roles: ['studio-admin'], isAdmin: true, sessionId: 's1' }
const appId = 'org.example.asset-board'

const settings: AppSetting[] = [
  { key: 'assetTypes', type: 'stringList', scope: 'infrastructure', required: true, title: { en: 'Asset types' } },
  { key: 'serialIdName', type: 'string', scope: 'infrastructure', default: 'serialNumber', title: { en: 'Name of the serial number ID' } },
  { key: 'units', type: 'string', enum: ['metric', 'imperial'], default: 'metric', title: { en: 'Units' } },
  { key: 'pageSize', type: 'number', default: 25, title: { en: 'Shells per page' } },
  { key: 'showOthers', type: 'boolean', title: { en: 'Show other shells' } },
]

function withSettings (overrides: Partial<AppManifest> = {}): AppManifest {
  return manifestOf({ id: appId, studioApi: '^0.1.9', settings, ...overrides })
}

function findings (manifest: AppManifest): string[] {
  return checkPackage(zipApp(manifest)).findings.map(finding => `${finding.path}: ${finding.message}`)
}

async function problemOf (promise: Promise<unknown>): Promise<StudioProblem> {
  try {
    await promise
  } catch (error) {
    if (error instanceof StudioProblem) {
      return error
    }
    throw error
  }
  throw new Error('expected a problem')
}

describe('settings in the manifest', () => {
  it('pass studio-app pack and Studio\'s checks', () => {
    expect(findings(withSettings())).toEqual([])
  })

  it('need unique keys, enum only for texts, defaults that fit, and Studio app API 0.1.9', () => {
    expect(findings(withSettings({ studioApi: '^0.1.6' }))).toEqual(['studio-app.json#studioApi: allows Studio app API 0.1.6, but settings needs 0.1.9; declare ^0.1.9'])
    expect(findings(withSettings({ settings: [settings[0]!, { ...settings[1]!, key: 'assetTypes' }] }))).toEqual(['studio-app.json#settings[1].key: duplicates the setting key "assetTypes"'])
    expect(findings(withSettings({ settings: [{ key: 'pageSize', type: 'number', enum: ['1'], title: { en: 'x' } }] }))).toEqual(['studio-app.json#settings[0].enum: applies to string and stringList settings only, not to number'])
    expect(findings(withSettings({ settings: [{ ...settings[2]!, default: 'nautical' }] }))).toEqual(['studio-app.json#settings[0].default: must be one of "metric", "imperial"'])
    expect(findings(withSettings({ settings: [{ ...settings[3]!, default: '25' }] }))).toEqual(['studio-app.json#settings[0].default: must be a finite number'])
    expect(findings(withSettings({ settings: [{ ...settings[3]!, key: 'page-size' }] }))[0]).toMatch(/^studio-app\.json#settings\.0\.key: must match pattern/)
  })

  it('refuse values of the wrong type, and infrastructure values of installation settings', () => {
    expect(checkSettingValue(settings[0]!, ['a', 'b'])).toBeNull()
    expect(checkSettingValue(settings[0]!, 'a')).toMatch(/must be a list of at most 100 strings/)
    expect(checkSettingValue(settings[3]!, Number.NaN)).toBe('must be a finite number')
    expect(checkSettingValue(settings[4]!, 'true')).toBe('must be true or false')
    expect(checkSettingValue(settings[1]!, 'x'.repeat(2001))).toMatch(/at most 2000 characters/)
    const manifest = withSettings()
    expect(checkSettingValues(manifest, { assetTypes: ['a'], pageSize: 10 }, { path: 'values', scope: 'installation' })).toEqual([])
    expect(checkSettingValues(manifest, { pageSize: 10, colour: 'red' }, { path: 'apps.0.settings', scope: 'infrastructure' })).toEqual([
      { path: 'apps.0.settings.pageSize', message: 'is set per installation, on the Apps page, not per infrastructure' },
      { path: 'apps.0.settings.colour', message: `is not a setting of ${appId}` },
    ])
  })
})

describe('settings on the test Studio', () => {
  it('start empty, and refuse connections the context marks unbound', async () => {
    expect(testContext()).toMatchObject({ settings: {}, connections: {} })
    const studio = createTestStudio({
      context: { settings: { assetTypes: ['urn:example:pump'] }, connections: { forecast: { bound: false } } },
      handlers: { 'studio.connections.call': connectionsHandler({ forecast: { getForecast: () => ({ body: {} }) } }) },
    })
    expect(studio.client.context.settings).toEqual({ assetTypes: ['urn:example:pump'] })
    await expect(studio.client.connections.call({ connection: 'forecast', operation: 'getForecast' })).rejects.toMatchObject({ code: 'connection_not_bound' })
    studio.setContext({ connections: { forecast: { bound: true } } })
    expect(await studio.client.connections.call({ connection: 'forecast', operation: 'getForecast' })).toMatchObject({ status: 200 })
  })

  it('take the defaults and bound connections from the manifest, unless the context says otherwise', () => {
    const manifest = withSettings({ connections: [{ id: 'forecast', title: { en: 'Forecast' }, api: 'api/weather.json', operations: ['getForecast'] }] })
    expect(createTestStudio({ manifest }).context).toMatchObject({
      settings: { assetTypes: null, serialIdName: 'serialNumber', units: 'metric', pageSize: 25, showOthers: null },
      connections: { forecast: { bound: true } },
    })
    expect(createTestStudio({ manifest, context: { settings: { assetTypes: ['urn:example:pump'] } } }).context.settings).toEqual({ assetTypes: ['urn:example:pump'] })
  })
})

describe('settings values', () => {
  let handle: DatabaseHandle
  let deps: StudioDeps

  const env = {
    STUDIO_PUBLIC_URL: 'https://studio.example.org',
    STUDIO_DATA_KEY: randomBytes(32).toString('base64url'),
    STUDIO_OIDC_ISSUER: 'https://idp.example.org/realms/x',
    STUDIO_OIDC_CLIENT_ID: 'studio',
    STUDIO_APPS_URL: 'https://apps.example.org',
    STUDIO_APPS_ALLOW_UNSIGNED: 'true',
  }

  const twoPlants = (northTypes: string, southTypes: string) => `
version: 1
infrastructures:
  - key: plant-north
    name: Plant North
    template: mono-all
    endpoints: [{ type: aasEnvironment, url: "https://north.example.org" }]
    security: { mode: unsecured }
    connections:
      - key: weather
        type: http
        url: https://weather.example.org/v1
        auth: { scheme: none }
        apps: [{ app: ${appId}, connection: forecast }]
    apps:
      - app: ${appId}
        settings: { assetTypes: ${northTypes}, serialIdName: plantSerial }
  - key: plant-south
    name: Plant South
    template: mono-all
    endpoints: [{ type: aasEnvironment, url: "https://south.example.org" }]
    security: { mode: unsecured }
    apps:
      - app: ${appId}
        settings: { assetTypes: ${southTypes} }
`

  const forecastApi = JSON.stringify({ openapi: '3.1.0', info: { title: 'Weather', version: '1' }, paths: { '/forecast': { get: { operationId: 'getForecast', responses: { 200: { description: 'ok' } } } } } })

  function packageOf (manifest: AppManifest): Uint8Array {
    return zipApp(manifest, { 'ui/index.html': '<!doctype html><title>x</title>', 'api/weather.json': forecastApi })
  }

  const withForecast = (overrides: Partial<AppManifest> = {}) => withSettings({
    permissions: ['studio.aas.read', 'studio.connections'],
    connections: [{ id: 'forecast', title: { en: 'Forecast' }, api: 'api/weather.json', operations: ['getForecast'] }],
    ...overrides,
  })

  beforeAll(async () => {
    handle = await openDatabase({ kind: 'memory' })
    await applyMigrations(handle.db, await loadMigrationsFromDirectory(migrationsDirectory))
  })

  beforeEach(async () => {
    await handle.db.delete(infrastructures)
    await handle.db.delete(appInstallations)
    const config = loadStudioConfig(env, 'hosted')
    deps = { config, db: handle.db, cipher: new SecretCipher(config.dataKey) }
  })

  afterAll(async () => {
    await handle.close()
  })

  async function install (manifest: AppManifest = withForecast()) {
    return (await installApp(deps, admin, packageOf(manifest), null, 'r1')).record
  }

  async function plant (key: string) {
    const [record] = await handle.db.select().from(infrastructures).where(eq(infrastructures.managedKey, key))
    return record!
  }

  it('resolve per infrastructure, then installation, then default, for one package on two infrastructures', async () => {
    const installation = await install()
    await reconcileManagedInfrastructures(deps, parseInfrastructureFile(twoPlants('[urn:example:pump, urn:example:valve]', '[urn:example:compressor]'), 'infrastructures.yaml'))
    const updated = await updateInstallationSettings(deps, admin, installation.id, { values: { pageSize: 50, serialIdName: 'serial', showOthers: null } }, 'r2')

    expect(targetContext(updated, await plant('plant-north'))).toEqual({
      settings: { assetTypes: ['urn:example:pump', 'urn:example:valve'], serialIdName: 'plantSerial', units: 'metric', pageSize: 50, showOthers: null },
      connections: { forecast: { bound: true } },
    })
    expect(targetContext(updated, await plant('plant-south'))).toEqual({
      settings: { assetTypes: ['urn:example:compressor'], serialIdName: 'serial', units: 'metric', pageSize: 50, showOthers: null },
      connections: { forecast: { bound: false } },
    })
    // A workspace, or a frame without a target, has installation values and defaults only.
    expect(targetContext(updated, null).settings.assetTypes).toBeNull()
    expect((await describeInstallation(deps, updated)).settingValues).toEqual({ pageSize: 50, serialIdName: 'serial' })

    const [audit] = await handle.db.select().from(auditEvents).where(eq(auditEvents.action, 'app.settings.update'))
    expect(audit?.details).toEqual({ appId, changed: ['pageSize', 'serialIdName'] })
  })

  it('reach an App Builder preview of the app through the installed app (ADR 0054)', async () => {
    const installation = await install()
    await reconcileManagedInfrastructures(deps, parseInfrastructureFile(twoPlants('[urn:example:pump]', '[urn:example:compressor]'), 'infrastructures.yaml'))
    const updated = await updateInstallationSettings(deps, admin, installation.id, { values: { pageSize: 50 } }, 'r2')
    const developer = { ...deps, config: { ...deps.config, apps: { ...deps.config.apps, allowUnsigned: true } } }
    const { record: preview } = await installPreviewApp(developer, packageOf(withForecast()), 'local.preview.p1', 'app-builder', appId)
    expect(preview).toMatchObject({ previewOf: appId, settings: { pageSize: 50 } })
    expect(targetContext(preview, await plant('plant-north'))).toEqual(targetContext(updated, await plant('plant-north')))
    expect(targetContext(preview, await plant('plant-north')).connections).toEqual({ forecast: { bound: true } })

    // Without an installed app, the preview has its own (empty) configuration.
    const { record: alone } = await installPreviewApp(developer, packageOf(withForecast()), 'local.preview.p2', 'app-builder', 'org.example.not-installed')
    expect(alone.previewOf).toBeNull()
    expect(targetContext(alone, await plant('plant-north')).connections).toEqual({ forecast: { bound: false } })
  })

  it('reach only users who may open the infrastructure, for frames and backends', async () => {
    const installation = await install()
    await reconcileManagedInfrastructures(deps, parseInfrastructureFile(twoPlants('[urn:example:pump]', '[urn:example:compressor]'), 'infrastructures.yaml'))
    const north = await plant('plant-north')
    const unauthorized = { access: async () => {
      throw new StudioProblem('target_auth_required')
    } }
    expect((await problemOf(userTargetContext(unauthorized, 's1', installation, north))).code).toBe('target_auth_required')
    const authorized = { access: async () => ({ accessToken: undefined, downstreamIdentity: null }) }
    expect((await userTargetContext(authorized, 's1', installation, north)).settings.assetTypes).toEqual(['urn:example:pump'])
    expect((await userTargetContext(unauthorized, 's1', installation, null)).settings.assetTypes).toBeNull()
  })

  it('refuse values of the wrong type on the Apps page, in the dialog and in the declared file', async () => {
    const installation = await install()
    const refused = await problemOf(updateInstallationSettings(deps, admin, installation.id, { values: { pageSize: 'many', colour: 'red' } }, 'r2'))
    expect(refused.code).toBe('invalid_request')
    expect(refused.violations).toEqual([
      { path: 'values.pageSize', message: 'must be a finite number' },
      { path: 'values.colour', message: `is not a setting of ${appId}` },
    ])

    const input = {
      name: 'Plant West',
      template: 'mono-all',
      endpoints: [{ type: 'aasEnvironment', url: 'https://west.example.org' }],
      security: { mode: 'unsecured' },
      apps: [{ app: appId, settings: { assetTypes: 'urn:example:pump' } }],
    }
    const dialog = await problemOf(createInfrastructure(deps, admin, input, 'r3'))
    expect(dialog.violations).toEqual([{ path: 'apps.0.settings.assetTypes', message: expect.stringMatching(/must be a list/) }])

    await expect(reconcileManagedInfrastructures(deps, parseInfrastructureFile(twoPlants('urn:example:pump', '[]'), 'infrastructures.yaml')))
      .rejects
      .toThrow(/infrastructure plant-north: .*apps\.0\.settings\.assetTypes: must be a list/)
    expect(await handle.db.select().from(infrastructures)).toEqual([])

    const imported = await importInfrastructures(deps, admin, { yaml: twoPlants('urn:example:pump', '[]'), dryRun: true, resolutions: {} }, 'r4')
    expect(imported.entries[0]!.problems.join(' ')).toMatch(/apps\.0\.settings\.assetTypes: must be a list/)
    expect(imported.entries[1]!.problems).toEqual([])
  })

  it('keep values for apps that are not installed, and export them', async () => {
    await reconcileManagedInfrastructures(deps, parseInfrastructureFile(twoPlants('[urn:example:pump]', '[urn:example:compressor]'), 'infrastructures.yaml'))
    const north = await plant('plant-north')
    expect(toInfrastructure(north).apps).toEqual([{ app: appId, settings: { assetTypes: ['urn:example:pump'], serialIdName: 'plantSerial' } }])
    const exported = await exportInfrastructures(deps, [north.id])
    expect(exported).toContain(`- app: ${appId}`)
    expect(parseInfrastructureFile(exported, 'export.yaml')[0]!.input.apps).toEqual(toInfrastructure(north).apps)
  })

  it('drop installation values an update no longer accepts, and show what it changes', async () => {
    const installation = await install()
    await updateInstallationSettings(deps, admin, installation.id, { values: { pageSize: 50, units: 'imperial' } }, 'r2')
    const next = withForecast({
      version: '1.1.0',
      settings: [
        settings[0]!,
        { ...settings[2]!, enum: ['metric'] },
        { key: 'pageSize', type: 'string', title: { en: 'Page size' } },
        { key: 'mapZoom', type: 'number', default: 12, title: { en: 'Zoom' } },
      ],
    })
    const inspection = await inspectAppPackage(deps, packageOf(next), null)
    expect(inspection.update).toMatchObject({
      settingsAdded: ['mapZoom'],
      settingsRemoved: ['serialIdName', 'showOthers'],
      settingsChanged: ['units', 'pageSize'],
      valuesDropped: ['pageSize', 'units'],
    })
    await installApp(deps, admin, packageOf(next), null, 'r3')
    expect((await getInstallation(deps, installation.id)).settings).toEqual({})
  })
})
