import type { BrandingAssetSlot, BrandingSettings, LegalEntry, LegalPage, LegalSource } from '#shared/branding'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, isAbsolute, join, resolve } from 'node:path'
import { parse } from 'yaml'
import { z } from 'zod'
import { brandingAssetMaxBytes, brandingAssetTypes, brandingSettingsSchema, legalPages } from '#shared/branding'

/**
 * A brand file: an image or font on the web (logos and favicon only), or
 * the bytes of a file, served by Studio at `<base>/branding/<slot>`.
 */
export type BrandingAsset = { url: string } | { bytes: Uint8Array, contentType: string }

/** A branding file's settings and files (ADR 0055). */
export interface BrandingLayer<Asset = BrandingAsset> {
  settings: BrandingSettings
  assets: Partial<Record<BrandingAssetSlot, Asset>>
}

export class BrandingFileError extends Error {}

/** Reads a file the branding file names, relative to it; throws if it is missing. */
export type BrandingFileReader = (path: string) => Uint8Array

const text = z.string().min(1)
const legalFileSource = z.union([text, z.record(z.string(), text)])

/**
 * The branding file as written: grouped for people (logo, appearance,
 * languages), with paths to files where the settings hold their contents.
 */
const brandingFileSchema = z.strictObject({
  version: z.literal(1),
  productName: z.unknown().optional(),
  organisation: z.unknown().optional(),
  supportUrl: z.unknown().optional(),
  helpUrl: z.unknown().optional(),
  logo: z.union([text, z.strictObject({ light: text.optional(), dark: text.optional(), compact: text.optional() })]).optional(),
  favicon: text.optional(),
  font: text.optional(),
  appearance: z.strictObject({
    theme: z.unknown().optional(),
    accent: z.unknown().optional(),
    secondary: z.unknown().optional(),
    background: z.unknown().optional(),
    shape: z.unknown().optional(),
  }).optional(),
  languages: z.strictObject({
    default: z.unknown().optional(),
    available: z.unknown().optional(),
    values: z.unknown().optional(),
  }).optional(),
  signInMessage: z.unknown().optional(),
  legal: z.strictObject(Object.fromEntries(legalPages.map(page => [page, legalFileSource.optional()]))).optional(),
  locked: z.unknown().optional(),
})

/** Where each setting is written in the file, for error messages. */
const filePaths: Partial<Record<keyof BrandingSettings, string>> = {
  accent: 'appearance.accent',
  secondary: 'appearance.secondary',
  theme: 'appearance.theme',
  background: 'appearance.background',
  shape: 'appearance.shape',
  uiLanguage: 'languages.default',
  languages: 'languages.available',
  valueLanguage: 'languages.values',
}

const isUrl = (value: string) => /^https?:\/\//i.test(value)

function issuesOf (error: z.ZodError, rename = true, prefix: string[] = []): string {
  return error.issues.map(issue => {
    const [first, ...rest] = issue.path.map(String)
    const head = rename ? (filePaths[first as keyof BrandingSettings] ?? first) : first
    return `${[...prefix, head, ...rest].filter(Boolean).join('.') || '(file)'}: ${issue.message}`
  }).join('; ')
}

/** A brand file from a path or URL in the file, checked against the slot's types and size. */
function assetOf (slot: BrandingAssetSlot, value: string, read: BrandingFileReader, field: string): BrandingAsset {
  if (isUrl(value)) {
    if (slot === 'font') {
      // A font from another host would tell it about every page view.
      throw new BrandingFileError(`${field}: use a woff2 file next to the branding file, not a URL.`)
    }
    return { url: new URL(value).href }
  }
  const contentType = brandingAssetTypes[slot][extname(value).toLowerCase()]
  if (!contentType) {
    throw new BrandingFileError(`${field}: ${value} must be one of ${Object.keys(brandingAssetTypes[slot]).join(', ')}.`)
  }
  const bytes = read(value)
  if (bytes.byteLength > brandingAssetMaxBytes) {
    throw new BrandingFileError(`${field}: ${value} is larger than ${brandingAssetMaxBytes / 1024 / 1024} MB.`)
  }
  return { bytes, contentType }
}

/** A legal page: a URL, or Markdown files, for all languages or per language. */
function legalOf (value: string | Record<string, string>, read: BrandingFileReader, field: string, fallbackLanguage: string): LegalSource {
  const entry = (item: string, path: string): LegalEntry => {
    if (isUrl(item)) {
      return { url: item }
    }
    if (!/\.(?:md|markdown|txt)$/i.test(item)) {
      throw new BrandingFileError(`${path}: use an http(s) URL or a Markdown (.md) file, got ${item}.`)
    }
    return { markdown: new TextDecoder().decode(read(item)) }
  }
  if (typeof value === 'string') {
    return { [fallbackLanguage]: entry(value, field) }
  }
  return Object.fromEntries(Object.entries(value).map(([language, item]) => [language, entry(item, `${field}.${language}`)]))
}

/**
 * Parses a branding file (YAML, ADR 0055). Paths in it are relative to the
 * file; `read` loads them, from disk or from an imported archive.
 */
export function parseBrandingFile (source: string, read: BrandingFileReader): BrandingLayer {
  let raw: unknown
  try {
    raw = parse(source)
  } catch (error) {
    throw new BrandingFileError(`not valid YAML: ${(error as Error).message}`)
  }
  const parsed = brandingFileSchema.safeParse(raw)
  if (!parsed.success) {
    throw new BrandingFileError(issuesOf(parsed.error, false))
  }
  const file = parsed.data

  const candidate = Object.fromEntries(Object.entries({
    productName: file.productName,
    organisation: file.organisation,
    supportUrl: file.supportUrl,
    helpUrl: file.helpUrl,
    ...file.appearance,
    uiLanguage: file.languages?.default,
    languages: file.languages?.available,
    valueLanguage: file.languages?.values,
    signInMessage: file.signInMessage,
    locked: file.locked,
  }).filter(([, value]) => value !== undefined))
  const settings = brandingSettingsSchema.safeParse(candidate)
  if (!settings.success) {
    throw new BrandingFileError(issuesOf(settings.error))
  }
  const result: BrandingSettings = settings.data

  const fallbackLanguage = result.uiLanguage ?? 'en'
  const legal: Partial<Record<LegalPage, LegalSource>> = {}
  for (const page of legalPages) {
    const value = file.legal?.[page]
    if (value !== undefined) {
      legal[page] = legalOf(value, read, `legal.${page}`, fallbackLanguage)
    }
  }
  if (Object.keys(legal).length > 0) {
    const checked = brandingSettingsSchema.shape.legal.safeParse(legal)
    if (!checked.success) {
      throw new BrandingFileError(issuesOf(checked.error, false, ['legal']))
    }
    result.legal = checked.data
  }

  const assets: BrandingLayer['assets'] = {}
  const logo = typeof file.logo === 'string' ? { light: file.logo, dark: file.logo } : file.logo
  for (const [slot, value, field] of [
    ['logo-light', logo?.light, 'logo.light'],
    ['logo-dark', logo?.dark, 'logo.dark'],
    ['logo-compact', logo?.compact, 'logo.compact'],
    ['favicon', file.favicon, 'favicon'],
    ['font', file.font, 'font'],
  ] as const) {
    if (value) {
      assets[slot] = assetOf(slot, value, read, field)
    }
  }
  return { settings: result, assets }
}

/** Reads files relative to a directory on disk. */
export function diskReader (directory: string): BrandingFileReader {
  return path => {
    const full = isAbsolute(path) ? path : resolve(directory, path)
    if (!existsSync(full) || !statSync(full).isFile()) {
      throw new BrandingFileError(`${path} does not exist (looked for ${full}).`)
    }
    if (statSync(full).size > brandingAssetMaxBytes * 2) {
      throw new BrandingFileError(`${path} is too large.`)
    }
    return new Uint8Array(readFileSync(full))
  }
}

/** Reads and parses the branding file at `path`. */
export function readBrandingFile (path: string): BrandingLayer {
  let source: string
  try {
    source = readFileSync(path, 'utf8')
  } catch {
    throw new BrandingFileError(`${path} could not be read.`)
  }
  return parseBrandingFile(source, diskReader(resolve(path, '..')))
}

/**
 * Where the desktop app looks for a branding file that IT manages for the
 * whole computer, so its users cannot change it (ADR 0055).
 */
export function systemBrandingFile (platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string | null {
  switch (platform) {
    case 'darwin': {
      return '/Library/Application Support/BaSyx Studio/branding.yml'
    }
    case 'win32': {
      return env.ProgramData ? join(env.ProgramData, 'BaSyx Studio', 'branding.yml') : null
    }
    case 'linux': {
      return '/etc/basyx-studio/branding.yml'
    }
    default: {
      return null
    }
  }
}
