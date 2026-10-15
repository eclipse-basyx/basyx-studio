import type { ConceptDescriptionSummary, ConceptDescriptionUsages, ElementHit, ElementValueInput, Page, ShellSummary } from '#shared/contract'
import type { ConceptDescriptionSource } from '#shared/search/expression'
import type { JsonObject } from '../aas/outline'
import type { Violation } from '../problem'
import type { BinaryContent, ElementSnapshot, StructureResult } from '../targets/aas-target'
import type { InspectedEnvironment, UploadFormat } from './package'

// IPC contract between the Studio Service and the Workspace Worker process.

export interface WorkspaceInfo {
  workspaceId: string
  fileName: string
  unsavedChanges: boolean
  /** Never saved: it has no file yet. */
  isNew: boolean
  canUndo: boolean
  canRedo: boolean
  /** AAS Core findings in the package as opened. */
  diagnostics: string[]
}

/** Target operations the worker executes on an opened workspace. */
export interface WorkspaceCalls {
  listShells: (limit: number, cursor: string | undefined) => Page<ShellSummary>
  shell: (id: string) => JsonObject
  submodelIds: (shellId: string) => string[]
  submodelMetadata: (id: string) => JsonObject
  submodel: (id: string) => JsonObject
  element: (submodelId: string, idShortPath: string) => ElementSnapshot
  undo: () => void
  redo: () => void
  setThumbnail: (shellId: string, file: BinaryContent) => Promise<JsonObject>
  setElementValue: (submodelId: string, idShortPath: string, value: ElementValueInput['value'], revision: string) => ElementSnapshot
  addElement: (submodelId: string, parentPath: string | null, element: JsonObject, index: number | null, structureRevision: string) => StructureResult
  replaceElement: (submodelId: string, idShortPath: string, element: JsonObject, revision: string) => StructureResult
  deleteElement: (submodelId: string, idShortPath: string, revision: string) => void
  moveElement: (submodelId: string, idShortPath: string, index: number, structureRevision: string) => StructureResult
  replaceSubmodelMetadata: (submodelId: string, metadata: JsonObject, revision: string) => JsonObject
  createSubmodel: (submodel: JsonObject) => void
  deleteSubmodel: (id: string) => void
  createShell: (shell: JsonObject) => void
  replaceShell: (id: string, shell: JsonObject, revision: string) => JsonObject
  replaceSubmodel: (id: string, submodel: JsonObject, revision: string) => JsonObject
  addSubmodelRef: (shellId: string, submodelId: string) => void
  removeSubmodelRef: (shellId: string, submodelId: string) => void
  deleteShell: (id: string) => void
  thumbnail: (shellId: string) => Promise<BinaryContent | null>
  attachment: (submodelId: string, idShortPath: string) => Promise<BinaryContent>
  replaceAttachment: (submodelId: string, idShortPath: string, file: BinaryContent, revision: string) => Promise<ElementSnapshot>
  conceptDescriptions: (limit: number, cursor: string | undefined) => Page<ConceptDescriptionSummary>
  conceptDescription: (id: string) => JsonObject
  searchConceptDescriptions: (expression: string, sources: readonly ConceptDescriptionSource[], limit: number, cursor: string | undefined) => Page<ConceptDescriptionSummary>
  createConceptDescription: (conceptDescription: JsonObject) => void
  replaceConceptDescription: (id: string, conceptDescription: JsonObject, revision: string) => JsonObject
  deleteConceptDescription: (id: string, revision: string) => void
  conceptDescriptionUsages: (id: string) => ConceptDescriptionUsages
  searchShells: (expression: string, limit: number, cursor: string | undefined) => Page<ShellSummary>
  searchElements: (text: string, limit: number) => ElementHit[]
}
export type WorkspaceMethod = keyof WorkspaceCalls

export type WorkerRequest
  = | { op: 'open', path: string }
    /** A new, empty package without a file. */
    | { op: 'create' }
    | { op: 'call', workspaceId: string, method: WorkspaceMethod, args: unknown[] }
    /** Saves in place, or to `path`, which then becomes the workspace's file (Save As). */
    | { op: 'save', workspaceId: string, path?: string }
    | { op: 'close', workspaceId: string }
    | { op: 'list' }
    /** Validates a file before it is uploaded to a live target; opens nothing. */
    | { op: 'inspect', bytes: Uint8Array, format: UploadFormat }

export interface WorkerResults {
  open: WorkspaceInfo
  create: WorkspaceInfo
  call: unknown
  save: WorkspaceInfo
  close: null
  list: WorkspaceInfo[]
  inspect: InspectedEnvironment
}

export interface WorkerProblem {
  code: string
  detail?: string
  violations?: Violation[]
}

export type WorkerResponse
  = | { id: number, ok: true, result: unknown }
    | { id: number, ok: false, problem: WorkerProblem }
