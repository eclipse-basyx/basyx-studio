import type { BrandingLayer } from '~~/server/lib/branding/file'
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { brandingContext, brandingWarnings, mergeBranding, preferencePolicy } from '~~/server/lib/branding'
import { exportBrandingArchive, importBrandingArchive } from '~~/server/lib/branding/archive'
import { BrandingFileError, parseBrandingFile, readBrandingFile, systemBrandingFile } from '~~/server/lib/branding/file'
import { ConfigurationError, loadStudioConfig } from '~~/server/lib/config'
import { appBrandFontUrl, colorNotes, pickLocalized } from '#shared/branding'
import { roundedShapeDefaults, withShape } from '../../packages/studio-app-kit/src/vuetify-defaults'

const env = {
  STUDIO_PUBLIC_URL: 'https://studio.example.org',
  STUDIO_DATA_KEY: randomBytes(32).toString('base64url'),
  STUDIO_OIDC_ISSUER: 'https://idp.example.org/realms/x',
  STUDIO_OIDC_CLIENT_ID: 'studio',
}

const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>'

/** A branding folder as an operator would mount it. */
function brandingFolder (yaml: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'studio-branding-'))
  mkdirSync(join(directory, 'legal'))
  writeFileSync(join(directory, 'logo-light.svg'), svg)
  writeFileSync(join(directory, 'logo-dark.svg'), svg)
  writeFileSync(join(directory, 'favicon.png'), Buffer.from([0x89, 0x50, 0x4E, 0x47]))
  writeFileSync(join(directory, 'legal', 'impressum.de.md'), '# Impressum\n\nACME GmbH')
  writeFileSync(join(directory, 'branding.yml'), yaml)
  return join(directory, 'branding.yml')
}

const example = `
version: 1
productName: ACME Twin Studio
organisation: ACME GmbH
supportUrl: mailto:support@acme.example
logo:
  light: ./logo-light.svg
  dark: ./logo-dark.svg
favicon: ./favicon.png
appearance:
  theme: dark
  accent: { light: "#00549f", dark: "#5FA8FF" }
  secondary: "#F69222"
  background: slate
  shape: rounded
languages:
  default: de
  available: [de, en]
  values: de
signInMessage:
  de: Willkommen
  en: Welcome
legal:
  imprint:
    de: ./legal/impressum.de.md
    en: https://acme.example/en/imprint
  privacy: https://acme.example/privacy
locked: [theme, accent]
`

describe('branding file', () => {
  it('reads settings, files and legal pages relative to the file', () => {
    const { settings, assets } = readBrandingFile(brandingFolder(example))
    expect(settings).toMatchObject({
      productName: 'ACME Twin Studio',
      organisation: 'ACME GmbH',
      supportUrl: 'mailto:support@acme.example',
      theme: 'dark',
      accent: { light: '#00549F', dark: '#5FA8FF' },
      secondary: { light: '#F69222', dark: '#F69222' },
      background: 'slate',
      shape: 'rounded',
      uiLanguage: 'de',
      languages: ['de', 'en'],
      valueLanguage: 'de',
      signInMessage: { de: 'Willkommen', en: 'Welcome' },
      locked: ['theme', 'accent'],
    })
    expect(settings.legal?.imprint).toEqual({ de: { markdown: '# Impressum\n\nACME GmbH' }, en: { url: 'https://acme.example/en/imprint' } })
    // One page for all languages is stored under the default language.
    expect(settings.legal?.privacy).toEqual({ de: { url: 'https://acme.example/privacy' } })
    expect(assets['logo-light']).toMatchObject({ contentType: 'image/svg+xml' })
    expect(assets.favicon).toMatchObject({ contentType: 'image/png' })
  })

  it('names the field of a mistake as it is written in the file', () => {
    const read = () => new Uint8Array()
    expect(() => parseBrandingFile('version: 1\nappearance:\n  accent: blue\n', read)).toThrow(/appearance\.accent/)
    expect(() => parseBrandingFile('version: 1\nlanguages:\n  default: xx\n', read)).toThrow(/languages\.default/)
    expect(() => parseBrandingFile('version: 1\ncolour: red\n', read)).toThrow(BrandingFileError)
    expect(() => parseBrandingFile('version: 2\n', read)).toThrow(/version/)
    expect(() => parseBrandingFile('version: 1\nlocked: [colours]\n', read)).toThrow(/locked/)
  })

  it('refuses files it cannot use', () => {
    const missing = () => {
      throw new BrandingFileError('missing')
    }
    expect(() => parseBrandingFile('version: 1\nlogo: ./logo.gif\n', missing)).toThrow(/logo\.light/)
    expect(() => parseBrandingFile('version: 1\nfont: https://fonts.example.com/x.woff2\n', missing)).toThrow(/woff2 file/)
    expect(() => parseBrandingFile('version: 1\nlegal:\n  imprint: ./imprint.pdf\n', missing)).toThrow(/Markdown/)
    expect(() => parseBrandingFile('version: 1\nlogo: ./logo.svg\n', missing)).toThrow(/missing/)
    expect(() => parseBrandingFile('version: 1\nlogo: ./logo.svg\n', () => new Uint8Array(3 * 1024 * 1024))).toThrow(/larger/)
  })

  it('is read at startup and stops Studio with the field when it is invalid', () => {
    const config = loadStudioConfig({ ...env, STUDIO_BRANDING_FILE: brandingFolder(example) }, 'hosted')
    expect(config.branding.file?.settings.productName).toBe('ACME Twin Studio')
    expect(config.branding.editable).toBe(true)
    expect(() => loadStudioConfig({ ...env, STUDIO_BRANDING_FILE: brandingFolder('version: 1\nappearance:\n  shape: square\n') }, 'hosted'))
      .toThrow(ConfigurationError)
    expect(() => loadStudioConfig({ ...env, STUDIO_BRANDING_FILE: '/does/not/exist.yml' }, 'hosted')).toThrow(/could not be read/)
    expect(loadStudioConfig({ ...env, STUDIO_BRANDING_EDITABLE: 'false' }, 'hosted').branding.editable).toBe(false)
  })

  it('knows where IT puts the desktop branding file', () => {
    expect(systemBrandingFile('darwin', {})).toBe('/Library/Application Support/BaSyx Studio/branding.yml')
    expect(systemBrandingFile('linux', {})).toBe('/etc/basyx-studio/branding.yml')
    expect(systemBrandingFile('win32', { ProgramData: String.raw`C:\ProgramData` })).toContain('BaSyx Studio')
  })
})

describe('branding sources', () => {
  const layer = (settings: BrandingLayer['settings'], assets: BrandingLayer['assets'] = {}): BrandingLayer => ({ settings, assets })

  it('takes each value from the first source that has it: environment, file, administrators', () => {
    const resolved = mergeBranding([
      { source: 'env', layer: layer({ productName: 'From env' }) },
      { source: 'file', layer: layer({ productName: 'From file', organisation: 'File GmbH', legal: { privacy: { en: { url: 'https://file.example/privacy' } } }, locked: ['theme'] }) },
      { source: 'admin', layer: layer({ organisation: 'Admin GmbH', helpUrl: 'https://admin.example/help', legal: { imprint: { en: { markdown: '# Imprint' } }, privacy: { en: { markdown: 'ignored' } } }, locked: ['shape'] }, { 'logo-compact': { bytes: new Uint8Array([1]), contentType: 'image/png' } }) },
    ])
    expect(resolved.settings).toMatchObject({ productName: 'From env', organisation: 'File GmbH', helpUrl: 'https://admin.example/help' })
    expect(resolved.sources).toMatchObject({ 'productName': 'env', 'organisation': 'file', 'helpUrl': 'admin', 'legal.privacy': 'file', 'legal.imprint': 'admin', 'asset.logo-compact': 'admin' })
    expect(resolved.settings.legal?.privacy).toEqual({ en: { url: 'https://file.example/privacy' } })
    // Locks add up; only the file's are beyond the administrators' reach.
    expect(resolved.settings.locked).toEqual(['theme', 'shape'])
    expect(resolved.fixedLocks).toEqual(['theme'])
    expect(resolved.customized).toBe(true)
    expect(mergeBranding([{ source: 'env', layer: layer({}) }, { source: 'file', layer: null }]).customized).toBe(false)
  })

  it('gives the client legal links and versioned file paths', () => {
    const resolved = mergeBranding([{
      source: 'file',
      layer: layer({ legal: { imprint: { de: { markdown: '# Impressum' }, en: { url: 'https://acme.example/imprint' } } } }, { 'logo-light': { bytes: new Uint8Array([1, 2]), contentType: 'image/svg+xml' }, 'logo-dark': { url: 'https://cdn.example/logo.svg' } }),
    }])
    const { branding, legal } = brandingContext(resolved)
    expect(legal.pages.imprint).toEqual({ de: '/legal/imprint', en: 'https://acme.example/imprint' })
    expect(legal.pages.privacy).toBeNull()
    expect(branding.logoLight).toMatch(/^\/branding\/logo-light\?v=[0-9a-f]{12}$/)
    expect(branding.logoDark).toBe('https://cdn.example/logo.svg')
  })

  it('turns locks and defaults into a preference policy', () => {
    expect(preferencePolicy({ theme: 'dark', uiLanguage: 'de', languages: ['de', 'en'], locked: ['theme'] })).toEqual({
      defaults: { theme: 'dark', uiLanguage: 'de', accent: 'basyx' },
      locked: ['theme'],
      languages: ['de', 'en'],
    })
  })

  it('warns about hard-to-read colours and missing legal pages of hosted deployments', () => {
    expect(colorNotes({ accent: { light: '#FFEB3B', dark: '#FFEB3B' } })).toHaveLength(1)
    const config = loadStudioConfig(env, 'hosted')
    expect(brandingWarnings({ config }, mergeBranding([]))[0]).toMatch(/imprint or privacy/)
  })

  it('picks the closest language', () => {
    const values = { de: 'Hallo', en: 'Hello' }
    expect(pickLocalized(values, 'de-saar')).toBe('Hallo')
    expect(pickLocalized(values, 'fr', 'de')).toBe('Hallo')
    expect(pickLocalized(values, 'fr')).toBe('Hello')
    expect(pickLocalized({ ja: 'こんにちは' }, 'fr')).toBe('こんにちは')
    expect(pickLocalized(null, 'en')).toBeNull()
  })
})

describe('branding archive', () => {
  it('exports the branding in effect and imports it again unchanged', () => {
    const file = readBrandingFile(brandingFolder(example))
    const resolved = mergeBranding([{ source: 'file', layer: file }])
    const imported = importBrandingArchive(exportBrandingArchive(resolved))
    expect(imported.settings).toEqual(file.settings)
    expect(Object.keys(imported.assets).toSorted()).toEqual(['favicon', 'logo-dark', 'logo-light'])
    expect(imported.assets.favicon).toEqual(file.assets.favicon)
  })

  it('refuses archives without a branding file and paths outside the archive', async () => {
    const { zipSync, strToU8 } = await import('fflate')
    expect(() => importBrandingArchive(zipSync({ 'other.txt': strToU8('x') }))).toThrow(/branding\.yml/)
    expect(() => importBrandingArchive(zipSync({ 'branding.yml': strToU8('version: 1\nlogo: ../secret.svg\n') }))).toThrow(/not in the archive/)
    expect(() => importBrandingArchive(new Uint8Array([1, 2, 3]))).toThrow(/ZIP/)
  })
})

describe('app branding', () => {
  it('uses the app’s own asset prefix for the current font on web and desktop', () => {
    const id = 'app-0000000000000000'
    const brandFont = '/branding/font?v=123456abcdef'
    expect(appBrandFontUrl(`https://apps.example.org/studio/app/${id}/ui/index.html`, id, brandFont))
      .toBe(`https://apps.example.org/studio/app/${id}/.studio-brand.woff2?v=123456abcdef`)
    expect(appBrandFontUrl(`studio-app://${id}/ui/index.html`, id, brandFont))
      .toBe(`studio-app://${id}/.studio-brand.woff2?v=123456abcdef`)
    expect(appBrandFontUrl(`studio-app://${id}/ui/index.html`, id, null)).toBeUndefined()
  })

  it('lays the rounded radii over an app\'s defaults without dropping the others', () => {
    const merged = withShape({ VCard: { flat: true, border: true, rounded: 'lg' }, VDialog: { VCard: { flat: false } } }, roundedShapeDefaults)
    expect(merged.VCard).toEqual({ flat: true, border: true, rounded: 'xl' })
    expect(merged.VDialog).toEqual({ VCard: { flat: false, rounded: 'xl' } })
    expect(merged.VBtn).toEqual({ rounded: 'pill' })
  })
})

describe('the documented example', () => {
  it('loads examples/deployment/branding/branding.yml', () => {
    const { settings, assets } = readBrandingFile(new URL('../../examples/deployment/branding/branding.yml', import.meta.url).pathname)
    expect(settings).toMatchObject({ productName: 'Example Twin Studio', background: 'neutral', shape: 'normal', uiLanguage: 'en' })
    expect(settings.locked).not.toContain('background')
    expect(Object.keys(settings.legal ?? {})).toEqual(['imprint', 'privacy', 'accessibility'])
    expect(Object.keys(assets).toSorted()).toEqual(['favicon', 'logo-compact', 'logo-dark', 'logo-light'])
    expect(colorNotes(settings)).toEqual([])
  })
})
