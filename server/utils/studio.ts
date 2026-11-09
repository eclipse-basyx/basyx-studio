import type { DeploymentMode } from '#shared/contract'
import type { StudioDeps } from '../lib/deps'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { useRuntimeConfig } from 'nuxt/server'
import { apiBasePath } from '#shared/contract'
import { agentCatalog } from '../lib/agents/catalog'
import { AgentManager, defaultProjectsDir } from '../lib/agents/manager'
import { DatabaseProjectStore } from '../lib/app-projects/store'
import { embedTokenKey } from '../lib/apps/embeds'
import { reconcileManagedPackages } from '../lib/apps/packages'
import { BackendRunner } from '../lib/apps/runner'
import { installBundledApp, listInstallations, removeBundledApp } from '../lib/apps/store'
import { capabilityTokenKey } from '../lib/apps/tokens'
import { installationTrust, revocationReason } from '../lib/apps/trust'
import { configurationWarnings, loadStudioConfig } from '../lib/config'
import { systemDiscoveryEnvironment } from '../lib/containers/discovery'
import { infrastructureInputOf } from '../lib/containers/infrastructure'
import { ContainerManager } from '../lib/containers/manager'
import { CopyPlanStore } from '../lib/copies/store'
import { SecretCipher } from '../lib/crypto/cipher'
import { openDatabase } from '../lib/database/client'
import { applyMigrations } from '../lib/database/migrate'
import { FileGrantStore } from '../lib/desktop/grants'
import { parseInfrastructureSources } from '../lib/infrastructure-file'
import { createInfrastructure, deleteInfrastructure, reconcileManagedInfrastructures } from '../lib/infrastructures'
import { configureOutboundProxy } from '../lib/network/guarded-fetch'
import { describeOutboundProxy } from '../lib/network/proxy'
import { ensureDesktopSession } from '../lib/sessions'
import { CredentialBroker } from '../lib/targets/credentials'
import { studioPath } from '../lib/urls'
import { WorkspaceWorkerClient } from '../lib/workspaces/client'
import { WorkspaceManager } from '../lib/workspaces/manager'
import { loadAppTemplate } from '../nitro/app-template'
import { loadBundledApps } from '../nitro/bundled-apps'
import { loadMigrationsFromAssets } from '../nitro/migration-assets'
import { previewInstaller } from './app-builder'

export interface StudioRuntime extends StudioDeps {
  broker: CredentialBroker
  /** Desktop AASX workspaces; `null` when hosted or the worker is missing. */
  workspaces: WorkspaceManager | null
  /** Checks uploads in the Workspace Worker process (ADR 0014); `null` when the worker is missing. */
  inspector: WorkspaceWorkerClient | null
  /** Backend apps in Deno; `null` when apps are disabled. */
  backends: BackendRunner | null
  /** Signs the capability tokens of backend app calls. */
  capabilityKey: Buffer
  /** Signs the frame URLs of views embedded in other apps' pages (ADR 0051). */
  embedKey: Buffer
  /** Files the user chose in native dialogs for local BaSyx instances (desktop). */
  fileGrants: FileGrantStore
  /** Copy plans between targets, from pasted text and imported files (DATA-012 to DATA-015). */
  copies: CopyPlanStore
  /** Local BaSyx instances on Docker or Podman (ADR 0033); `null` when hosted. */
  containers: ContainerManager | null
  /** The App Builder's coding agents (ADR 0054); `null` when hosted. */
  agents: AgentManager | null
  close: () => Promise<void>
}

/** The Deno executable: configured, else the pnpm-managed runtime (`devEngines.runtime`). */
function denoExecutable (configured: string | null): string {
  return configured ?? join(process.cwd(), 'node_modules', 'deno', process.platform === 'win32' ? 'deno.exe' : 'deno')
}

/** The bundled Workspace Worker: configured for `nuxt dev`, else next to the server entry. */
function workspaceWorkerEntry (configured: string): string | null {
  const entry = configured || process.env.STUDIO_WORKSPACE_WORKER || (process.argv[1] ? join(dirname(process.argv[1]), 'workspace-worker.mjs') : '')
  return entry && existsSync(entry) ? entry : null
}

/** Installs or updates the apps shipped with this build; a broken package never blocks startup. */
async function installBundledApps (deps: StudioDeps): Promise<void> {
  // BaSyx Docker became a native Studio feature. Its stack records live in a
  // separate table and remain intact; only the obsolete iframe installation
  // and its immutable UI blobs are removed.
  if (await removeBundledApp(deps, 'org.eclipse.basyx.studio.docker')) {
    console.info('[studio] retired bundled app org.eclipse.basyx.studio.docker removed')
  }
  for (const { name, bytes } of await loadBundledApps()) {
    try {
      const outcome = await installBundledApp(deps, bytes)
      if (outcome !== 'unchanged') {
        console.info(`[studio] bundled app ${name}: ${outcome}`)
      }
    } catch (error) {
      console.error(`[studio] bundled app ${name} was not installed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

/**
 * Installs, updates and removes the deployment's packages (STUDIO_APP_PACKAGES,
 * ADR 0044). A package that fails is skipped; its previous version stays.
 */
async function installManagedPackages (deps: StudioDeps): Promise<void> {
  const result = await reconcileManagedPackages(deps, deps.config.apps.packages)
  for (const change of ['installed', 'updated', 'removed'] as const) {
    if (result[change].length > 0) {
      console.info(`[studio] managed apps ${change}: ${result[change].join(', ')}`)
    }
  }
  for (const failure of result.failed) {
    console.error(`[studio] managed app package not installed: ${failure}`)
  }
  if (result.failed.length > 0) {
    console.error('[studio] managed apps that are no longer configured were kept, because a package failed')
  }
}

/** Revocation takes effect with the trust store read at startup (ADR 0044). */
async function reportRevokedApps (deps: StudioDeps): Promise<void> {
  for (const record of await listInstallations(deps)) {
    const { revoked } = installationTrust(record, deps.config.apps.trustStore)
    if (revoked) {
      console.warn(`[studio] app ${record.appId} ${record.version} is revoked: ${revocationReason(revoked, record)}`)
    }
  }
}

let runtime: Promise<StudioRuntime> | undefined

async function initialize (): Promise<StudioRuntime> {
  const { app, studio: runtimeConfig } = useRuntimeConfig()
  const deploymentMode = runtimeConfig.deploymentMode as DeploymentMode
  const config = loadStudioConfig(process.env, deploymentMode, app.baseURL)
  for (const warning of configurationWarnings(config, process.env)) {
    console.warn(`[studio] ${warning}`)
  }
  configureOutboundProxy(config.outboundProxy)
  if (config.outboundProxy) {
    console.info(`[studio] ${describeOutboundProxy(config.outboundProxy)}`)
  }
  const handle = await openDatabase(config.database)
  try {
    const applied = await applyMigrations(handle.db, await loadMigrationsFromAssets())
    if (applied.length > 0) {
      console.info(`[studio] applied database migrations: ${applied.join(', ')}`)
    }
    const deps: StudioDeps = { config, db: handle.db, cipher: new SecretCipher(config.dataKey) }
    if (config.apps.baseUrl) {
      // Managed packages first: they take precedence over bundled apps with the same ID.
      // Apps before infrastructures: declared settings values are checked against them (ADR 0048).
      await installManagedPackages(deps)
      await installBundledApps(deps)
      await reportRevokedApps(deps)
    }
    const declared = await reconcileManagedInfrastructures(deps, parseInfrastructureSources(config.managedInfrastructures))
    for (const change of ['created', 'updated', 'removed'] as const) {
      if (declared[change].length > 0) {
        console.info(`[studio] declared infrastructures ${change}: ${declared[change].join(', ')}`)
      }
    }
    if (config.deploymentMode === 'desktop') {
      await ensureDesktopSession(deps)
    }
    let workspaces: WorkspaceManager | null = null
    let inspector: WorkspaceWorkerClient | null = null
    const entry = workspaceWorkerEntry(String(runtimeConfig.workspaceWorker ?? ''))
    if (entry) {
      // Desktop shares one worker for workspaces and upload checks; hosted
      // Studio starts it only to check uploads.
      inspector = new WorkspaceWorkerClient({ entry })
      if (config.deploymentMode === 'desktop') {
        workspaces = new WorkspaceManager(inspector)
      }
    } else {
      console.warn('[studio] the Workspace Worker was not found; AASX workspaces and uploads are unavailable')
    }
    const backends = config.apps.baseUrl
      ? new BackendRunner({
          denoPath: denoExecutable(config.apps.denoPath),
          workDir: config.apps.workDir,
          capabilityUrl: config.apps.capabilityUrl,
          callPath: studioPath(config, `${apiBasePath}/app-calls`),
        })
      : null
    const fileGrants = new FileGrantStore()
    const containers = config.containers
      ? new ContainerManager({
          deps,
          dataDir: config.containers.dataDir,
          discovery: systemDiscoveryEnvironment(),
          grants: fileGrants,
          infrastructures: {
            create: async ({ name, spec, actor, requestId }) => (await createInfrastructure(deps, actor, infrastructureInputOf(name, spec), requestId)).id,
            remove: (id, actor, requestId) => deleteInfrastructure(deps, actor, id, requestId),
          },
        })
      : null
    const agents = config.appBuilder
      ? new AgentManager({
          projectsDir: config.appBuilder.projectsDir ?? defaultProjectsDir(),
          store: new DatabaseProjectStore(deps.db),
          template: loadAppTemplate,
          studioVersion: String(runtimeConfig.version ?? '0.0.0'),
          previews: previewInstaller({ ...deps, backends }, 'app-builder'),
          // The adapters are started as scripts, never imported; Nitro's file
          // tracing copies them into the server output (nuxt.config.ts).
          agents: agentCatalog(createRequire(import.meta.url).resolve),
          // Electron's Node in the desktop app (ELECTRON_RUN_AS_NODE).
          nodePath: process.execPath,
        })
      : null
    console.info(`[studio] ${config.deploymentMode} mode, ${config.database.kind} database, public URL ${config.publicUrl}${config.basePath}`)
    return {
      ...deps,
      broker: new CredentialBroker(deps),
      workspaces,
      inspector,
      backends,
      capabilityKey: capabilityTokenKey(config.dataKey),
      embedKey: embedTokenKey(config.dataKey),
      fileGrants,
      copies: new CopyPlanStore(),
      containers,
      agents,
      close: async () => {
        await agents?.dispose()
        backends?.dispose()
        await containers?.dispose()
        workspaces?.dispose()
        inspector?.close()
        await handle.close()
      },
    }
  } catch (error) {
    await handle.close()
    throw error
  }
}

/** The process-wide Studio runtime (configuration, database, cipher, credential broker). */
export function useStudio (): Promise<StudioRuntime> {
  runtime ??= initialize().catch(error => {
    runtime = undefined
    throw error
  })
  return runtime
}

export async function closeStudio (): Promise<void> {
  const current = runtime
  runtime = undefined
  if (current) {
    await (await current.catch(() => undefined))?.close()
  }
}
