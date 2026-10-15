import { z } from 'zod'
import { conceptDescriptionSources } from '../search/expression'
import { securityModeSchema, syncModes } from './infrastructure'

export const authenticationStates = ['not_required', 'authenticated', 'required'] as const
export const authenticationStateSchema = z.enum(authenticationStates)
export type AuthenticationState = z.infer<typeof authenticationStateSchema>

export const targetKinds = ['live', 'workspace'] as const
export type TargetKind = (typeof targetKinds)[number]

/**
 * How shells are searched (MVP-4 plan, S2): `query` on the server with the
 * AAS Query Language, `expression` evaluated by Studio (workspaces), or
 * `filter` over the loaded list only.
 */
export const searchModes = ['query', 'expression', 'filter'] as const

/**
 * What a target supports. Feature code branches on capabilities, never on
 * the target kind.
 * - `persistence: immediate` writes reach the source on apply (live targets);
 *   `explicit_save` keeps applied changes until the user saves (workspaces).
 * - `search`: `shells` matches shell fields, `elements` also submodel elements.
 * - `history`, `changeFeed` and `sharing` are optional BaSyx Go features that
 *   Studio detects on the target; they are `false` until detected.
 */
export const targetCapabilitiesSchema = z.object({
  /** Change values of elements (`writeValues` of the MVP-5 plan, P1). */
  write: z.boolean(),
  /** Add, delete, move and rename elements and edit submodel metadata. */
  writeStructure: z.boolean(),
  /** Create shells and submodels, change shell metadata and submodel references. */
  createResources: z.boolean(),
  /** Children of collections keep the order Studio gives them (list items always do). */
  orderedChildren: z.boolean(),
  /** Undo and redo of applied changes (workspaces only, MVP-5 plan, W8). */
  undo: z.boolean(),
  persistence: z.enum(['immediate', 'explicit_save']),
  deleteShells: z.boolean(),
  /** Read File elements and thumbnails, and replace File contents. */
  files: z.boolean(),
  operations: z.boolean(),
  conceptDescriptions: z.boolean(),
  /**
   * How concept descriptions are searched (MVP-6 plan, S1): `query` on the
   * repository's query endpoint, `expression` by Studio (workspaces), or
   * `filter` on the loaded list only.
   */
  conceptDescriptionSearch: z.enum(searchModes),
  search: z.enum(searchModes),
  /** Where shell queries run (`search: query`); raw queries use that endpoint's roots. */
  queryTarget: z.enum(['registry', 'repository']).nullable(),
  /** Submodel elements can be searched (the palette). */
  elementSearch: z.boolean(),
  /** Find shells by asset ID. */
  discovery: z.boolean(),
  /** Download a shell with its submodels as AASX, JSON or XML. */
  export: z.boolean(),
  /** Add the content of an AASX, JSON or XML file. */
  upload: z.boolean(),
  /** Read submodels and shells as they were at a point in time. */
  history: z.boolean(),
  /** Read the change events of shells, submodels and assets. */
  changeFeed: z.boolean(),
  /** Grant other users access to a shell (BaSyx Go ReBAC, as the signed-in user). */
  sharing: z.boolean(),
  /** Where the shell list comes from; registry entries may point to shells that cannot be opened. */
  listSource: z.enum(['registry', 'repository']),
})
export type TargetCapabilities = z.infer<typeof targetCapabilitiesSchema>

/** Nothing is offered; used while a target is unknown or not loaded. */
export const noCapabilities: TargetCapabilities = {
  write: false,
  writeStructure: false,
  createResources: false,
  orderedChildren: false,
  undo: false,
  persistence: 'immediate',
  deleteShells: false,
  files: false,
  operations: false,
  conceptDescriptions: false,
  conceptDescriptionSearch: 'filter',
  search: 'filter',
  queryTarget: null,
  elementSearch: false,
  discovery: false,
  export: false,
  upload: false,
  history: false,
  changeFeed: false,
  sharing: false,
  listSource: 'repository',
}

/** State of a desktop AASX workspace; `null` for live targets. */
export const workspaceStateSchema = z.object({
  fileName: z.string(),
  unsavedChanges: z.boolean(),
  /** A package that was never saved: *Save* is *Save as*. */
  isNew: z.boolean().optional(),
  canUndo: z.boolean().optional(),
  canRedo: z.boolean().optional(),
})
export type WorkspaceState = z.infer<typeof workspaceStateSchema>

export const targetSchema = z.object({
  id: z.string(),
  kind: z.enum(targetKinds),
  name: z.string(),
  description: z.string().nullable(),
  /** Downstream security mode of a live target; `null` for workspaces. */
  securityMode: securityModeSchema.nullable(),
  authenticationState: authenticationStateSchema,
  capabilities: targetCapabilitiesSchema,
  workspace: workspaceStateSchema.nullable(),
  /**
   * Whether Studio writes descriptors and asset links after uploads and
   * deletes (MVP-4 plan, I5): the infrastructure's default and whether users
   * may choose; `null` where the server keeps registries and discovery in
   * step itself, or has none.
   */
  registrySync: z.object({ studioDefault: z.enum(syncModes), userOverride: z.boolean() }).nullable(),
})
export type Target = z.infer<typeof targetSchema>

export function pageSchema<T extends z.ZodType> (item: T) {
  return z.object({
    items: z.array(item),
    page: z.object({
      nextCursor: z.string().nullable(),
      hasMore: z.boolean(),
    }),
  })
}
export interface Page<T> {
  items: T[]
  page: { nextCursor: string | null, hasMore: boolean }
}

export const langStringSchema = z.object({ language: z.string(), text: z.string() })
export type LangString = z.infer<typeof langStringSchema>

export const shellSummarySchema = z.object({
  key: z.string(),
  id: z.string(),
  idShort: z.string().nullable(),
  displayName: z.array(langStringSchema),
  description: z.array(langStringSchema),
  assetKind: z.string().nullable(),
  globalAssetId: z.string().nullable(),
  /** Whether the asset information names a default thumbnail. */
  thumbnail: z.boolean(),
  /**
   * The thumbnail's address when it is an external http(s) URL: BaSyx Go
   * answers such thumbnails with a redirect, which Studio does not follow,
   * so the browser loads them directly.
   */
  thumbnailUrl: z.string().nullable(),
})
export type ShellSummary = z.infer<typeof shellSummarySchema>

export const shellDetailSchema = z.object({
  key: z.string(),
  shell: z.record(z.string(), z.unknown()),
  /** Revision of the shell's metadata and asset information (not its submodel references), for `PUT`. */
  revision: z.string().nullable().optional(),
})
export type ShellDetail = z.infer<typeof shellDetailSchema>

/** Whether a shell of the list can be opened (the Web UI's online/offline marker). */
export const shellAvailabilityStatuses = ['available', 'forbidden', 'not_found', 'blocked', 'unreachable'] as const
export const shellAvailabilityRequestSchema = z.object({
  keys: z.array(z.string().regex(/^[\w-]{1,4000}$/)).min(1).max(50),
})
export const shellAvailabilitySchema = z.object({
  items: z.array(z.object({ key: z.string(), status: z.enum(shellAvailabilityStatuses) })),
})
export type ShellAvailability = z.infer<typeof shellAvailabilitySchema>

export const submodelRefStatuses = ['available', 'forbidden', 'not_found', 'blocked', 'error'] as const
export const submodelRefSchema = z.object({
  key: z.string(),
  /** `Template` or `Instance`, where the submodel could be read. */
  kind: z.string().nullable().optional(),
  submodelId: z.string(),
  idShort: z.string().nullable(),
  semanticId: z.string().nullable(),
  status: z.enum(submodelRefStatuses),
})
export type SubmodelRef = z.infer<typeof submodelRefSchema>

export const operationVariableGroups = ['input', 'output', 'inoutput'] as const
export type OperationVariableGroup = (typeof operationVariableGroups)[number]

export const elementNodeSchema = z.object({
  key: z.string(),
  /** idShort, `[index]` for list items, or the variable group name. */
  label: z.string(),
  /** AAS modelType, or `OperationVariables` for a synthetic variable group. */
  modelType: z.string(),
  variableGroup: z.enum(operationVariableGroups).nullable(),
  semanticId: z.string().nullable(),
  preview: z.string().nullable(),
  hasChildren: z.boolean(),
})
export type ElementNode = z.infer<typeof elementNodeSchema>

export const submodelDetailSchema = z.object({
  key: z.string(),
  submodel: z.record(z.string(), z.unknown()),
  /** Revision of the submodel's metadata, for `PUT` (MVP-5 plan, W1); absent for historic or full reads. */
  revision: z.string().nullable().optional(),
})
export type SubmodelDetail = z.infer<typeof submodelDetailSchema>

/**
 * How reliably a write detects concurrent changes:
 * - `strong`: the source checks the revision atomically (HTTP `If-Match`);
 * - `best_effort`: Studio compares against a fresh read just before writing,
 *   so a change between that read and the write is not detected.
 */
export const concurrencyModes = ['strong', 'best_effort'] as const
export type ConcurrencyMode = (typeof concurrencyModes)[number]

/** Value kinds the editor can change. */
export const editableModelTypes = ['Property', 'MultiLanguageProperty'] as const
export type EditableModelType = (typeof editableModelTypes)[number]

export const elementDetailSchema = z.object({
  key: z.string(),
  /** Human-readable path, e.g. `Level1.Items[2]` or `Calibrate@input.Offset`. */
  path: z.string(),
  value: z.unknown(),
  /**
   * Opaque revision token for writes (sent back as `If-Match`), or `null`
   * when the element cannot be written, e.g. an operation variable.
   */
  revision: z.string().nullable(),
  concurrency: z.enum(concurrencyModes).nullable(),
  /** The elements above it, from the submodel's top level down, for opening its path in the tree. */
  ancestors: z.array(z.object({ key: z.string(), label: z.string() })),
  /**
   * Revision of the element's children (idShorts, types and order, not
   * their values) that adding, moving and reordering are based on; `null`
   * for elements without children.
   */
  structureRevision: z.string().nullable().optional(),
})
export type ElementDetail = z.infer<typeof elementDetailSchema>

/**
 * New value of a `Property` (a string, or `null` to clear it) or of a
 * `MultiLanguageProperty` (all language strings).
 */
export const elementValueInputSchema = z.object({
  value: z.union([
    z.string().max(1_000_000).nullable(),
    z.array(langStringSchema.extend({
      language: z.string().min(1).max(64),
      text: z.string().max(1_000_000),
    })).max(200),
  ]),
})
export type ElementValueInput = z.infer<typeof elementValueInputSchema>

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(4000).optional(),
})

/** A node of a fully loaded submodel tree, with its children. */
export interface TreeNode extends ElementNode {
  /** Value type of a Property or Range (`xs:double`, …). */
  valueType: string | null
  /** Loaded children; absent with `hasChildren` when they follow on demand. */
  children?: TreeNode[]
}

/**
 * A new element below `parentElementKey` (the submodel's top level without
 * it), at `index` (appended without it). Based on the parent's structure
 * revision (`If-Match`).
 */
export const elementCreateSchema = z.object({
  parentElementKey: z.string().max(4000).optional(),
  index: z.number().int().min(0).optional(),
  element: z.record(z.string(), z.unknown()),
})
export type ElementCreateInput = z.infer<typeof elementCreateSchema>

/** The element as it should be, including a new idShort. Based on the element's revision. */
export const elementReplaceSchema = z.object({
  element: z.record(z.string(), z.unknown()),
})
export type ElementReplaceInput = z.infer<typeof elementReplaceSchema>

/** Moves an element to `index` among its siblings; based on the parent's structure revision. */
export const elementMoveSchema = z.object({
  index: z.number().int().min(0),
})
export type ElementMoveInput = z.infer<typeof elementMoveSchema>

/** Submodel metadata; the elements are kept as they are. */
export const submodelReplaceSchema = z.object({
  submodel: z.record(z.string(), z.unknown()),
})
export type SubmodelReplaceInput = z.infer<typeof submodelReplaceSchema>

export const pointInTimeQuerySchema = z.object({
  /** Point in time (ISO 8601) for a historic version; needs the `history` capability. */
  at: z.iso.datetime({ offset: true }).optional(),
})

/** An element as JSON (`ElementDetail`) or as AAS XML (MVP-4 plan, T2). */
export const elementQuerySchema = pointInTimeQuerySchema.extend({
  format: z.enum(['json', 'xml']).default('json'),
})

/**
 * A submodel: its metadata without elements (the default), the whole
 * submodel as JSON, or the whole submodel as AAS XML.
 */
export const submodelQuerySchema = pointInTimeQuerySchema.extend({
  content: z.enum(['metadata', 'full']).default('metadata'),
  format: z.enum(['json', 'xml']).default('json'),
})

/**
 * One tree request (MVP-4 plan, T1): the children of the submodel or of
 * `parentElementKey`, with as many complete levels below them as fit into
 * `budget` nodes.
 */
export const elementLevelQuerySchema = pointInTimeQuerySchema.extend({
  parentElementKey: z.string().max(4000).optional(),
  budget: z.coerce.number().int().min(1).max(5000).optional(),
})

export const conceptDescriptionSummarySchema = z.object({
  id: z.string(),
  idShort: z.string().nullable(),
  preferredName: z.array(langStringSchema),
  definition: z.array(langStringSchema),
  dataType: z.string().nullable(),
  unit: z.string().nullable(),
})
export type ConceptDescriptionSummary = z.infer<typeof conceptDescriptionSummarySchema>

/** One concept description with the revision a write must be based on (MVP-6 plan, W1). */
export const conceptDescriptionDetailSchema = z.object({
  key: z.string(),
  conceptDescription: z.record(z.string(), z.unknown()),
  revision: z.string().nullable(),
})
export type ConceptDescriptionDetail = z.infer<typeof conceptDescriptionDetailSchema>

/** A new or edited concept description; AAS Core checks it on the server. */
export const conceptDescriptionInputSchema = z.object({
  conceptDescription: z.record(z.string(), z.unknown()),
})
export type ConceptDescriptionInput = z.infer<typeof conceptDescriptionInputSchema>

/** A concept description as JSON (`ConceptDescriptionDetail`) or as AAS XML. */
export const conceptDescriptionQuerySchema = z.object({
  format: z.enum(['json', 'xml']).default('json'),
})

/**
 * How many submodels and elements reference a concept description by their
 * semantic ID (MVP-6 plan, L5). `checked` is false where the target cannot
 * search for it; `truncated` where it stopped counting.
 */
export interface ConceptDescriptionUsages {
  checked: boolean
  submodels: number
  elements: number
  truncated: boolean
}

/** A submodel element that matched a search, with where to find it. */
export interface ElementHit {
  shellKey: string | null
  shellLabel: string | null
  submodelKey: string
  submodelLabel: string
  elementKey: string
  label: string
  modelType: string
  path: string
}

/** A shell search (MVP-4 plan, S2): the search field's expression, or a raw query from the advanced dialog. */
export const searchRequestSchema = z.object({
  scope: z.enum(['shells', 'elements', 'conceptDescriptions']).default('shells'),
  /** Concept descriptions only: the sources to narrow to (MVP-6 plan, S1). */
  sources: z.array(z.enum(conceptDescriptionSources)).max(4).optional(),
  expression: z.string().max(2000).optional(),
  query: z.record(z.string(), z.unknown()).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z.string().max(4000).optional(),
})
  .refine(input => (input.expression === undefined) !== (input.query === undefined), 'give either an expression or a query')
  .refine(input => input.scope !== 'elements' || input.expression !== undefined, 'elements are searched by text')
  .refine(input => input.scope === 'conceptDescriptions' || input.sources === undefined, 'only concept descriptions are filtered by source')
export type SearchRequest = z.input<typeof searchRequestSchema>

export type ShellSearch = { expression: string } | { query: Record<string, unknown> }

export interface ShellSearchPage extends Page<ShellSummary> {
  /** Which service answered: the AAS registry, the AAS repository, or the workspace itself. */
  endpoint: 'registry' | 'repository' | 'workspace'
}

export interface ElementSearchResult {
  items: ElementHit[]
}

export const lookupQuerySchema = z.object({
  assetId: z.string().trim().min(1).max(2000),
})

export const exportFormats = ['aasx', 'json', 'xml'] as const
export type ExportFormat = (typeof exportFormats)[number]
export const exportQuerySchema = z.object({ format: z.enum(exportFormats) })

/** The outcome of one descriptor or asset-link write after an upload or delete (MVP-4 plan, I5). */
export interface SyncStep {
  resource: 'submodel' | 'shell' | 'submodelReference' | 'shellDescriptor' | 'submodelDescriptor' | 'assetLinks'
  id: string
  outcome: 'written' | 'removed' | 'failed' | 'skipped'
  detail?: string
}

/** Result of an upload: the shells it added. */
export interface UploadResult {
  shells: ShellSummary[]
  /** Descriptors and asset links Studio wrote; empty where the server keeps them itself. */
  sync: SyncStep[]
}

export interface DeleteResult {
  /** Descriptor and asset links Studio removed; empty where the server keeps them itself. */
  sync: SyncStep[]
}

export const operationArgumentSchema = z.object({
  idShort: z.string().min(1).max(128),
  value: z.string().max(100_000).nullable(),
})

export const invocationInputSchema = z.object({
  /** Values of the input and in-out variables, as typed by the user. */
  arguments: z.array(operationArgumentSchema).max(100),
  async: z.boolean().default(false),
})
export type InvocationInput = z.infer<typeof invocationInputSchema>

export interface OperationArgument {
  idShort: string
  valueType: string | null
  value: unknown
}

export interface Invocation {
  /** Handle of an asynchronous invocation, to poll its state. */
  handle: string | null
  state: 'running' | 'completed' | 'failed'
  outputs: OperationArgument[]
  message: string | null
}

export const changeActions = ['created', 'updated', 'deleted'] as const
export const changeEntities = ['aas', 'submodel', 'asset'] as const

export interface ChangeEvent {
  id: string
  time: string
  action: (typeof changeActions)[number]
  entity: (typeof changeEntities)[number]
  /** The AAS or submodel identifier. */
  subject: string
  /** The resource key of the subject, to link to it. */
  subjectKey: string
}

export interface ChangePage {
  items: ChangeEvent[]
  /** Pass as `after` to read newer events. */
  lastEventId: string | null
}

export const changesQuerySchema = z.object({
  /** Only events newer than this event. */
  after: z.string().max(200).optional(),
  /** ISO 8601; ignored with `after`. */
  since: z.iso.datetime({ offset: true }).optional(),
  /** Only events about these identifiers (a shell and its submodels). */
  subjects: z.union([z.string().max(2000), z.array(z.string().max(2000)).max(200)]).optional().transform(value => value === undefined ? undefined : (Array.isArray(value) ? value : [value])),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

/** Relations the share dialog offers; the target defines which it accepts. */
export const accessRelations = ['viewer', 'editor', 'executor', 'owner'] as const
const relationSchema = z.string().regex(/^[a-z][\w-]{0,63}$/, 'invalid relation')
export const accessGrantSchema = z.object({
  relation: relationSchema,
  subjectType: z.enum(['user', 'group']),
  issuer: z.string().min(1).max(2000),
  subject: z.string().min(1).max(500),
})
export type AccessGrant = z.infer<typeof accessGrantSchema>

export const accessGrantsInputSchema = z.object({ grants: z.array(accessGrantSchema).max(500) })

export interface AccessDocument {
  grants: AccessGrant[]
  /** Opaque revision; send it back as `If-Match` when replacing the grants. */
  revision: string | null
  /** Issuer of the signed-in user, for new grants. */
  issuer: string | null
}

export const rightActions = ['read', 'update', 'delete', 'execute', 'manage'] as const
export type RightAction = (typeof rightActions)[number]
/** The signed-in user's rights on a shell; every action is `true` without sharing. */
export type EffectiveRights = Record<RightAction, boolean>

export const invitationInputSchema = z.object({
  relation: relationSchema,
  expiresInDays: z.number().int().min(1).max(90).default(7),
  maxUses: z.number().int().min(1).max(100).default(1),
})

export interface InvitationResult {
  token: string
  expiresAt: string
}

// Creating shells and submodels, instances and templates (MVP-5 plan, W4,
// T1-T5). Studio writes whole resources; the shell never carries its
// submodel references in a metadata write.

export const submodelSourceSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('empty'),
    idShort: z.string().min(1).max(128),
    id: z.string().min(1).max(2000).optional(),
    /** The submodel's other fields: names, description, category, semantic ID, kind. */
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    source: z.literal('template'),
    /** `bundled:<name>` or `target:<submodelKey>` (a Template-kind submodel on the target). */
    templateId: z.string().min(1).max(4000),
    id: z.string().min(1).max(2000).optional(),
    idShort: z.string().min(1).max(128).optional(),
    /** Names, description, category and semantic ID that replace the template's. */
    metadata: z.record(z.string(), z.unknown()).optional(),
    /** Paths of the optional elements to keep. */
    include: z.array(z.string().max(1000)).max(5000).optional(),
    /** Values by element path. */
    values: z.record(z.string().max(1000), z.string().max(100_000)).optional(),
  }),
  z.object({
    source: z.literal('json'),
    submodel: z.record(z.string(), z.unknown()),
    id: z.string().min(1).max(2000).optional(),
  }),
  z.object({
    source: z.literal('existing'),
    id: z.string().min(1).max(2000),
  }),
])
export type SubmodelSource = z.infer<typeof submodelSourceSchema>

/** A new shell, optionally with new submodels (the creation wizard). Without `shell.id` one is generated. */
export const shellCreateSchema = z.object({
  shell: z.record(z.string(), z.unknown()),
  submodels: z.array(submodelSourceSchema).max(50).default([]),
})
export type ShellCreateInput = z.infer<typeof shellCreateSchema>

/** The shell's metadata and asset information; the submodel references are kept. */
export const shellReplaceSchema = z.object({
  shell: z.record(z.string(), z.unknown()),
})
export type ShellReplaceInput = z.infer<typeof shellReplaceSchema>

/** Adds a submodel to a shell: a new one, or a reference to an existing one. */
export const submodelRefCreateSchema = z.object({
  submodel: submodelSourceSchema,
})
export type SubmodelRefCreateInput = z.infer<typeof submodelRefCreateSchema>

export const submodelRefDeleteQuerySchema = z.object({
  deleteSubmodel: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
})

/** An instance from a type shell (T4): the submodels to copy (all by default) and the new shell's fields. */
export const instanceCreateSchema = z.object({
  shell: z.record(z.string(), z.unknown()).default({}),
  submodelIds: z.array(z.string().min(1).max(2000)).max(100).optional(),
})
export type InstanceCreateInput = z.infer<typeof instanceCreateSchema>

/** A dry run: AAS Core findings for a JSON value, nothing is written. */
export const validationInputSchema = z.object({
  kind: z.enum(['element', 'submodel', 'shell', 'conceptDescription']),
  value: z.unknown(),
})
export type ValidationInput = z.infer<typeof validationInputSchema>

export interface ValidationResult {
  violations: Array<{ path: string, message: string }>
}

/** A shell with the steps that created it (submodels first, then the shell, then registries). */
export interface ShellCreateResult {
  shell: ShellSummary
  steps: SyncStep[]
}

export interface SubmodelTemplate {
  id: string
  title: string
  semanticId: string | null
  source: 'bundled' | 'target'
  /** What a template is: a submodel, or a collection that gets a submodel around it. */
  version: string | null
}

export interface SubmodelTemplateFields {
  id: string
  title: string
  fields: Array<{
    path: string
    label: string
    modelType: string
    valueType: string | null
    required: boolean
    input: boolean
    depth: number
  }>
}

/** A new, empty workspace (MVP-5 plan, P4). */
export const newWorkspaceInputSchema = z.object({ empty: z.literal(true) })
