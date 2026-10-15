import { z } from 'zod'
import { accentNames, backgroundNames, hexColorPattern, shapes } from '../appearance'
import { localeCodes } from '../i18n/locales'
import { syncModes } from './infrastructure'

const shellKey = z.string().regex(/^[\w-]{1,4000}$/)

/** A recently opened shell with the title it had; older entries are a bare key. */
const recentShell = z.union([
  z.object({ key: shellKey, title: z.string().max(500).nullable() }),
  shellKey.transform(key => ({ key, title: null })),
])
export type RecentShell = z.infer<typeof recentShell>

/**
 * Per-user settings, stored by Studio (PostgreSQL or PGlite). Recently
 * opened shells are kept per target, so switching targets never shows
 * another target's shells. Favorites were dropped after the MVP-4 review:
 * keys stored by earlier versions are ignored and removed on the next save.
 */
export const preferencesSchema = z.object({
  recent: z.record(z.string().max(100), z.array(recentShell).max(50)).default({}),
  /** Preferred language of multi-language values, e.g. `en` or `de`. */
  /**
   * UI language (ADR 0026); `null` follows the browser. A code that is no
   * longer known falls back to `null` instead of invalidating every setting.
   */
  uiLanguage: z.enum(localeCodes).nullable().default(null).catch(null),
  valueLanguage: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/).default('en'),
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  /** Accent colour (shared/appearance.ts): a preset or a custom `#RRGGBB`; anything else falls back to BaSyx. */
  accent: z.union([z.enum(accentNames), z.string().regex(hexColorPattern)]).default('basyx').catch('basyx'),
  /** Page and card colours (shared/appearance.ts), in a light and a dark tone. */
  background: z.enum(backgroundNames).default('neutral').catch('neutral'),
  /** `normal`: small radii; `rounded`: large radii, pill-shaped buttons and chips. */
  shape: z.enum(shapes).default('normal').catch('normal'),
  /** View of the AAS targets list; `null` picks cards for a few targets and rows for many. */
  targetsView: z.enum(['grid', 'list']).nullable().default(null).catch(null),
  /** Off by default, as auto-sync in the BaSyx Web UI: every open shell would poll its infrastructure. */
  autoRefresh: z.boolean().default(false),
  refreshIntervalSeconds: z.number().int().min(1).max(300).default(5),
  /**
   * Registry and discovery sync per infrastructure ID, where the
   * infrastructure lets users choose (MVP-4 plan, I5).
   */
  syncOverrides: z.record(z.string().max(100), z.enum(syncModes)).default({}),
  /** Desktop app: the welcome screen at startup, until the user turns it off. */
  showWelcome: z.boolean().default(true),
})
export type Preferences = z.infer<typeof preferencesSchema>

export const defaultPreferences: Preferences = preferencesSchema.parse({})
