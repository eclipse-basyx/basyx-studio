import type {
  AccessDocument,
  AccessGrant,
  ChangeEvent,
  ChangePage,
  ConceptDescriptionSummary,
  ConceptDescriptionUsages,
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
import type { FailureRecorder } from '../network/guarded-fetch'
import type { AasTarget, BinaryContent, ChangesQuery, ElementSnapshot, StructureResult } from './aas-target'
import type { TargetBase, TargetHttpOptions } from './http'
import type { types } from '@aas-core-works/aas-core3.1-typescript'
import type { Configuration } from 'basyx-typescript-sdk'
import { types as aasTypes, jsonization } from '@aas-core-works/aas-core3.1-typescript'
import { AasDiscoveryClient, AasRegistryClient, AasRepositoryClient, ConceptDescriptionRepositoryClient, Lib, SubmodelRegistryClient, SubmodelRepositoryClient } from 'basyx-typescript-sdk'
import { serviceUrl } from '#shared/contract'
import { buildConceptDescriptionQuery, buildShellQuery, escapeRegex, parseSearch } from '#shared/search/expression'
import {
  handleFromLocation,
  invocationBody,
  invocationOutputs,
  subjectFilter,
  toAccessGrants,
  toChangeEvent,
  toConceptDescriptionSummary,
  toEffectiveRights,
} from '../aas/basyx-go'
import { containerChildren, countSemanticUses, insertChild, moveChild, removeChild, replaceChild, semanticKey, shellMetadata, submodelReference, verifyConceptDescription, verifyShell, verifySubmodelMetadata, withChildren } from '../aas/edits'
import { formatLocator, parseLocator } from '../aas/keys'
import { checkRawQuery, toSdkQuery } from '../aas/query'
import { descriptorSummary, submodelIdOf, toShellSummary } from '../aas/shells'
import { assetLinksOf, shellDescriptor, submodelDescriptor, submodelIdsOf } from '../aas/sync'
import { elementHits } from '../aas/tree'
import { withValue } from '../aas/values'
import { StudioProblem } from '../problem'
import { liveCapabilities } from './capabilities'
import { encodeIdentifier, TargetHttp } from './http'
import { announcedFeatures } from './profiles'
import { EndpointResolver } from './resolution'
import { contentHash, parseRevision, parseStructureRevision, revisionOf, structureRevisionOf } from './revision'

type Jsonable = Parameters<typeof Lib.assetAdministrationShellDescriptorFromJsonable>[0]

type SdkResult<T>
  = | { success: true, data: T, statusCode?: number, etag?: string }
    | { success: false, error: unknown, statusCode?: number, etag?: string, preconditionFailed?: boolean }

/** Attempts per write when the submodel revision changes between read and write. */
const writeAttempts = 3

/** How long the target may take for an asynchronous operation before giving up. */
const asyncInvocationTimeout = 'PT60S'

const exportMediaTypes: Record<ExportFormat, string> = {
  aasx: 'application/asset-administration-shell-package+xml',
  json: 'application/json',
  xml: 'application/xml',
}

export interface LiveTargetOptions extends TargetHttpOptions {
  /** The shell the request is about, for submodels reached through it. */
  shellContext?: string
}

/**
 * Converts SDK results to plain JSON at the adapter boundary. The SDK bundles
 * its own copy of aas-core, so its instances fail `instanceof` checks against
 * Studio's copy; serialization works because it dispatches through methods.
 */
function toJson (value: types.Class): JsonObject {
  return jsonization.toJsonable(value) as JsonObject
}

function path (idShortPath: string): string {
  return encodeURIComponent(idShortPath)
}

/** Maps a value-only operation result to Studio's invocation state. */
function toInvocation (operation: JsonObject, result: JsonObject, handle: string | null): Invocation {
  const state = String(result.executionState ?? 'Completed')
  const messages = Array.isArray(result.messages) ? result.messages as JsonObject[] : []
  const message = messages.map(entry => entry.text).find(text => typeof text === 'string') as string | undefined
  if (state === 'Running' || state === 'Initiated') {
    return { handle, state: 'running', outputs: [], message: message ?? null }
  }
  const failed = state !== 'Completed' || result.success === false
  return { handle, state: failed ? 'failed' : 'completed', outputs: failed ? [] : invocationOutputs(operation, result), message: message ?? (failed ? state : null) }
}

/**
 * Live AAS target, scoped to one request. Uses `basyx-typescript-sdk` for
 * every operation it offers; BaSyx Go endpoints the SDK lacks go through the
 * same guarded, credentialed HTTP layer (ADR 0022).
 */
export class LiveAasTarget implements AasTarget {
  readonly capabilities: TargetCapabilities
  readonly #http: TargetHttp
  readonly #aasClient = new AasRepositoryClient()
  readonly #submodelClient = new SubmodelRepositoryClient()
  readonly #cdClient = new ConceptDescriptionRepositoryClient()
  readonly #discoveryClient = new AasDiscoveryClient()
  readonly #registryClient = new AasRegistryClient()
  readonly #submodelRegistryClient = new SubmodelRegistryClient()
  readonly #record: LiveTargetOptions['record']
  readonly #resolver: EndpointResolver

  constructor (options: LiveTargetOptions) {
    this.#http = new TargetHttp(options)
    this.#record = options.record
    this.#resolver = new EndpointResolver(options.record, this.#http, options.shellContext)
    this.capabilities = liveCapabilities(options.record)
  }

  /** The shell list from the list source: the AAS registry's descriptors or the AAS repository (I3). */
  async listShells (limit: number, cursor: string | undefined): Promise<Page<ShellSummary>> {
    if (this.#listsFromRegistry()) {
      const data = await this.#call('aasRegistry', configuration =>
        this.#registryClient.getAllAssetAdministrationShellDescriptors({ configuration, limit, cursor }))
      const nextCursor = data.pagedResult?.cursor ?? null
      return {
        items: data.result.map(descriptor => descriptorSummary(Lib.toJsonableAssetAdministrationShellDescriptor(descriptor) as JsonObject)),
        page: { nextCursor, hasMore: nextCursor !== null },
      }
    }
    const data = await this.#call('aasRepository', configuration =>
      this.#aasClient.getAllAssetAdministrationShells({ configuration, limit, cursor }))
    const nextCursor = data.pagedResult?.cursor ?? null
    return {
      items: data.result.map(shell => toShellSummary(toJson(shell))),
      page: { nextCursor, hasMore: nextCursor !== null },
    }
  }

  async shell (id: string): Promise<JsonObject> {
    return toJson(await this.#call(await this.#shellBase(id), configuration =>
      this.#aasClient.getAssetAdministrationShellById({ configuration, aasIdentifier: id })))
  }

  /** Submodel identifiers referenced by a shell, across all pages. */
  async submodelIds (shellId: string): Promise<string[]> {
    const ids: string[] = []
    let cursor: string | undefined
    for (let page = 0; page < 20; page++) {
      const data = await this.#call(await this.#shellBase(shellId), configuration =>
        this.#aasClient.getAllSubmodelReferencesAasRepository({ configuration, aasIdentifier: shellId, limit: 100, cursor }))
      for (const reference of data.result) {
        const id = submodelIdOf(toJson(reference))
        if (id) {
          ids.push(id)
        }
      }
      cursor = data.pagedResult?.cursor ?? undefined
      if (!cursor) {
        break
      }
    }
    return ids
  }

  async submodelMetadata (id: string): Promise<JsonObject> {
    // `$metadata` responses are plain JSON in the SDK (no aas-core instance).
    return await this.#call(await this.#submodelBase(id), configuration =>
      this.#submodelClient.getSubmodelByIdMetadata({ configuration, submodelIdentifier: id })) as unknown as JsonObject
  }

  async submodel (id: string): Promise<JsonObject> {
    return toJson(await this.#call(await this.#submodelBase(id), configuration =>
      this.#submodelClient.getSubmodelById({ configuration, submodelIdentifier: id })))
  }

  async element (submodelId: string, idShortPath: string): Promise<ElementSnapshot> {
    const { value, etag } = await this.#read(submodelId, idShortPath)
    return { value, revision: revisionOf(value), concurrency: etag ? 'strong' : 'best_effort' }
  }

  /**
   * Reads the element again, checks that it still matches the revision the
   * user edited, and writes it. With a downstream ETag the write is
   * conditional, so a change after the check is detected (`strong`); BaSyx Go
   * shares one revision per submodel, so a 412 caused by another element is
   * retried. Without an ETag the check is all there is (`best_effort`).
   */
  async setElementValue (submodelId: string, idShortPath: string, value: ElementValueInput['value'], revision: string): Promise<ElementSnapshot> {
    return this.#conditionalWrite(submodelId, idShortPath, revision, async (current, configuration) => {
      const { instance } = withValue(current.value, value)
      return this.#submodelClient.patchSubmodelElementByPath({
        configuration,
        submodelIdentifier: submodelId,
        idShortPath,
        submodelElement: instance,
        ifMatch: current.etag,
      })
    })
  }

  /**
   * Structural changes replace the children of the parent (a submodel or a
   * container element) in one write, based on the ETag of the read. That
   * keeps the order, a rename and an insert at an index atomic, where the
   * AAS API has only append and delete (MVP-5 plan, W2, W3).
   */
  async addElement (submodelId: string, parentPath: string | null, element: JsonObject, index: number | null, structureRevision: string): Promise<StructureResult> {
    const expected = parseStructureRevision(structureRevision)
    const placed = await this.#changeChildren(submodelId, parentPath, parent => {
      if (structureRevisionOf(parent.children) !== expected) {
        throw new StudioProblem('structure_conflict')
      }
      return insertChild(parent.children, parent.element, parent.type, element, index)
    })
    return this.#placed(submodelId, parentPath, placed.type, placed.index, placed.children)
  }

  async replaceElement (submodelId: string, idShortPath: string, element: JsonObject, revision: string): Promise<StructureResult> {
    const token = parseRevision(revision)
    const parentPath = this.#parentPath(idShortPath)
    const placed = await this.#changeChildren(submodelId, parentPath, parent => {
      const position = this.#position(parent.children, idShortPath)
      if (contentHash(parent.children[position]) !== token.hash) {
        throw new StudioProblem('revision_conflict')
      }
      return replaceChild(parent.children, position, parent.element, parent.type, element)
    })
    return this.#placed(submodelId, parentPath, placed.type, placed.index, placed.children)
  }

  async deleteElement (submodelId: string, idShortPath: string, revision: string): Promise<void> {
    const token = parseRevision(revision)
    await this.#changeChildren(submodelId, this.#parentPath(idShortPath), parent => {
      const position = this.#position(parent.children, idShortPath)
      if (contentHash(parent.children[position]) !== token.hash) {
        throw new StudioProblem('revision_conflict')
      }
      return { children: removeChild(parent.children, position), index: position }
    })
  }

  async moveElement (submodelId: string, idShortPath: string, index: number, structureRevision: string): Promise<StructureResult> {
    // BaSyx Go returns named children by name, whatever order they are written in
    // (phase 0 measurement); only the children of lists have a position.
    if (parseLocator(idShortPath).at(-1)?.kind !== 'index') {
      throw new StudioProblem('unsupported_operation', 'This infrastructure orders elements by name; only list items can be moved.')
    }
    const expected = parseStructureRevision(structureRevision)
    const parentPath = this.#parentPath(idShortPath)
    const placed = await this.#changeChildren(submodelId, parentPath, parent => {
      if (structureRevisionOf(parent.children) !== expected) {
        throw new StudioProblem('structure_conflict')
      }
      return moveChild(parent.children, this.#position(parent.children, idShortPath), index)
    })
    return this.#placed(submodelId, parentPath, placed.type, placed.index, placed.children)
  }

  async replaceSubmodelMetadata (submodelId: string, metadata: JsonObject, revision: string): Promise<JsonObject> {
    const token = parseRevision(revision)
    const base = await this.#submodelBase(submodelId)
    for (let attempt = 1; ; attempt++) {
      const read = await this.#send(base, configuration =>
        this.#submodelClient.getSubmodelById({ configuration, submodelIdentifier: submodelId }))
      if (!read.success) {
        throw await this.#http.problem(read.statusCode, read.recorder)
      }
      const current = toJson(read.data)
      const { submodelElements: _, ...currentMetadata } = current
      if (contentHash(currentMetadata) !== token.hash) {
        throw new StudioProblem('revision_conflict')
      }
      if (metadata.id !== current.id) {
        throw new StudioProblem('validation_failed', 'The identifier of a submodel cannot be changed.', {
          violations: [{ path: 'id', message: 'The identifier of a submodel cannot be changed.' }],
        })
      }
      const verified = verifySubmodelMetadata(metadata)
      const next = { ...verified, ...(current.submodelElements === undefined ? {} : { submodelElements: current.submodelElements }) }
      const instance = jsonization.submodelFromJsonable(next as Parameters<typeof jsonization.submodelFromJsonable>[0]).mustValue()
      const result = await this.#send(base, configuration => this.#submodelClient.putSubmodelById({
        configuration,
        submodelIdentifier: submodelId,
        submodel: instance,
        ifMatch: read.etag,
      }))
      if (result.success) {
        return this.submodelMetadata(submodelId)
      }
      if (!result.preconditionFailed) {
        throw await this.#http.problem(result.statusCode, result.recorder)
      }
      if (attempt === writeAttempts) {
        throw new StudioProblem('revision_conflict', 'The submodel kept changing while saving. Try again.')
      }
    }
  }

  async createSubmodel (submodel: JsonObject): Promise<void> {
    const instance = jsonization.submodelFromJsonable(submodel as Parameters<typeof jsonization.submodelFromJsonable>[0]).mustValue()
    await this.#create('submodelRepository', configuration =>
      this.#submodelClient.postSubmodel({ configuration, submodel: instance }))
  }

  async deleteSubmodel (id: string): Promise<void> {
    await this.#call(await this.#submodelBase(id), configuration =>
      this.#submodelClient.deleteSubmodelById({ configuration, submodelIdentifier: id }))
  }

  async createShell (shell: JsonObject): Promise<void> {
    const instance = jsonization.assetAdministrationShellFromJsonable(shell as Parameters<typeof jsonization.assetAdministrationShellFromJsonable>[0]).mustValue()
    await this.#create('aasRepository', configuration =>
      this.#aasClient.postAssetAdministrationShell({ configuration, assetAdministrationShell: instance }))
  }

  async replaceShell (id: string, shell: JsonObject, revision: string): Promise<JsonObject> {
    const token = parseRevision(revision)
    const base = await this.#shellBase(id)
    for (let attempt = 1; ; attempt++) {
      const read = await this.#send(base, configuration =>
        this.#aasClient.getAssetAdministrationShellById({ configuration, aasIdentifier: id }))
      if (!read.success) {
        throw await this.#http.problem(read.statusCode, read.recorder)
      }
      const current = toJson(read.data)
      if (contentHash(shellMetadata(current)) !== token.hash) {
        throw new StudioProblem('revision_conflict')
      }
      if (shell.id !== id) {
        throw new StudioProblem('validation_failed', 'The identifier of a shell cannot be changed.', {
          violations: [{ path: 'id', message: 'The identifier of a shell cannot be changed.' }],
        })
      }
      // The references stay as they are now, so a concurrent add is not lost (W1).
      const { submodels: _, ...changes } = shell
      const next = verifyShell({ ...changes, ...(current.submodels === undefined ? {} : { submodels: current.submodels }) })
      const instance = jsonization.assetAdministrationShellFromJsonable(next as Parameters<typeof jsonization.assetAdministrationShellFromJsonable>[0]).mustValue()
      const result = await this.#send(base, configuration => this.#aasClient.putAssetAdministrationShellById({
        configuration,
        aasIdentifier: id,
        assetAdministrationShell: instance,
        ifMatch: read.etag,
      }))
      if (result.success) {
        return this.shell(id)
      }
      if (!result.preconditionFailed) {
        throw await this.#http.problem(result.statusCode, result.recorder)
      }
      if (attempt === writeAttempts) {
        throw new StudioProblem('revision_conflict', 'The shell kept changing while saving. Try again.')
      }
    }
  }

  async replaceSubmodel (id: string, submodel: JsonObject, revision: string): Promise<JsonObject> {
    const token = parseRevision(revision)
    const base = await this.#submodelBase(id)
    for (let attempt = 1; ; attempt++) {
      const read = await this.#send(base, configuration =>
        this.#submodelClient.getSubmodelById({ configuration, submodelIdentifier: id }))
      if (!read.success) {
        throw await this.#http.problem(read.statusCode, read.recorder)
      }
      if (contentHash(toJson(read.data)) !== token.hash) {
        throw new StudioProblem('revision_conflict')
      }
      const parsed = jsonization.submodelFromJsonable(submodel as Parameters<typeof jsonization.submodelFromJsonable>[0])
      if (parsed.error) {
        throw new StudioProblem('validation_failed', parsed.error.message)
      }
      const result = await this.#send(base, configuration => this.#submodelClient.putSubmodelById({
        configuration,
        submodelIdentifier: id,
        submodel: parsed.mustValue(),
        ifMatch: read.etag,
      }))
      if (result.success) {
        return this.submodel(id)
      }
      if (!result.preconditionFailed) {
        throw await this.#http.problem(result.statusCode, result.recorder)
      }
      if (attempt === writeAttempts) {
        throw new StudioProblem('revision_conflict', 'The submodel kept changing while saving. Try again.')
      }
    }
  }

  async unregisterSubmodels (submodelIds: string[], plan: SyncPlan): Promise<SyncStep[]> {
    if (!plan.registry || serviceUrl(this.#record, 'submodelRegistry') === undefined) {
      return []
    }
    const steps: SyncStep[] = []
    for (const id of submodelIds) {
      steps.push(await this.#syncStep('submodelDescriptor', id, 'removed', () => this.#call('submodelRegistry', configuration =>
        this.#submodelRegistryClient.deleteSubmodelDescriptorById({ configuration, submodelIdentifier: id }))))
    }
    return steps
  }

  async addSubmodelRef (shellId: string, submodelId: string): Promise<void> {
    const reference = jsonization.referenceFromJsonable(submodelReference(submodelId) as Parameters<typeof jsonization.referenceFromJsonable>[0]).mustValue()
    await this.#call(await this.#shellBase(shellId), configuration =>
      this.#aasClient.postSubmodelReference({ configuration, aasIdentifier: shellId, submodelReference: reference }))
  }

  async removeSubmodelRef (shellId: string, submodelId: string): Promise<void> {
    await this.#call(await this.#shellBase(shellId), configuration =>
      this.#aasClient.deleteSubmodelReferenceById({ configuration, aasIdentifier: shellId, submodelIdentifier: submodelId }))
  }

  async deleteShell (id: string): Promise<void> {
    await this.#call(await this.#shellBase(id), configuration =>
      this.#aasClient.deleteAssetAdministrationShellById({ configuration, aasIdentifier: id }))
  }

  /**
   * Writes the descriptors and asset links of uploaded shells where Studio
   * keeps the registries and discovery in step (MVP-4 plan, I5). Each
   * resource reports its outcome; a failure does not undo the upload.
   */
  async registerShells (shellIds: string[], plan: SyncPlan): Promise<SyncStep[]> {
    const steps: SyncStep[] = []
    if (!plan.registry && !plan.discovery) {
      return steps
    }
    const submodelRegistry = serviceUrl(this.#record, 'submodelRegistry') !== undefined
    for (const id of shellIds) {
      const shell = await this.shell(id).catch(() => null)
      if (!shell) {
        steps.push({ resource: 'shellDescriptor', id, outcome: 'failed', detail: 'The uploaded shell could not be read.' })
        continue
      }
      if (plan.registry) {
        steps.push(await this.#syncStep('shellDescriptor', id, 'written', async () => {
          const descriptor = Lib.assetAdministrationShellDescriptorFromJsonable(shellDescriptor(shell, serviceUrl(this.#record, 'aasRepository')!) as Jsonable).mustValue()
          const created = await this.#send('aasRegistry', configuration =>
            this.#registryClient.postAssetAdministrationShellDescriptor({ configuration, assetAdministrationShellDescriptor: descriptor }))
          // An earlier upload registered it already: replace it.
          if (!created.success && created.statusCode === 409) {
            await this.#call('aasRegistry', configuration =>
              this.#registryClient.putAssetAdministrationShellDescriptorById({ configuration, aasIdentifier: id, assetAdministrationShellDescriptor: descriptor }))
          } else if (!created.success) {
            throw await this.#http.problem(created.statusCode, created.recorder)
          }
        }))
        for (const submodelId of submodelRegistry ? submodelIdsOf(shell) : []) {
          steps.push(await this.#syncStep('submodelDescriptor', submodelId, 'written', async () => {
            const submodel = await this.submodelMetadata(submodelId)
            const descriptor = Lib.submodelDescriptorFromJsonable(submodelDescriptor(submodel, serviceUrl(this.#record, 'submodelRepository')!) as Jsonable).mustValue()
            const created = await this.#send('submodelRegistry', configuration =>
              this.#submodelRegistryClient.postSubmodelDescriptor({ configuration, submodelDescriptor: descriptor }))
            if (!created.success && created.statusCode === 409) {
              await this.#call('submodelRegistry', configuration =>
                this.#submodelRegistryClient.putSubmodelDescriptorById({ configuration, submodelIdentifier: submodelId, submodelDescriptor: descriptor }))
            } else if (!created.success) {
              throw await this.#http.problem(created.statusCode, created.recorder)
            }
          }))
        }
      }
      const links = assetLinksOf(shell)
      if (plan.discovery && links.length > 0) {
        steps.push(await this.#syncStep('assetLinks', id, 'written', async () => {
          await this.#call('aasDiscovery', configuration => this.#discoveryClient.postAllAssetLinksById({
            configuration,
            aasIdentifier: id,
            specificAssetId: links.map(link => new aasTypes.SpecificAssetId(link.name, link.value)),
          }))
        }))
      }
    }
    return steps
  }

  /**
   * Removes the descriptor and asset links of a deleted shell (MVP-4 plan,
   * I5). Its submodels stay, and so do their descriptors.
   */
  async unregisterShell (shellId: string, plan: SyncPlan): Promise<SyncStep[]> {
    const steps: SyncStep[] = []
    if (plan.registry) {
      steps.push(await this.#syncStep('shellDescriptor', shellId, 'removed', () => this.#call('aasRegistry', configuration =>
        this.#registryClient.deleteAssetAdministrationShellDescriptorById({ configuration, aasIdentifier: shellId }))))
    }
    if (plan.discovery) {
      steps.push(await this.#syncStep('assetLinks', shellId, 'removed', () => this.#call('aasDiscovery', configuration =>
        this.#discoveryClient.deleteAllAssetLinksById({ configuration, aasIdentifier: shellId }))))
    }
    return steps
  }

  async undo (): Promise<void> {
    throw new StudioProblem('unsupported_operation', 'Changes on a live infrastructure cannot be undone.')
  }

  async redo (): Promise<void> {
    throw new StudioProblem('unsupported_operation', 'Changes on a live infrastructure cannot be undone.')
  }

  async setThumbnail (shellId: string, file: BinaryContent): Promise<JsonObject> {
    const base = await this.#shellBase(shellId)
    await this.#call(base, configuration => this.#aasClient.putThumbnail({
      configuration,
      aasIdentifier: shellId,
      fileName: file.fileName ?? 'thumbnail',
      file: new Blob([file.bytes as BlobPart], { type: file.contentType }),
    }))
    return this.shell(shellId)
  }

  async thumbnail (shellId: string): Promise<BinaryContent | null> {
    const result = await this.#send(await this.#shellBase(shellId), configuration =>
      this.#aasClient.getThumbnail({ configuration, aasIdentifier: shellId }))
    if (!result.success) {
      if (result.statusCode === 404) {
        return null
      }
      throw await this.#http.problem(result.statusCode, result.recorder)
    }
    const blob = result.data as Blob
    return { bytes: new Uint8Array(await blob.arrayBuffer()), contentType: blob.type || 'application/octet-stream', fileName: null }
  }

  async attachment (submodelId: string, idShortPath: string): Promise<BinaryContent> {
    const { value } = await this.#read(submodelId, idShortPath)
    if (value.modelType !== 'File') {
      throw new StudioProblem('unsupported_operation', 'Only File elements have an attachment.')
    }
    const blob = await this.#call(await this.#submodelBase(submodelId), configuration =>
      this.#submodelClient.getFileByPath({ configuration, submodelIdentifier: submodelId, idShortPath })) as Blob
    const location = typeof value.value === 'string' ? value.value : ''
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      contentType: typeof value.contentType === 'string' ? value.contentType : (blob.type || 'application/octet-stream'),
      fileName: location.split('/').pop() || null,
    }
  }

  async replaceAttachment (submodelId: string, idShortPath: string, file: BinaryContent, revision: string): Promise<ElementSnapshot> {
    return this.#conditionalWrite(submodelId, idShortPath, revision, async (current, configuration) => {
      if (current.value.modelType !== 'File') {
        throw new StudioProblem('unsupported_operation', 'Only File elements have an attachment.')
      }
      return this.#submodelClient.putFileByPath({
        configuration,
        submodelIdentifier: submodelId,
        idShortPath,
        fileName: file.fileName ?? 'file',
        file: new Blob([file.bytes as BlobPart], { type: file.contentType }),
        ifMatch: current.etag,
      })
    })
  }

  // The SDK's asynchronous value-only invocation does not expose the
  // `Location` header with the handle, so invocations use the adapter.
  async invoke (submodelId: string, idShortPath: string, args: Array<{ idShort: string, value: string | null }>, async: boolean): Promise<Invocation> {
    const operation = await this.#operation(submodelId, idShortPath)
    const base = `/submodels/${encodeIdentifier(submodelId)}/submodel-elements/${path(idShortPath)}`
    if (!async) {
      const result = await this.#http.json<JsonObject>(await this.#submodelBase(submodelId), `${base}/invoke/$value`, {
        method: 'POST',
        body: invocationBody(operation, args),
      })
      return toInvocation(operation, result, null)
    }
    const response = await this.#http.request(await this.#submodelBase(submodelId), `${base}/invoke-async/$value`, {
      method: 'POST',
      body: invocationBody(operation, args, asyncInvocationTimeout),
    })
    await response.body?.cancel()
    const handle = handleFromLocation(response.headers.get('location'))
    if (!handle) {
      throw new StudioProblem('target_invalid_response', 'The target did not return a handle for the asynchronous invocation.')
    }
    return { handle, state: 'running', outputs: [], message: null }
  }

  async invocation (submodelId: string, idShortPath: string, handle: string): Promise<Invocation> {
    const operation = await this.#operation(submodelId, idShortPath)
    const base = `/submodels/${encodeIdentifier(submodelId)}/submodel-elements/${path(idShortPath)}`
    const submodelBase = await this.#submodelBase(submodelId)
    const status = await this.#http.json<JsonObject>(submodelBase, `${base}/operation-status/${encodeURIComponent(handle)}`)
    const state = toInvocation(operation, status, handle)
    if (state.state !== 'completed') {
      return state
    }
    const result = await this.#http.json<JsonObject>(submodelBase, `${base}/operation-results/${encodeURIComponent(handle)}/$value`)
    return toInvocation(operation, result, handle)
  }

  async conceptDescriptions (limit: number, cursor: string | undefined): Promise<Page<ConceptDescriptionSummary>> {
    const data = await this.#call('conceptDescriptionRepository', configuration =>
      this.#cdClient.getAllConceptDescriptions({ configuration, limit, cursor }))
    const nextCursor = data.pagedResult?.cursor ?? null
    return {
      items: data.result.map(cd => toConceptDescriptionSummary(toJson(cd))),
      page: { nextCursor, hasMore: nextCursor !== null },
    }
  }

  /** Concept descriptions through the repository's query endpoint: the search field's expression or a checked raw query. */
  async searchConceptDescriptions (search: ShellSearch, sources: readonly ConceptDescriptionSource[], limit: number, cursor: string | undefined): Promise<Page<ConceptDescriptionSummary>> {
    if (this.capabilities.conceptDescriptionSearch !== 'query') {
      throw new StudioProblem('query_unsupported')
    }
    const checked = 'query' in search ? { query: checkRawQuery(search.query, 'conceptDescriptions') } : search
    const json = buildConceptDescriptionQuery(checked, sources) ?? { $condition: { $boolean: true } }
    const data = await this.#call('conceptDescriptionRepository', configuration =>
      this.#cdClient.queryConceptDescriptions({ configuration, query: toSdkQuery(json), limit, cursor }))
    const nextCursor = data.pagedResult?.cursor ?? null
    return {
      items: data.resultType === 'Identifier' ? [] : data.result.map(cd => toConceptDescriptionSummary(toJson(cd))),
      page: { nextCursor, hasMore: nextCursor !== null },
    }
  }

  async conceptDescription (id: string): Promise<JsonObject> {
    return toJson(await this.#call('conceptDescriptionRepository', configuration =>
      this.#cdClient.getConceptDescriptionById({ configuration, cdIdentifier: id })))
  }

  async createConceptDescription (conceptDescription: JsonObject): Promise<void> {
    const instance = jsonization.conceptDescriptionFromJsonable(conceptDescription as Parameters<typeof jsonization.conceptDescriptionFromJsonable>[0]).mustValue()
    await this.#create('conceptDescriptionRepository', configuration =>
      this.#cdClient.postConceptDescription({ configuration, conceptDescription: instance }))
  }

  async replaceConceptDescription (id: string, conceptDescription: JsonObject, revision: string): Promise<JsonObject> {
    if (conceptDescription.id !== id) {
      throw new StudioProblem('validation_failed', 'The identifier of a concept description cannot be changed.', {
        violations: [{ path: 'id', message: 'The identifier of a concept description cannot be changed.' }],
      })
    }
    const next = verifyConceptDescription(conceptDescription)
    const instance = jsonization.conceptDescriptionFromJsonable(next as Parameters<typeof jsonization.conceptDescriptionFromJsonable>[0]).mustValue()
    await this.#conditionalCd(id, revision, (etag, configuration) =>
      this.#cdClient.putConceptDescriptionById({ configuration, cdIdentifier: id, conceptDescription: instance, ifMatch: etag }))
    return this.conceptDescription(id)
  }

  async deleteConceptDescription (id: string, revision: string): Promise<void> {
    await this.#conditionalCd(id, revision, (etag, configuration) =>
      this.#cdClient.deleteConceptDescriptionById({ configuration, cdIdentifier: id, ifMatch: etag }))
  }

  /**
   * Counts through the submodel repository's query endpoint: submodels whose
   * own semantic ID or one of whose elements' names the concept description.
   * Without query support the usages are unknown.
   */
  async conceptDescriptionUsages (id: string): Promise<ConceptDescriptionUsages> {
    if (!this.capabilities.elementSearch) {
      return { checked: false, submodels: 0, elements: 0, truncated: false }
    }
    const limit = 100
    const data = await this.#call('submodelRepository', configuration => this.#submodelClient.querySubmodels({
      configuration,
      query: toSdkQuery({ $condition: { $or: [
        { $eq: [{ $field: '$sm#semanticId' }, { $strVal: id }] },
        { $eq: [{ $field: '$sme#semanticId' }, { $strVal: id }] },
      ] } }),
      limit,
    }))
    const submodels = data.resultType === 'Identifier' ? [] : data.result.map(submodel => toJson(submodel))
    return {
      checked: true,
      submodels: submodels.filter(submodel => semanticKey(submodel) === id).length,
      elements: submodels.reduce((sum, submodel) => sum + countSemanticUses(submodel, id), 0),
      truncated: Boolean(data.pagedResult?.cursor),
    }
  }

  /**
   * Shells matching a search, through the AAS Query Language on the service
   * the capabilities name (`queryTarget`): an expression of the search field
   * is turned into a query for that service, a raw query is checked first.
   * An empty expression lists the shells.
   */
  async searchShells (search: ShellSearch, limit: number, cursor: string | undefined): Promise<ShellSearchPage> {
    const target = this.capabilities.queryTarget
    if (!target) {
      throw new StudioProblem('query_unsupported')
    }
    const json = 'query' in search ? checkRawQuery(search.query, target) : buildShellQuery(target, parseSearch(search.expression))
    if (!json) {
      return { ...await this.listShells(limit, cursor), endpoint: target }
    }
    const query = toSdkQuery(json)
    const items: ShellSummary[] = []
    let nextCursor: string | null
    if (target === 'registry') {
      const data = await this.#call('aasRegistry', configuration =>
        this.#registryClient.queryAssetAdministrationShellDescriptors({ configuration, query, limit, cursor }))
      if (data.resultType !== 'Identifier') {
        items.push(...data.result.map(descriptor => descriptorSummary(Lib.toJsonableAssetAdministrationShellDescriptor(descriptor) as JsonObject)))
      }
      nextCursor = data.pagedResult?.cursor ?? null
    } else {
      const data = await this.#call('aasRepository', configuration =>
        this.#aasClient.queryAssetAdministrationShells({ configuration, query, limit, cursor }))
      if (data.resultType !== 'Identifier') {
        items.push(...data.result.map(shell => toShellSummary(toJson(shell))))
      }
      nextCursor = data.pagedResult?.cursor ?? null
    }
    return { items, page: { nextCursor, hasMore: nextCursor !== null }, endpoint: target }
  }

  /**
   * Submodel elements whose idShort matches a text (case-insensitive), for
   * the palette. The submodel repository finds the submodels; where the AAS
   * repository can query, it names the shells they belong to, so the hits can
   * be opened.
   */
  async searchElements (text: string, limit: number): Promise<ElementHit[]> {
    if (!this.capabilities.elementSearch) {
      throw new StudioProblem('query_unsupported')
    }
    const pattern = `(?i)${escapeRegex(text)}`
    const data = await this.#call('submodelRepository', configuration => this.#submodelClient.querySubmodels({
      configuration,
      query: toSdkQuery({ $condition: { $match: [{ $regex: [{ $field: '$sme#idShort' }, { $strVal: pattern }] }] } }),
      limit,
    }))
    const submodels = data.resultType === 'Identifier' ? [] : data.result.map(submodel => toJson(submodel))
    const owners = await this.#owners(submodels.map(submodel => String(submodel.id)))
    return submodels
      .flatMap(submodel => elementHits(submodel, text, limit, owners.get(String(submodel.id)) ?? null))
      .slice(0, limit * 2)
  }

  /**
   * Shells registered for an asset ID in the discovery service. Shells that
   * are not registered there are found by their global asset ID.
   */
  async lookupShells (assetId: string): Promise<ShellSummary[]> {
    let ids: string[] = []
    if (this.capabilities.discovery) {
      const data = await this.#call('aasDiscovery', configuration =>
        this.#discoveryClient.getAllAssetAdministrationShellIdsByAssetLink({ configuration, assetIds: [{ name: 'globalAssetId', value: assetId }], limit: 20 }))
      ids = data.result
    }
    if (ids.length === 0) {
      if (!announcedFeatures(this.#record).query.aasRepository) {
        return []
      }
      const data = await this.#call('aasRepository', configuration => this.#aasClient.queryAssetAdministrationShells({
        configuration,
        query: toSdkQuery({ $condition: { $eq: [{ $field: '$aas#assetInformation.globalAssetId' }, { $strVal: assetId }] } }),
        limit: 20,
      }))
      return data.resultType === 'Identifier' ? [] : data.result.map(shell => toShellSummary(toJson(shell)))
    }
    const shells = await Promise.allSettled(ids.map(id => this.shell(id)))
    return shells.filter(result => result.status === 'fulfilled').map(result => toShellSummary(result.value))
  }

  /**
   * The SDK's serialization call cannot choose the format (Accept header).
   * BaSyx Go adds the shell's submodels itself and skips dangling
   * references, which an explicit `submodelIds` list would fail on.
   */
  async exportShell (shellId: string, format: ExportFormat): Promise<BinaryContent> {
    const response = await this.#http.request('aasEnvironment', '/serialization', {
      query: {
        aasIds: encodeIdentifier(shellId),
        includeConceptDescriptions: true,
      },
      headers: { Accept: exportMediaTypes[format] },
    })
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType: exportMediaTypes[format],
      fileName: null,
    }
  }

  async upload (file: BinaryContent): Promise<void> {
    const form = new FormData()
    form.append('file', new Blob([file.bytes as BlobPart], { type: file.contentType }), file.fileName ?? 'upload')
    if (file.fileName) {
      form.append('fileName', file.fileName)
    }
    const response = await this.#http.request('aasEnvironment', '/upload', { method: 'POST', body: form })
    await response.body?.cancel()
  }

  async submodelAt (id: string, date: string): Promise<JsonObject> {
    return this.#http.json<JsonObject>(await this.#submodelBase(id), `/submodels/${encodeIdentifier(id)}/$history`, { query: { date } })
  }

  /**
   * Change events, newest first. Without `after`, it pages through the
   * events since `since` and keeps the newest `limit`; with `after` it returns
   * only events newer than that event.
   */
  async changes (query: ChangesQuery): Promise<ChangePage> {
    const filter = query.subjects?.length ? subjectFilter(query.subjects) : undefined
    const collected: ChangeEvent[] = []
    let cursor: string | undefined
    for (let page = 0; page < 10; page++) {
      const data = await this.#http.json<{ records?: JsonObject[], cursor?: string }>('aasRepository', '/events', {
        query: {
          limit: 200,
          presentation: 'COMPACT',
          filter,
          cursor,
          lastEventId: cursor ? undefined : query.after,
          since: cursor || query.after ? undefined : query.since,
        },
      })
      for (const record of data.records ?? []) {
        const event = toChangeEvent(record)
        if (event) {
          collected.push(event)
        }
      }
      cursor = data.cursor
      if (!cursor || (data.records ?? []).length === 0) {
        break
      }
    }
    const items = collected.toReversed().slice(0, query.limit)
    return { items, lastEventId: collected.at(-1)?.id ?? query.after ?? null }
  }

  async access (shellId: string): Promise<AccessDocument> {
    const response = await this.#http.request(await this.#shellBase(shellId), `/shells/${encodeIdentifier(shellId)}/$access`)
    const document = await response.json() as JsonObject
    const principal = await this.#http.json<JsonObject>(await this.#shellBase(shellId), '/security/rebac/principal').catch(() => ({} as JsonObject))
    return {
      grants: toAccessGrants(document),
      revision: response.headers.get('etag'),
      issuer: typeof principal.issuer === 'string' ? principal.issuer : null,
    }
  }

  async setAccess (shellId: string, grants: AccessGrant[], revision: string): Promise<AccessDocument> {
    const response = await this.#http.request(await this.#shellBase(shellId), `/shells/${encodeIdentifier(shellId)}/$access/grants`, {
      method: 'PUT',
      body: { grants },
      headers: { 'If-Match': revision },
    })
    await response.body?.cancel()
    return this.access(shellId)
  }

  async effectiveRights (shellId: string): Promise<EffectiveRights> {
    return toEffectiveRights(await this.#http.json<JsonObject>(await this.#shellBase(shellId), `/shells/${encodeIdentifier(shellId)}/$access/effective`))
  }

  async invite (shellId: string, relation: string, expiresAt: string, maxUses: number): Promise<InvitationResult> {
    const result = await this.#http.json<JsonObject>(await this.#shellBase(shellId), `/shells/${encodeIdentifier(shellId)}/$access/invitations`, {
      method: 'POST',
      body: { relation, expiresAt, maxUses },
    })
    if (typeof result.token !== 'string') {
      throw new StudioProblem('target_invalid_response', 'The target did not return an invitation token.')
    }
    return { token: result.token, expiresAt: typeof result.expiresAt === 'string' ? result.expiresAt : expiresAt }
  }

  async acceptInvitation (token: string): Promise<void> {
    const response = await this.#http.request('aasRepository', '/security/rebac/invitations/accept', { method: 'POST', body: { token } })
    await response.body?.cancel()
  }

  /** The shells that reference the submodels, if the AAS repository can query. */
  async #owners (submodelIds: string[]): Promise<Map<string, { key: string, label: string }>> {
    const owners = new Map<string, { key: string, label: string }>()
    if (submodelIds.length === 0 || !announcedFeatures(this.#record).query.aasRepository) {
      return owners
    }
    const references = submodelIds.map(id => ({ $eq: [{ $field: '$aas#submodels[].keys[].value' }, { $strVal: id }] }))
    const data = await this.#call('aasRepository', configuration => this.#aasClient.queryAssetAdministrationShells({
      configuration,
      query: toSdkQuery({ $condition: references.length === 1 ? references[0]! : { $or: references } }),
      limit: 100,
    }))
    for (const shell of data.resultType === 'Identifier' ? [] : data.result.map(item => toJson(item))) {
      const summary = toShellSummary(shell)
      for (const reference of Array.isArray(shell.submodels) ? shell.submodels as JsonObject[] : []) {
        const id = submodelIdOf(reference)
        if (id && !owners.has(id)) {
          owners.set(id, { key: summary.key, label: summary.idShort ?? summary.id })
        }
      }
    }
    return owners
  }

  #parentPath (idShortPath: string): string | null {
    const steps = parseLocator(idShortPath)
    return steps.length > 1 ? formatLocator(steps.slice(0, -1)) : null
  }

  /** The position of the addressed element among its siblings. */
  #position (children: JsonObject[], idShortPath: string): number {
    const last = parseLocator(idShortPath).at(-1)!
    const position = last.kind === 'index'
      ? last.index
      : (last.kind === 'idShort' ? children.findIndex(child => child.idShort === last.idShort) : -1)
    if (position < 0 || position >= children.length) {
      throw new StudioProblem('target_resource_not_found')
    }
    return position
  }

  async #placed (submodelId: string, parentPath: string | null, parentType: string, index: number, children: JsonObject[]): Promise<StructureResult> {
    const child = children[index]!
    const path = parentType === 'SubmodelElementList'
      ? `${parentPath}[${index}]`
      : (parentPath ? `${parentPath}.${String(child.idShort)}` : String(child.idShort))
    return { path, snapshot: await this.element(submodelId, path) }
  }

  /**
   * Reads the children of a parent with the ETag, lets `change` produce the
   * new children, and writes them conditionally. A 412 caused by an
   * unrelated change in the submodel is retried with a fresh read.
   */
  async #changeChildren (
    submodelId: string,
    parentPath: string | null,
    change: (parent: { element: JsonObject | null, type: string, children: JsonObject[] }) => { children: JsonObject[], index: number },
  ): Promise<{ children: JsonObject[], index: number, type: string }> {
    const base = await this.#submodelBase(submodelId)
    for (let attempt = 1; ; attempt++) {
      let parent: { element: JsonObject | null, type: string, children: JsonObject[] }
      let etag: string | undefined
      let root: JsonObject = {}
      if (parentPath === null) {
        const read = await this.#send(base, configuration =>
          this.#submodelClient.getSubmodelById({ configuration, submodelIdentifier: submodelId }))
        if (!read.success) {
          throw await this.#http.problem(read.statusCode, read.recorder)
        }
        root = toJson(read.data)
        etag = read.etag
        parent = { element: null, type: 'Submodel', children: Array.isArray(root.submodelElements) ? root.submodelElements as JsonObject[] : [] }
      } else {
        const read = await this.#read(submodelId, parentPath)
        if (!['SubmodelElementCollection', 'SubmodelElementList', 'Entity', 'AnnotatedRelationshipElement'].includes(String(read.value.modelType))) {
          throw new StudioProblem('unsupported_operation', `${String(read.value.modelType)} elements have no children.`)
        }
        etag = read.etag
        parent = { element: read.value, type: String(read.value.modelType), children: containerChildren(read.value) }
      }

      const changed = change(parent)
      const result = await this.#putChildren(submodelId, parentPath, parent.element ?? root, changed.children, etag)
      if (result.success) {
        return { ...changed, type: parent.type }
      }
      if (!result.preconditionFailed) {
        throw await this.#http.problem(result.statusCode, result.recorder)
      }
      if (attempt === writeAttempts) {
        throw new StudioProblem('structure_conflict', 'The submodel kept changing while saving. Try again.')
      }
    }
  }

  /** Writes the children of a parent (the submodel for `null`), conditionally. */
  async #putChildren (submodelId: string, parentPath: string | null, parent: JsonObject, children: JsonObject[], etag: string | undefined) {
    return this.#send(await this.#submodelBase(submodelId), async configuration => {
      if (parentPath === null) {
        // The submodel keeps its metadata; only the top level changes.
        const next = { ...parent, submodelElements: children }
        return this.#submodelClient.putSubmodelById({
          configuration,
          submodelIdentifier: submodelId,
          submodel: jsonization.submodelFromJsonable(next as Parameters<typeof jsonization.submodelFromJsonable>[0]).mustValue(),
          ifMatch: etag,
        })
      }
      const next = withChildren(parent, children)
      return this.#submodelClient.putSubmodelElementByPath({
        configuration,
        submodelIdentifier: submodelId,
        idShortPath: parentPath,
        submodelElement: jsonization.submodelElementFromJsonable(next as Parameters<typeof jsonization.submodelElementFromJsonable>[0]).mustValue(),
        ifMatch: etag,
      })
    })
  }

  async #operation (submodelId: string, idShortPath: string): Promise<JsonObject> {
    const { value } = await this.#read(submodelId, idShortPath)
    if (value.modelType !== 'Operation') {
      throw new StudioProblem('unsupported_operation', 'Only Operation elements can be invoked.')
    }
    return value
  }

  /** Runs a conditional write based on the revision the user saw, retrying on unrelated submodel changes. */
  async #conditionalWrite (
    submodelId: string,
    idShortPath: string,
    revision: string,
    write: (current: { value: JsonObject, etag: string | undefined }, configuration: Configuration) => Promise<SdkResult<unknown>>,
  ): Promise<ElementSnapshot> {
    const token = parseRevision(revision)
    for (let attempt = 1; ; attempt++) {
      const current = await this.#read(submodelId, idShortPath)
      if (contentHash(current.value) !== token.hash) {
        throw new StudioProblem('revision_conflict')
      }
      const result = await this.#send(await this.#submodelBase(submodelId), configuration => write(current, configuration))
      if (result.success) {
        return this.element(submodelId, idShortPath)
      }
      if (!result.preconditionFailed) {
        throw await this.#http.problem(result.statusCode, result.recorder)
      }
      if (attempt === writeAttempts) {
        throw new StudioProblem('revision_conflict', 'The submodel kept changing while saving. Try again.')
      }
    }
  }

  /** A write of a concept description based on the revision the user saw, retried when only the downstream tag moved. */
  async #conditionalCd (id: string, revision: string, write: (etag: string | undefined, configuration: Configuration) => Promise<SdkResult<unknown>>): Promise<void> {
    const token = parseRevision(revision)
    for (let attempt = 1; ; attempt++) {
      const read = await this.#send('conceptDescriptionRepository', configuration =>
        this.#cdClient.getConceptDescriptionById({ configuration, cdIdentifier: id }))
      if (!read.success) {
        throw await this.#http.problem(read.statusCode, read.recorder)
      }
      if (contentHash(toJson(read.data)) !== token.hash) {
        throw new StudioProblem('revision_conflict')
      }
      const result = await this.#send('conceptDescriptionRepository', configuration => write(read.etag, configuration))
      if (result.success) {
        return
      }
      if (!result.preconditionFailed) {
        throw await this.#http.problem(result.statusCode, result.recorder)
      }
      if (attempt === writeAttempts) {
        throw new StudioProblem('revision_conflict', 'The concept description kept changing while saving. Try again.')
      }
    }
  }

  async #read (submodelId: string, idShortPath: string): Promise<{ value: JsonObject, etag: string | undefined }> {
    // Blob values are left out unless asked for (AAS API `extent`).
    const result = await this.#send(await this.#submodelBase(submodelId), configuration =>
      this.#submodelClient.getSubmodelElementByPath({ configuration, submodelIdentifier: submodelId, idShortPath, extent: 'withBlobValue' }))
    if (!result.success) {
      throw await this.#http.problem(result.statusCode, result.recorder)
    }
    return { value: toJson(result.data), etag: result.etag }
  }

  #listsFromRegistry (): boolean {
    return this.#record.listSource === 'registry' && serviceUrl(this.#record, 'aasRegistry') !== undefined
  }

  async #shellBase (id: string): Promise<TargetBase> {
    return { url: await this.#resolver.shellBase(id) }
  }

  async #submodelBase (id: string): Promise<TargetBase> {
    return { url: await this.#resolver.submodelBase(id) }
  }

  async #syncStep (resource: SyncStep['resource'], id: string, outcome: 'written' | 'removed', run: () => Promise<unknown>): Promise<SyncStep> {
    try {
      await run()
      return { resource, id, outcome }
    } catch (error) {
      // Gone already counts as removed.
      if (outcome === 'removed' && error instanceof StudioProblem && error.code === 'target_resource_not_found') {
        return { resource, id, outcome }
      }
      return { resource, id, outcome: 'failed', detail: error instanceof StudioProblem ? (error.detail ?? error.title) : 'internal error' }
    }
  }

  /** A create call: a 409 means the identifier exists (nothing was written). */
  async #create<T> (base: TargetBase, operation: (configuration: Configuration) => Promise<SdkResult<T>>): Promise<T> {
    const result = await this.#send(base, operation)
    if (result.success) {
      return result.data
    }
    if (result.statusCode === 409) {
      throw new StudioProblem('identifier_conflict')
    }
    throw await this.#http.problem(result.statusCode, result.recorder)
  }

  async #call<T> (base: TargetBase, operation: (configuration: Configuration) => Promise<SdkResult<T>>): Promise<T> {
    const result = await this.#send(base, operation)
    if (result.success) {
      return result.data
    }
    throw await this.#http.problem(result.statusCode, result.recorder)
  }

  async #send<T> (base: TargetBase, operation: (configuration: Configuration) => Promise<SdkResult<T>>): Promise<SdkResult<T> & { recorder: FailureRecorder }> {
    const recorder: FailureRecorder = {}
    return { ...await operation(this.#http.configuration(base, recorder)), recorder }
  }
}
