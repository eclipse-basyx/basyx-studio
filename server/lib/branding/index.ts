import type { BrandingAdminView, BrandingAssetSlot, BrandingField, BrandingSettings, BrandingSource, LegalPage, LegalSource, LockableSetting } from '#shared/branding'
import type { Preferences, StudioContext } from '#shared/contract'
import type { StudioDeps } from '../deps'
import type { BrandingAsset, BrandingLayer } from './file'
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { brandingAssetMaxBytes, brandingAssetSlots, brandingAssetTypes, brandingSettingsSchema, colorNotes, legalPages, lockableSettings } from '#shared/branding'
import { brandingAssets, brandingSettings } from '../../database/schema'
import { StudioProblem } from '../problem'

const rowId = 'deployment'
// Exports may reference operator-configured external logos and favicons.
const assetUrlContentType = 'text/uri-list'

/** An asset in effect, with a version that changes with its content, for caching. */
export interface ResolvedAsset {
  asset: BrandingAsset
  source: BrandingSource
  version: string
}

/** The branding in effect: every source merged, each value from the first that has it. */
export interface ResolvedBranding {
  settings: BrandingSettings
  sources: Partial<Record<BrandingField, BrandingSource>>
  assets: Partial<Record<BrandingAssetSlot, ResolvedAsset>>
  /** Locks of the deployment (branding file), which administrators cannot lift. */
  fixedLocks: LockableSetting[]
  /** Whether anything differs from BaSyx Studio's own look. */
  customized: boolean
}

/** What administrators stored, with who did it last. */
export interface AdminBranding extends BrandingLayer {
  updatedAt: Date | null
  updatedBy: string | null
}

const settingKeys = Object.keys(brandingSettingsSchema.shape).filter(key => key !== 'legal' && key !== 'locked') as Array<Exclude<keyof BrandingSettings, 'legal' | 'locked'>>

function versionOf (asset: BrandingAsset): string {
  const hash = createHash('sha256')
  hash.update('url' in asset ? asset.url : asset.bytes)
  return hash.digest('hex').slice(0, 12)
}

/**
 * Merges the sources, highest first: environment, branding file,
 * administrators (ADR 0055). Legal pages merge per page and assets per slot;
 * locks add up.
 */
export function mergeBranding (layers: Array<{ source: BrandingSource, layer: BrandingLayer | null }>): ResolvedBranding {
  const settings: BrandingSettings = {}
  const sources: ResolvedBranding['sources'] = {}
  const present = layers.filter((entry): entry is { source: BrandingSource, layer: BrandingLayer } => entry.layer !== null)
  for (const key of settingKeys) {
    const from = present.find(entry => entry.layer.settings[key] !== undefined)
    if (from) {
      (settings as Record<string, unknown>)[key] = from.layer.settings[key]
      sources[key] = from.source
    }
  }
  const legal: Partial<Record<LegalPage, LegalSource>> = {}
  for (const page of legalPages) {
    const from = present.find(entry => entry.layer.settings.legal?.[page] !== undefined)
    if (from) {
      legal[page] = from.layer.settings.legal![page]!
      sources[`legal.${page}`] = from.source
    }
  }
  if (Object.keys(legal).length > 0) {
    settings.legal = legal
  }
  const locked = lockableSettings.filter(name => present.some(entry => entry.layer.settings.locked?.includes(name)))
  if (locked.length > 0) {
    settings.locked = locked
    sources.locked = present.find(entry => entry.layer.settings.locked?.length)?.source
  }
  const fixedLocks = lockableSettings.filter(name => present.some(entry => entry.source !== 'admin' && entry.layer.settings.locked?.includes(name)))
  const assets: ResolvedBranding['assets'] = {}
  for (const slot of brandingAssetSlots) {
    const from = present.find(entry => entry.layer.assets[slot] !== undefined)
    if (from) {
      const asset = from.layer.assets[slot]!
      assets[slot] = { asset, source: from.source, version: versionOf(asset) }
      sources[`asset.${slot}`] = from.source
    }
  }
  return { settings, sources, assets, fixedLocks, customized: Object.keys(sources).length > 0 }
}

/** The administrators' branding; empty when there is none. */
export async function loadAdminBranding (deps: Pick<StudioDeps, 'db'>): Promise<AdminBranding> {
  const [row] = await deps.db.select().from(brandingSettings).where(eq(brandingSettings.id, rowId))
  const assetRows = await deps.db.select().from(brandingAssets)
  // Stored settings that no longer validate (an older or newer Studio) are ignored as a whole.
  const parsed = brandingSettingsSchema.safeParse(row?.settings ?? {})
  const assets: BrandingLayer['assets'] = {}
  for (const asset of assetRows) {
    if ((brandingAssetSlots as readonly string[]).includes(asset.slot)) {
      assets[asset.slot] = asset.contentType === assetUrlContentType
        ? { url: new TextDecoder().decode(asset.content) }
        : { bytes: asset.content, contentType: asset.contentType }
    }
  }
  const times = [row?.updatedAt, ...assetRows.map(asset => asset.updatedAt)].filter((time): time is Date => time instanceof Date)
  const latest = times.toSorted((a, b) => b.getTime() - a.getTime())[0] ?? null
  const updatedBy = latest
    ? (row?.updatedAt?.getTime() === latest.getTime() ? row.updatedBy : assetRows.find(asset => asset.updatedAt.getTime() === latest.getTime())?.updatedBy) ?? null
    : null
  return { settings: parsed.success ? parsed.data : {}, assets, updatedAt: latest, updatedBy }
}

/** The branding in effect: environment, file and, where administrators may change it, theirs. */
export async function resolveBranding (deps: Pick<StudioDeps, 'db' | 'config'>): Promise<ResolvedBranding> {
  const { branding } = deps.config
  const admin = branding.editable ? await loadAdminBranding(deps) : null
  return mergeBranding([
    { source: 'env', layer: branding.env },
    { source: 'file', layer: branding.file },
    { source: 'admin', layer: admin },
  ])
}

function invalidBranding (issues: Array<{ path: PropertyKey[], message: string }>): StudioProblem {
  return new StudioProblem('invalid_request', 'The branding is invalid.', {
    violations: issues.map(issue => ({ path: issue.path.map(String).join('.'), message: issue.message })),
  })
}

function requireEditable (deps: Pick<StudioDeps, 'config'>): void {
  if (!deps.config.branding.editable) {
    throw new StudioProblem('forbidden', 'This deployment sets its branding; it cannot be changed in Studio (STUDIO_BRANDING_EDITABLE).')
  }
}

/** Replaces the administrators' settings. */
export async function saveAdminSettings (deps: Pick<StudioDeps, 'db' | 'config'>, raw: unknown, subject: string): Promise<BrandingSettings> {
  requireEditable(deps)
  const parsed = brandingSettingsSchema.safeParse(raw)
  if (!parsed.success) {
    throw invalidBranding(parsed.error.issues)
  }
  const settings = parsed.data
  await deps.db.insert(brandingSettings)
    .values({ id: rowId, settings, updatedBy: subject })
    .onConflictDoUpdate({ target: brandingSettings.id, set: { settings, updatedBy: subject, updatedAt: new Date() } })
  return settings
}

/** The content type of an uploaded file for a slot, from its declared type; `null` if the slot does not take it. */
export function assetContentType (slot: BrandingAssetSlot, declared: string | undefined): string | null {
  const type = (declared ?? '').split(';', 1)[0]!.trim().toLowerCase()
  const allowed = new Set(Object.values(brandingAssetTypes[slot]))
  // Browsers send .ico files under two names.
  const normalized = type === 'image/vnd.microsoft.icon' ? 'image/x-icon' : type
  return allowed.has(normalized) ? normalized : null
}

/** Stores an uploaded logo, favicon or font. */
export async function saveAdminAsset (deps: Pick<StudioDeps, 'db' | 'config'>, slot: BrandingAssetSlot, bytes: Uint8Array, declaredType: string | undefined, subject: string): Promise<void> {
  requireEditable(deps)
  const contentType = assetContentType(slot, declaredType)
  if (!contentType) {
    throw new StudioProblem('invalid_request', `The ${slot} must be one of ${[...new Set(Object.values(brandingAssetTypes[slot]))].join(', ')}.`)
  }
  if (bytes.byteLength === 0 || bytes.byteLength > brandingAssetMaxBytes) {
    throw new StudioProblem('invalid_request', `The file must be between 1 byte and ${brandingAssetMaxBytes / 1024 / 1024} MB.`)
  }
  await deps.db.insert(brandingAssets)
    .values({ slot, contentType, content: bytes, updatedBy: subject })
    .onConflictDoUpdate({ target: brandingAssets.slot, set: { contentType, content: bytes, updatedBy: subject, updatedAt: new Date() } })
}

/** Removes an uploaded file; the next source's, or BaSyx's, applies again. */
export async function deleteAdminAsset (deps: Pick<StudioDeps, 'db' | 'config'>, slot: BrandingAssetSlot): Promise<void> {
  requireEditable(deps)
  await deps.db.delete(brandingAssets).where(eq(brandingAssets.slot, slot))
}

/** Replaces everything administrators set with an imported branding (ADR 0055). */
export async function replaceAdminBranding (deps: Pick<StudioDeps, 'db' | 'config'>, layer: BrandingLayer, subject: string): Promise<void> {
  requireEditable(deps)
  await deps.db.transaction(async tx => {
    await tx.delete(brandingAssets)
    for (const [slot, asset] of Object.entries(layer.assets) as Array<[BrandingAssetSlot, BrandingAsset]>) {
      const file = 'url' in asset
        ? { contentType: assetUrlContentType, content: new TextEncoder().encode(asset.url) }
        : { contentType: asset.contentType, content: asset.bytes }
      await tx.insert(brandingAssets).values({ slot, ...file, updatedBy: subject })
    }
    await tx.insert(brandingSettings)
      .values({ id: rowId, settings: layer.settings, updatedBy: subject })
      .onConflictDoUpdate({ target: brandingSettings.id, set: { settings: layer.settings, updatedBy: subject, updatedAt: new Date() } })
  })
}

/** The Studio path of an asset, versioned so browsers fetch a replaced one; a web asset as is. */
function assetUrl (slot: BrandingAssetSlot, resolved: ResolvedAsset | undefined): string | null {
  if (!resolved) {
    return null
  }
  return 'url' in resolved.asset ? resolved.asset.url : `/branding/${slot}?v=${resolved.version}`
}

/** A legal page per language: its external URL, or the Studio page that shows its Markdown. */
function legalLinks (page: LegalPage, source: LegalSource | undefined): Record<string, string> | null {
  if (!source) {
    return null
  }
  return Object.fromEntries(Object.entries(source).map(([language, entry]) => [language, 'url' in entry ? entry.url : `/legal/${page}`]))
}

/** The branding as the client gets it with the context (public: the sign-in page needs it). */
export function brandingContext (resolved: ResolvedBranding): Pick<StudioContext, 'branding' | 'legal'> & { productName: string | null } {
  const { settings, assets } = resolved
  return {
    productName: settings.productName ?? null,
    branding: {
      customized: resolved.customized,
      organisation: settings.organisation ?? null,
      supportUrl: settings.supportUrl ?? null,
      helpUrl: settings.helpUrl ?? null,
      logoLight: assetUrl('logo-light', assets['logo-light']),
      logoDark: assetUrl('logo-dark', assets['logo-dark']),
      logoCompact: assetUrl('logo-compact', assets['logo-compact']),
      favicon: assetUrl('favicon', assets.favicon),
      font: assetUrl('font', assets.font),
      accentLight: settings.accent?.light ?? null,
      accentDark: settings.accent?.dark ?? null,
      secondaryLight: settings.secondary?.light ?? null,
      secondaryDark: settings.secondary?.dark ?? null,
      theme: settings.theme ?? null,
      background: settings.background ?? null,
      shape: settings.shape ?? null,
      uiLanguage: settings.uiLanguage ?? null,
      languages: settings.languages ?? null,
      valueLanguage: settings.valueLanguage ?? null,
      signInMessage: settings.signInMessage ?? null,
      locked: settings.locked ?? [],
    },
    legal: {
      copyrightName: settings.organisation ?? null,
      pages: Object.fromEntries(legalPages.map(page => [page, legalLinks(page, settings.legal?.[page])])) as Record<LegalPage, Record<string, string> | null>,
    },
  }
}

/** Everything administrators see on the Branding page. */
export async function brandingAdminView (deps: Pick<StudioDeps, 'db' | 'config'>): Promise<BrandingAdminView> {
  const admin = await loadAdminBranding(deps)
  const resolved = await resolveBranding(deps)
  const assets = Object.fromEntries(brandingAssetSlots.map(slot => {
    const entry = resolved.assets[slot]
    return [slot, {
      source: entry?.source ?? 'default',
      url: assetUrl(slot, entry),
      contentType: entry && 'bytes' in entry.asset ? entry.asset.contentType : null,
      size: entry && 'bytes' in entry.asset ? entry.asset.bytes.byteLength : null,
    }]
  })) as BrandingAdminView['assets']
  return {
    editable: deps.config.branding.editable,
    admin: admin.settings,
    effective: resolved.settings,
    sources: resolved.sources,
    fixedLocks: resolved.fixedLocks,
    assets,
    notes: colorNotes(resolved.settings),
    updatedAt: admin.updatedAt?.toISOString() ?? null,
    updatedBy: admin.updatedBy,
  }
}

/** The values a deployment gives preferences: defaults for users who keep them, and the locked ones. */
export interface PreferencePolicy {
  defaults: Partial<Pick<Preferences, LockableSetting>>
  locked: LockableSetting[]
  /** The UI languages users may pick; all when `null`. */
  languages: string[] | null
}

/** The preference policy of a branding. */
export function preferencePolicy (settings: BrandingSettings): PreferencePolicy {
  const defaults: PreferencePolicy['defaults'] = {}
  if (settings.theme) {
    defaults.theme = settings.theme
  }
  if (settings.background) {
    defaults.background = settings.background
  }
  if (settings.shape) {
    defaults.shape = settings.shape
  }
  if (settings.uiLanguage) {
    defaults.uiLanguage = settings.uiLanguage
  }
  if (settings.valueLanguage) {
    defaults.valueLanguage = settings.valueLanguage
  }
  // The accent's default is `basyx`, which stands for the deployment's accent.
  defaults.accent = 'basyx'
  return { defaults, locked: settings.locked ?? [], languages: settings.languages ?? null }
}

/** Warnings about the branding at startup. */
export function brandingWarnings (deps: Pick<StudioDeps, 'config'>, resolved: ResolvedBranding): string[] {
  const warnings = colorNotes(resolved.settings)
  if (deps.config.deploymentMode === 'hosted') {
    const missing = (['imprint', 'privacy'] as const).filter(page => !resolved.settings.legal?.[page])
    if (missing.length > 0) {
      warnings.push(`No ${missing.join(' or ')} page is configured. Deployments in the EU usually need both (see docs/deployment/branding.md).`)
    }
  }
  return warnings
}
