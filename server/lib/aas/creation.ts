import type { IdScheme } from '#shared/aas/identifiers'
import type { ShellCreateInput, SubmodelSource, SyncStep } from '#shared/contract'
import type { AasTarget } from '../targets/aas-target'
import type { JsonObject } from './outline'
import type { SyncPlan } from './sync'
import { generateId } from '#shared/aas/identifiers'
import { convertToInstance, instantiateSubmodel } from '#shared/aas/templates'
import { StudioProblem } from '../problem'
import { revisionOf } from '../targets/revision'
import { bundledTemplate } from '../templates'
import { shellMetadata, submodelReference, verifyShell, verifySubmodel } from './edits'
import { decodeKey } from './keys'
import { submodelIdsOf } from './sync'

// Writes over several resources (MVP-5 plan, W4): submodels first, then the
// shell or the reference, then registries and discovery. Each step reports its
// outcome; a failure stops the later steps and is never reported as atomic.

export interface CreationContext {
  target: AasTarget
  scheme: IdScheme
  plan: SyncPlan
}

async function exists (check: () => Promise<unknown>): Promise<boolean> {
  try {
    await check()
    return true
  } catch (error) {
    if (error instanceof StudioProblem && error.code === 'target_resource_not_found') {
      return false
    }
    // An unreachable or forbidden check must not pass as "free".
    throw error
  }
}

/** Fails with `identifier_conflict` before anything is written. */
export async function assertFree (target: AasTarget, kind: 'shell' | 'submodel', id: string): Promise<void> {
  const taken = await exists(() => kind === 'shell' ? target.shell(id) : target.submodelMetadata(id))
  if (taken) {
    throw new StudioProblem('identifier_conflict', `A ${kind} with the identifier ${id} exists already.`)
  }
}

/** Runs the steps in order; the first failure becomes a `partial_write` that lists them all. */
export class StepRunner {
  readonly steps: SyncStep[] = []

  async run (resource: SyncStep['resource'], id: string, work: () => Promise<unknown>): Promise<void> {
    try {
      await work()
      this.steps.push({ resource, id, outcome: 'written' })
    } catch (error) {
      const detail = error instanceof StudioProblem ? (error.detail ?? error.title) : 'internal error'
      this.steps.push({ resource, id, outcome: 'failed', detail })
      // Nothing was written before: the original problem is the answer.
      if (this.steps.every(step => step.outcome === 'failed')) {
        throw error
      }
      throw new StudioProblem('partial_write', detail, { steps: this.steps })
    }
  }
}

export async function templateSubmodel (target: AasTarget, templateId: string): Promise<JsonObject> {
  if (templateId.startsWith('bundled:')) {
    return bundledTemplate(templateId)
  }
  if (templateId.startsWith('target:')) {
    const id = decodeKey(templateId.slice('target:'.length), 'template key')
    const submodel = await target.submodel(id)
    if (submodel.kind !== 'Template') {
      throw new StudioProblem('template_invalid', 'This submodel is not a template.')
    }
    return submodel
  }
  throw new StudioProblem('template_invalid', 'Unknown template source.')
}

/**
 * The fields of a new submodel the user filled in the form (names,
 * description, category, semantic ID); identity, kind of a copy and elements
 * are never taken from them, except the kind of an empty submodel.
 */
function ownFields (metadata: JsonObject | undefined, keepKind = false): JsonObject {
  const { id: _id, idShort: _idShort, modelType: _type, submodelElements: _elements, kind, ...rest } = metadata ?? {}
  return keepKind && kind !== undefined ? { ...rest, kind } : rest
}

/** The submodel a source describes, verified, with a fresh ID where it has none; `null` for an existing one. */
export async function buildSubmodel (target: AasTarget, source: SubmodelSource, scheme: IdScheme): Promise<JsonObject | null> {
  switch (source.source) {
    case 'existing': {
      return null
    }
    case 'empty': {
      return verifySubmodel({
        kind: 'Instance',
        ...ownFields(source.metadata, true),
        modelType: 'Submodel',
        id: source.id ?? generateId('sm', scheme),
        idShort: source.idShort,
      })
    }
    case 'json': {
      const submodel = source.submodel
      if (submodel.modelType !== 'Submodel') {
        throw new StudioProblem('validation_failed', 'The JSON is not a submodel.', { violations: [{ path: 'modelType', message: 'Expected a Submodel.' }] })
      }
      return verifySubmodel({ ...submodel, id: source.id ?? (typeof submodel.id === 'string' && submodel.id ? submodel.id : generateId('sm', scheme)) })
    }
    case 'template': {
      const template = await templateSubmodel(target, source.templateId)
      return verifySubmodel({
        ...instantiateSubmodel(template, {
          id: source.id ?? generateId('sm', scheme),
          idShort: source.idShort,
          include: new Set(source.include),
          values: source.values,
        }),
        ...ownFields(source.metadata),
      })
    }
  }
}

function newShell (input: JsonObject, scheme: IdScheme): JsonObject {
  const asset = (input.assetInformation ?? {}) as JsonObject
  return {
    ...input,
    modelType: 'AssetAdministrationShell',
    id: typeof input.id === 'string' && input.id ? input.id : generateId('aas', scheme),
    // AAS requires a global or a specific asset ID.
    assetInformation: {
      assetKind: 'Instance',
      ...(asset.globalAssetId === undefined && asset.specificAssetIds === undefined ? { globalAssetId: generateId('asset', scheme) } : {}),
      ...asset,
    },
  }
}

/** Creates a shell with new submodels and references to existing ones (the wizard). */
export async function createShell (context: CreationContext, input: ShellCreateInput): Promise<{ shell: JsonObject, steps: SyncStep[] }> {
  const { target, scheme, plan } = context
  const built = await Promise.all(input.submodels.map(async source => ({ source, submodel: await buildSubmodel(target, source, scheme) })))
  const references = built.map(({ source, submodel }) => submodelReference(submodel ? String(submodel.id) : (source as { id: string }).id))
  const shell = verifyShell({
    ...newShell(input.shell, scheme),
    ...(references.length > 0 ? { submodels: references } : {}),
  })

  // Everything is checked before the first write.
  await assertFree(target, 'shell', String(shell.id))
  for (const { submodel } of built) {
    if (submodel) {
      await assertFree(target, 'submodel', String(submodel.id))
    }
  }
  for (const { source } of built) {
    if (source.source === 'existing') {
      await target.submodelMetadata(source.id)
    }
  }

  const runner = new StepRunner()
  for (const { submodel } of built) {
    if (submodel) {
      await runner.run('submodel', String(submodel.id), () => target.createSubmodel(submodel))
    }
  }
  await runner.run('shell', String(shell.id), () => target.createShell(shell))
  runner.steps.push(...await target.registerShells([String(shell.id)], plan))
  return { shell, steps: runner.steps }
}

/** Adds a new or existing submodel to a shell. */
export async function addSubmodel (context: CreationContext, shellId: string, source: SubmodelSource): Promise<{ submodelId: string, steps: SyncStep[] }> {
  const { target, scheme, plan } = context
  const shell = await target.shell(shellId)
  const submodel = await buildSubmodel(target, source, scheme)
  const submodelId = submodel ? String(submodel.id) : (source as { id: string }).id
  if (submodelIdsOf(shell).includes(submodelId)) {
    throw new StudioProblem('identifier_conflict', 'The shell references this submodel already.')
  }
  await (submodel ? assertFree(target, 'submodel', submodelId) : target.submodelMetadata(submodelId))
  const runner = new StepRunner()
  if (submodel) {
    await runner.run('submodel', submodelId, () => target.createSubmodel(submodel))
  }
  await runner.run('submodelReference', submodelId, () => target.addSubmodelRef(shellId, submodelId))
  runner.steps.push(...await target.registerShells([shellId], plan))
  return { submodelId, steps: runner.steps }
}

/** Removes a submodel reference, and the submodel itself on request (U6). */
export async function removeSubmodel (context: CreationContext, shellId: string, submodelId: string, deleteSubmodel: boolean): Promise<SyncStep[]> {
  const { target, plan } = context
  const runner = new StepRunner()
  await runner.run('submodelReference', submodelId, () => target.removeSubmodelRef(shellId, submodelId))
  if (deleteSubmodel) {
    await runner.run('submodel', submodelId, () => target.deleteSubmodel(submodelId))
    runner.steps.push(...await target.unregisterSubmodels([submodelId], plan))
  }
  runner.steps.push(...await target.registerShells([shellId], plan))
  return runner.steps
}

/**
 * Deletes a shell and, on request, the submodels it references (the Web UI's
 * delete dialog). Each submodel reports its own outcome; one that is gone
 * already counts as removed. Descriptors follow the sync plan.
 */
export async function deleteShellWithSubmodels (context: CreationContext, shellId: string, deleteSubmodels: boolean): Promise<SyncStep[]> {
  const { target, plan } = context
  const submodelIds = deleteSubmodels ? await target.submodelIds(shellId) : []
  await target.deleteShell(shellId)
  const steps: SyncStep[] = [{ resource: 'shell', id: shellId, outcome: 'removed' }]
  const removed: string[] = []
  for (const id of submodelIds) {
    try {
      await target.deleteSubmodel(id)
      removed.push(id)
      steps.push({ resource: 'submodel', id, outcome: 'removed' })
    } catch (error) {
      if (error instanceof StudioProblem && error.code === 'target_resource_not_found') {
        removed.push(id)
        steps.push({ resource: 'submodel', id, outcome: 'removed' })
      } else {
        steps.push({ resource: 'submodel', id, outcome: 'failed', detail: error instanceof StudioProblem ? (error.detail ?? error.title) : 'internal error' })
      }
    }
  }
  steps.push(...await target.unregisterShell(shellId, plan), ...await target.unregisterSubmodels(removed, plan))
  return steps
}

/** An instance from a type shell (T4): a new shell with `derivedFrom`, and copies of its submodels. */
export async function createInstance (context: CreationContext, typeShellId: string, input: { shell: JsonObject, submodelIds?: string[] }): Promise<{ shell: JsonObject, steps: SyncStep[] }> {
  const { target, scheme, plan } = context
  const type = await target.shell(typeShellId)
  const asset = (type.assetInformation ?? {}) as JsonObject
  if (asset.assetKind !== 'Type') {
    throw new StudioProblem('unsupported_operation', 'Instances are created from shells of asset kind Type.')
  }
  const wanted = input.submodelIds ?? submodelIdsOf(type)
  const known = new Set(submodelIdsOf(type))
  for (const id of wanted) {
    if (!known.has(id)) {
      throw new StudioProblem('invalid_request', `The shell does not reference ${id}.`)
    }
  }
  const copies: JsonObject[] = []
  for (const id of wanted) {
    const { submodel } = convertToInstance(await target.submodel(id))
    copies.push({ ...submodel, id: generateId('sm', scheme) })
  }
  const inputAsset = (input.shell.assetInformation ?? {}) as JsonObject
  const shell = verifyShell({
    ...shellMetadata(type),
    ...input.shell,
    modelType: 'AssetAdministrationShell',
    id: typeof input.shell.id === 'string' && input.shell.id ? input.shell.id : generateId('aas', scheme),
    derivedFrom: { type: 'ModelReference', keys: [{ type: 'AssetAdministrationShell', value: String(type.id) }] },
    assetInformation: { ...asset, ...inputAsset, assetKind: 'Instance', globalAssetId: inputAsset.globalAssetId ?? generateId('asset', scheme) },
    ...(copies.length > 0 ? { submodels: copies.map(copy => submodelReference(String(copy.id))) } : {}),
  })
  await assertFree(target, 'shell', String(shell.id))
  const runner = new StepRunner()
  for (const copy of copies) {
    await runner.run('submodel', String(copy.id), () => target.createSubmodel(verifySubmodel(copy)))
  }
  await runner.run('shell', String(shell.id), () => target.createShell(shell))
  runner.steps.push(...await target.registerShells([String(shell.id)], plan))
  return { shell, steps: runner.steps }
}

/** *Convert to instance* (T5): template qualifiers go, kind becomes `Instance`. */
export async function convertSubmodelToInstance (target: AasTarget, submodelId: string): Promise<{ submodel: JsonObject, removedQualifiers: number }> {
  const current = await target.submodel(submodelId)
  if (current.kind !== 'Template') {
    throw new StudioProblem('unsupported_operation', 'Only submodels of kind Template can be converted.')
  }
  const { submodel, removedQualifiers } = convertToInstance(current)
  await target.replaceSubmodel(submodelId, submodel, revisionOf(current))
  return { submodel, removedQualifiers }
}
