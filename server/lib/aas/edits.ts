import type { ElementModelType } from '#shared/aas/defaults'
import type { JsonObject } from './outline'
import type { types } from '@aas-core-works/aas-core3.1-typescript'
import { jsonization, verification } from '@aas-core-works/aas-core3.1-typescript'
import { childProperties, childTypesFor, hasNamedChildren } from '#shared/aas/defaults'
import { StudioProblem } from '../problem'

// Structural edits of submodel elements on plain AAS JSON (MVP-5 plan, W1,
// W2, W3, W6). Both target kinds use these functions, so a change means the
// same on a live infrastructure and in a workspace; they differ only in
// where the result is written.

/** The container's children property, or `null` if the element cannot hold children. */
export function childProperty (modelType: unknown): string | null {
  return typeof modelType === 'string' && modelType !== 'Submodel' ? (childProperties[modelType] ?? null) : null
}

function isObject (value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The direct children of a container element, in order. */
export function containerChildren (container: JsonObject): JsonObject[] {
  const property = childProperty(container.modelType)
  const value = property ? container[property] : undefined
  return Array.isArray(value) ? value.filter(isObject) : []
}

/** The container with other children. */
export function withChildren (container: JsonObject, children: JsonObject[]): JsonObject {
  const property = childProperty(container.modelType)
  if (!property) {
    throw new StudioProblem('unsupported_operation', `${String(container.modelType)} elements have no children.`)
  }
  const { [property]: _, ...rest } = container
  return children.length === 0 ? rest : { ...rest, [property]: children }
}

/**
 * Parses and verifies one element with AAS Core, returning it normalized. The
 * findings carry the AAS Core paths, which the form maps to its fields.
 */
export function verifyElement (element: JsonObject): { json: JsonObject, instance: types.ISubmodelElement } {
  const parsed = jsonization.submodelElementFromJsonable(element as jsonization.JsonValue)
  if (parsed.error) {
    throw new StudioProblem('validation_failed', parsed.error.message, {
      violations: [{ path: parsed.error.path.toString(), message: parsed.error.message }],
    })
  }
  const instance = parsed.mustValue()
  const violations = [...verification.verify(instance)]
    .map(error => ({ path: error.path.toString(), message: error.message }))
  if (violations.length > 0) {
    throw new StudioProblem('validation_failed', violations[0]!.message, { violations })
  }
  return { json: jsonization.toJsonable(instance) as JsonObject, instance }
}

/**
 * Checks a submodel's metadata. The elements are left out: verifying them
 * would block edits for findings that exist already.
 */
export function verifySubmodelMetadata (submodel: JsonObject): JsonObject {
  const { submodelElements: _, ...metadata } = submodel
  const parsed = jsonization.submodelFromJsonable(metadata as jsonization.JsonValue)
  if (parsed.error) {
    throw new StudioProblem('validation_failed', parsed.error.message, {
      violations: [{ path: parsed.error.path.toString(), message: parsed.error.message }],
    })
  }
  const instance = parsed.mustValue()
  const violations = [...verification.verify(instance)]
    .map(error => ({ path: error.path.toString(), message: error.message }))
  if (violations.length > 0) {
    throw new StudioProblem('validation_failed', violations[0]!.message, { violations })
  }
  return jsonization.toJsonable(instance) as JsonObject
}

/** A parent's rule for what it holds, checked before AAS Core sees the result. */
function checkAgainstParent (parent: JsonObject | null, element: JsonObject): void {
  if (parent === null) {
    return
  }
  if (parent.modelType !== 'SubmodelElementList' && !childTypesFor(parent).includes(element.modelType as ElementModelType)) {
    throw new StudioProblem('validation_failed', `A ${String(parent.modelType)} cannot hold a ${String(element.modelType)}.`, {
      violations: [{ path: 'modelType', message: `A ${String(parent.modelType)} cannot hold a ${String(element.modelType)}.` }],
    })
  }
  if (parent.modelType !== 'SubmodelElementList') {
    return
  }
  const expected = parent.typeValueListElement
  if (typeof expected === 'string' && element.modelType !== expected) {
    throw new StudioProblem('validation_failed', `A list of ${expected} elements cannot hold a ${String(element.modelType)}.`, {
      violations: [{ path: 'modelType', message: `The list holds ${expected} elements only.` }],
    })
  }
  const expectedValueType = parent.valueTypeListElement
  if (typeof expectedValueType === 'string' && typeof element.valueType === 'string' && element.valueType !== expectedValueType) {
    throw new StudioProblem('validation_failed', `The list holds values of type ${expectedValueType}.`, {
      violations: [{ path: 'valueType', message: `The list holds ${expectedValueType} values only.` }],
    })
  }
}

/**
 * Parses the parent holding the verified element with AAS Core, so a child
 * the parent's type does not accept never reaches the environment and makes
 * it unsavable. Only errors in the child count: findings the parent has
 * already do not block.
 */
function assertParentAccepts (parent: JsonObject | null, element: JsonObject): void {
  if (parent === null) {
    return
  }
  const parsed = jsonization.submodelElementFromJsonable(withChildren(parent, [element]) as jsonization.JsonValue)
  if (parsed.error?.path.toString().startsWith(`${childProperty(parent.modelType)}[0]`)) {
    const message = `A ${String(parent.modelType)} cannot hold this element: ${parsed.error.message}`
    throw new StudioProblem('validation_failed', message, { violations: [{ path: 'modelType', message }] })
  }
}

function assertUnique (children: JsonObject[], idShort: unknown, except: number): void {
  if (typeof idShort !== 'string') {
    return
  }
  if (children.some((child, position) => position !== except && child.idShort === idShort)) {
    throw new StudioProblem('idshort_conflict', `An element named ${idShort} exists already.`)
  }
}

/** Elements of named containers need an idShort; list children have none to rely on. */
function assertNamed (parentType: string, element: JsonObject): void {
  if (hasNamedChildren(parentType) && (typeof element.idShort !== 'string' || element.idShort === '')) {
    throw new StudioProblem('validation_failed', 'The element needs an idShort.', {
      violations: [{ path: 'idShort', message: 'The element needs an idShort.' }],
    })
  }
}

export interface Placement {
  children: JsonObject[]
  /** The position the element has in `children`. */
  index: number
}

/**
 * Inserts a verified element at `index` (appended without it). `parentType`
 * is `Submodel` for the top level.
 */
export function insertChild (children: JsonObject[], parent: JsonObject | null, parentType: string, element: JsonObject, index: number | null): Placement {
  assertNamed(parentType, element)
  checkAgainstParent(parent, element)
  assertUnique(children, element.idShort, -1)
  const verified = verifyElement(element).json
  assertParentAccepts(parent, verified)
  const position = index === null ? children.length : Math.min(index, children.length)
  return { children: [...children.slice(0, position), verified, ...children.slice(position)], index: position }
}

/** Replaces the element at `position`, which may change its idShort (W3). */
export function replaceChild (children: JsonObject[], position: number, parent: JsonObject | null, parentType: string, element: JsonObject): Placement {
  if (element.modelType !== children[position]!.modelType) {
    throw new StudioProblem('validation_failed', 'The type of an element cannot be changed.', {
      violations: [{ path: 'modelType', message: 'The type of an element cannot be changed.' }],
    })
  }
  // Containers keep the children they have now: a form edits the element, not its subtree (W1).
  const current = children[position]!
  const merged = childProperty(current.modelType) && element.modelType === current.modelType
    ? withChildren(element, containerChildren(current))
    : element
  assertNamed(parentType, merged)
  checkAgainstParent(parent, merged)
  assertUnique(children, merged.idShort, position)
  const verified = verifyElement(merged).json
  assertParentAccepts(parent, verified)
  const next = [...children]
  next[position] = verified
  return { children: next, index: position }
}

export function removeChild (children: JsonObject[], position: number): JsonObject[] {
  return children.filter((_, current) => current !== position)
}

export function moveChild (children: JsonObject[], position: number, index: number): Placement {
  const target = Math.min(index, children.length - 1)
  const next = [...children]
  const [moved] = next.splice(position, 1)
  next.splice(target, 0, moved!)
  return { children: next, index: target }
}

function violationsOf (verified: Iterable<{ path: { toString: () => string }, message: string }>): Array<{ path: string, message: string }> {
  return [...verified].map(error => ({ path: error.path.toString(), message: error.message }))
}

/** Parses and verifies a whole submodel (new submodels, JSON insert); returns it normalized. */
export function verifySubmodel (submodel: JsonObject): JsonObject {
  const parsed = jsonization.submodelFromJsonable(submodel as jsonization.JsonValue)
  if (parsed.error) {
    throw new StudioProblem('validation_failed', parsed.error.message, {
      violations: [{ path: parsed.error.path.toString(), message: parsed.error.message }],
    })
  }
  const instance = parsed.mustValue()
  const violations = violationsOf(verification.verify(instance))
  if (violations.length > 0) {
    throw new StudioProblem('validation_failed', violations[0]!.message, { violations })
  }
  return jsonization.toJsonable(instance) as JsonObject
}

/** Parses and verifies a shell; returns it normalized. */
export function verifyShell (shell: JsonObject): JsonObject {
  const parsed = jsonization.assetAdministrationShellFromJsonable(shell as jsonization.JsonValue)
  if (parsed.error) {
    throw new StudioProblem('validation_failed', parsed.error.message, {
      violations: [{ path: parsed.error.path.toString(), message: parsed.error.message }],
    })
  }
  const instance = parsed.mustValue()
  const violations = violationsOf(verification.verify(instance))
  if (violations.length > 0) {
    throw new StudioProblem('validation_failed', violations[0]!.message, { violations })
  }
  return jsonization.toJsonable(instance) as JsonObject
}

/** Parses and verifies a concept description, including its IEC 61360 content; returns it normalized. */
export function verifyConceptDescription (conceptDescription: JsonObject): JsonObject {
  const parsed = jsonization.conceptDescriptionFromJsonable(conceptDescription as jsonization.JsonValue)
  if (parsed.error) {
    throw new StudioProblem('validation_failed', parsed.error.message, {
      violations: [{ path: parsed.error.path.toString(), message: parsed.error.message }],
    })
  }
  const instance = parsed.mustValue()
  const violations = violationsOf(verification.verify(instance))
  if (violations.length > 0) {
    throw new StudioProblem('validation_failed', violations[0]!.message, { violations })
  }
  return jsonization.toJsonable(instance) as JsonObject
}

/** Findings of AAS Core for a value without writing it (the insert dialog, MVP-5 plan, C3). */
export function findings (kind: 'element' | 'submodel' | 'shell' | 'conceptDescription', value: unknown): Array<{ path: string, message: string }> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return [{ path: '', message: 'Expected a JSON object.' }]
    }
    const json = value as JsonObject
    switch (kind) {
      case 'element': {
        verifyElement(json)

        break
      }
      case 'submodel': {
        verifySubmodel(json)

        break
      }
      case 'conceptDescription': {
        verifyConceptDescription(json)

        break
      }
      default: {
        verifyShell(json)
      }
    }
    return []
  } catch (error) {
    if (error instanceof StudioProblem) {
      return error.violations ?? [{ path: '', message: error.detail ?? error.title }]
    }
    throw error
  }
}

/** The part of a shell its metadata revision covers: everything but the submodel references. */
export function shellMetadata (shell: JsonObject): JsonObject {
  const { submodels: _, ...metadata } = shell
  return metadata
}

/** A model reference to a submodel. */
export function submodelReference (submodelId: string): JsonObject {
  return { type: 'ModelReference', keys: [{ type: 'Submodel', value: submodelId }] }
}

/** The first key value of a semantic ID: the identifier of its concept description (MVP-6 plan, E1). */
export function semanticKey (node: JsonObject): string | null {
  const keys = (node.semanticId as { keys?: Array<{ value?: unknown }> } | undefined)?.keys
  const value = Array.isArray(keys) ? keys[0]?.value : undefined
  return typeof value === 'string' && value !== '' ? value : null
}

/** Elements of a submodel, at any depth, whose semantic ID names `id` (operation variables included). */
export function countSemanticUses (submodel: JsonObject, id: string): number {
  let count = 0
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item)
      }
      return
    }
    if (typeof value !== 'object' || value === null) {
      return
    }
    const node = value as JsonObject
    if (typeof node.modelType === 'string' && semanticKey(node) === id) {
      count++
    }
    for (const field of ['submodelElements', 'value', 'statements', 'annotations', 'inputVariables', 'outputVariables', 'inoutputVariables']) {
      if (field in node) {
        visit(node[field])
      }
    }
  }
  visit(submodel.submodelElements)
  return count
}
