import type {
  AccessDocument,
  AccessGrant,
  ChangePage,
  ConceptDescriptionSummary,
  ConceptDescriptionUsages,
  ConcurrencyMode,
  EffectiveRights,
  ElementHit,
  ElementValueInput,
  ExportFormat,
  InvitationResult,
  Invocation,
  Page,
  ShellSearch,
  ShellSearchPage,
  ShellSummary,
  TargetCapabilities,
} from '#shared/contract'
import type { ConceptDescriptionSource } from '#shared/search/expression'
import type { JsonObject } from '../aas/outline'
import type { SyncPlan, SyncStep } from '../aas/sync'

/** An element as read, with the revision token a write must be based on. */
export interface ElementSnapshot {
  value: JsonObject
  revision: string
  concurrency: ConcurrencyMode
}

/**
 * The outcome of a structural change: the element's path after the change
 * (renamed, inserted or moved), and its content, or `null` if it was deleted.
 */
export interface StructureResult {
  path: string | null
  snapshot: ElementSnapshot | null
}

/** File content with its media type, e.g. an attachment, a thumbnail or an export. */
export interface BinaryContent {
  bytes: Uint8Array
  contentType: string
  fileName: string | null
}

export interface ChangesQuery {
  after?: string
  since?: string
  subjects?: string[]
  limit: number
}

/** Optional target features that Studio detects (they depend on the server's configuration). */
/**
 * The AAS operations the Studio API needs, independent of where the data
 * lives (ADR 0003). Implemented by live infrastructures and desktop AASX
 * workspaces; route handlers only see this interface. Operations a target
 * cannot do fail with `unsupported_operation`, and its capabilities say so
 * beforehand.
 */
export interface AasTarget {
  readonly capabilities: TargetCapabilities

  listShells: (limit: number, cursor: string | undefined) => Promise<Page<ShellSummary>>
  shell: (id: string) => Promise<JsonObject>
  /** Submodel identifiers referenced by a shell. */
  submodelIds: (shellId: string) => Promise<string[]>
  /** The submodel without its elements. */
  submodelMetadata: (id: string) => Promise<JsonObject>
  submodel: (id: string) => Promise<JsonObject>
  element: (submodelId: string, idShortPath: string) => Promise<ElementSnapshot>
  /**
   * Sets the value of a `Property` or `MultiLanguageProperty`. Fails with
   * `revision_conflict` when the element changed since `revision` was read.
   */
  setElementValue: (submodelId: string, idShortPath: string, value: ElementValueInput['value'], revision: string) => Promise<ElementSnapshot>

  /**
   * Adds an element under `parentPath` (the submodel's top level for `null`)
   * at `index` (appended for `null`). Fails with `structure_conflict` when
   * the parent's children changed since `structureRevision` was read, and
   * with `idshort_conflict` when a sibling has the same idShort.
   */
  addElement: (submodelId: string, parentPath: string | null, element: JsonObject, index: number | null, structureRevision: string) => Promise<StructureResult>
  /** Replaces an element with its edited version, including a new idShort; the caller keeps the children (W1). */
  replaceElement: (submodelId: string, idShortPath: string, element: JsonObject, revision: string) => Promise<StructureResult>
  deleteElement: (submodelId: string, idShortPath: string, revision: string) => Promise<void>
  /** Moves an element to `index` among its siblings, based on the parent's structure revision. */
  moveElement: (submodelId: string, idShortPath: string, index: number, structureRevision: string) => Promise<StructureResult>
  /** Replaces the submodel's metadata, keeping its elements; based on the `revision` of the metadata as read. */
  replaceSubmodelMetadata: (submodelId: string, metadata: JsonObject, revision: string) => Promise<JsonObject>

  /** Creates a submodel (verified by the caller). Fails with `identifier_conflict` if its ID exists. */
  createSubmodel: (submodel: JsonObject) => Promise<void>
  /** Deletes a submodel; shells that reference it keep a dangling reference unless the caller removed it. */
  deleteSubmodel: (id: string) => Promise<void>
  /** Creates a shell with its submodel references as given. */
  createShell: (shell: JsonObject) => Promise<void>
  /**
   * Replaces the shell's metadata and asset information and keeps its
   * submodel references. Based on the revision of the metadata as read.
   */
  replaceShell: (id: string, shell: JsonObject, revision: string) => Promise<JsonObject>
  /**
   * Replaces a whole submodel (instance conversion). `revision` is the hash
   * of the submodel as read in full; the structure is the caller's change.
   */
  replaceSubmodel: (id: string, submodel: JsonObject, revision: string) => Promise<JsonObject>
  addSubmodelRef: (shellId: string, submodelId: string) => Promise<void>
  removeSubmodelRef: (shellId: string, submodelId: string) => Promise<void>

  /** Undo and redo of the last applied change; workspaces only (`undo` capability). */
  undo: () => Promise<void>
  redo: () => Promise<void>
  /** Sets the shell's default thumbnail to a new file. */
  setThumbnail: (shellId: string, file: BinaryContent) => Promise<JsonObject>

  /** Deletes a shell; its submodels stay. */
  deleteShell: (id: string) => Promise<void>
  /** The shell's thumbnail, or `null` if it has none. */
  thumbnail: (shellId: string) => Promise<BinaryContent | null>
  /** The content of a File element. */
  attachment: (submodelId: string, idShortPath: string) => Promise<BinaryContent>
  /** Replaces the content of a File element, based on the revision the user saw. */
  replaceAttachment: (submodelId: string, idShortPath: string, file: BinaryContent, revision: string) => Promise<ElementSnapshot>
  invoke: (submodelId: string, idShortPath: string, args: Array<{ idShort: string, value: string | null }>, async: boolean) => Promise<Invocation>
  invocation: (submodelId: string, idShortPath: string, handle: string) => Promise<Invocation>
  conceptDescriptions: (limit: number, cursor: string | undefined) => Promise<Page<ConceptDescriptionSummary>>
  /** One concept description as stored (MVP-6 plan, W2). */
  conceptDescription: (id: string) => Promise<JsonObject>
  /** Creates a concept description (verified by the caller). Fails with `identifier_conflict` if its ID exists. */
  createConceptDescription: (conceptDescription: JsonObject) => Promise<void>
  /** Replaces a concept description, based on the `revision` of it as read; its ID cannot change. */
  replaceConceptDescription: (id: string, conceptDescription: JsonObject, revision: string) => Promise<JsonObject>
  /** Deletes a concept description, based on the `revision` of it as read; referencing elements stay as they are. */
  deleteConceptDescription: (id: string, revision: string) => Promise<void>
  /**
   * Concept descriptions matching the search field's expression or a raw
   * query, cursor-paged (MVP-6 plan, S1). Needs `conceptDescriptionSearch`
   * other than `filter`; workspaces take expressions only.
   */
  searchConceptDescriptions: (search: ShellSearch, sources: readonly ConceptDescriptionSource[], limit: number, cursor: string | undefined) => Promise<Page<ConceptDescriptionSummary>>
  /** Submodels and elements whose semantic ID names the concept description, where the target can search for them (L5). */
  conceptDescriptionUsages: (id: string) => Promise<ConceptDescriptionUsages>
  /** Shells matching the search field's expression or a raw query (MVP-4 plan, S2). */
  searchShells: (search: ShellSearch, limit: number, cursor: string | undefined) => Promise<ShellSearchPage>
  /** Submodel elements whose idShort matches a text, with the shell they belong to where it is known. */
  searchElements: (text: string, limit: number) => Promise<ElementHit[]>
  lookupShells: (assetId: string) => Promise<ShellSummary[]>
  exportShell: (shellId: string, format: ExportFormat) => Promise<BinaryContent>
  /** Adds an already validated AASX, JSON or XML environment. */
  upload: (file: BinaryContent) => Promise<void>
  /** Descriptors and asset links after an upload or delete, where Studio writes them (MVP-4 plan, I5). */
  registerShells: (shellIds: string[], plan: SyncPlan) => Promise<SyncStep[]>
  unregisterShell: (shellId: string, plan: SyncPlan) => Promise<SyncStep[]>
  /** Removes the descriptors of deleted submodels where Studio keeps the submodel registry in step. */
  unregisterSubmodels: (submodelIds: string[], plan: SyncPlan) => Promise<SyncStep[]>
  /** The submodel as it was at `date` (ISO 8601). */
  submodelAt: (id: string, date: string) => Promise<JsonObject>
  changes: (query: ChangesQuery) => Promise<ChangePage>
  access: (shellId: string) => Promise<AccessDocument>
  setAccess: (shellId: string, grants: AccessGrant[], revision: string) => Promise<AccessDocument>
  effectiveRights: (shellId: string) => Promise<EffectiveRights>
  invite: (shellId: string, relation: string, expiresAt: string, maxUses: number) => Promise<InvitationResult>
  /** Accepts an invitation as the signed-in user. */
  acceptInvitation: (token: string) => Promise<void>
}
