import type { BrandingAdminView, BrandingAssetSlot, BrandingField, BrandingSettings, BrandingSource, LegalPage, LegalSource, LockableSetting } from '#shared/branding'
import type { Preferences, StudioContext } from '#shared/contract'
import type { BrandingConfig } from '../config'
import type { StudioDeps } from '../deps'
import type { BrandingAsset, BrandingLayer } from './file'
import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { brandingAssetMaxBytes, brandingAssetSlots, brandingAssetTypes, brandingSettingsSchema, colorNotes, legalPages, lockableSettings, pickLocalized } from '#shared/branding'
import { brandingAssets, brandingSettings } from '../../database/schema'
import { StudioProblem } from '../problem'

const rowId = 'deployment'
// Exports may reference operator-configured external logos and favicons.
const assetUrlContentType = 'text/uri-list'

/** Uploaded files are represented by metadata until a consumer asks for their bytes. */
type AssetMetadata = { contentType: string, size: number, version: string }
type Asset = BrandingAsset | AssetMetadata

/** An asset in effect, with a version that changes with its content, for caching. */
interface ResolvedAsset<T extends Asset> {
  asset: T
  source: BrandingSource
  version: string
}

/** The branding in effect: every source merged, each value from the first that has it. */
export interface ResolvedBranding<T extends Asset = Asset> {
  settings: BrandingSettings
  sources: Partial<Record<BrandingField, BrandingSource>>
  assets: Partial<Record<BrandingAssetSlot, ResolvedAsset<T>>>
  /** Locks of the deployment (branding file), which administrators cannot lift. */
  fixedLocks: LockableSetting[]
  /** Whether anything differs from BaSyx Studio's own look. */
  customized: boolean
}

/** What administrators stored, with who did it last. */
interface AdminBranding extends BrandingLayer<AssetMetadata | { url: string }> {
  updatedAt: Date | null
  updatedBy: string | null
}

const settingKeys = Object.keys(brandingSettingsSchema.shape).filter(key => key !== 'legal' && key !== 'locked') as Array<Exclude<keyof BrandingSettings, 'legal' | 'locked'>>

function versionOf (asset: Asset): string {
  if ('version' in asset) {
    return asset.version
  }
  const hash = createHash('sha256')
  hash.update('url' in asset ? asset.url : asset.bytes)
  return hash.digest('hex').slice(0, 12)
}

/**
 * Merges the sources, highest first (ADR 0055). A fixed lock also protects
 * the value behind it, even when the file leaves that value at its default.
 */
export function mergeBranding<T extends Asset> (layers: Array<{ source: BrandingSource, layer: BrandingLayer<T> | null }>, managed = false): ResolvedBranding<T> {
  const settings: BrandingSettings = {}
  const sources: ResolvedBranding['sources'] = {}
  const present = layers.filter((entry): entry is { source: BrandingSource, layer: BrandingLayer<T> } => entry.layer !== null)
  const fixedLocks = lockableSettings.filter(name => present.some(entry => entry.source !== 'admin' && entry.layer.settings.locked?.includes(name)))
  for (const key of settingKeys) {
    const lock = fixedLocks.find(name => name === key || (name === 'uiLanguage' && key === 'languages'))
    const from = present.find(({ source, layer }) => layer.settings[key] !== undefined
      && (!lock || (managed ? source === 'file' : source !== 'admin')))
    if (from) {
      (settings as Record<string, unknown>)[key] = from.layer.settings[key]
      sources[key] = from.source
    } else if (lock) {
      sources[key] = present.find(entry => entry.source !== 'admin' && entry.layer.settings.locked?.includes(lock))?.source
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
  const assets: ResolvedBranding<T>['assets'] = {}
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
async function loadAdminBranding (deps: Pick<StudioDeps, 'db'>): Promise<AdminBranding> {
  const [row] = await deps.db.select().from(brandingSettings).where(eq(brandingSettings.id, rowId))
  const assetRows = await deps.db.select({
    slot: brandingAssets.slot,
    contentType: brandingAssets.contentType,
    url: brandingAssets.url,
    size: brandingAssets.size,
    version: brandingAssets.version,
    updatedAt: brandingAssets.updatedAt,
    updatedBy: brandingAssets.updatedBy,
  }).from(brandingAssets)
  // Stored settings that no longer validate (an older or newer Studio) are ignored as a whole.
  const parsed = brandingSettingsSchema.safeParse(row?.settings ?? {})
  const assets: AdminBranding['assets'] = {}
  for (const asset of assetRows) {
    if ((brandingAssetSlots as readonly string[]).includes(asset.slot)) {
      assets[asset.slot] = asset.url === null
        ? { contentType: asset.contentType, size: asset.size, version: asset.version }
        : { url: asset.url }
    }
  }
  const times = [row?.updatedAt, ...assetRows.map(asset => asset.updatedAt)].filter((time): time is Date => time instanceof Date)
  const latest = times.toSorted((a, b) => b.getTime() - a.getTime())[0] ?? null
  const updatedBy = latest
    ? (row?.updatedAt?.getTime() === latest.getTime() ? row.updatedBy : assetRows.find(asset => asset.updatedAt.getTime() === latest.getTime())?.updatedBy) ?? null
    : null
  return { settings: parsed.success ? parsed.data : {}, assets, updatedAt: latest, updatedBy }
}

function mergeDeploymentBranding (branding: BrandingConfig, admin: AdminBranding | null): ResolvedBranding {
  const env = { source: 'env', layer: branding.env } as const
  const file = { source: 'file', layer: branding.file } as const
  return mergeBranding<Asset>([
    ...(branding.managed ? [file, env] : [env, file]),
    { source: 'admin', layer: admin },
  ], branding.managed)
}

/** The effective branding, with uploaded assets represented by metadata. */
export async function resolveBranding (deps: Pick<StudioDeps, 'db' | 'config'>): Promise<ResolvedBranding> {
  const { branding } = deps.config
  const admin = branding.editable ? await loadAdminBranding(deps) : null
  return mergeDeploymentBranding(branding, admin)
}

async function readAssetBytes (deps: Pick<StudioDeps, 'db'>, slot: BrandingAssetSlot, entry: ResolvedAsset<Asset>): Promise<Extract<BrandingAsset, { bytes: Uint8Array }> | null> {
  const { asset, version } = entry
  if ('url' in asset) {
    return null
  }
  if ('bytes' in asset) {
    return asset
  }
  // Keep the bytes and version together if an upload replaces the file meanwhile.
  const [row] = await deps.db
    .select({ content: brandingAssets.content, contentType: brandingAssets.contentType })
    .from(brandingAssets)
    .where(and(eq(brandingAssets.slot, slot), eq(brandingAssets.version, version), eq(brandingAssets.contentType, asset.contentType)))
  return row ? { bytes: row.content, contentType: row.contentType } : null
}

/** Loads just the file being served. */
export async function readBrandingAsset (deps: Pick<StudioDeps, 'db' | 'config'>, slot: BrandingAssetSlot, version?: string) {
  const entry = (await resolveBranding(deps)).assets[slot]
  if (!entry || (version !== undefined && version !== entry.version)) {
    return null
  }
  const asset = await readAssetBytes(deps, slot, entry)
  return asset ? { ...asset, version: entry.version } : null
}

/** Includes the bytes of all effective files for an export. */
export async function resolveBrandingForExport (deps: Pick<StudioDeps, 'db' | 'config'>): Promise<ResolvedBranding<BrandingAsset>> {
  const resolved = await resolveBranding(deps)
  const assets: ResolvedBranding<BrandingAsset>['assets'] = {}
  await Promise.all(brandingAssetSlots.map(async slot => {
    const entry = resolved.assets[slot]
    if (entry) {
      const asset = 'url' in entry.asset ? entry.asset : await readAssetBytes(deps, slot, entry)
      if (!asset) {
        throw new StudioProblem('revision_conflict', 'A branding file changed while preparing the export. Run the export again.')
      }
      assets[slot] = { ...entry, asset }
    }
  }))
  return { ...resolved, assets }
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
    .onConflictDoUpdate({ target: brandingAssets.slot, set: { contentType, content: bytes, url: null, updatedBy: subject, updatedAt: new Date() } })
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
        ? { contentType: assetUrlContentType, content: new TextEncoder().encode(asset.url), url: asset.url }
        : { contentType: asset.contentType, content: asset.bytes }
      await tx.insert(brandingAssets).values({ slot, ...file, updatedBy: subject })
    }
    await tx.insert(brandingSettings)
      .values({ id: rowId, settings: layer.settings, updatedBy: subject })
      .onConflictDoUpdate({ target: brandingSettings.id, set: { settings: layer.settings, updatedBy: subject, updatedAt: new Date() } })
  })
}

/** The Studio path of an asset, versioned so browsers fetch a replaced one; a web asset as is. */
function assetUrl (slot: BrandingAssetSlot, resolved: ResolvedAsset<Asset> | undefined): string | null {
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
  const legacyUrl = (page: 'imprint' | 'privacy'): string | null => {
    const entry = pickLocalized(settings.legal?.[page], settings.uiLanguage ?? 'en')
    return entry && 'url' in entry ? entry.url : null
  }
  const revision = createHash('sha256').update(JSON.stringify([settings, brandingAssetSlots.map(slot => assets[slot]?.version)])).digest('hex')
  return {
    productName: settings.productName ?? null,
    branding: {
      revision,
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
      legalNoticeUrl: legacyUrl('imprint'),
      privacyPolicyUrl: legacyUrl('privacy'),
      pages: Object.fromEntries(legalPages.map(page => [page, legalLinks(page, settings.legal?.[page])])) as Record<LegalPage, Record<string, string> | null>,
    },
  }
}

/** Everything administrators see on the Branding page. */
export async function brandingAdminView (deps: Pick<StudioDeps, 'db' | 'config'>): Promise<BrandingAdminView> {
  const admin = await loadAdminBranding(deps)
  const { branding } = deps.config
  const resolved = mergeDeploymentBranding(branding, branding.editable ? admin : null)
  const assets = Object.fromEntries(brandingAssetSlots.map(slot => {
    const entry = resolved.assets[slot]
    return [slot, {
      source: entry?.source ?? 'default',
      url: assetUrl(slot, entry),
      contentType: entry && 'contentType' in entry.asset ? entry.asset.contentType : null,
      size: entry && 'contentType' in entry.asset
        ? ('bytes' in entry.asset ? entry.asset.bytes.byteLength : entry.asset.size)
        : null,
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
