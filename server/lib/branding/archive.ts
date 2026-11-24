import type { BrandingAssetSlot } from '#shared/branding'
import type { BrandingAsset, BrandingLayer } from './file'
import type { ResolvedBranding } from './index'
import { posix } from 'node:path'
import { unzipSync, zipSync } from 'fflate'
import { stringify } from 'yaml'
import { brandingAssetMaxBytes, brandingAssetTypes, legalPages } from '#shared/branding'
import { BrandingFileError, parseBrandingFile } from './file'

/** The branding file's name inside an archive. */
export const brandingArchiveFile = 'branding.yml'

const archiveLimits = { maxEntries: 100, maxBytes: 20 * 1024 * 1024 }

function extensionOf (slot: BrandingAssetSlot, contentType: string): string {
  return Object.entries(brandingAssetTypes[slot]).find(([, type]) => type === contentType)?.[0] ?? ''
}

/**
 * The branding in effect as an archive: `branding.yml` in the file format
 * (ADR 0055) with its files beside it, to roll out with
 * STUDIO_BRANDING_FILE or to import into another Studio.
 */
export function exportBrandingArchive (resolved: ResolvedBranding<BrandingAsset>): Uint8Array {
  const files: Record<string, Uint8Array> = {}
  const encoder = new TextEncoder()
  const { settings, assets } = resolved

  const assetPath = (slot: BrandingAssetSlot): string | undefined => {
    const entry = assets[slot]
    if (!entry) {
      return undefined
    }
    if ('url' in entry.asset) {
      return entry.asset.url
    }
    const path = `assets/${slot}${extensionOf(slot, entry.asset.contentType)}`
    files[path] = entry.asset.bytes
    return path
  }

  const legal: Record<string, Record<string, string>> = {}
  for (const page of legalPages) {
    const source = settings.legal?.[page]
    if (!source) {
      continue
    }
    legal[page] = Object.fromEntries(Object.entries(source).map(([language, entry]) => {
      if ('url' in entry) {
        return [language, entry.url]
      }
      const path = `legal/${page}.${language}.md`
      files[path] = encoder.encode(entry.markdown)
      return [language, path]
    }))
  }

  const logo = Object.fromEntries(Object.entries({ light: assetPath('logo-light'), dark: assetPath('logo-dark'), compact: assetPath('logo-compact') }).filter(([, value]) => value))
  const appearance = Object.fromEntries(Object.entries({ theme: settings.theme, accent: settings.accent, secondary: settings.secondary, background: settings.background, shape: settings.shape }).filter(([, value]) => value !== undefined))
  const languages = Object.fromEntries(Object.entries({ default: settings.uiLanguage, available: settings.languages, values: settings.valueLanguage }).filter(([, value]) => value !== undefined))
  const document = Object.fromEntries(Object.entries({
    version: 1,
    productName: settings.productName,
    organisation: settings.organisation,
    supportUrl: settings.supportUrl,
    helpUrl: settings.helpUrl,
    logo: Object.keys(logo).length > 0 ? logo : undefined,
    favicon: assetPath('favicon'),
    font: assetPath('font'),
    appearance: Object.keys(appearance).length > 0 ? appearance : undefined,
    languages: Object.keys(languages).length > 0 ? languages : undefined,
    signInMessage: settings.signInMessage,
    legal: Object.keys(legal).length > 0 ? legal : undefined,
    locked: settings.locked,
  }).filter(([, value]) => value !== undefined))
  files[brandingArchiveFile] = encoder.encode(`# BaSyx Studio branding (docs/deployment/branding.md)\n${stringify(document)}`)
  return zipSync(files, { level: 6 })
}

/** Reads an archive made by `exportBrandingArchive`, or by hand: `branding.yml` at its root or in one folder. */
export function importBrandingArchive (archive: Uint8Array): BrandingLayer {
  let entries: Record<string, Uint8Array>
  let count = 0
  let total = 0
  try {
    entries = unzipSync(archive, {
      filter: file => {
        count += 1
        total += file.originalSize
        if (count > archiveLimits.maxEntries || total > archiveLimits.maxBytes || file.originalSize > brandingAssetMaxBytes * 2) {
          throw new BrandingFileError('The archive has too many or too large files.')
        }
        return !file.name.endsWith('/')
      },
    })
  } catch (error) {
    if (error instanceof BrandingFileError) {
      throw error
    }
    throw new BrandingFileError('The file is not a ZIP archive.')
  }
  const main = Object.keys(entries).filter(name => posix.basename(name) === brandingArchiveFile).toSorted((a, b) => a.length - b.length)[0]
  if (!main) {
    throw new BrandingFileError(`The archive has no ${brandingArchiveFile}.`)
  }
  const root = posix.dirname(main)
  return parseBrandingFile(new TextDecoder().decode(entries[main]), path => {
    const full = posix.normalize(posix.join(root, path))
    const bytes = full.startsWith('../') || posix.isAbsolute(path) ? undefined : entries[full]
    if (!bytes) {
      throw new BrandingFileError(`${path} is not in the archive.`)
    }
    return bytes
  })
}
