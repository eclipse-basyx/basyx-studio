import type { AppPackageInspection, AppSettingSummary, AppSettingValue, AppSettingValues, AppTargetContext, InfrastructureAppSettings } from '#shared/contract'
import type { Actor, StudioDeps } from '../deps'
import type { InfrastructureRecord } from '../infrastructures'
import type { AppInstallationRecord } from './store'
import type { AppManifest, AppSetting } from '@basyx/studio-sdk/protocol'
import { checkSettingValue, checkSettingValues, settingScope } from '@basyx/studio-app-kit/manifest'
import { eq } from 'drizzle-orm'
import { appSettingsUpdateSchema } from '#shared/contract'
import { appInstallations } from '../../database/schema'
import { recordAudit } from '../audit'
import { boundConnection, configurationAppId } from '../connections/http'
import { StudioProblem } from '../problem'
import { getInstallation } from './store'

// Settings that apps declare and administrators set per installation and per
// infrastructure (ADR 0048). Values are checked against the installed
// manifest when they are saved; values that a later version no longer
// accepts are dropped from the installation and ignored on infrastructures.

/** The manifest's settings as the forms show them. */
export function settingSummaries (manifest: AppManifest): AppSettingSummary[] {
  return (manifest.settings ?? []).map(setting => ({
    key: setting.key,
    type: setting.type,
    title: setting.title,
    description: setting.description ?? null,
    enum: setting.enum ?? null,
    default: setting.default ?? null,
    required: setting.required ?? false,
    scope: settingScope(setting),
  }))
}

/** The values that the manifest's settings accept; values of other or changed settings are dropped. */
export function keptValues (manifest: AppManifest, values: AppSettingValues): { kept: AppSettingValues, dropped: string[] } {
  const declared = new Map((manifest.settings ?? []).map(setting => [setting.key, setting]))
  const kept: AppSettingValues = {}
  const dropped: string[] = []
  for (const [key, value] of Object.entries(values)) {
    const setting = declared.get(key)
    if (setting && checkSettingValue(setting, value) === null) {
      kept[key] = value
    } else {
      dropped.push(key)
    }
  }
  return { kept, dropped: dropped.toSorted() }
}

function accepted (setting: AppSetting, value: unknown): value is AppSettingValue {
  return value !== undefined && value !== null && checkSettingValue(setting, value) === null
}

/**
 * Every declared setting's value for a target: the infrastructure's value of
 * an `infrastructure` setting, else the installation's, else the default,
 * else `null`. Values the setting does not accept (any more) are skipped.
 */
export function resolveSettings (manifest: AppManifest, installationValues: AppSettingValues, infrastructureValues: AppSettingValues | null): Record<string, AppSettingValue | null> {
  const resolved: Record<string, AppSettingValue | null> = {}
  for (const setting of manifest.settings ?? []) {
    const own = settingScope(setting) === 'infrastructure' ? infrastructureValues?.[setting.key] : undefined
    const installed = installationValues[setting.key]
    if (accepted(setting, own)) {
      resolved[setting.key] = own
    } else if (accepted(setting, installed)) {
      resolved[setting.key] = installed
    } else {
      resolved[setting.key] = setting.default ?? null
    }
  }
  return resolved
}

/** The values an infrastructure holds for an app, if any. */
export function infrastructureValuesFor (record: Pick<InfrastructureRecord, 'appSettings'> | null, appId: string): AppSettingValues | null {
  return record?.appSettings.find(entry => entry.app === appId)?.settings ?? null
}

/**
 * What a frame or backend on a target gets in its context (G3, G4): the
 * resolved settings, and per declared connection whether the target's
 * infrastructure binds it. Workspaces and frames without a target have no
 * infrastructure (`null`).
 */
export function targetContext (installation: Pick<AppInstallationRecord, 'appId' | 'manifest' | 'settings'> & { previewOf?: string | null }, record: Pick<InfrastructureRecord, 'appSettings' | 'connections'> | null): AppTargetContext {
  return {
    settings: resolveSettings(installation.manifest, installation.settings, infrastructureValuesFor(record, configurationAppId(installation))),
    connections: Object.fromEntries((installation.manifest.connections ?? []).map(connection => [
      connection.id,
      { bound: record !== null && boundConnection(record, configurationAppId(installation), connection.id) !== undefined },
    ])),
  }
}

/** Checks that a session may open an infrastructure (the credential broker's `access`). */
export interface TargetAccessCheck {
  access: (record: InfrastructureRecord, sessionId: string) => Promise<unknown>
}

/**
 * The target context for a user's frame or backend call: only a user who may
 * open the infrastructure gets its values and bindings, as connection calls
 * check (SEC-005). A delegated-user infrastructure the user has not
 * authorized is refused with `target_auth_required`.
 */
export async function userTargetContext (broker: TargetAccessCheck, sessionId: string, installation: Pick<AppInstallationRecord, 'appId' | 'manifest' | 'settings'> & { previewOf?: string | null }, record: InfrastructureRecord | null): Promise<AppTargetContext> {
  if (record) {
    await broker.access(record, sessionId)
  }
  return targetContext(installation, record)
}

type SettingChanges = Pick<NonNullable<AppPackageInspection['update']>, 'settingsAdded' | 'settingsRemoved' | 'settingsChanged' | 'valuesDropped'>

/** What an update changes in the settings, and which installation values it drops (ADR 0048). */
export function settingChanges (before: AppManifest, after: AppManifest, values: AppSettingValues): SettingChanges {
  const was = new Map((before.settings ?? []).map(setting => [setting.key, setting]))
  const now = new Map((after.settings ?? []).map(setting => [setting.key, setting]))
  const shape = (setting: AppSetting) => JSON.stringify([setting.type, setting.enum ?? null, settingScope(setting)])
  return {
    settingsAdded: [...now.keys()].filter(key => !was.has(key)),
    settingsRemoved: [...was.keys()].filter(key => !now.has(key)),
    settingsChanged: [...now].filter(([key, setting]) => was.has(key) && shape(was.get(key)!) !== shape(setting)).map(([key]) => key),
    valuesDropped: keptValues(after, values).dropped,
  }
}

/**
 * Checks the values an infrastructure holds for installed apps (ADR 0048):
 * every key is an `infrastructure` setting of the app that accepts the value.
 * Values for apps that are not installed are kept unchecked.
 */
export function appSettingViolations (manifests: ReadonlyMap<string, AppManifest>, apps: readonly InfrastructureAppSettings[]): { path: string, message: string }[] {
  return apps.flatMap((entry, index) => {
    const manifest = manifests.get(entry.app)
    return manifest ? checkSettingValues(manifest, entry.settings, { path: `apps.${index}.settings`, scope: 'infrastructure' }) : []
  })
}

/** The manifests of the installed apps by app ID, for checking infrastructure values. */
export async function installedManifests (deps: Pick<StudioDeps, 'db'>): Promise<Map<string, AppManifest>> {
  const rows = await deps.db.select({ appId: appInstallations.appId, manifest: appInstallations.manifest }).from(appInstallations)
  return new Map(rows.map(row => [row.appId, row.manifest]))
}

/** Refuses infrastructure values that an installed app's settings do not accept. */
export async function requireValidAppSettings (deps: Pick<StudioDeps, 'db'>, apps: readonly InfrastructureAppSettings[]): Promise<void> {
  if (apps.length === 0) {
    return
  }
  const violations = appSettingViolations(await installedManifests(deps), apps)
  if (violations.length > 0) {
    throw new StudioProblem('invalid_request', 'Some app settings do not fit the installed apps.', { violations })
  }
}

/** The app IDs whose infrastructure values differ, for the infrastructure's audit record. */
export function changedApps (before: readonly InfrastructureAppSettings[], after: readonly InfrastructureAppSettings[]): string[] {
  const byApp = (entries: readonly InfrastructureAppSettings[]) => new Map(entries.map(entry => [entry.app, JSON.stringify(Object.entries(entry.settings).toSorted(([a], [b]) => a.localeCompare(b)))]))
  const was = byApp(before)
  const now = byApp(after)
  return [...new Set([...was.keys(), ...now.keys()])].filter(app => was.get(app) !== now.get(app)).toSorted()
}

/**
 * Replaces an installation's values (`PUT /app-installations/{id}/settings`):
 * `null` and missing keys leave a setting without a value. Every value must
 * be accepted by its setting; the change is audited with the keys that
 * changed, never the values.
 */
export async function updateInstallationSettings (deps: StudioDeps, actor: Actor, id: string, raw: unknown, requestId: string): Promise<AppInstallationRecord> {
  const parsed = appSettingsUpdateSchema.safeParse(raw)
  if (!parsed.success) {
    throw new StudioProblem('invalid_request', 'The settings are invalid.', {
      violations: parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })),
    })
  }
  const record = await getInstallation(deps, id)
  const values = Object.fromEntries(Object.entries(parsed.data.values).filter((entry): entry is [string, AppSettingValue] => entry[1] !== null))
  const violations = checkSettingValues(record.manifest, values, { path: 'values', scope: 'installation' })
  if (violations.length > 0) {
    throw new StudioProblem('invalid_request', `Some values do not fit the settings of ${record.appId}.`, { violations })
  }
  const [updated] = await deps.db.update(appInstallations).set({ settings: values }).where(eq(appInstallations.id, id)).returning()
  if (!updated) {
    throw new StudioProblem('app_not_found')
  }
  const keys = [...new Set([...Object.keys(record.settings), ...Object.keys(values)])]
  await recordAudit(deps, {
    action: 'app.settings.update',
    outcome: 'success',
    requestId,
    actorSubject: actor.subject,
    appInstallationId: id,
    details: { appId: record.appId, changed: keys.filter(key => JSON.stringify(record.settings[key]) !== JSON.stringify(values[key])).toSorted() },
  })
  return updated
}
