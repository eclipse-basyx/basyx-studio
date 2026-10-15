import type { ConceptDescriptionSummary, ConceptDescriptionUsages, ElementHit, ElementValueInput, Page, ShellSummary } from '#shared/contract'
import type { ConceptDescriptionSource } from '#shared/search/expression'
import type { LocatorStep } from '../aas/keys'
import type { JsonObject } from '../aas/outline'
import type { BinaryContent, ElementSnapshot, StructureResult } from '../targets/aas-target'
import { conceptDescriptionSearchFields, conceptDescriptionSource, matchesConceptDescription, matchesShell, parseSearch } from '#shared/search/expression'
import { toConceptDescriptionSummary } from '../aas/basyx-go'
import { containerChildren, countSemanticUses, insertChild, moveChild, removeChild, replaceChild, semanticKey, shellMetadata, submodelReference, verifyConceptDescription, verifyShell, verifySubmodelMetadata, withChildren } from '../aas/edits'
import { formatLocator, parseLocator } from '../aas/keys'
import { submodelIdOf, toShellSummary } from '../aas/shells'
import { elementHits } from '../aas/tree'
import { withValue } from '../aas/values'
import { StudioProblem } from '../problem'
import { contentHash, parseRevision, parseStructureRevision, revisionOf, structureRevisionOf } from '../targets/revision'

function objects (value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter((item): item is JsonObject => typeof item === 'object' && item !== null && !Array.isArray(item)) : []
}

function notFound (): never {
  throw new StudioProblem('target_resource_not_found')
}

/** Elements below a submodel element that the AAS API addresses by idShort. */
function namedChildren (element: JsonObject): unknown {
  switch (element.modelType) {
    case 'SubmodelElementCollection': {
      return element.value
    }
    case 'Entity': {
      return element.statements
    }
    case 'AnnotatedRelationshipElement': {
      return element.annotations
    }
    default: {
      return undefined
    }
  }
}

/** Changes the undo log keeps; older ones fall off. */
const maxUndo = 50

function isContainer (element: JsonObject): boolean {
  return ['SubmodelElementCollection', 'SubmodelElementList', 'Entity', 'AnnotatedRelationshipElement'].includes(String(element.modelType))
}

/** Access to the files (parts) of the package behind a workspace. */
export interface PackageFiles {
  /** A part by its path in the package, e.g. `/aasx-suppl/manual.pdf`. */
  read: (path: string) => Promise<BinaryContent | null>
  /** Stores a supplementary file and returns its path in the package. */
  write: (fileName: string, file: BinaryContent) => Promise<string>
  /** The package thumbnail, if any. */
  thumbnail: () => Promise<BinaryContent | null>
}

const noFiles: PackageFiles = {
  read: async () => null,
  write: async () => {
    throw new StudioProblem('unsupported_operation', 'This workspace cannot store files.')
  },
  thumbnail: async () => null,
}

function paged<T> (items: T[], limit: number, cursor: string | undefined): Page<T> {
  const start = cursor === undefined ? 0 : Number(cursor)
  if (!Number.isInteger(start) || start < 0 || start > items.length) {
    throw new StudioProblem('invalid_request', 'Malformed cursor.')
  }
  const end = Math.min(start + limit, items.length)
  return {
    items: items.slice(start, end),
    page: { nextCursor: end < items.length ? String(end) : null, hasMore: end < items.length },
  }
}

/**
 * The AAS environment of an opened package, with the operations of a
 * Studio target. Only the Workspace Worker holds it; one worker call runs at
 * a time, so a revision check and the following change cannot interleave.
 */
export class WorkspaceModel {
  /** Identifies the state of the environment; every applied change, undo and redo gives it a new or earlier value. */
  revision = 0
  savedRevision = 0
  /** The newest revision handed out, so a new change never reuses the number of an undone one. */
  #latest = 0
  readonly #undone: Array<{ environment: JsonObject, revision: number }> = []
  readonly #redone: Array<{ environment: JsonObject, revision: number }> = []

  constructor (readonly environment: JsonObject, private readonly files: PackageFiles = noFiles) {}

  get canUndo (): boolean {
    return this.#undone.length > 0
  }

  get canRedo (): boolean {
    return this.#redone.length > 0
  }

  get unsavedChanges (): boolean {
    return this.revision !== this.savedRevision
  }

  /** Marks a package that was never saved as changed, so closing it asks first. */
  markUnsaved (): void {
    this.revision = ++this.#latest
  }

  /** The state before a change, for the undo log (W8). */
  snapshot (): { environment: JsonObject, revision: number } {
    return { environment: structuredClone(this.environment), revision: this.revision }
  }

  /** Puts a change into the undo log, if it happened. */
  recordChange (before: { environment: JsonObject, revision: number }): void {
    if (this.revision === before.revision) {
      return
    }
    this.#undone.push(before)
    if (this.#undone.length > maxUndo) {
      this.#undone.shift()
    }
    this.#redone.length = 0
  }

  undo (): void {
    const entry = this.#undone.pop()
    if (!entry) {
      throw new StudioProblem('unsupported_operation', 'There is nothing to undo.')
    }
    this.#redone.push(this.snapshot())
    this.#restore(entry)
  }

  redo (): void {
    const entry = this.#redone.pop()
    if (!entry) {
      throw new StudioProblem('unsupported_operation', 'There is nothing to redo.')
    }
    this.#undone.push(this.snapshot())
    this.#restore(entry)
  }

  listShells (limit: number, cursor: string | undefined): Page<ShellSummary> {
    const page = paged(objects(this.environment.assetAdministrationShells), limit, cursor)
    return { items: page.items.map(shell => toShellSummary(shell)), page: page.page }
  }

  shell (id: string): JsonObject {
    return objects(this.environment.assetAdministrationShells).find(shell => shell.id === id) ?? notFound()
  }

  submodelIds (shellId: string): string[] {
    return objects(this.shell(shellId).submodels)
      .map(reference => submodelIdOf(reference))
      .filter((id): id is string => id !== null)
  }

  submodel (id: string): JsonObject {
    return objects(this.environment.submodels).find(submodel => submodel.id === id) ?? notFound()
  }

  submodelMetadata (id: string): JsonObject {
    const { submodelElements: _, ...metadata } = this.submodel(id)
    return metadata
  }

  element (submodelId: string, idShortPath: string): ElementSnapshot {
    const { container, index } = this.#locate(submodelId, idShortPath)
    const value = container[index] as JsonObject
    return { value, revision: revisionOf(value), concurrency: 'strong' }
  }

  setElementValue (submodelId: string, idShortPath: string, value: ElementValueInput['value'], revision: string): ElementSnapshot {
    const token = parseRevision(revision)
    const { container, index } = this.#locate(submodelId, idShortPath)
    if (contentHash(container[index]) !== token.hash) {
      throw new StudioProblem('revision_conflict')
    }
    const { json } = withValue(container[index] as JsonObject, value)
    container[index] = json
    this.revision = ++this.#latest
    return { value: json, revision: revisionOf(json), concurrency: 'strong' }
  }

  addElement (submodelId: string, parentPath: string | null, element: JsonObject, index: number | null, structureRevision: string): StructureResult {
    const parent = this.#parent(submodelId, parentPath)
    this.#checkStructure(parent.children, structureRevision)
    const placed = insertChild(parent.children, parent.element, parent.type, element, index)
    parent.write(placed.children)
    this.revision = ++this.#latest
    const added = placed.children[placed.index]!
    return { path: this.#childPath(parentPath, parent.type, added, placed.index), snapshot: { value: added, revision: revisionOf(added), concurrency: 'strong' } }
  }

  replaceElement (submodelId: string, idShortPath: string, element: JsonObject, revision: string): StructureResult {
    const token = parseRevision(revision)
    const { container, index } = this.#locate(submodelId, idShortPath)
    if (contentHash(container[index]) !== token.hash) {
      throw new StudioProblem('revision_conflict')
    }
    const parentPath = this.#parentPath(idShortPath)
    const parent = this.#parent(submodelId, parentPath)
    const placed = replaceChild(parent.children, index, parent.element, parent.type, element)
    parent.write(placed.children)
    this.revision = ++this.#latest
    const replaced = placed.children[index]!
    return { path: this.#childPath(parentPath, parent.type, replaced, index), snapshot: { value: replaced, revision: revisionOf(replaced), concurrency: 'strong' } }
  }

  deleteElement (submodelId: string, idShortPath: string, revision: string): void {
    const token = parseRevision(revision)
    const { container, index } = this.#locate(submodelId, idShortPath)
    if (contentHash(container[index]) !== token.hash) {
      throw new StudioProblem('revision_conflict')
    }
    const parent = this.#parent(submodelId, this.#parentPath(idShortPath))
    parent.write(removeChild(parent.children, index))
    this.revision = ++this.#latest
  }

  moveElement (submodelId: string, idShortPath: string, index: number, structureRevision: string): StructureResult {
    const parentPath = this.#parentPath(idShortPath)
    const parent = this.#parent(submodelId, parentPath)
    this.#checkStructure(parent.children, structureRevision)
    const { index: position } = this.#locate(submodelId, idShortPath)
    const placed = moveChild(parent.children, position, index)
    parent.write(placed.children)
    this.revision = ++this.#latest
    const moved = placed.children[placed.index]!
    return { path: this.#childPath(parentPath, parent.type, moved, placed.index), snapshot: { value: moved, revision: revisionOf(moved), concurrency: 'strong' } }
  }

  replaceSubmodelMetadata (submodelId: string, metadata: JsonObject, revision: string): JsonObject {
    const token = parseRevision(revision)
    const submodel = this.submodel(submodelId)
    if (contentHash(this.submodelMetadata(submodelId)) !== token.hash) {
      throw new StudioProblem('revision_conflict')
    }
    if (metadata.id !== submodel.id) {
      throw new StudioProblem('validation_failed', 'The identifier of a submodel cannot be changed.', {
        violations: [{ path: 'id', message: 'The identifier of a submodel cannot be changed.' }],
      })
    }
    const verified = verifySubmodelMetadata(metadata)
    const submodels = objects(this.environment.submodels)
    submodels[submodels.indexOf(submodel)] = { ...verified, ...(submodel.submodelElements === undefined ? {} : { submodelElements: submodel.submodelElements }) }
    this.environment.submodels = submodels
    this.revision = ++this.#latest
    return this.submodelMetadata(submodelId)
  }

  createSubmodel (submodel: JsonObject): void {
    if (objects(this.environment.submodels).some(candidate => candidate.id === submodel.id)) {
      throw new StudioProblem('identifier_conflict')
    }
    this.environment.submodels = [...objects(this.environment.submodels), submodel]
    this.revision = ++this.#latest
  }

  deleteSubmodel (id: string): void {
    const submodels = objects(this.environment.submodels)
    const remaining = submodels.filter(submodel => submodel.id !== id)
    if (remaining.length === submodels.length) {
      notFound()
    }
    this.environment.submodels = remaining
    this.revision = ++this.#latest
  }

  createShell (shell: JsonObject): void {
    if (objects(this.environment.assetAdministrationShells).some(candidate => candidate.id === shell.id)) {
      throw new StudioProblem('identifier_conflict')
    }
    this.environment.assetAdministrationShells = [...objects(this.environment.assetAdministrationShells), shell]
    this.revision = ++this.#latest
  }

  replaceShell (id: string, shell: JsonObject, revision: string): JsonObject {
    const token = parseRevision(revision)
    const current = this.shell(id)
    if (contentHash(shellMetadata(current)) !== token.hash) {
      throw new StudioProblem('revision_conflict')
    }
    if (shell.id !== id) {
      throw new StudioProblem('validation_failed', 'The identifier of a shell cannot be changed.', {
        violations: [{ path: 'id', message: 'The identifier of a shell cannot be changed.' }],
      })
    }
    const { submodels: _, ...changes } = shell
    const next = verifyShell({ ...changes, ...(current.submodels === undefined ? {} : { submodels: current.submodels }) })
    const shells = objects(this.environment.assetAdministrationShells)
    shells[shells.indexOf(current)] = next
    this.environment.assetAdministrationShells = shells
    this.revision = ++this.#latest
    return next
  }

  replaceSubmodel (id: string, submodel: JsonObject, revision: string): JsonObject {
    const token = parseRevision(revision)
    const current = this.submodel(id)
    if (contentHash(current) !== token.hash) {
      throw new StudioProblem('revision_conflict')
    }
    if (submodel.id !== id) {
      throw new StudioProblem('validation_failed', 'The identifier of a submodel cannot be changed.')
    }
    const submodels = objects(this.environment.submodels)
    submodels[submodels.indexOf(current)] = submodel
    this.environment.submodels = submodels
    this.revision = ++this.#latest
    return submodel
  }

  addSubmodelRef (shellId: string, submodelId: string): void {
    const shell = this.shell(shellId)
    if (this.submodelIds(shellId).includes(submodelId)) {
      throw new StudioProblem('identifier_conflict', 'The shell references this submodel already.')
    }
    shell.submodels = [...objects(shell.submodels), submodelReference(submodelId)]
    this.revision = ++this.#latest
  }

  removeSubmodelRef (shellId: string, submodelId: string): void {
    const shell = this.shell(shellId)
    const references = objects(shell.submodels)
    const remaining = references.filter(reference => submodelIdOf(reference) !== submodelId)
    if (remaining.length === references.length) {
      notFound()
    }
    shell.submodels = remaining
    this.revision = ++this.#latest
  }

  deleteShell (id: string): void {
    const shells = objects(this.environment.assetAdministrationShells)
    const remaining = shells.filter(shell => shell.id !== id)
    if (remaining.length === shells.length) {
      notFound()
    }
    this.environment.assetAdministrationShells = remaining
    this.revision = ++this.#latest
  }

  /** The shell's default thumbnail, else the package thumbnail. */
  async thumbnail (shellId: string): Promise<BinaryContent | null> {
    const information = (this.shell(shellId).assetInformation ?? {}) as JsonObject
    const thumbnail = (information.defaultThumbnail ?? {}) as JsonObject
    if (typeof thumbnail.path === 'string') {
      const file = await this.files.read(thumbnail.path)
      if (file) {
        return file
      }
    }
    return this.files.thumbnail()
  }

  /** Sets the shell's default thumbnail to a new file in the package. */
  async setThumbnail (shellId: string, file: BinaryContent): Promise<JsonObject> {
    const shell = this.shell(shellId)
    const location = await this.files.write(file.fileName ?? 'thumbnail', file)
    const asset = (shell.assetInformation ?? {}) as JsonObject
    shell.assetInformation = { ...asset, defaultThumbnail: { path: location, contentType: file.contentType } }
    this.revision = ++this.#latest
    return shell
  }

  async attachment (submodelId: string, idShortPath: string): Promise<BinaryContent> {
    const { value } = this.element(submodelId, idShortPath)
    if (value.modelType !== 'File') {
      throw new StudioProblem('unsupported_operation', 'Only File elements have an attachment.')
    }
    const location = typeof value.value === 'string' ? value.value : ''
    const file = location ? await this.files.read(location) : null
    if (!file) {
      throw new StudioProblem('target_resource_not_found', 'The file is not part of the package.')
    }
    return { ...file, contentType: typeof value.contentType === 'string' ? value.contentType : file.contentType }
  }

  async replaceAttachment (submodelId: string, idShortPath: string, file: BinaryContent, revision: string): Promise<ElementSnapshot> {
    const token = parseRevision(revision)
    const { container, index } = this.#locate(submodelId, idShortPath)
    const current = container[index] as JsonObject
    if (contentHash(current) !== token.hash) {
      throw new StudioProblem('revision_conflict')
    }
    if (current.modelType !== 'File') {
      throw new StudioProblem('unsupported_operation', 'Only File elements have an attachment.')
    }
    const location = await this.files.write(file.fileName ?? 'file', file)
    const json = { ...current, value: location, contentType: file.contentType }
    container[index] = json
    this.revision = ++this.#latest
    return { value: json, revision: revisionOf(json), concurrency: 'strong' }
  }

  conceptDescriptions (limit: number, cursor: string | undefined): Page<ConceptDescriptionSummary> {
    const page = paged(objects(this.environment.conceptDescriptions), limit, cursor)
    return { items: page.items.map(cd => toConceptDescriptionSummary(cd)), page: page.page }
  }

  /** Concept descriptions matching a search expression, evaluated here (no query endpoint). */
  searchConceptDescriptions (expression: string, sources: readonly ConceptDescriptionSource[], limit: number, cursor: string | undefined): Page<ConceptDescriptionSummary> {
    const parsed = parseSearch(expression, conceptDescriptionSearchFields)
    const page = paged(objects(this.environment.conceptDescriptions).filter(cd => matchesConceptDescription(cd, parsed)
      && (sources.length === 0 || sources.includes(conceptDescriptionSource(String(cd.id))))), limit, cursor)
    return { items: page.items.map(cd => toConceptDescriptionSummary(cd)), page: page.page }
  }

  conceptDescription (id: string): JsonObject {
    return objects(this.environment.conceptDescriptions).find(cd => cd.id === id) ?? notFound()
  }

  createConceptDescription (conceptDescription: JsonObject): void {
    if (objects(this.environment.conceptDescriptions).some(candidate => candidate.id === conceptDescription.id)) {
      throw new StudioProblem('identifier_conflict')
    }
    this.environment.conceptDescriptions = [...objects(this.environment.conceptDescriptions), conceptDescription]
    this.revision = ++this.#latest
  }

  replaceConceptDescription (id: string, conceptDescription: JsonObject, revision: string): JsonObject {
    const token = parseRevision(revision)
    const current = this.conceptDescription(id)
    if (contentHash(current) !== token.hash) {
      throw new StudioProblem('revision_conflict')
    }
    if (conceptDescription.id !== id) {
      throw new StudioProblem('validation_failed', 'The identifier of a concept description cannot be changed.', {
        violations: [{ path: 'id', message: 'The identifier of a concept description cannot be changed.' }],
      })
    }
    const next = verifyConceptDescription(conceptDescription)
    const all = objects(this.environment.conceptDescriptions)
    all[all.indexOf(current)] = next
    this.environment.conceptDescriptions = all
    this.revision = ++this.#latest
    return next
  }

  deleteConceptDescription (id: string, revision: string): void {
    const token = parseRevision(revision)
    const current = this.conceptDescription(id)
    if (contentHash(current) !== token.hash) {
      throw new StudioProblem('revision_conflict')
    }
    this.environment.conceptDescriptions = objects(this.environment.conceptDescriptions).filter(cd => cd !== current)
    this.revision = ++this.#latest
  }

  /** The whole package is at hand, so every usage is counted. */
  conceptDescriptionUsages (id: string): ConceptDescriptionUsages {
    const submodels = objects(this.environment.submodels)
    return {
      checked: true,
      submodels: submodels.filter(submodel => semanticKey(submodel) === id).length,
      elements: submodels.reduce((sum, submodel) => sum + countSemanticUses(submodel, id), 0),
      truncated: false,
    }
  }

  /**
   * Shells matching a search field expression, evaluated here with the same
   * semantics as the query Studio builds for live targets (MVP-4 plan, S2).
   */
  searchShells (expression: string, limit: number, cursor: string | undefined): Page<ShellSummary> {
    const parsed = parseSearch(expression)
    const matches = objects(this.environment.assetAdministrationShells).filter(shell => matchesShell(shell, parsed))
    const page = paged(matches, limit, cursor)
    return { items: page.items.map(shell => toShellSummary(shell)), page: page.page }
  }

  /** Submodel elements whose idShort contains a text (case-insensitive), with the shell that references them. */
  searchElements (text: string, limit: number): ElementHit[] {
    const owner = new Map<string, { key: string, label: string }>()
    for (const shell of objects(this.environment.assetAdministrationShells)) {
      const summary = toShellSummary(shell)
      for (const id of this.submodelIds(summary.id)) {
        if (!owner.has(id)) {
          owner.set(id, { key: summary.key, label: summary.idShort ?? summary.id })
        }
      }
    }
    const elements: ElementHit[] = []
    for (const submodel of objects(this.environment.submodels)) {
      elements.push(...elementHits(submodel, text, limit - elements.length, owner.get(String(submodel.id)) ?? null))
      if (elements.length >= limit) {
        break
      }
    }
    return elements
  }

  #restore (entry: { environment: JsonObject, revision: number }): void {
    for (const key of Object.keys(this.environment)) {
      Reflect.deleteProperty(this.environment, key)
    }
    Object.assign(this.environment, entry.environment)
    this.revision = entry.revision
  }

  #parentPath (idShortPath: string): string | null {
    const steps = parseLocator(idShortPath)
    return steps.length > 1 ? formatLocator(steps.slice(0, -1)) : null
  }

  #checkStructure (children: JsonObject[], structureRevision: string): void {
    if (structureRevisionOf(children) !== parseStructureRevision(structureRevision)) {
      throw new StudioProblem('structure_conflict')
    }
  }

  #childPath (parentPath: string | null, parentType: string, child: JsonObject, index: number): string {
    if (parentType === 'SubmodelElementList') {
      return `${parentPath}[${index}]`
    }
    const idShort = String(child.idShort)
    return parentPath ? `${parentPath}.${idShort}` : idShort
  }

  /** A container (a submodel's top level or an element) with its children and a way to store them. */
  #parent (submodelId: string, parentPath: string | null): { element: JsonObject | null, type: string, children: JsonObject[], write: (children: JsonObject[]) => void } {
    if (parentPath === null) {
      const submodel = this.submodel(submodelId)
      return {
        element: null,
        type: 'Submodel',
        children: objects(submodel.submodelElements),
        write: children => {
          submodel.submodelElements = children
        },
      }
    }
    const { container, index } = this.#locate(submodelId, parentPath)
    const element = container[index] as JsonObject
    if (!isContainer(element)) {
      throw new StudioProblem('unsupported_operation', `${String(element.modelType)} elements have no children.`)
    }
    return {
      element,
      type: String(element.modelType),
      children: containerChildren(element),
      write: children => {
        container[index] = withChildren(element, children)
      },
    }
  }

  /** The array holding the addressed element and its position, so it can be replaced. */
  #locate (submodelId: string, idShortPath: string): { container: unknown[], index: number } {
    const steps: LocatorStep[] = parseLocator(idShortPath)
    let container: unknown = this.submodel(submodelId).submodelElements
    let index = -1
    for (const step of steps) {
      if (index !== -1) {
        const parent = (container as unknown[])[index] as JsonObject
        container = step.kind === 'index'
          ? (parent.modelType === 'SubmodelElementList' ? parent.value : undefined)
          : namedChildren(parent)
      }
      if (!Array.isArray(container)) {
        notFound()
      }
      if (step.kind === 'index') {
        index = step.index < container.length ? step.index : notFound()
      } else if (step.kind === 'idShort') {
        index = container.findIndex(item => (item as JsonObject | null)?.idShort === step.idShort)
        if (index === -1) {
          notFound()
        }
      } else {
        throw new StudioProblem('invalid_request', 'Operation variables are not addressable.')
      }
    }
    return { container: container as unknown[], index }
  }
}
