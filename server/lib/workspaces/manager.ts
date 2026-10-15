import type { Target } from '#shared/contract'
import type { JsonObject } from '../aas/outline'
import type { SyncStep } from '../aas/sync'
import type { AasTarget, BinaryContent, ElementSnapshot } from '../targets/aas-target'
import type { WorkspaceWorkerClient } from './client'
import type { WorkspaceCalls, WorkspaceInfo, WorkspaceMethod } from './protocol'
import { randomBytes } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute } from 'node:path'
import { allRights } from '../aas/basyx-go'
import { StudioProblem } from '../problem'
import { workspaceCapabilities } from '../targets/capabilities'

export type FileGrantPurpose = 'open' | 'save'

interface FileGrant {
  path: string
  purpose: FileGrantPurpose
  expiresAt: number
}

const grantTtlMs = 5 * 60 * 1000

function unsupported (): never {
  throw new StudioProblem('unsupported_operation', 'Local AASX workspaces do not support this operation.')
}

export function isWorkspaceId (id: string): boolean {
  return /^ws-[\w-]{12}$/.test(id)
}

export function toWorkspaceTarget (info: WorkspaceInfo): Target {
  return {
    id: info.workspaceId,
    kind: 'workspace',
    name: info.fileName,
    description: null,
    securityMode: null,
    authenticationState: 'not_required',
    capabilities: workspaceCapabilities,
    workspace: { fileName: info.fileName, unsavedChanges: info.unsavedChanges, isNew: info.isNew, canUndo: info.canUndo, canRedo: info.canRedo },
    registrySync: null,
  }
}

/** A desktop AASX workspace as a Studio target; every operation runs in the Workspace Worker. */
class WorkspaceAasTarget implements AasTarget {
  readonly capabilities = workspaceCapabilities

  // Server-only features (D13); the capabilities say they are absent.
  invoke = unsupported
  invocation = unsupported
  lookupShells = unsupported
  exportShell = unsupported
  upload = unsupported
  // A workspace has no registries or discovery.
  registerShells = noSync
  unregisterShell = noSync
  unregisterSubmodels = noSync
  submodelAt = unsupported
  changes = unsupported
  access = unsupported
  setAccess = unsupported
  invite = unsupported
  acceptInvitation = unsupported

  constructor (private readonly client: WorkspaceWorkerClient, private readonly workspaceId: string) {}

  listShells = (limit: number, cursor: string | undefined) => this.#call('listShells', limit, cursor)
  shell = (id: string): Promise<JsonObject> => this.#call('shell', id)
  submodelIds = (shellId: string) => this.#call('submodelIds', shellId)
  submodelMetadata = (id: string): Promise<JsonObject> => this.#call('submodelMetadata', id)
  submodel = (id: string): Promise<JsonObject> => this.#call('submodel', id)
  element = (submodelId: string, idShortPath: string): Promise<ElementSnapshot> => this.#call('element', submodelId, idShortPath)
  setElementValue: AasTarget['setElementValue'] = (submodelId, idShortPath, value, revision) =>
    this.#call('setElementValue', submodelId, idShortPath, value, revision)

  addElement: AasTarget['addElement'] = (submodelId, parentPath, element, index, structureRevision) =>
    this.#call('addElement', submodelId, parentPath, element, index, structureRevision)

  replaceElement: AasTarget['replaceElement'] = (submodelId, idShortPath, element, revision) =>
    this.#call('replaceElement', submodelId, idShortPath, element, revision)

  deleteElement: AasTarget['deleteElement'] = (submodelId, idShortPath, revision) =>
    this.#call('deleteElement', submodelId, idShortPath, revision)

  moveElement: AasTarget['moveElement'] = (submodelId, idShortPath, index, structureRevision) =>
    this.#call('moveElement', submodelId, idShortPath, index, structureRevision)

  replaceSubmodelMetadata: AasTarget['replaceSubmodelMetadata'] = (submodelId, metadata, revision) =>
    this.#call('replaceSubmodelMetadata', submodelId, metadata, revision)

  undo = () => this.#call('undo')
  redo = () => this.#call('redo')
  setThumbnail = (shellId: string, file: BinaryContent) => this.#call('setThumbnail', shellId, file)
  createSubmodel = (submodel: JsonObject) => this.#call('createSubmodel', submodel)
  deleteSubmodel = (id: string) => this.#call('deleteSubmodel', id)
  createShell = (shell: JsonObject) => this.#call('createShell', shell)
  replaceShell = (id: string, shell: JsonObject, revision: string) => this.#call('replaceShell', id, shell, revision)
  replaceSubmodel = (id: string, submodel: JsonObject, revision: string) => this.#call('replaceSubmodel', id, submodel, revision)
  addSubmodelRef = (shellId: string, submodelId: string) => this.#call('addSubmodelRef', shellId, submodelId)
  removeSubmodelRef = (shellId: string, submodelId: string) => this.#call('removeSubmodelRef', shellId, submodelId)
  deleteShell = (id: string) => this.#call('deleteShell', id)
  thumbnail = (shellId: string) => this.#call('thumbnail', shellId)
  attachment = (submodelId: string, idShortPath: string) => this.#call('attachment', submodelId, idShortPath)
  replaceAttachment = (submodelId: string, idShortPath: string, file: BinaryContent, revision: string) =>
    this.#call('replaceAttachment', submodelId, idShortPath, file, revision)

  conceptDescriptions = (limit: number, cursor: string | undefined) => this.#call('conceptDescriptions', limit, cursor)
  conceptDescription = (id: string) => this.#call('conceptDescription', id)
  /** Workspaces have no query endpoint; raw queries are not offered (`conceptDescriptionSearch: expression`). */
  searchConceptDescriptions: AasTarget['searchConceptDescriptions'] = async (search, sources, limit, cursor) => {
    if (!('expression' in search)) {
      throw new StudioProblem('query_unsupported', 'AASX packages are searched with the search field only.')
    }
    return this.#call('searchConceptDescriptions', search.expression, sources, limit, cursor)
  }

  createConceptDescription = (conceptDescription: JsonObject) => this.#call('createConceptDescription', conceptDescription)
  replaceConceptDescription = (id: string, conceptDescription: JsonObject, revision: string) =>
    this.#call('replaceConceptDescription', id, conceptDescription, revision)

  deleteConceptDescription = (id: string, revision: string) => this.#call('deleteConceptDescription', id, revision)
  conceptDescriptionUsages = (id: string) => this.#call('conceptDescriptionUsages', id)
  /** Workspaces have no query endpoint; raw queries are not offered (`search: expression`). */
  searchShells: AasTarget['searchShells'] = async (search, limit, cursor) => {
    if (!('expression' in search)) {
      throw new StudioProblem('query_unsupported', 'AASX packages are searched with the search field only.')
    }
    return { ...await this.#call('searchShells', search.expression, limit, cursor), endpoint: 'workspace' }
  }

  searchElements = (text: string, limit: number) => this.#call('searchElements', text, limit)
  effectiveRights = async () => allRights

  #call<M extends WorkspaceMethod> (method: M, ...args: Parameters<WorkspaceCalls[M]>): Promise<Awaited<ReturnType<WorkspaceCalls[M]>>> {
    return this.client.request({ op: 'call', workspaceId: this.workspaceId, method, args }) as Promise<Awaited<ReturnType<WorkspaceCalls[M]>>>
  }
}

/**
 * Desktop AASX workspaces. Native paths only arrive as file grants from the
 * Electron main process (after a user picked them in a dialog); the renderer
 * only ever sees opaque, short-lived, single-use handles.
 */
const noSync = async (): Promise<SyncStep[]> => []

export class WorkspaceManager {
  readonly #grants = new Map<string, FileGrant>()

  constructor (readonly client: WorkspaceWorkerClient) {}

  async grant (path: string, purpose: FileGrantPurpose): Promise<{ handle: string, fileName: string }> {
    if (!isAbsolute(path) || extname(path).toLowerCase() !== '.aasx') {
      throw new StudioProblem('invalid_request', 'Only absolute paths of .aasx files can be granted.')
    }
    const checked = purpose === 'open' ? await stat(path).catch(() => null) : await stat(dirname(path)).catch(() => null)
    if (!checked || (purpose === 'open' ? !checked.isFile() : !checked.isDirectory())) {
      throw new StudioProblem('not_found', 'The file or folder does not exist.')
    }
    const now = Date.now()
    for (const [handle, grant] of this.#grants) {
      if (grant.expiresAt < now) {
        this.#grants.delete(handle)
      }
    }
    const handle = randomBytes(24).toString('base64url')
    this.#grants.set(handle, { path, purpose, expiresAt: now + grantTtlMs })
    return { handle, fileName: basename(path) }
  }

  async open (handle: string): Promise<WorkspaceInfo> {
    return this.client.request({ op: 'open', path: this.#take(handle, 'open') })
  }

  /** A new, empty package (P4); it is saved with *Save as*. */
  create (): Promise<WorkspaceInfo> {
    return this.client.request({ op: 'create' })
  }

  list (): Promise<WorkspaceInfo[]> {
    return this.client.request({ op: 'list' })
  }

  async info (workspaceId: string): Promise<WorkspaceInfo> {
    const info = (await this.list()).find(workspace => workspace.workspaceId === workspaceId)
    if (!info) {
      throw new StudioProblem('not_found', 'This workspace is not open.')
    }
    return info
  }

  target (workspaceId: string): AasTarget {
    return new WorkspaceAasTarget(this.client, workspaceId)
  }

  save (workspaceId: string): Promise<WorkspaceInfo> {
    return this.client.request({ op: 'save', workspaceId })
  }

  async saveAs (workspaceId: string, handle: string): Promise<WorkspaceInfo> {
    return this.client.request({ op: 'save', workspaceId, path: this.#take(handle, 'save') })
  }

  async close (workspaceId: string, force: boolean): Promise<void> {
    const info = await this.info(workspaceId)
    if (info.unsavedChanges && !force) {
      throw new StudioProblem('workspace_unsaved_changes')
    }
    await this.client.request({ op: 'close', workspaceId })
  }

  dispose (): void {
    this.client.close()
  }

  #take (handle: string, purpose: FileGrantPurpose): string {
    const grant = this.#grants.get(handle)
    this.#grants.delete(handle)
    if (!grant || grant.purpose !== purpose || grant.expiresAt < Date.now()) {
      throw new StudioProblem('invalid_request', 'The file selection expired. Choose the file again.')
    }
    return grant.path
  }
}
