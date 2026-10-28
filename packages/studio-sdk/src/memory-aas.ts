import type { ConceptInfo, ElementSnapshot, ElementValue, FileContent, JsonObject, ShellSummary, SpecificAssetId, SubmodelSnapshot, SubmodelSummary, WriteStep } from './protocol.ts'
import type { TestHandlers } from './testing.ts'
import { putAttachmentMaxBytes } from './protocol.ts'
import { StudioError } from './transport.ts'

// AAS content in memory for the test Studio: the reads and the structural
// writes of `studio.aas.*` (Studio app API 0.1.5) on shells and submodels the
// caller passes, with revisions, conflicts and attachments as Studio has
// them. It does not verify content with AAS Core, keep registries or
// generate identifiers by an infrastructure's scheme.
//
//   const aas = memoryAas({ submodels: [fileSystem] })
//   const studio = createTestStudio({ handlers: aas.handlers, context: { mode: 'edit' } })

export interface MemoryAasOptions {
  shells?: JsonObject[]
  submodels?: JsonObject[]
  /** Concept descriptions for `studio.aas.describeConcepts` (Studio app API 0.1.15). */
  conceptDescriptions?: JsonObject[]
}

export interface MemoryAas {
  /** Handlers for `createTestStudio`; spread them and add or replace your own. */
  readonly handlers: TestHandlers
  /** The shells as they are now. */
  readonly shells: JsonObject[]
  /** The submodels as they are now. */
  readonly submodels: JsonObject[]
  /** Stores the content of a File element under its value, as if it had been uploaded; a File without value gets one. */
  setFile: (submodelId: string, idShortPath: string, file: FileContent) => void
}

const titles: Record<string, { status: number, title: string }> = {
  target_resource_not_found: { status: 404, title: 'The target has no such resource' },
  revision_conflict: { status: 412, title: 'The resource was changed by someone else' },
  structure_conflict: { status: 412, title: 'The structure was changed by someone else' },
  idshort_conflict: { status: 409, title: 'An element with this idShort already exists here' },
  identifier_conflict: { status: 409, title: 'This identifier is used already' },
  validation_failed: { status: 422, title: 'The value is not valid' },
  unsupported_operation: { status: 422, title: 'This operation is not supported here' },
  invalid_request: { status: 400, title: 'Invalid request' },
}

function refuse (code: keyof typeof titles, detail?: string): StudioError {
  const { status, title } = titles[code]!
  return new StudioError({ code, title, status, retryable: false, ...(detail === undefined ? {} : { detail }) })
}

type LangStrings = ConceptInfo['preferredName']

function langStrings (value: unknown): LangStrings {
  return Array.isArray(value) ? (value as LangStrings).filter(entry => typeof entry?.language === 'string' && typeof entry.text === 'string').map(({ language, text }) => ({ language, text })) : []
}

/** A concept description's IEC 61360 content, as Studio answers `describeConcepts`. */
function conceptInfo (id: string, cd: JsonObject): ConceptInfo {
  const specifications = Array.isArray(cd.embeddedDataSpecifications) ? cd.embeddedDataSpecifications as JsonObject[] : []
  const content = (specifications.map(spec => spec?.dataSpecificationContent).find(value => typeof value === 'object' && value !== null) ?? {}) as JsonObject
  return {
    id,
    preferredName: langStrings(content.preferredName),
    shortName: langStrings(content.shortName),
    definition: langStrings(content.definition),
    unit: typeof content.unit === 'string' ? content.unit : null,
    dataType: typeof content.dataType === 'string' ? content.dataType : null,
  }
}

/** Key-order independent JSON, so equal content has equal revisions. */
function canonical (value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(item => canonical(item)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).toSorted(([a], [b]) => (a < b ? -1 : (a > b ? 1 : 0)))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** FNV-1a over the canonical JSON; opaque to apps, like Studio's revisions. */
function hash (value: unknown): string {
  const text = canonical(value)
  let state = 0x81_1C_9D_C5
  for (const character of text) {
    state ^= character.codePointAt(0)!
    state = Math.imul(state, 0x01_00_01_93) >>> 0
  }
  return `${state.toString(16).padStart(8, '0')}${text.length.toString(16)}`
}

/** The property that holds a container's children. */
function childKey (modelType: unknown): 'value' | 'statements' | 'annotations' | null {
  switch (modelType) {
    case 'SubmodelElementCollection':
    case 'SubmodelElementList': {
      return 'value'
    }
    case 'Entity': {
      return 'statements'
    }
    case 'AnnotatedRelationshipElement': {
      return 'annotations'
    }
    default: {
      return null
    }
  }
}

function childrenKey (container: JsonObject): 'submodelElements' | 'value' | 'statements' | 'annotations' {
  const key = container.modelType === 'Submodel' ? 'submodelElements' : childKey(container.modelType)
  if (!key) {
    throw refuse('unsupported_operation', 'This element has no children.')
  }
  return key
}

/** A container's children, for reading: an empty container stays as it is, so its revision does not change. */
function childrenOf (container: JsonObject): JsonObject[] {
  const children = container[childrenKey(container)]
  return Array.isArray(children) ? children as JsonObject[] : []
}

/** A container's children, to change them: an empty container gets its array. */
function mutableChildrenOf (container: JsonObject): JsonObject[] {
  const key = childrenKey(container)
  if (!Array.isArray(container[key])) {
    container[key] = []
  }
  return container[key] as JsonObject[]
}

function structureRevision (children: JsonObject[]): string {
  return `s.${hash(children.map(child => typeof child.idShort === 'string' ? [child.idShort, child.modelType] : [null, child.modelType, hash(child)]))}`
}

function revision (element: JsonObject): string {
  return `h.${hash(element)}`
}

type Step = { kind: 'name', idShort: string } | { kind: 'index', index: number }

function parsePath (idShortPath: string): Step[] {
  const steps: Step[] = []
  for (const match of idShortPath.matchAll(/([^.[\]]+)|\[(\d+)\]/g)) {
    steps.push(match[2] === undefined ? { kind: 'name', idShort: match[1]! } : { kind: 'index', index: Number(match[2]) })
  }
  if (steps.length === 0) {
    throw refuse('invalid_request', 'The idShortPath is empty.')
  }
  return steps
}

function joinPath (parentPath: string | null, child: JsonObject, index: number, parent: JsonObject): string {
  const step = parent.modelType === 'SubmodelElementList' ? `[${index}]` : String(child.idShort)
  if (!parentPath) {
    return step
  }
  return step.startsWith('[') ? `${parentPath}${step}` : `${parentPath}.${step}`
}

/** Creates AAS content in memory with handlers for the test Studio. */
export function memoryAas (options: MemoryAasOptions = {}): MemoryAas {
  const shells: JsonObject[] = structuredClone(options.shells ?? [])
  const submodels: JsonObject[] = structuredClone(options.submodels ?? [])
  const conceptDescriptions: JsonObject[] = structuredClone(options.conceptDescriptions ?? [])
  // Contents belong to the File's value, as in a workspace package: an
  // element that keeps its value keeps its content, also through a rename
  // or a replaced submodel.
  const files = new Map<string, FileContent>()
  let stored = 0
  /** A new location for a file's content, as a server or package names it. */
  const location = (fileName: string) => `/aasx/files/${++stored}/${encodeURIComponent(fileName)}`
  const contentOf = (element: JsonObject) => typeof element.value === 'string' ? files.get(element.value) : undefined

  const shellOf = (id: string) => shells.find(shell => shell.id === id) ?? (() => {
    throw refuse('target_resource_not_found', `No shell ${id}.`)
  })()
  const submodelOf = (id: string) => submodels.find(submodel => submodel.id === id) ?? (() => {
    throw refuse('target_resource_not_found', `No submodel ${id}.`)
  })()

  /** The element at a path, with its parent and position. */
  function locate (submodelId: string, idShortPath: string): { parent: JsonObject, children: JsonObject[], position: number, element: JsonObject } {
    let parent = submodelOf(submodelId)
    let located: { parent: JsonObject, children: JsonObject[], position: number, element: JsonObject } | null = null
    for (const step of parsePath(idShortPath)) {
      if (located) {
        parent = located.element
      }
      const children = childrenOf(parent)
      const position = step.kind === 'index' ? step.index : children.findIndex(child => child.idShort === step.idShort)
      if (position < 0 || position >= children.length) {
        throw refuse('target_resource_not_found', `No element ${idShortPath}.`)
      }
      located = { parent, children, position, element: children[position]! }
    }
    return located!
  }

  function snapshot (element: JsonObject): ElementSnapshot {
    const key = childKey(element.modelType)
    return {
      value: structuredClone(element),
      revision: revision(element),
      concurrency: 'strong',
      structureRevision: key ? structureRevision(childrenOf(element)) : null,
    }
  }

  function checkRevision (element: JsonObject, expected: string): void {
    if (revision(element) !== expected) {
      throw refuse('revision_conflict')
    }
  }

  function checkNamed (parent: JsonObject, children: JsonObject[], element: JsonObject, except: number): void {
    if (parent.modelType === 'SubmodelElementList') {
      return
    }
    if (typeof element.idShort !== 'string' || !/^[A-Z][\w-]*$/i.test(element.idShort)) {
      throw new StudioError({ ...titles.validation_failed!, code: 'validation_failed', retryable: false, violations: [{ path: 'idShort', message: 'Must start with a letter and contain letters, digits, _ and - only.' }] })
    }
    if (children.some((child, index) => index !== except && child.idShort === element.idShort)) {
      throw refuse('idshort_conflict')
    }
  }

  const submodelSnapshot = (submodel: JsonObject): SubmodelSnapshot => ({
    submodel: structuredClone(submodel),
    revision: revision(submodel),
    structureRevision: structureRevision(childrenOf(submodel)),
  })

  const reference = (submodelId: string) => ({ type: 'ModelReference', keys: [{ type: 'Submodel', value: submodelId }] })
  const referencedIds = (shell: JsonObject) => ((shell.submodels ?? []) as Array<{ keys?: Array<{ value?: string }> }>).map(ref => ref.keys?.at(-1)?.value).filter((id): id is string => typeof id === 'string')
  const newId = (kind: string) => `urn:uuid:${globalThis.crypto?.randomUUID?.() ?? `${kind}-${Date.now()}-${Math.random().toString(16).slice(2)}`}`

  function addSubmodel (json: JsonObject): string {
    const submodel: JsonObject = { modelType: 'Submodel', ...structuredClone(json) }
    submodel.id = typeof submodel.id === 'string' && submodel.id ? submodel.id : newId('sm')
    if (submodels.some(existing => existing.id === submodel.id)) {
      throw refuse('identifier_conflict', `A submodel with the identifier ${String(submodel.id)} exists already.`)
    }
    submodels.push(submodel)
    return String(submodel.id)
  }

  const handlers: TestHandlers = {
    'studio.aas.listShells': ({ limit = 50, cursor }) => {
      const start = cursor ? Number(cursor) : 0
      const items: ShellSummary[] = shells.slice(start, start + limit).map(shell => {
        const asset = (shell.assetInformation ?? {}) as JsonObject
        return {
          id: String(shell.id),
          idShort: typeof shell.idShort === 'string' ? shell.idShort : null,
          displayName: (shell.displayName ?? []) as ShellSummary['displayName'],
          assetKind: (asset.assetKind as string | undefined) ?? null,
          globalAssetId: (asset.globalAssetId as string | undefined) ?? null,
          assetType: (asset.assetType as string | undefined) ?? null,
          specificAssetIds: ((asset.specificAssetIds ?? []) as SpecificAssetId[]).map(({ name, value }) => ({ name, value })),
        }
      })
      const more = start + limit < shells.length
      return { items, page: { nextCursor: more ? String(start + limit) : null, hasMore: more } }
    },
    'studio.aas.getShell': ({ shellId }) => structuredClone(shellOf(shellId)),
    'studio.aas.listSubmodels': ({ shellId }) => ({
      items: referencedIds(shellOf(shellId)).map((id): SubmodelSummary => {
        const submodel = submodels.find(candidate => candidate.id === id)
        const semanticId = (submodel?.semanticId as { keys?: Array<{ value?: string }> } | undefined)?.keys?.[0]?.value ?? null
        return { id, idShort: (submodel?.idShort as string | undefined) ?? null, semanticId, status: submodel ? 'available' : 'not_found' }
      }),
    }),
    'studio.aas.getSubmodel': ({ submodelId }) => structuredClone(submodelOf(submodelId)),
    'studio.aas.getSubmodelSnapshot': ({ submodelId }) => submodelSnapshot(submodelOf(submodelId)),
    'studio.aas.getElement': ({ submodelId, idShortPath }) => snapshot(locate(submodelId, idShortPath).element),
    'studio.aas.describeConcepts': ({ ids }) => ({
      concepts: ids.map(id => {
        const cd = conceptDescriptions.find(candidate => candidate.id === id)
        return cd ? conceptInfo(id, cd) : null
      }),
    }),
    'studio.aas.setElementValue': ({ submodelId, idShortPath, value, revision: expected }) => {
      const { element } = locate(submodelId, idShortPath)
      checkRevision(element, expected)
      if (element.modelType !== 'Property' && element.modelType !== 'MultiLanguageProperty') {
        throw refuse('unsupported_operation', 'Only values of Properties and MultiLanguageProperties can be set.')
      }
      element.value = structuredClone(value as ElementValue)
      return snapshot(element)
    },
    'studio.aas.createShell': ({ shell, submodels: news = [] }) => {
      const steps: WriteStep[] = []
      const created: JsonObject = { modelType: 'AssetAdministrationShell', ...structuredClone(shell) }
      created.id = typeof created.id === 'string' && created.id ? created.id : newId('aas')
      if (shells.some(existing => existing.id === created.id)) {
        throw refuse('identifier_conflict', `A shell with the identifier ${String(created.id)} exists already.`)
      }
      const ids = news.map(submodel => {
        const id = addSubmodel(submodel)
        steps.push({ resource: 'submodel', id, outcome: 'written' })
        return id
      })
      if (ids.length > 0) {
        created.submodels = [...((created.submodels ?? []) as JsonObject[]), ...ids.map(id => reference(id))]
      }
      shells.push(created)
      steps.push({ resource: 'shell', id: String(created.id), outcome: 'written' })
      return { shell: structuredClone(created), steps }
    },
    'studio.aas.createSubmodel': ({ submodel, shellId }) => {
      const shell = shellId === undefined ? null : shellOf(shellId)
      const submodelId = addSubmodel(submodel)
      const steps: WriteStep[] = [{ resource: 'submodel', id: submodelId, outcome: 'written' }]
      if (shell) {
        shell.submodels = [...((shell.submodels ?? []) as JsonObject[]), reference(submodelId)]
        steps.push({ resource: 'submodelReference', id: submodelId, outcome: 'written' })
      }
      return { submodelId, steps }
    },
    'studio.aas.putSubmodel': ({ submodelId, submodel, revision: expected }) => {
      const current = submodelOf(submodelId)
      checkRevision(current, expected)
      if (submodel.id !== submodelId) {
        throw refuse('validation_failed', 'The identifier of a submodel cannot change.')
      }
      const next: JsonObject = { modelType: 'Submodel', ...structuredClone(submodel) }
      submodels[submodels.indexOf(current)] = next
      return submodelSnapshot(next)
    },
    'studio.aas.addElement': ({ submodelId, parentPath, element, index, structureRevision: expected }) => {
      const parent = parentPath === undefined ? submodelOf(submodelId) : locate(submodelId, parentPath).element
      if (structureRevision(childrenOf(parent)) !== expected) {
        throw refuse('structure_conflict')
      }
      checkNamed(parent, childrenOf(parent), element, -1)
      const children = mutableChildrenOf(parent)
      const position = index === undefined ? children.length : Math.min(index, children.length)
      const added = structuredClone(element)
      children.splice(position, 0, added)
      return { ...snapshot(added), idShortPath: joinPath(parentPath ?? null, added, position, parent) }
    },
    'studio.aas.putElement': ({ submodelId, idShortPath, element, revision: expected }) => {
      const { parent, children, position, element: current } = locate(submodelId, idShortPath)
      checkRevision(current, expected)
      if (element.modelType !== current.modelType) {
        throw refuse('validation_failed', 'The type of an element cannot be changed.')
      }
      checkNamed(parent, children, element, position)
      const next = structuredClone(element)
      // Containers keep the children they have: the app edits the element, not its subtree.
      const key = childKey(current.modelType)
      if (key) {
        next[key] = current[key]
      }
      children[position] = next
      const parentPath = idShortPath.replace(/(?:^|\.)[^.[\]]+$|\[\d+\]$/, '') || null
      return { ...snapshot(next), idShortPath: joinPath(parentPath, next, position, parent) }
    },
    'studio.aas.deleteElement': ({ submodelId, idShortPath, revision: expected }) => {
      const { children, position, element } = locate(submodelId, idShortPath)
      checkRevision(element, expected)
      children.splice(position, 1)
      return null
    },
    'studio.aas.deleteSubmodel': ({ submodelId, removeReferences = false }) => {
      const submodel = submodelOf(submodelId)
      const steps: WriteStep[] = []
      if (removeReferences) {
        for (const shell of shells.filter(candidate => referencedIds(candidate).includes(submodelId))) {
          shell.submodels = ((shell.submodels ?? []) as Array<{ keys?: Array<{ value?: string }> }>).filter(ref => ref.keys?.at(-1)?.value !== submodelId)
          steps.push({ resource: 'submodelReference', id: String(shell.id), outcome: 'written' })
        }
      }
      submodels.splice(submodels.indexOf(submodel), 1)
      steps.push({ resource: 'submodel', id: submodelId, outcome: 'written' })
      return { steps }
    },
    'studio.aas.deleteShell': ({ shellId, deleteSubmodels = false }) => {
      const shell = shellOf(shellId)
      shells.splice(shells.indexOf(shell), 1)
      const steps: WriteStep[] = [{ resource: 'shell', id: shellId, outcome: 'removed' }]
      for (const id of deleteSubmodels ? referencedIds(shell) : []) {
        const index = submodels.findIndex(submodel => submodel.id === id)
        if (index !== -1) {
          submodels.splice(index, 1)
        }
        steps.push({ resource: 'submodel', id, outcome: 'removed' })
      }
      return { steps }
    },
    'studio.aas.putAttachment': ({ submodelId, idShortPath, fileName, contentType, data, revision: expected }) => {
      const { element } = locate(submodelId, idShortPath)
      checkRevision(element, expected)
      if (element.modelType !== 'File') {
        throw refuse('unsupported_operation', 'Only File elements have an attachment.')
      }
      const bytes = data instanceof Uint8Array ? data.slice() : new Uint8Array(data.slice(0))
      if (bytes.byteLength > putAttachmentMaxBytes) {
        throw refuse('invalid_request', `The file is larger than ${putAttachmentMaxBytes / 1024 / 1024} MiB.`)
      }
      element.contentType = contentType
      element.value = location(fileName)
      files.set(element.value as string, { bytes, contentType })
      return snapshot(element)
    },
    'studio.ui.readFile': ({ submodelId, idShortPath }) => {
      const { element } = locate(submodelId, idShortPath)
      if (element.modelType !== 'File') {
        throw refuse('unsupported_operation', 'Only File elements have an attachment.')
      }
      if (typeof element.value !== 'string' || !element.value) {
        throw refuse('target_resource_not_found', 'The File element has no value.')
      }
      const file = contentOf(element)
      if (!file) {
        throw refuse('target_resource_not_found', 'The File element has no content.')
      }
      return { bytes: file.bytes.slice(), contentType: file.contentType }
    },
  }

  return {
    handlers,
    shells,
    submodels,
    setFile: (submodelId, idShortPath, file) => {
      const { element } = locate(submodelId, idShortPath)
      if (typeof element.value !== 'string' || !element.value) {
        element.value = location(element.idShort ? String(element.idShort) : 'file')
      }
      files.set(element.value as string, { bytes: file.bytes.slice(), contentType: file.contentType })
    },
  }
}
