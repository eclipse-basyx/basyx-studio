import type { AppBuilderOperation, AppBuilderOperationResults } from '#shared/contract'
import type { AgentManager } from '../lib/agents/manager'
import type { PreviewInstaller } from '../lib/app-projects/previews'
import type { StudioDeps } from '../lib/deps'
import type { StudioRuntime } from './studio'
import type { z } from 'zod'
import { appBuilderOperationSchemas } from '#shared/contract'
import { contributionsFor } from '../lib/apps/contributions'
import { readAppPackage } from '../lib/apps/package'
import { findPreviewApp, installPreviewApp, removeInstallation } from '../lib/apps/store'
import { StudioProblem } from '../lib/problem'

/** The validated parameters of an operation, with their defaults applied. */
type Params<O extends AppBuilderOperation> = z.output<(typeof appBuilderOperationSchemas)[O]>

/** One handler per App Builder operation; adding an operation without one does not compile. */
const handlers: { [O in AppBuilderOperation]: (params: Params<O>, agents: AgentManager) => Promise<AppBuilderOperationResults[O]> | AppBuilderOperationResults[O] } = {
  getStatus: ({ refresh }, agents) => agents.status(refresh),
  listProjects: (_, agents) => agents.projects(),
  createProject: ({ name, agentId, prompt }, agents) => agents.createProject(name, agentId, prompt),
  removeProject: async ({ projectId, deleteFolder }, agents) => {
    await agents.removeProject(projectId, deleteFolder)
    return null
  },
  openFolder: async ({ projectId }, agents) => {
    await agents.openFolder(projectId)
    return null
  },
  startConversation: ({ projectId, agentId }, agents) => agents.startConversation(projectId, agentId),
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
  getChanges: ({ projectId, commit }, agents) => agents.changes(projectId, commit),
  undoTurn: async ({ conversationId, commit }, agents) => {
    await agents.undo(conversationId, commit)
    return null
  },
  getPreview: ({ projectId }, agents) => agents.preview(projectId),
  buildPreview: ({ projectId }, agents) => agents.buildPreview(projectId),
  approvePreview: ({ projectId }, agents) => agents.approvePreview(projectId),
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
export async function performAppBuilderOperation<O extends AppBuilderOperation> (studio: StudioRuntime, operation: O, params: Params<O>): Promise<AppBuilderOperationResults[O]> {
  const handler = handlers[operation] as (params: Params<O>, agents: AgentManager) => Promise<AppBuilderOperationResults[O]> | AppBuilderOperationResults[O]
  return await handler(params, requireAgents(studio))
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
