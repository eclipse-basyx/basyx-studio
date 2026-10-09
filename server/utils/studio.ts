import type { DeploymentMode } from '#shared/contract'
import type { StudioDeps } from '../lib/deps'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { useRuntimeConfig } from 'nuxt/server'
import { BackendRunner } from '../lib/apps/runner'
import { capabilityTokenKey } from '../lib/apps/tokens'
import { loadStudioConfig } from '../lib/config'
import { SecretCipher } from '../lib/crypto/cipher'
import { openDatabase } from '../lib/database/client'
import { applyMigrations } from '../lib/database/migrate'
import { ensureDesktopSession } from '../lib/sessions'
import { CredentialBroker } from '../lib/targets/credentials'
import { WorkspaceWorkerClient } from '../lib/workspaces/client'
import { WorkspaceManager } from '../lib/workspaces/manager'
import { loadMigrationsFromAssets } from '../nitro/migration-assets'

export interface StudioRuntime extends StudioDeps {
  broker: CredentialBroker
  /** Desktop AASX workspaces; `null` when hosted or the worker is missing. */
  workspaces: WorkspaceManager | null
  /** Backend apps in Deno; `null` when apps are disabled. */
  backends: BackendRunner | null
  /** Signs the capability tokens of backend app calls. */
  capabilityKey: Buffer
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

let runtime: Promise<StudioRuntime> | undefined

async function initialize (): Promise<StudioRuntime> {
  const runtimeConfig = useRuntimeConfig().studio
  const deploymentMode = runtimeConfig.deploymentMode as DeploymentMode
  const config = loadStudioConfig(process.env, deploymentMode)
  const handle = await openDatabase(config.database)
  try {
    const applied = await applyMigrations(handle.db, await loadMigrationsFromAssets())
    if (applied.length > 0) {
      console.info(`[studio] applied database migrations: ${applied.join(', ')}`)
    }
    const deps: StudioDeps = { config, db: handle.db, cipher: new SecretCipher(config.dataKey) }
    if (config.deploymentMode === 'desktop') {
      await ensureDesktopSession(deps)
    }
    let workspaces: WorkspaceManager | null = null
    if (config.deploymentMode === 'desktop') {
      const entry = workspaceWorkerEntry(String(runtimeConfig.workspaceWorker ?? ''))
      if (entry) {
        workspaces = new WorkspaceManager(new WorkspaceWorkerClient({ entry }))
      } else {
        console.warn('[studio] the Workspace Worker was not found; AASX workspaces are unavailable')
      }
    }
    const backends = config.apps.baseUrl
      ? new BackendRunner({
          denoPath: denoExecutable(config.apps.denoPath),
          workDir: config.apps.workDir,
          capabilityUrl: config.apps.capabilityUrl,
        })
      : null
    console.info(`[studio] ${config.deploymentMode} mode, ${config.database.kind} database, public URL ${config.publicUrl}`)
    return {
      ...deps,
      broker: new CredentialBroker(deps),
      workspaces,
      backends,
      capabilityKey: capabilityTokenKey(config.dataKey),
      close: async () => {
        backends?.dispose()
        workspaces?.dispose()
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
