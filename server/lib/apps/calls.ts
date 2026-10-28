import type { IdScheme } from '#shared/aas/identifiers'
import type { AppMethodName, AppPermission, TargetCapabilities } from '#shared/contract'
import type { JsonObject } from '../aas/outline'
import type { SyncPlan } from '../aas/sync'
import type { AasTarget, ElementSnapshot, StructureResult } from '../targets/aas-target'
import type { AppInstallationRecord } from './store'
import type { TrustStore } from './trust'
import type { ConceptInfo, Methods } from '@basyx/studio-sdk/protocol'
import { editModeMethods, methodPermissions } from '#shared/contract'
import { toConceptInfo } from '../aas/basyx-go'
import { addSubmodel, createShell, createStandaloneSubmodel, deleteShellWithSubmodels, deleteSubmodelWithReferences } from '../aas/creation'
import { childProperty, containerChildren, verifySubmodel } from '../aas/edits'
import { parseLocator, splitAddressable } from '../aas/keys'
import { firstKeyValue } from '../aas/outline'
import { resolveSubmodelRefs } from '../aas/submodel-refs'
import { isAbsent } from '../copies/plan'
import { StudioProblem } from '../problem'
import { revisionOf, structureRevisionOf } from '../targets/revision'
import { installationTrust, revocationReason } from './trust'

export type AasMethodName = Extract<AppMethodName, `studio.aas.${string}`>

export function isAasMethod (method: AppMethodName): method is AasMethodName {
  return method.startsWith('studio.aas.')
}

export function isWriteMethod (method: AppMethodName): boolean {
  return method === 'studio.aas.setElementValue' || requiresEditMode(method)
}

/** Structural writes and attachment uploads, which Studio runs only in its edit mode (MVP-7 A1). */
export function requiresEditMode (method: AppMethodName): boolean {
  return editModeMethods.includes(method)
}

/** Who makes a call: the host bridge for a frame, or a backend with a capability token. */
export type AppCaller = 'host' | 'backend'

/** Studio's mode when the call was made: what the host page showed, or what a backend's token was issued in. */
export type AppCallMode = 'view' | 'edit'

/**
 * Refuses a call the installed manifest does not permit (ADR 0018), and every
 * call of a revoked app (ADR 0044). Backends may call AAS methods and their
 * app's HTTP connections (ADR 0047). Reserved permissions need more than the
 * manifest: `studio.containers` is held by bundled apps only (ADR 0033),
 * `studio.timeseries.read` also by signed apps whose publisher the trust
 * store grants it. The user's own rights are checked separately, by the
 * target.
 */
export function authorizeAppCall (installation: AppInstallationRecord, method: AppMethodName, caller: AppCaller, trustStore: TrustStore, mode: AppCallMode = 'view'): void {
  const trust = installationTrust(installation, trustStore)
  if (trust.revoked) {
    throw new StudioProblem('app_revoked', `${installation.appId} is no longer trusted: ${revocationReason(trust.revoked, installation)}.`)
  }
  // Studio's page carries the bytes of an attachment; a backend has none to send.
  // Backends may call their app's HTTP connections (ADR 0047).
  if (caller === 'backend' && (!isAasMethod(method) || method === 'studio.aas.putAttachment') && method !== 'studio.connections.call') {
    throw new StudioProblem('unsupported_operation', `${method} is not available to backend apps.`)
  }
  const permission: AppPermission | null = methodPermissions[method]
  if (permission && !installation.manifest.permissions.includes(permission)) {
    throw new StudioProblem('app_permission_not_declared', `${method} needs the permission ${permission}, which ${installation.appId} did not declare.`)
  }
  if (isContainerMethod(method) && !installation.bundled) {
    throw new StudioProblem('app_permission_not_declared', `${method} is reserved for the apps shipped with Studio.`)
  }
  if (method === 'studio.timeseries.read' && !trust.granted.includes('studio.timeseries.read')) {
    throw new StudioProblem('app_permission_not_declared', `${method} is reserved for the apps shipped with Studio and for signed apps whose publisher the trust store grants it.`)
  }
  // The app's own controls follow `context.mode`; Studio does not rely on them.
  if (requiresEditMode(method) && mode !== 'edit') {
    throw new StudioProblem('app_edit_mode_required', `${method} needs Studio's edit mode.`)
  }
}

/**
 * Refuses a call from code of another package than the installed one: a
 * frame or backend that was loaded before an in-place update (ADR 0044).
 * Its permissions and trust are those of the version it runs, not of the
 * update.
 */
export function requireInstalledRevision (installation: AppInstallationRecord, digest: string | undefined): void {
  if (digest !== undefined && digest !== installation.digest) {
    throw new StudioProblem('app_outdated', `${installation.appId} was updated to ${installation.version} after this frame was loaded. Reload it.`)
  }
}

export type ContainerMethodName = Extract<AppMethodName, `studio.containers.${string}`>

export function isContainerMethod (method: AppMethodName): method is ContainerMethodName {
  return method.startsWith('studio.containers.')
}

/** An idShortPath of an API-addressable element; operation variables are not. */
function addressable (idShortPath: string): string {
  const { idShortPath: path, rest } = splitAddressable(parseLocator(idShortPath))
  if (rest.length > 0) {
    throw new StudioProblem('unsupported_operation', 'Operation variables cannot be addressed separately.')
  }
  return path
}

/**
 * Checks that the user can read the shell an app opens with
 * `studio.ui.openShell` (external apps plan X2), and that the shell
 * references the submodel to select, before Studio's page leaves the app.
 * The target applies the user's rights, so a shell they cannot read is
 * refused as it would be on its page.
 */
export async function checkShellToOpen (target: AasTarget, params: Methods['studio.ui.openShell']['params']): Promise<void> {
  await target.shell(params.shellId)
  if (params.submodelId !== undefined && !(await target.submodelIds(params.shellId)).includes(params.submodelId)) {
    throw new StudioProblem('target_resource_not_found', 'The shell does not reference this submodel.')
  }
}

/**
 * Reads the submodel an app shows with `studio.ui.openView` (ADR 0051) as
 * the user, for the semantic ID that picks the view, and checks that the
 * shell, if named, references it. The target applies the user's rights, so
 * a submodel they cannot read is refused before any view opens.
 */
export async function checkViewToOpen (target: AasTarget, params: Methods['studio.ui.openView']['params']): Promise<{ id: string, semanticId: string, idShort: string | null }> {
  if (params.shellId !== undefined) {
    await checkShellToOpen(target, { shellId: params.shellId, submodelId: params.submodelId })
  }
  const metadata = await target.submodelMetadata(params.submodelId)
  const semanticId = firstKeyValue(metadata.semanticId)
  if (semanticId === null) {
    throw new StudioProblem('unsupported_operation', 'The submodel has no semantic ID, so no app has a view for it.')
  }
  return { id: params.submodelId, semanticId, idShort: typeof metadata.idShort === 'string' ? metadata.idShort : null }
}

/** The target of an AAS call, with what writes over several resources need (MVP-5 plan, W4, W5). */
export interface AasCallContext {
  target: AasTarget
  /** How new shells and submodels get their identifiers (ADR 0028). */
  idScheme: IdScheme
  /** What Studio writes to registries and discovery for this user (DATA-020). */
  syncPlan: () => Promise<SyncPlan>
}

/** The capability each structural method needs of the target, checked before any downstream request. */
const structuralCapabilities: Partial<Record<AasMethodName, keyof TargetCapabilities>> = {
  'studio.aas.createShell': 'createResources',
  'studio.aas.createSubmodel': 'createResources',
  'studio.aas.deleteSubmodel': 'createResources',
  'studio.aas.deleteShell': 'deleteShells',
  'studio.aas.putSubmodel': 'writeStructure',
  'studio.aas.addElement': 'writeStructure',
  'studio.aas.putElement': 'writeStructure',
  'studio.aas.deleteElement': 'writeStructure',
  'studio.aas.putAttachment': 'files',
}

/** The SDK's element snapshot (studio-sdk/0), with the structure revision of a container. */
function toSnapshot (snapshot: ElementSnapshot): Methods['studio.aas.getElement']['result'] {
  const { value, revision, concurrency } = snapshot
  return { value, revision, concurrency, structureRevision: childProperty(value.modelType) ? structureRevisionOf(containerChildren(value)) : null }
}

function toWriteResult (result: StructureResult): Methods['studio.aas.addElement']['result'] {
  if (!result.path || !result.snapshot) {
    throw new StudioProblem('internal_error')
  }
  return { ...toSnapshot(result.snapshot), idShortPath: result.path }
}

function toSubmodelSnapshot (submodel: JsonObject): Methods['studio.aas.getSubmodelSnapshot']['result'] {
  const elements = Array.isArray(submodel.submodelElements) ? submodel.submodelElements as unknown[] : []
  return { submodel, revision: revisionOf(submodel), structureRevision: structureRevisionOf(elements) }
}

/** A submodel as an app passes it; `modelType` may be left out. */
function submodelJson (submodel: JsonObject): JsonObject {
  return { modelType: 'Submodel', ...submodel }
}

/** Concept descriptions read at once for `describeConcepts`. */
const conceptReads = 8

/**
 * The concept descriptions for semantic IDs, in their order (app API 0.1.15):
 * each ID read once, a few at a time; `null` for one the target does not
 * have, and for all on a target without concept descriptions. Other failures
 * fail the call rather than look like a missing description.
 */
async function describeConcepts (target: AasTarget, ids: string[]): Promise<Array<ConceptInfo | null>> {
  if (!target.capabilities.conceptDescriptions) {
    return ids.map(() => null)
  }
  const unique = [...new Set(ids)]
  const found = new Map<string, ConceptInfo | null>()
  let next = 0
  const read = async () => {
    while (next < unique.length) {
      const id = unique[next++]!
      try {
        found.set(id, toConceptInfo(id, await target.conceptDescription(id)))
      } catch (error) {
        if (!isAbsent(error)) {
          throw error
        }
        found.set(id, null)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(conceptReads, unique.length) }, read))
  return ids.map(id => found.get(id) ?? null)
}

/**
 * Runs an AAS capability method on the caller's target. Parameters are
 * already validated; structural writes use the editor's code paths, so
 * revisions, AAS Core findings, registry sync and a workspace's undo log
 * apply as in the editor.
 */
export async function executeAasMethod<M extends AasMethodName> (context: AasCallContext, method: M, params: Methods[M]['params']): Promise<Methods[M]['result']>
export async function executeAasMethod (context: AasCallContext, method: AasMethodName, params: Record<string, any>): Promise<unknown> {
  const { target } = context
  const capability = structuralCapabilities[method]
  if (capability && !target.capabilities[capability]) {
    throw new StudioProblem('unsupported_operation', 'This target does not support this operation.')
  }
  const creation = async () => ({ target, scheme: context.idScheme, plan: await context.syncPlan() })
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
      // The SDK's shape (studio-sdk/0): the fields are named, so new ones on Studio's own references stay internal.
      return { items: refs.map(ref => ({ id: ref.submodelId, idShort: ref.idShort, semanticId: ref.semanticId, status: ref.status })) }
    }
    case 'studio.aas.getSubmodel': {
      return target.submodel(params.submodelId)
    }
    case 'studio.aas.getSubmodelSnapshot': {
      return toSubmodelSnapshot(await target.submodel(params.submodelId))
    }
    case 'studio.aas.getElement': {
      return toSnapshot(await target.element(params.submodelId, addressable(params.idShortPath)))
    }
    case 'studio.aas.describeConcepts': {
      return { concepts: await describeConcepts(target, params.ids as string[]) }
    }
    case 'studio.aas.setElementValue': {
      return toSnapshot(await target.setElementValue(params.submodelId, addressable(params.idShortPath), params.value, params.revision))
    }
    case 'studio.aas.createShell': {
      const submodels = (params.submodels as JsonObject[]).map(submodel => ({ source: 'json' as const, submodel: submodelJson(submodel) }))
      const { shell, steps } = await createShell(await creation(), { shell: params.shell, submodels })
      return { shell, steps }
    }
    case 'studio.aas.createSubmodel': {
      const source = { source: 'json' as const, submodel: submodelJson(params.submodel) }
      const { submodelId, steps } = params.shellId
        ? await addSubmodel(await creation(), params.shellId, source)
        : await createStandaloneSubmodel(await creation(), source)
      return { submodelId, steps }
    }
    case 'studio.aas.putSubmodel': {
      const submodel = verifySubmodel(submodelJson(params.submodel))
      if (submodel.id !== params.submodelId) {
        throw new StudioProblem('validation_failed', 'The identifier of a submodel cannot change.', { violations: [{ path: 'id', message: 'Must be the submodel\'s identifier.' }] })
      }
      return toSubmodelSnapshot(await target.replaceSubmodel(params.submodelId, submodel, params.revision))
    }
    case 'studio.aas.addElement': {
      const parent = params.parentPath === undefined ? null : addressable(params.parentPath)
      return toWriteResult(await target.addElement(params.submodelId, parent, params.element, params.index ?? null, params.structureRevision))
    }
    case 'studio.aas.putElement': {
      return toWriteResult(await target.replaceElement(params.submodelId, addressable(params.idShortPath), params.element, params.revision))
    }
    case 'studio.aas.deleteElement': {
      await target.deleteElement(params.submodelId, addressable(params.idShortPath), params.revision)
      return null
    }
    case 'studio.aas.deleteSubmodel': {
      return { steps: await deleteSubmodelWithReferences(await creation(), params.submodelId, params.removeReferences) }
    }
    case 'studio.aas.deleteShell': {
      return { steps: await deleteShellWithSubmodels(await creation(), params.shellId, params.deleteSubmodels) }
    }
    case 'studio.aas.putAttachment': {
      const file = { bytes: params.data as Uint8Array, contentType: params.contentType, fileName: params.fileName }
      return toSnapshot(await target.replaceAttachment(params.submodelId, addressable(params.idShortPath), file, params.revision))
    }
  }
}
