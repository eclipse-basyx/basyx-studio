import type { AppInstallation } from '#shared/contract'
import type { Actor, StudioDeps } from '../deps'
import { randomBytes } from 'node:crypto'
import { and, eq, inArray, notExists, sql } from 'drizzle-orm'
import { appBlobs, appFiles, appInstallations } from '../../database/schema'
import { recordAudit } from '../audit'
import { StudioProblem } from '../problem'
import { readAppPackage, sha256Hex } from './package'

export type AppInstallationRecord = typeof appInstallations.$inferSelect

/** Lower-case, so it stays the same as a `studio-app://` host name. */
function newInstallationId (): string {
  return `app-${randomBytes(8).toString('hex')}`
}

export function isInstallationId (value: string): boolean {
  return /^app-[0-9a-f]{16}$/.test(value)
}

function requireAppsEnabled (deps: StudioDeps): void {
  if (!deps.config.apps.baseUrl) {
    throw new StudioProblem('unsupported_operation', 'Apps need a separate apps origin (STUDIO_APPS_URL).')
  }
}

/**
 * Installs a developer-mode package. Validation completes before anything
 * is stored; the installation, its files and their content-addressed blobs
 * are written in one transaction.
 */
export async function installApp (deps: StudioDeps, actor: Actor, bytes: Uint8Array, requestId: string): Promise<AppInstallationRecord> {
  requireAppsEnabled(deps)
  if (!deps.config.apps.allowUnsigned) {
    throw new StudioProblem('app_unsigned_disabled', 'Set STUDIO_APPS_ALLOW_UNSIGNED=true to allow developer-mode installs.')
  }
  const pkg = readAppPackage(bytes, deps.config.deploymentMode)
  const id = newInstallationId()

  const record = await deps.db.transaction(async tx => {
    const [existing] = await tx.select({ version: appInstallations.version }).from(appInstallations).where(eq(appInstallations.appId, pkg.manifest.id))
    if (existing) {
      throw new StudioProblem('app_already_installed', `${pkg.manifest.id} ${existing.version} is installed. Uninstall it first; updates come with the marketplace.`)
    }
    const [installed] = await tx.insert(appInstallations).values({
      id,
      appId: pkg.manifest.id,
      version: pkg.manifest.version,
      digest: pkg.digest,
      manifest: pkg.manifest,
      unsigned: true,
      installedBy: actor.subject,
    }).returning()
    const unique = new Map(pkg.files.map(file => [file.digest, file]))
    for (const file of unique.values()) {
      await tx.insert(appBlobs).values({ digest: file.digest, size: file.content.length, content: file.content }).onConflictDoNothing()
    }
    if (pkg.files.length > 0) {
      await tx.insert(appFiles).values(pkg.files.map(file => ({ installationId: id, path: file.path, digest: file.digest, contentType: file.contentType })))
    }
    return installed!
  })

  await recordAudit(deps, {
    action: 'app.install',
    outcome: 'success',
    requestId,
    actorSubject: actor.subject,
    appInstallationId: id,
    details: { appId: record.appId, version: record.version, digest: record.digest, unsigned: true, permissions: record.manifest.permissions },
  })
  return record
}

export async function listInstallations (deps: Pick<StudioDeps, 'db'>): Promise<AppInstallationRecord[]> {
  return deps.db.select().from(appInstallations).orderBy(appInstallations.installedAt)
}

export async function getInstallation (deps: Pick<StudioDeps, 'db'>, id: string): Promise<AppInstallationRecord> {
  const [record] = isInstallationId(id) ? await deps.db.select().from(appInstallations).where(eq(appInstallations.id, id)) : []
  if (!record) {
    throw new StudioProblem('app_not_found')
  }
  return record
}

/** Removes the installation and every blob no other installation uses. */
export async function uninstallApp (deps: StudioDeps, actor: Actor, id: string, requestId: string): Promise<AppInstallationRecord> {
  const record = await getInstallation(deps, id)
  await deps.db.transaction(async tx => {
    await tx.delete(appInstallations).where(eq(appInstallations.id, id))
    await tx.delete(appBlobs).where(notExists(
      tx.select({ one: sql`1` }).from(appFiles).where(eq(appFiles.digest, appBlobs.digest)),
    ))
  })
  await recordAudit(deps, {
    action: 'app.uninstall',
    outcome: 'success',
    requestId,
    actorSubject: actor.subject,
    appInstallationId: id,
    details: { appId: record.appId, version: record.version },
  })
  return record
}

export interface AppFile {
  content: Uint8Array
  contentType: string
  digest: string
}

// Digests already verified in this process. Blobs are immutable.
const verified = new Set<string>()

/** Reads one file of an installation, verifying its content digest. */
export async function readAppFile (deps: Pick<StudioDeps, 'db'>, installationId: string, path: string): Promise<AppFile | null> {
  if (!isInstallationId(installationId)) {
    return null
  }
  const [row] = await deps.db
    .select({ content: appBlobs.content, contentType: appFiles.contentType, digest: appFiles.digest })
    .from(appFiles)
    .innerJoin(appBlobs, eq(appBlobs.digest, appFiles.digest))
    .where(and(eq(appFiles.installationId, installationId), eq(appFiles.path, path)))
  if (!row) {
    return null
  }
  if (!verified.has(row.digest)) {
    if (sha256Hex(row.content) !== row.digest) {
      throw new StudioProblem('internal_error', 'An app file does not match its digest.')
    }
    verified.add(row.digest)
  }
  return row
}

/** Files below a directory of an installation, for extracting a backend. */
export async function readAppFiles (deps: Pick<StudioDeps, 'db'>, installationId: string, paths: string[]): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>()
  if (paths.length === 0) {
    return files
  }
  const rows = await deps.db
    .select({ path: appFiles.path, content: appBlobs.content, digest: appFiles.digest })
    .from(appFiles)
    .innerJoin(appBlobs, eq(appBlobs.digest, appFiles.digest))
    .where(and(eq(appFiles.installationId, installationId), inArray(appFiles.path, paths)))
  for (const row of rows) {
    if (sha256Hex(row.content) !== row.digest) {
      throw new StudioProblem('internal_error', 'An app file does not match its digest.')
    }
    files.set(row.path, row.content)
  }
  return files
}

export async function listAppFilePaths (deps: Pick<StudioDeps, 'db'>, installationId: string): Promise<string[]> {
  const rows = await deps.db.select({ path: appFiles.path }).from(appFiles).where(eq(appFiles.installationId, installationId))
  return rows.map(row => row.path)
}

export function toAppInstallation (record: AppInstallationRecord): AppInstallation {
  const { manifest } = record
  return {
    id: record.id,
    appId: record.appId,
    version: record.version,
    title: manifest.title,
    description: manifest.description ?? null,
    publisher: manifest.publisher.name,
    digest: record.digest,
    unsigned: record.unsigned,
    permissions: manifest.permissions,
    submodelViews: manifest.contributes.submodelViews?.length ?? 0,
    modules: manifest.contributes.modules?.length ?? 0,
    backend: Boolean(manifest.backend),
    installedAt: record.installedAt.toISOString(),
    installedBy: record.installedBy,
  }
}
