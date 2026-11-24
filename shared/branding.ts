// A deployment's corporate design (ADR 0055): its name, logos, colours,
// defaults and locks for the users' appearance settings, and its legal pages.
// Three sources set it, each value from the first that has it: STUDIO_*
// environment variables, the branding file (STUDIO_BRANDING_FILE) and
// administrators in Studio. Server and client share the shapes here.

import { z } from 'zod'
import { backgroundNames, hexColorPattern, readableShade, shapes } from './appearance'
import { localeCodes } from './i18n/locales'

/** User settings that a deployment can fix for every user. */
export const lockableSettings = ['theme', 'accent', 'background', 'shape', 'uiLanguage', 'valueLanguage'] as const
export type LockableSetting = (typeof lockableSettings)[number]

/** Legal pages a deployment can offer; each an external page or Markdown that Studio hosts. */
export const legalPages = ['imprint', 'privacy', 'accessibility', 'terms'] as const
export type LegalPage = (typeof legalPages)[number]

/** Image and font files of the brand, served at `<base>/branding/<slot>`. */
export const brandingAssetSlots = ['logo-light', 'logo-dark', 'logo-compact', 'favicon', 'font'] as const
export type BrandingAssetSlot = (typeof brandingAssetSlots)[number]

/** Content types each slot accepts, by file extension. */
export const brandingAssetTypes: Record<BrandingAssetSlot, Record<string, string>> = {
  'logo-light': { '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' },
  'logo-dark': { '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' },
  'logo-compact': { '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' },
  'favicon': { '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' },
  'font': { '.woff2': 'font/woff2' },
}

/** Path of the deployment font within an installation's files. */
export const appBrandFontPath = '.studio-brand.woff2'

/** Serve the deployment font on the app's own file origin, including on desktop. */
export function appBrandFontUrl (entryUrl: string, installationId: string, font: string | null | undefined): string | undefined {
  const version = font?.match(/^\/branding\/font\?v=([a-f0-9]{12})$/)?.[1]
  if (!version) {
    return undefined
  }
  const entry = new URL(entryUrl)
  const installationPath = `/app/${installationId}/`
  const start = entry.pathname.indexOf(installationPath)
  if (entry.protocol !== 'studio-app:' && start === -1) {
    return undefined
  }
  const base = entry.protocol === 'studio-app:' ? '/' : entry.pathname.slice(0, start + installationPath.length)
  return new URL(`${base}${appBrandFontPath}?v=${version}`, entry).href
}

/** Largest brand file Studio accepts. */
export const brandingAssetMaxBytes = 2 * 1024 * 1024

/** A language code as in `de`, `en` or `zh-Hans`. */
const languageCode = z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/, 'use a language code such as de or en')

const hexColor = z.string().regex(hexColorPattern, 'use #RRGGBB').transform(value => value.toUpperCase())

/** A colour for the light and the dark theme; one value serves both. */
const themedColor = z.union([
  hexColor.transform(value => ({ light: value, dark: value })),
  z.strictObject({ light: hexColor, dark: hexColor }),
])
export type ThemedColor = { light: string, dark: string }

const webUrl = z.url({ protocol: /^https?$/ })
const linkUrl = z.union([webUrl, z.string().regex(/^mailto:[^\s@]+@[^\s@]+$/, 'use an http(s) URL or mailto:')])

/** Text per language, e.g. `{ de: '…', en: '…' }`. */
function localizedText (max: number) {
  return z.record(languageCode, z.string().trim().min(1).max(max)).refine(value => Object.keys(value).length > 0, 'add at least one language')
}

/** One language's legal page: an external page, or Markdown that Studio shows. */
export const legalEntrySchema = z.union([
  z.strictObject({ url: webUrl }),
  z.strictObject({ markdown: z.string().trim().min(1).max(200_000) }),
])
export type LegalEntry = z.infer<typeof legalEntrySchema>

/** A legal page per language. */
export const legalSourceSchema = z.record(languageCode, legalEntrySchema).refine(value => Object.keys(value).length > 0, 'add at least one language')
export type LegalSource = z.infer<typeof legalSourceSchema>

/**
 * The settings of one source, every field optional. Files and images are
 * not part of it: they are assets (`brandingAssetSlots`).
 */
export const brandingSettingsSchema = z.strictObject({
  productName: z.string().trim().min(1).max(80).optional(),
  /** The organisation that runs this Studio: the copyright line and About. */
  organisation: z.string().trim().min(1).max(200).optional(),
  /** Where users get help with this deployment: a page or `mailto:`. */
  supportUrl: linkUrl.optional(),
  /** The organisation's own documentation for Studio. */
  helpUrl: webUrl.optional(),
  accent: themedColor.optional(),
  secondary: themedColor.optional(),
  theme: z.enum(['system', 'light', 'dark']).optional(),
  background: z.enum(backgroundNames).optional(),
  shape: z.enum(shapes).optional(),
  /** The UI language of users who have not picked one; otherwise the browser's. */
  uiLanguage: z.enum(localeCodes).optional(),
  /** The UI languages users can pick from; all when unset. */
  languages: z.array(z.enum(localeCodes)).min(1).optional(),
  /** The default language of multi-language values. */
  valueLanguage: languageCode.optional(),
  /** Shown on the sign-in page, per language. */
  signInMessage: localizedText(1000).optional(),
  legal: z.strictObject(Object.fromEntries(legalPages.map(page => [page, legalSourceSchema.optional()])) as Record<LegalPage, z.ZodOptional<typeof legalSourceSchema>>).optional(),
  /** The user settings fixed to the deployment's value. */
  locked: z.array(z.enum(lockableSettings)).optional(),
})
export type BrandingSettings = z.infer<typeof brandingSettingsSchema>
export type BrandingField = Exclude<keyof BrandingSettings, 'legal'> | `legal.${LegalPage}` | `asset.${BrandingAssetSlot}`

/** Where a value of the effective branding came from. */
export const brandingSources = ['env', 'file', 'admin', 'default'] as const
export type BrandingSource = (typeof brandingSources)[number]

/** An asset's state, as administrators see it. */
export interface BrandingAssetInfo {
  source: BrandingSource
  /** An absolute URL, or the Studio path (under the base path) that serves it. */
  url: string | null
  contentType: string | null
  size: number | null
}

/** What GET /branding returns to administrators. */
export interface BrandingAdminView {
  /** Whether administrators may change the branding (STUDIO_BRANDING_EDITABLE). */
  editable: boolean
  /** The settings administrators made, as stored. */
  admin: BrandingSettings
  /** Every setting in effect, from whichever source. */
  effective: BrandingSettings
  /** The source of each field in effect; fields absent here have Studio's default. */
  sources: Partial<Record<BrandingField, BrandingSource>>
  /** Locks the deployment sets; administrators cannot lift them. */
  fixedLocks: LockableSetting[]
  assets: Record<BrandingAssetSlot, BrandingAssetInfo>
  /** Notes on colours that Studio shows in a readable shade instead. */
  notes: string[]
  updatedAt: string | null
  updatedBy: string | null
}

/**
 * Picks a language's text: the language, its base language (`de` for
 * `de-saar`), then `fallback`, English, and else any.
 */
export function pickLocalized<T> (values: Record<string, T> | null | undefined, language: string, fallback?: string | null): T | null {
  if (!values) {
    return null
  }
  const base = language.split('-', 1)[0]!
  for (const key of [language, base, fallback, fallback?.split('-', 1)[0], 'en']) {
    if (key && key in values) {
      return values[key]!
    }
  }
  return Object.values(values)[0] ?? null
}

/**
 * Notes for colours that are not readable as given: Studio uses a darker or
 * lighter shade of them (readableShade), so text in the colour reaches 4.5:1
 * (WCAG AA).
 */
export function colorAdjustments (settings: Pick<BrandingSettings, 'accent' | 'secondary'>) {
  const notes: Array<{ name: 'accent' | 'secondary', mode: 'light' | 'dark', color: string, shade: string }> = []
  for (const name of ['accent', 'secondary'] as const) {
    const color = settings[name]
    if (!color) {
      continue
    }
    for (const mode of ['light', 'dark'] as const) {
      const shade = readableShade(color[mode], mode === 'dark')
      if (shade !== color[mode]) {
        notes.push({ name, mode, color: color[mode], shade })
      }
    }
  }
  return notes
}

/** English notes for deployment logs and API clients. */
export function colorNotes (settings: Pick<BrandingSettings, 'accent' | 'secondary'>): string[] {
  return colorAdjustments(settings).map(({ name, mode, color, shade }) => `The ${name} colour ${color} is below 4.5:1 contrast in the ${mode} theme; Studio uses ${shade} instead.`)
}
