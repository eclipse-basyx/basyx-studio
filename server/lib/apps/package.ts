import type { DeploymentMode } from '#shared/contract'
import type { Violation } from '../problem'
import type { ArchiveLimits } from '../workspaces/archive'
import type { AppManifest } from '@basyx/studio-sdk/protocol'
import { createHash } from 'node:crypto'
import { unzipSync } from 'fflate'
import { StudioProblem } from '../problem'
import { inspectArchive } from '../workspaces/archive'
import { checkCompatibility, checkManifestConsistency, manifestFileName, parseManifest } from './manifest'

const MiB = 1024 * 1024

/** Developer-mode uploads are small; the marketplace may allow more. */
export const appArchiveLimits: ArchiveLimits = {
  maxArchiveBytes: 20 * MiB,
  maxEntries: 2000,
  maxEntryBytes: 20 * MiB,
  maxTotalBytes: 50 * MiB,
  maxCompressionRatio: 100,
  ratioThresholdBytes: MiB,
}

const maxManifestBytes = 64 * 1024

/**
 * File types an app package may contain, with the content type they are
 * served with. Content types are never sniffed.
 */
export const appContentTypes: Readonly<Record<string, string>> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json',
  map: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  wasm: 'application/wasm',
  txt: 'text/plain; charset=utf-8',
}

export function contentTypeOf (path: string): string | null {
  const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase()
  return extension ? (appContentTypes[extension] ?? null) : null
}

/** Archive litter from desktop file managers, skipped instead of rejected. */
function isLitter (path: string): boolean {
  return path.startsWith('__MACOSX/') || /(?:^|\/)(?:\.DS_Store|Thumbs\.db)$/.test(path)
}

export function sha256Hex (bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export interface AppPackageFile {
  path: string
  digest: string
  contentType: string
  content: Uint8Array
}

export interface AppPackage {
  manifest: AppManifest
  /** `sha256:<hex>` of the archive as uploaded. */
  digest: string
  files: AppPackageFile[]
}

function summary (findings: Violation[]): string {
  return findings.length === 1 ? 'The package has 1 finding.' : `The package has ${findings.length} findings.`
}

/** The findings are in `violations`; the detail only counts them. */
function rejected (findings: Violation[]): StudioProblem {
  return new StudioProblem('app_package_rejected', summary(findings), { violations: findings })
}

/**
 * Validates an uploaded app package (ZIP) completely before anything is
 * stored: archive limits and entry names, allowed file types, the manifest
 * schema and its references, and compatibility with this Studio.
 */
export function readAppPackage (bytes: Uint8Array, deploymentMode: DeploymentMode): AppPackage {
  try {
    inspectArchive(bytes, appArchiveLimits, 'app package (ZIP)')
  } catch (error) {
    if (error instanceof StudioProblem && error.code === 'package_rejected') {
      throw rejected([{ path: '(archive)', message: (error.detail ?? error.title).replace(/^The (?:file|package) /, '').replace(/\.$/, '') }])
    }
    throw error
  }

  const entries = unzipSync(bytes)
  let names = Object.keys(entries).filter(name => !name.endsWith('/') && !isLitter(name))

  // Accept archives of a folder: strip a single top-level directory that
  // holds the manifest.
  if (!names.includes(manifestFileName)) {
    const tops = new Set(names.map(name => name.split('/', 1)[0]))
    const [top] = tops
    if (tops.size === 1 && names.includes(`${top}/${manifestFileName}`)) {
      const prefix = `${top}/`
      for (const name of names) {
        entries[name.slice(prefix.length)] = entries[name]!
      }
      names = names.map(name => name.slice(prefix.length))
    }
  }

  const findings: Violation[] = []
  const files: AppPackageFile[] = []
  for (const path of names) {
    if (path === manifestFileName) {
      continue
    }
    const contentType = contentTypeOf(path)
    if (!contentType) {
      findings.push({ path, message: 'has a file type that apps may not contain' })
      continue
    }
    const content = entries[path]!
    files.push({ path, digest: sha256Hex(content), contentType, content })
  }

  const manifestBytes = entries[manifestFileName]
  if (!manifestBytes) {
    throw rejected([...findings, { path: manifestFileName, message: 'is missing at the package root' }])
  }
  if (manifestBytes.length > maxManifestBytes) {
    throw rejected([...findings, { path: manifestFileName, message: 'is larger than 64 KiB' }])
  }
  const parsed = parseManifest(new TextDecoder('utf-8', { fatal: false }).decode(manifestBytes))
  if (!parsed.manifest) {
    throw rejected([...findings, ...parsed.findings])
  }
  findings.push(...checkManifestConsistency(parsed.manifest, new Set(files.map(file => file.path))))
  if (findings.length > 0) {
    throw rejected(findings)
  }

  const incompatible = checkCompatibility(parsed.manifest, deploymentMode)
  if (incompatible.length > 0) {
    throw new StudioProblem('app_incompatible', summary(incompatible), { violations: incompatible })
  }

  return { manifest: parsed.manifest, digest: `sha256:${sha256Hex(bytes)}`, files }
}
