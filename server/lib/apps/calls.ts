import type { AppMethodName, AppPermission } from '#shared/contract'
import type { AasTarget } from '../targets/aas-target'
import type { AppInstallationRecord } from './store'
import type { Methods } from '@basyx/studio-sdk/protocol'
import { methodPermissions } from '#shared/contract'
import { parseLocator, splitAddressable } from '../aas/keys'
import { resolveSubmodelRefs } from '../aas/submodel-refs'
import { StudioProblem } from '../problem'

export type AasMethodName = Extract<AppMethodName, `studio.aas.${string}`>

export function isAasMethod (method: AppMethodName): method is AasMethodName {
  return method.startsWith('studio.aas.')
}

export function isWriteMethod (method: AppMethodName): boolean {
  return method === 'studio.aas.setElementValue'
}

/** Who makes a call: the host bridge for a frame, or a backend with a capability token. */
export type AppCaller = 'host' | 'backend'

/**
 * Refuses a call the installed manifest does not permit (ADR 0018). The
 * user's own rights are checked separately, by the target.
 */
export function authorizeAppCall (installation: AppInstallationRecord, method: AppMethodName, caller: AppCaller): void {
  if (caller === 'backend' && !isAasMethod(method)) {
    throw new StudioProblem('unsupported_operation', `${method} is not available to backend apps.`)
  }
  const permission: AppPermission | null = methodPermissions[method]
  if (permission && !installation.manifest.permissions.includes(permission)) {
    throw new StudioProblem('app_permission_not_declared', `${method} needs the permission ${permission}, which ${installation.appId} did not declare.`)
  }
}

/** An idShortPath of an API-addressable element; operation variables are not. */
function addressable (idShortPath: string): string {
  const { idShortPath: path, rest } = splitAddressable(parseLocator(idShortPath))
  if (rest.length > 0) {
    throw new StudioProblem('unsupported_operation', 'Operation variables cannot be addressed separately.')
  }
  return path
}

/** Runs an AAS capability method on the caller's target. Parameters are already validated. */
export async function executeAasMethod<M extends AasMethodName> (target: AasTarget, method: M, params: Methods[M]['params']): Promise<Methods[M]['result']>
export async function executeAasMethod (target: AasTarget, method: AasMethodName, params: Record<string, any>): Promise<unknown> {
  switch (method) {
    case 'studio.aas.listShells': {
      const page = await target.listShells(params.limit ?? 50, params.cursor)
      return {
        items: page.items.map(({ key: _key, description: _description, ...summary }) => summary),
        page: page.page,
      }
    }
    case 'studio.aas.getShell': {
      return target.shell(params.shellId)
    }
    case 'studio.aas.listSubmodels': {
      const refs = await resolveSubmodelRefs(target, await target.submodelIds(params.shellId))
      return { items: refs.map(({ key: _key, submodelId, ...ref }) => ({ id: submodelId, ...ref })) }
    }
    case 'studio.aas.getSubmodel': {
      return target.submodel(params.submodelId)
    }
    case 'studio.aas.getElement': {
      const snapshot = await target.element(params.submodelId, addressable(params.idShortPath))
      return { value: snapshot.value, revision: snapshot.revision, concurrency: snapshot.concurrency }
    }
    case 'studio.aas.setElementValue': {
      const snapshot = await target.setElementValue(params.submodelId, addressable(params.idShortPath), params.value, params.revision)
      return { value: snapshot.value, revision: snapshot.revision, concurrency: snapshot.concurrency }
    }
  }
}
