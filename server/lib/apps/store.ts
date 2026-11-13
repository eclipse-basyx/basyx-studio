import type { AppConnectionSummary, AppInstallation, AppPackageInspection, AppPermission } from '#shared/contract'
import type { AppTrustLevel } from '../../database/schema'
import type { StudioDatabase } from '../database/client'
import type { Actor, StudioDeps } from '../deps'
import type { AppPackage } from './package'
import type { TrustStore, VerifiedSignature } from './trust'
import type { AppManifest, AppSandbox } from '@basyx/studio-sdk/protocol'
import { randomBytes } from 'node:crypto'
import { needsRemoteCodeGrant, sandboxOrigins } from '@basyx/studio-app-kit/manifest'
import { sandboxOriginKinds } from '@basyx/studio-sdk/protocol'
import { and, eq, inArray, notExists, sql } from 'drizzle-orm'
import semver from 'semver'
import { appBlobs, appFiles, appInstallations } from '../../database/schema'
import { recordAudit } from '../audit'
import { StudioProblem } from '../problem'
import { installationConnections } from './connections'
import { readAppPackage, sha256Hex } from './package'
import { checkSandbox } from './sandbox'
import { keptValues, settingChanges, settingSummaries } from './settings'
import { installationTrust, verifyPackageSignature } from './trust'

export type AppInstallationRecord = typeof appInstallations.$inferSelect

/** Lower-case, so it stays the same as a `studio-app://` host name. */
export function newInstallationId (): string {
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

/** Rejects installs and uninstalls when the deployment fixes its apps (STUDIO_APPS_ALLOW_INSTALL=false). */
function requireAppChanges (deps: StudioDeps): void {
  if (!deps.config.deployment.appInstalls) {
    throw new StudioProblem('forbidden', 'This Studio deployment does not allow installing or removing apps.')
  }
}

/** Permissions only the apps shipped with Studio may hold: they reach beyond the AAS (ADR 0033). */
export const bundledOnlyPermissions = ['studio.containers'] as const

/** The subject recorded as installer of bundled apps. */
export const bundledInstaller = 'studio'

/** The subject recorded as installer of managed packages (STUDIO_APP_PACKAGES). */
export const managedInstaller = 'deployment'

type Transaction = Parameters<Parameters<StudioDatabase['transaction']>[0]>[0]

// Arbitrary constant: the first key of the per-app advisory locks; the
// two-key form never meets the migration lock.
const appLockClass = 7_240_044

/**
 * Serializes every change of one app ID until the transaction ends, so
 * concurrent installs, updates and removals see each other's result.
 * Unlike a row lock, it also covers an app ID that is not installed yet.
 */
export async function lockAppId (tx: Transaction, appId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${appLockClass}, hashtext(${appId}))`)
}

/** How an installation is trusted and who owns it (ADR 0044). */
export interface InstallationSource {
  trust: AppTrustLevel
  /** The trust store's publisher name, for signed packages. */
  publisher: string | null
  keyFingerprint: string | null
  bundled: boolean
  managed: boolean
  installedBy: string
}

/** The source of an installation from a verified signature, or its unsigned fallback. */
export function sourceOf (signer: VerifiedSignature | null, unsigned: AppTrustLevel, owner: Pick<InstallationSource, 'bundled' | 'managed' | 'installedBy'>): InstallationSource {
  return { trust: signer ? 'signed' : unsigned, publisher: signer?.publisher.name ?? null, keyFingerprint: signer?.keyFingerprint ?? null, ...owner }
}

/**
 * Writes a new installation, or replaces the package of an existing one in
 * place: its ID stays, so frames, deep links and audit records stay valid,
 * and so do the values of settings that the new version still accepts
 * (ADR 0048). Blobs no installation uses any more are removed.
 */
export async function writeInstallation (tx: Transaction, id: string, existing: boolean, pkg: AppPackage, source: InstallationSource): Promise<AppInstallationRecord> {
  const values = { appId: pkg.manifest.id, version: pkg.manifest.version, digest: pkg.digest, manifest: pkg.manifest, ...source, installedAt: new Date() }
  let settings = {}
  if (existing) {
    const [current] = await tx.select({ settings: appInstallations.settings }).from(appInstallations).where(eq(appInstallations.id, id))
    settings = keptValues(pkg.manifest, current?.settings ?? {}).kept
  }
  const [record] = existing
    ? await tx.update(appInstallations).set({ ...values, settings }).where(eq(appInstallations.id, id)).returning()
    : await tx.insert(appInstallations).values({ id, ...values }).returning()
  if (existing) {
    await tx.delete(appFiles).where(eq(appFiles.installationId, id))
  }
  for (const file of new Map(pkg.files.map(entry => [entry.digest, entry])).values()) {
    await tx.insert(appBlobs).values({ digest: file.digest, size: file.content.length, content: file.content }).onConflictDoNothing()
  }
  if (pkg.files.length > 0) {
    await tx.insert(appFiles).values(pkg.files.map(file => ({ installationId: id, path: file.path, digest: file.digest, contentType: file.contentType })))
  }
  if (existing) {
    await tx.delete(appBlobs).where(notExists(
      tx.select({ one: sql`1` }).from(appFiles).where(eq(appFiles.digest, appBlobs.digest)),
    ))
  }
  return record!
}

interface PreparedUpload {
  pkg: AppPackage
  signer: VerifiedSignature | null
  existing: AppInstallationRecord | null
}

/**
 * Runs every check of an upload (ADR 0016, ADR 0044) without storing
 * anything: the package, its signature against the trust store, and, when
 * the app is installed, whether this package may update it.
 */
async function prepareUpload (deps: StudioDeps, bytes: Uint8Array, signature: string | null): Promise<PreparedUpload> {
  requireAppsEnabled(deps)
  requireAppChanges(deps)
  if (signature === null && !deps.config.apps.allowUnsigned) {
    throw new StudioProblem('app_unsigned_disabled', 'Sign the package with a key of a trusted publisher (STUDIO_APPS_TRUSTED_PUBLISHERS), or set STUDIO_APPS_ALLOW_UNSIGNED=true for developer-mode installs.')
  }
  const pkg = readAppPackage(bytes, deps.config.deploymentMode)
  const reserved = pkg.manifest.permissions.filter(permission => (bundledOnlyPermissions as readonly string[]).includes(permission))
  if (reserved.length > 0) {
    throw new StudioProblem('app_package_rejected', `${reserved.join(', ')} is reserved for the apps shipped with Studio (ADR 0033).`, {
      violations: reserved.map(permission => ({ path: 'studio-app.json#permissions', message: `requests ${permission}, which only bundled apps may hold` })),
    })
  }
  const signer = signature === null ? null : verifyPackageSignature(deps.config.apps.trustStore, bytes, signature, pkg.manifest.id)
  checkSandbox(deps.config, pkg.manifest, { publisher: signer?.publisher ?? null, developerMode: signer === null })
  const [existing] = await deps.db.select().from(appInstallations).where(eq(appInstallations.appId, pkg.manifest.id))
  if (existing) {
    checkUpdate(deps, existing, pkg, signer)
  }
  return { pkg, signer, existing: existing ?? null }
}

/**
 * Whether an upload may replace an installation in place (ADR 0044): signed
 * by the same trust store publisher, signed over unsigned, or unsigned over
 * unsigned in developer mode; with a higher version, or the same version to
 * restore a revoked installation.
 */
function checkUpdate (deps: StudioDeps, existing: AppInstallationRecord, pkg: AppPackage, signer: VerifiedSignature | null): void {
  const { id, version } = pkg.manifest
  if (existing.bundled) {
    throw new StudioProblem('app_already_installed', `${id} is shipped with Studio and is not replaced by uploads.`)
  }
  if (existing.managed) {
    throw new StudioProblem('app_already_installed', `${id} is installed by the deployment (STUDIO_APP_PACKAGES); update the package there.`)
  }
  const current = installationTrust(existing, deps.config.apps.trustStore)
  if (existing.trust === 'signed') {
    const publisher = current.verifiedPublisher ?? existing.publisher
    if (!signer) {
      throw new StudioProblem('app_signer_not_allowed', `${id} is signed by ${publisher}; an update needs a signature of the same publisher.`)
    }
    if (signer.publisher.name !== publisher) {
      throw new StudioProblem('app_signer_not_allowed', `${id} is signed by ${publisher}, so ${signer.publisher.name} cannot update it. Uninstall it first.`)
    }
  }
  if (existing.digest === pkg.digest && !current.revoked) {
    throw new StudioProblem('app_already_installed', `${id} ${existing.version} is installed already.`)
  }
  const restores = current.revoked !== null && signer !== null && semver.eq(version, existing.version)
  if (!semver.gt(version, existing.version) && !restores) {
    throw new StudioProblem('app_already_installed', `${id} ${existing.version} is installed; an update needs a higher version than ${version}.`)
  }
}

/** Checks an upload and says what installing it would do, for the consent dialog. Nothing is stored. */
export async function inspectAppPackage (deps: StudioDeps, bytes: Uint8Array, signature: string | null): Promise<AppPackageInspection> {
  const { pkg, signer, existing } = await prepareUpload(deps, bytes, signature)
  const { manifest } = pkg
  const summary = manifestSummary(manifest)
  let update: AppPackageInspection['update'] = null
  if (existing) {
    const before = manifestSummary(existing.manifest)
    update = {
      installationId: existing.id,
      version: existing.version,
      trust: existing.trust,
      verifiedPublisher: installationTrust(existing, deps.config.apps.trustStore).verifiedPublisher,
      permissionsAdded: summary.permissions.filter(permission => !before.permissions.includes(permission)),
      permissionsRemoved: before.permissions.filter(permission => !summary.permissions.includes(permission)),
      sandboxAdded: (['webAssembly', 'workers'] as const).filter(flag => summary.sandbox[flag] && !before.sandbox[flag]),
      originsAdded: sandboxOriginKinds.flatMap(kind => summary.sandbox[kind].filter(origin => !before.sandbox[kind].includes(origin)).map(origin => ({ kind, origin }))),
      originsRemoved: sandboxOriginKinds.flatMap(kind => before.sandbox[kind].filter(origin => !summary.sandbox[kind].includes(origin)).map(origin => ({ kind, origin }))),
      ...operationChanges(await installationConnections(deps, existing), pkg.connections),
      ...settingChanges(existing.manifest, manifest, existing.settings),
      backendAdded: summary.backend && !before.backend,
    }
  }
  return {
    ...summary,
    connections: pkg.connections,
    digest: pkg.digest,
    trust: signer ? 'signed' : 'unsigned',
    verifiedPublisher: signer?.publisher.name ?? null,
    keyFingerprint: signer?.keyFingerprint ?? null,
    grantedPermissions: (signer?.publisher.permissions ?? []).filter(permission => manifest.permissions.includes(permission)),
    update,
  }
}

type ConnectionOperations = Pick<NonNullable<AppPackageInspection['update']>, 'operationsAdded' | 'operationsRemoved'>

/**
 * The operations an update adds and removes (ADR 0047): an operation of the
 * same ID with another method or path counts as removed and added, so the
 * administrator confirms what the binding now allows.
 */
function operationChanges (before: AppConnectionSummary[], after: AppConnectionSummary[]): ConnectionOperations {
  const keys = (connections: AppConnectionSummary[]) => new Map(connections.flatMap(connection => connection.operations.map(operation => [
    `${connection.id} ${operation.operationId} ${operation.method} ${operation.path}`,
    { connection: connection.id, operationId: operation.operationId },
  ])))
  const was = keys(before)
  const now = keys(after)
  return {
    operationsAdded: [...now].filter(([key]) => !was.has(key)).map(([, operation]) => operation),
    operationsRemoved: [...was].filter(([key]) => !now.has(key)).map(([, operation]) => operation),
  }
}

export interface UploadResult {
  record: AppInstallationRecord
  /** The version it replaced in place, if it was an update. */
  previous: AppInstallationRecord | null
}

/**
 * Installs an uploaded package, or updates the installed app with the same
 * ID in place (ADR 0044). Validation completes before anything is stored;
 * the installation, its files and their content-addressed blobs are written
 * in one transaction. The caller stops a running backend after an update.
 */
export async function installApp (deps: StudioDeps, actor: Actor, bytes: Uint8Array, signature: string | null, requestId: string): Promise<UploadResult> {
  const { pkg, signer, existing } = await prepareUpload(deps, bytes, signature)
  const source = sourceOf(signer, 'unsigned', { bundled: false, managed: false, installedBy: actor.subject })
  const id = existing?.id ?? newInstallationId()

  const record = await deps.db.transaction(async tx => {
    await lockAppId(tx, pkg.manifest.id)
    // What the checks saw must still be installed; otherwise they ran against an older state.
    const [current] = await tx.select({ id: appInstallations.id, digest: appInstallations.digest }).from(appInstallations).where(eq(appInstallations.appId, pkg.manifest.id))
    if (current?.id !== existing?.id || current?.digest !== existing?.digest) {
      throw new StudioProblem('app_already_installed', `${pkg.manifest.id} was installed or changed in the meantime.`)
    }
    return writeInstallation(tx, id, existing !== null, pkg, source)
  })

  const dropped = existing ? keptValues(record.manifest, existing.settings).dropped : []
  await recordAudit(deps, {
    action: existing ? 'app.update' : 'app.install',
    outcome: 'success',
    requestId,
    actorSubject: actor.subject,
    appInstallationId: id,
    details: {
      appId: record.appId,
      version: record.version,
      digest: record.digest,
      trust: record.trust,
      publisher: record.publisher,
      keyFingerprint: record.keyFingerprint,
      permissions: record.manifest.permissions,
      ...(existing ? { previousVersion: existing.version, previousDigest: existing.digest } : {}),
      // Installation values the new version no longer accepts (ADR 0048).
      ...(dropped.length > 0 ? { settingsDropped: dropped } : {}),
    },
  })
  return { record, previous: existing }
}

/**
 * Installs or updates an app shipped with Studio (ADR 0023). Bundled apps
 * come from the Studio build itself, so they need neither developer mode nor
 * a signature. An app with the same ID that an administrator or the
 * deployment installed is left alone.
 */
export async function installBundledApp (deps: StudioDeps, bytes: Uint8Array): Promise<'installed' | 'updated' | 'unchanged' | 'skipped'> {
  const pkg = readAppPackage(bytes, null)
  // Apps for the other runtime only, e.g. BaSyx Docker on hosted Studio.
  if (!pkg.manifest.runtimes.includes(deps.config.deploymentMode)) {
    return 'skipped'
  }
  return deps.db.transaction(async tx => {
    await lockAppId(tx, pkg.manifest.id)
    const [existing] = await tx.select().from(appInstallations).where(eq(appInstallations.appId, pkg.manifest.id))
    if (existing && !existing.bundled) {
      return 'skipped'
    }
    if (existing?.digest === pkg.digest) {
      return 'unchanged'
    }
    await writeInstallation(tx, existing?.id ?? newInstallationId(), Boolean(existing), pkg, {
      trust: 'bundled',
      publisher: null,
      keyFingerprint: null,
      bundled: true,
      managed: false,
      installedBy: bundledInstaller,
    })
    return existing ? 'updated' : 'installed'
  })
}

/** Removes a first-party app retired from Studio; user-installed apps are never touched. */
export async function removeBundledApp (deps: Pick<StudioDeps, 'db'>, appId: string): Promise<boolean> {
  return deps.db.transaction(async tx => {
    await lockAppId(tx, appId)
    const [existing] = await tx.select({ id: appInstallations.id, bundled: appInstallations.bundled }).from(appInstallations).where(eq(appInstallations.appId, appId))
    if (!existing?.bundled) {
      return false
    }
    await tx.delete(appInstallations).where(eq(appInstallations.id, existing.id))
    await tx.delete(appBlobs).where(notExists(
      tx.select({ one: sql`1` }).from(appFiles).where(eq(appFiles.digest, appBlobs.digest)),
    ))
    return true
  })
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

/** The installations whose files may be served and whose contributions are offered: all but revoked ones (ADR 0044). */
/** The installations Studio shows and calls: not revoked, and not an App Builder preview (ADR 0054). */
export async function listActiveInstallations (deps: Pick<StudioDeps, 'db' | 'config'>): Promise<AppInstallationRecord[]> {
  return (await listInstallations(deps)).filter(record => !record.preview && !installationTrust(record, deps.config.apps.trustStore).revoked)
}

/** The App Builder's preview installed under `previewAppId`, if there is one. */
export async function findPreviewApp (deps: Pick<StudioDeps, 'db'>, previewAppId: string): Promise<AppInstallationRecord | null> {
  const [record] = await deps.db.select().from(appInstallations).where(eq(appInstallations.appId, previewAppId))
  return record?.preview ? record : null
}

/**
 * Installs or replaces the App Builder's preview of a project's app
 * (ADR 0054, plan B3): the package under `previewAppId`, unsigned as in
 * developer mode, with the checks of an upload except signatures and
 * versions, since Studio built it from the project's folder itself. The
 * user confirmed its permissions in the preview pane. When `sourceAppId`,
 * the project's app, is installed and trusted, the preview starts from its
 * settings and uses its infrastructure settings and connection bindings
 * (`previewOf`), so it runs where the app does.
 */
export async function installPreviewApp (deps: StudioDeps, bytes: Uint8Array, previewAppId: string, installedBy: string, sourceAppId: string | null = null): Promise<{ record: AppInstallationRecord, previous: AppInstallationRecord | null }> {
  requireAppsEnabled(deps)
  // A preview runs its code on real targets like any app: a deployment that fixes its apps has none.
  requireAppChanges(deps)
  if (!deps.config.apps.allowUnsigned) {
    throw new StudioProblem('app_unsigned_disabled', 'App Builder previews install unsigned, as in developer mode; set STUDIO_APPS_ALLOW_UNSIGNED=true.')
  }
  const read = readAppPackage(bytes, deps.config.deploymentMode)
  const pkg = { ...read, manifest: { ...read.manifest, id: previewAppId } }
  const reserved = pkg.manifest.permissions.filter(permission => (bundledOnlyPermissions as readonly string[]).includes(permission))
  if (reserved.length > 0) {
    throw new StudioProblem('app_package_rejected', `${reserved.join(', ')} is reserved for the apps shipped with Studio (ADR 0033).`)
  }
  checkSandbox(deps.config, pkg.manifest, { publisher: null, developerMode: true })
  return await deps.db.transaction(async tx => {
    await lockAppId(tx, previewAppId)
    const [existing] = await tx.select().from(appInstallations).where(eq(appInstallations.appId, previewAppId))
    if (existing && !existing.preview) {
      throw new StudioProblem('app_already_installed', `${previewAppId} is installed as an app of its own, so Studio does not replace it with a preview.`)
    }
    const [source] = sourceAppId && sourceAppId !== previewAppId
      ? await tx.select().from(appInstallations).where(eq(appInstallations.appId, sourceAppId))
      : []
    const original = source && !source.preview && !installationTrust(source, deps.config.apps.trustStore).revoked ? source : null
    const written = await writeInstallation(tx, existing?.id ?? newInstallationId(), existing !== undefined, pkg, sourceOf(null, 'unsigned', { bundled: false, managed: false, installedBy }))
    const [record] = await tx.update(appInstallations).set({
      preview: true,
      previewOf: original?.appId ?? null,
      // Previews have no settings page: the app's values, where they fit the preview's settings.
      ...(original ? { settings: keptValues(pkg.manifest, original.settings).kept } : {}),
    }).where(eq(appInstallations.id, written.id)).returning()
    return { record: record!, previous: existing ?? null }
  })
}

/** Removes the installation and every blob no other installation uses. */
export async function uninstallApp (deps: StudioDeps, actor: Actor, id: string, requestId: string): Promise<AppInstallationRecord> {
  requireAppChanges(deps)
  const record = await getInstallation(deps, id)
  if (record.bundled) {
    throw new StudioProblem('forbidden', 'Apps shipped with Studio cannot be uninstalled.')
  }
  if (record.managed) {
    throw new StudioProblem('forbidden', 'This app is installed by the deployment (STUDIO_APP_PACKAGES) and is removed there.')
  }
  await removeInstallation(deps, record, actor.subject, requestId)
  return record
}

/** Deletes an installation, its files and unused blobs, and audits it. */
export async function removeInstallation (deps: StudioDeps, record: AppInstallationRecord, actorSubject: string, requestId?: string): Promise<void> {
  const { id } = record
  await deps.db.transaction(async tx => {
    await lockAppId(tx, record.appId)
    await tx.delete(appInstallations).where(eq(appInstallations.id, id))
    await tx.delete(appBlobs).where(notExists(
      tx.select({ one: sql`1` }).from(appFiles).where(eq(appFiles.digest, appBlobs.digest)),
    ))
  })
  await recordAudit(deps, {
    action: 'app.uninstall',
    outcome: 'success',
    requestId,
    actorSubject,
    appInstallationId: id,
    details: { appId: record.appId, version: record.version },
  })
}

export interface AppFile {
  content: Uint8Array
  contentType: string
  digest: string
  /** What the installation's pages may run beyond scripts (ADR 0038). */
  sandbox: AppSandbox
  /** The installation may show other apps' views in its pages (`studio.ui.navigation`, ADR 0051). */
  embedsViews: boolean
}

// Digests already verified in this process. Blobs are immutable.
const verified = new Set<string>()

/** Reads one file of an installation, verifying its content digest. Revoked installations have no files. */
export async function readAppFile (deps: Pick<StudioDeps, 'db' | 'config'>, installationId: string, path: string): Promise<AppFile | null> {
  if (!isInstallationId(installationId)) {
    return null
  }
  const [row] = await deps.db
    .select({
      content: appBlobs.content,
      contentType: appFiles.contentType,
      digest: appFiles.digest,
      manifest: appInstallations.manifest,
      installation: { appId: appInstallations.appId, trust: appInstallations.trust, bundled: appInstallations.bundled, keyFingerprint: appInstallations.keyFingerprint },
    })
    .from(appFiles)
    .innerJoin(appBlobs, eq(appBlobs.digest, appFiles.digest))
    .innerJoin(appInstallations, eq(appInstallations.id, appFiles.installationId))
    .where(and(eq(appFiles.installationId, installationId), eq(appFiles.path, path)))
  if (!row || installationTrust({ ...row.installation, manifest: row.manifest }, deps.config.apps.trustStore).revoked) {
    return null
  }
  if (!verified.has(row.digest)) {
    if (sha256Hex(row.content) !== row.digest) {
      throw new StudioProblem('internal_error', 'An app file does not match its digest.')
    }
    verified.add(row.digest)
  }
  const { manifest, installation: _installation, ...file } = row
  return { ...file, sandbox: manifest.sandbox ?? {}, embedsViews: manifest.permissions.includes('studio.ui.navigation') }
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

type ManifestSummary = Pick<AppInstallation, 'appId' | 'version' | 'title' | 'description' | 'publisher' | 'permissions' | 'sandbox' | 'remoteCode' | 'settings' | 'submodelViews' | 'modules' | 'backend'>

/** An installation as the API returns it, with its connections' operations (ADR 0047). */
export async function describeInstallation (deps: Pick<StudioDeps, 'db' | 'config'>, record: AppInstallationRecord): Promise<AppInstallation> {
  return toAppInstallation(record, deps.config.apps.trustStore, await installationConnections(deps, record))
}

function manifestSummary (manifest: AppManifest): ManifestSummary {
  return {
    appId: manifest.id,
    version: manifest.version,
    title: manifest.title,
    description: manifest.description ?? null,
    publisher: manifest.publisher.name,
    permissions: manifest.permissions,
    sandbox: { webAssembly: manifest.sandbox?.webAssembly ?? false, workers: manifest.sandbox?.workers ?? false, ...sandboxOrigins(manifest) },
    remoteCode: needsRemoteCodeGrant(manifest),
    settings: settingSummaries(manifest),
    submodelViews: manifest.contributes.submodelViews?.length ?? 0,
    modules: manifest.contributes.modules?.length ?? 0,
    backend: Boolean(manifest.backend),
  }
}

/** An installation as the API returns it; `connections` come from `installationConnections`, see `describeInstallation`. */
export function toAppInstallation (record: AppInstallationRecord, trustStore: TrustStore, connections: AppConnectionSummary[] = []): AppInstallation {
  const trust = installationTrust(record, trustStore)
  return {
    ...manifestSummary(record.manifest),
    connections,
    id: record.id,
    appId: record.appId,
    version: record.version,
    digest: record.digest,
    trust: record.trust,
    verifiedPublisher: trust.verifiedPublisher,
    keyFingerprint: record.keyFingerprint,
    revoked: trust.revoked,
    bundled: record.bundled,
    managed: record.managed,
    settingValues: record.settings,
    grantedPermissions: trust.granted.filter((permission: AppPermission) => record.manifest.permissions.includes(permission)),
    installedAt: record.installedAt.toISOString(),
    installedBy: record.installedBy,
  }
}
