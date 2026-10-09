import type { AppMethodName } from '#shared/contract'
import type { AppCaller } from '../lib/apps/calls'
import type { AppInstallationRecord } from '../lib/apps/store'
import type { Actor } from '../lib/deps'
import type { StudioRuntime } from './studio'
import type { RequestEvent } from 'nuxt/server'
import { appMethodParamsSchemas } from '#shared/contract'
import { authorizeAppCall, executeAasMethod, isAasMethod, isWriteMethod } from '../lib/apps/calls'
import { listAppFilePaths, readAppFiles } from '../lib/apps/store'
import { issueCapabilityToken } from '../lib/apps/tokens'
import { recordAudit } from '../lib/audit'
import { StudioProblem } from '../lib/problem'
import { requestIdOf } from './handler'
import { useStudio } from './studio'
import { openTargetFor } from './target'

export function requireAppsBaseUrl (studio: StudioRuntime): string {
  if (!studio.config.apps.baseUrl) {
    throw new StudioProblem('unsupported_operation', 'Apps need a separate apps origin (STUDIO_APPS_URL).')
  }
  return studio.config.apps.baseUrl
}

export interface AppCall {
  caller: AppCaller
  actor: Actor
  installation: AppInstallationRecord
  /** The target the frame or token is bound to. */
  targetId: string | null
  method: AppMethodName
  params: unknown
}

const backendModule = /\.(?:js|mjs|json|wasm)$/

/**
 * Executes a capability call (ADR 0018): the installed manifest must declare
 * the method's permission, and the target applies the user's own rights.
 * Refusals and writes are audited with the app identity. UI methods are
 * only authorized here; the host renderer performs them.
 */
export async function performAppCall (event: RequestEvent, call: AppCall): Promise<unknown> {
  const studio = await useStudio()
  const requestId = requestIdOf(event)
  const { actor, installation, method, targetId } = call
  const auditFailure = (error: unknown) => recordAudit(studio, {
    action: 'app.call',
    outcome: 'failure',
    requestId,
    actorSubject: actor.subject,
    targetId,
    appInstallationId: installation.id,
    details: { appId: installation.appId, method, caller: call.caller, code: error instanceof StudioProblem ? error.code : 'internal_error' },
  })

  try {
    authorizeAppCall(installation, method, call.caller)
  } catch (error) {
    await auditFailure(error)
    throw error
  }

  const parsed = appMethodParamsSchemas[method].safeParse(call.params ?? {})
  if (!parsed.success) {
    throw new StudioProblem('invalid_request', `Invalid parameters for ${method}.`, {
      violations: parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })),
    })
  }
  const params = parsed.data as Record<string, unknown>

  if (method === 'studio.backend.call') {
    return callBackend(studio, call, params as { method: string, params?: unknown })
  }
  if (!isAasMethod(method)) {
    return null
  }
  if (!targetId) {
    throw new StudioProblem('invalid_request', 'This app frame is not bound to a target.')
  }

  const opened = await openTargetFor({
    actor,
    targetId,
    requestId,
    operation: method,
    read: !isWriteMethod(method),
    appInstallationId: installation.id,
  })
  if (!isWriteMethod(method)) {
    return executeAasMethod(opened.target, method, params as never)
  }
  const details = { appId: installation.appId, method, submodelId: params.submodelId, path: params.idShortPath }
  try {
    const result = await executeAasMethod(opened.target, method, params as never)
    await opened.auditWrite('success', details)
    return result
  } catch (error) {
    await opened.auditWrite('failure', { ...details, code: error instanceof StudioProblem ? error.code : 'internal_error' })
    throw error
  }
}

async function callBackend (studio: StudioRuntime, call: AppCall, params: { method: string, params?: unknown }): Promise<unknown> {
  const { installation } = call
  const backend = installation.manifest.backend
  if (!backend || !studio.backends) {
    throw new StudioProblem('app_backend_unavailable', `${installation.appId} has no backend.`)
  }
  const token = issueCapabilityToken(studio.capabilityKey, {
    installationId: installation.id,
    sessionId: call.actor.sessionId,
    targetId: call.targetId,
  })
  return studio.backends.call(installation.id, async () => {
    const paths = (await listAppFilePaths(studio, installation.id)).filter(path => backendModule.test(path))
    return { installationId: installation.id, appId: installation.appId, entry: backend.entry, files: await readAppFiles(studio, installation.id, paths) }
  }, params.method, params.params, token)
}
