import type { AppBuilderOperation, AppBuilderOperationResults } from '#shared/contract'
import type { AgentManager } from '../lib/agents/manager'
import type { PreviewInstaller } from '../lib/app-projects/previews'
import type { ReleaseInstaller } from '../lib/app-projects/release'
import type { Actor, StudioDeps } from '../lib/deps'
import type { FileGrantStore } from '../lib/desktop/grants'
import type { StudioRuntime } from './studio'
import type { z } from 'zod'
import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { signPackage } from '@basyx/studio-app-kit/signature'
import { appBuilderOperationSchemas } from '#shared/contract'
import { ensureMachineKey, findMachineKey, signWithMachineKey } from '../lib/app-projects/keys'
import { contributionsFor } from '../lib/apps/contributions'
import { readAppPackage } from '../lib/apps/package'
import { describeInstallation, findPreviewApp, inspectAppPackage, installApp, installPreviewApp, listInstallations, removeInstallation } from '../lib/apps/store'
import { StudioProblem } from '../lib/problem'

/** The validated parameters of an operation, with their defaults applied. */
type Params<O extends AppBuilderOperation> = z.output<(typeof appBuilderOperationSchemas)[O]>

/** Who calls: installing a release needs an administrator, as an upload does. */
export interface AppBuilderCall {
  actor: Actor
  requestId: string
}

function requireAdmin (call: AppBuilderCall): void {
  if (!call.actor.isAdmin) {
    throw new StudioProblem('forbidden', 'Installing apps needs an administrator.')
  }
}

type Handler<O extends AppBuilderOperation> = (params: Params<O>, agents: AgentManager, call: AppBuilderCall) => Promise<AppBuilderOperationResults[O]> | AppBuilderOperationResults[O]

/** One handler per App Builder operation; adding an operation without one does not compile. */
const handlers: { [O in AppBuilderOperation]: Handler<O> } = {
  getStatus: ({ refresh }, agents) => agents.status(refresh),
  listProjects: (_, agents) => agents.projects(),
  createProject: ({ name, agentId, model, prompt, source }, agents) => agents.createProject(name, agentId, prompt ?? null, source ?? null, model ?? null),
  addFolder: ({ folderHandle, agentId, model, name }, agents) => agents.addFolder(folderHandle, agentId, name ?? null, model ?? null),
  listBundledApps: (_, agents) => agents.bundledApps(),
  getAgentModels: ({ agentId }, agents) => agents.agentModels(agentId),
  removeProject: async ({ projectId, deleteFolder }, agents) => {
    await agents.removeProject(projectId, deleteFolder)
    return null
  },
  openFolder: async ({ projectId }, agents) => {
    await agents.openFolder(projectId)
    return null
  },
  startConversation: ({ projectId, agentId, model }, agents) => agents.startConversation(projectId, agentId, model ?? null),
  deleteConversation: async ({ conversationId }, agents) => {
    await agents.deleteConversation(conversationId)
    return null
  },
  sendPrompt: async ({ conversationId, text }, agents) => {
    await agents.prompt(conversationId, text)
    return null
  },
  cancelTurn: async ({ conversationId }, agents) => {
    await agents.cancel(conversationId)
    return null
  },
  answerApproval: async ({ conversationId, approvalId, decision }, agents) => {
    await agents.answer(conversationId, approvalId, decision)
    return null
  },
  setModel: ({ conversationId, value }, agents) => agents.setModel(conversationId, value),
  setPermissionMode: ({ conversationId, mode, acknowledgeRisk }, agents) => agents.setPermissionMode(conversationId, mode, acknowledgeRisk),
  getChanges: ({ projectId, commit }, agents) => agents.changes(projectId, commit),
  undoTurn: async ({ conversationId, commit }, agents) => {
    await agents.undo(conversationId, commit)
    return null
  },
  getPreview: ({ projectId }, agents) => agents.preview(projectId),
  buildPreview: ({ projectId }, agents) => agents.buildPreview(projectId),
  approvePreview: ({ projectId }, agents) => agents.approvePreview(projectId),
  getReleaseInfo: ({ projectId }, agents) => agents.releaseInfo(projectId),
  inspectRelease: ({ projectId, bump, signing, keyHandle, passphrase }, agents, call) => {
    requireAdmin(call)
    return agents.inspectRelease(projectId, { bump, signing, keyHandle: keyHandle ?? null, passphrase: passphrase ?? null })
  },
  installRelease: ({ projectId, digest }, agents, call) => {
    requireAdmin(call)
    return agents.installRelease(projectId, digest, call)
  },
  exportRelease: ({ projectId, digest, fileHandle }, agents, call) => {
    requireAdmin(call)
    return agents.exportRelease(projectId, digest, fileHandle)
  },
  getMachineKey: (_, agents) => agents.machineKey(),
}

export function isAppBuilderOperation (name: string): name is AppBuilderOperation {
  return Object.hasOwn(appBuilderOperationSchemas, name)
}

/** The App Builder's agents; only the desktop app has them (ADR 0054). */
export function requireAgents (studio: StudioRuntime): AgentManager {
  if (!studio.agents) {
    throw new StudioProblem('unsupported_operation', 'The App Builder is only available in the desktop app.')
  }
  return studio.agents
}

/** Runs an App Builder operation whose parameters were validated with its schema. */
export async function performAppBuilderOperation<O extends AppBuilderOperation> (studio: StudioRuntime, operation: O, params: Params<O>, call: AppBuilderCall): Promise<AppBuilderOperationResults[O]> {
  const handler = handlers[operation] as Handler<O>
  return await handler(params, requireAgents(studio), call)
}

/**
 * The App Builder's previews in Studio's app store (ADR 0054, plan B3):
 * installed by the local user, unsigned, flagged as previews.
 */
export function previewInstaller (studio: StudioDeps & { backends: { stop: (id: string) => Promise<void> } | null }, installedBy: string): PreviewInstaller | null {
  const baseUrl = studio.config.apps.baseUrl
  if (!baseUrl) {
    return null
  }
  return {
    read: bytes => readAppPackage(bytes, studio.config.deploymentMode).manifest,
    current: async id => {
      const record = await findPreviewApp(studio, id)
      return record ? { installationId: record.id, manifest: record.manifest } : null
    },
    install: async (bytes, id) => {
      const { record, previous } = await installPreviewApp(studio, bytes, id, installedBy)
      if (previous) {
        await studio.backends?.stop(record.id)
      }
      return record.id
    },
    contributions: async id => {
      const record = await findPreviewApp(studio, id)
      if (!record) {
        return null
      }
      // Every view, for the first semantic ID it applies to.
      const semanticIds = [...new Set((record.manifest.contributes.submodelViews ?? []).flatMap(view => view.semanticIds.slice(0, 1)))]
      const contributions = contributionsFor([record], baseUrl, semanticIds)
      return { ...contributions, submodelViews: contributions.submodelViews.filter((view, index, all) => all.findIndex(other => other.id === view.id) === index) }
    },
    remove: async id => {
      const record = await findPreviewApp(studio, id)
      if (record) {
        await removeInstallation(studio, record, installedBy)
      }
    },
  }
}

/**
 * Releases in Studio's app store (ADR 0054, plan B5–B8): signed with this
 * computer's key or the user's own, checked and installed as an upload is
 * (ADR 0044).
 */
export function releaseInstaller (studio: StudioDeps & { backends: { stop: (id: string) => Promise<void> } | null, fileGrants: FileGrantStore }): ReleaseInstaller | null {
  if (!studio.config.apps.baseUrl) {
    return null
  }
  return {
    installed: async appId => {
      const record = (await listInstallations(studio)).find(entry => entry.appId === appId && !entry.preview)
      return record ? { version: record.version, trust: record.trust, publisher: record.publisher } : null
    },
    sign: async (bytes, signing, keyHandle, passphrase) => {
      if (signing === 'unsigned') {
        return null
      }
      if (signing === 'machine') {
        return await signWithMachineKey(studio, bytes)
      }
      const pem = await readFile(studio.fileGrants.take(keyHandle ?? '', 'signing-key'), 'utf8')
      try {
        return signPackage(bytes, pem, passphrase ?? undefined)
      } catch (error) {
        throw new StudioProblem('invalid_request', 'The key could not sign: it is not an ECDSA P-256 private key in PEM, or it needs its passphrase.', { cause: error })
      }
    },
    inspect: (bytes, signature) => inspectAppPackage(studio, bytes, signature),
    install: async (bytes, signature, caller) => {
      const { record, previous } = await installApp(studio, caller.actor as Actor, bytes, signature, caller.requestId)
      if (previous) {
        await studio.backends?.stop(record.id)
      }
      return await describeInstallation(studio, record)
    },
    save: async (bytes, signature, fileHandle) => {
      const path = studio.fileGrants.take(fileHandle, 'app-package')
      await writeFile(path, bytes)
      if (signature) {
        await writeFile(`${path}.sig`, signature)
      }
      return basename(path)
    },
    machineKey: create => create ? ensureMachineKey(studio) : findMachineKey(studio),
  }
}
