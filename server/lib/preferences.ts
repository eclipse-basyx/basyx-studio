import type { LockableSetting } from '#shared/branding'
import type { Preferences } from '#shared/contract'
import type { PreferencePolicy } from './branding'
import type { StudioDeps } from './deps'
import { eq, sql } from 'drizzle-orm'
import { lockableSettings } from '#shared/branding'
import { defaultPreferences, preferencesSchema } from '#shared/contract'
import { userPreferences } from '../database/schema'
import { StudioProblem } from './problem'

/** No defaults, no locks: Studio's own defaults apply. */
const noPolicy: PreferencePolicy = { defaults: {}, locked: [], languages: null }

type Stored = Partial<Record<keyof Preferences, unknown>>

/** The deployment's value of a setting, else Studio's default. */
function defaultOf (policy: PreferencePolicy, key: LockableSetting): unknown {
  return policy.defaults[key] ?? defaultPreferences[key]
}

/**
 * The preferences in effect (ADR 0055): what the user chose, the
 * deployment's defaults where they did not choose, and the deployment's
 * values for locked settings. Stored values that no longer validate fall
 * back to the defaults.
 */
export function effectivePreferences (stored: Stored, policy: PreferencePolicy = noPolicy): Preferences {
  const merged: Stored = { ...stored }
  for (const key of lockableSettings) {
    if (policy.locked.includes(key) || merged[key] === undefined) {
      merged[key] = defaultOf(policy, key)
    }
  }
  const parsed = preferencesSchema.safeParse(merged)
  const preferences = parsed.success ? parsed.data : preferencesSchema.parse(Object.fromEntries(lockableSettings.map(key => [key, defaultOf(policy, key)])))
  if (policy.languages && preferences.uiLanguage && !policy.languages.includes(preferences.uiLanguage)) {
    preferences.uiLanguage = (policy.defaults.uiLanguage as Preferences['uiLanguage']) ?? null
  }
  return preferences
}

/** The user's preferences in effect. */
export async function getPreferences (deps: Pick<StudioDeps, 'db'>, subject: string, policy: PreferencePolicy = noPolicy): Promise<Preferences> {
  const [row] = await deps.db.select().from(userPreferences).where(eq(userPreferences.subject, subject))
  return effectivePreferences((row?.preferences ?? {}) as Stored, policy)
}

/**
 * Replaces the user's preferences. Locked settings keep what was stored
 * before, so lifting a lock brings the user's own choice back; a setting
 * equal to the deployment's default is not stored, so the user follows the
 * deployment when it changes its default.
 */
export async function savePreferences (deps: Pick<StudioDeps, 'db'>, subject: string, raw: unknown, policy: PreferencePolicy = noPolicy): Promise<Preferences> {
  const parsed = preferencesSchema.safeParse(raw)
  if (!parsed.success) {
    throw new StudioProblem('invalid_request', 'The preferences are invalid.', {
      violations: parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })),
    })
  }
  // The schema fills in Studio defaults for missing keys. Only the fields
  // actually sent by the client can change its stored appearance choices.
  const preserved = lockableSettings.filter(key => policy.locked.includes(key) || !Object.hasOwn(raw as object, key))
  const keep = (key: string, value: unknown): boolean => {
    const setting = key as LockableSetting
    if (!lockableSettings.includes(setting)) {
      return true
    }
    if (preserved.includes(setting)) {
      return false
    }
    if (setting === 'uiLanguage' && policy.languages && typeof value === 'string' && !policy.languages.includes(value)) {
      return false
    }
    return value !== defaultOf(policy, setting)
  }
  const preferences = Object.fromEntries(Object.entries(parsed.data).filter(([key, value]) => keep(key, value))) as Preferences
  // Preserve the selected fields from the current row at write time, including
  // any choices saved by a concurrent request.
  const update = preserved.length === 0
    ? sql`excluded.preferences`
    : sql`
      excluded.preferences || coalesce(
        (select jsonb_object_agg(saved.key, saved.value)
         from jsonb_each(${userPreferences.preferences}) as saved
         where saved.key in (${sql.join(preserved.map(key => sql`${key}`), sql`, `)})),
        '{}'::jsonb
      )`
  const [row] = await deps.db.insert(userPreferences)
    .values({ subject, preferences })
    .onConflictDoUpdate({ target: userPreferences.subject, set: { preferences: update, updatedAt: new Date() } })
    .returning({ preferences: userPreferences.preferences })
  return effectivePreferences(row!.preferences, policy)
}
