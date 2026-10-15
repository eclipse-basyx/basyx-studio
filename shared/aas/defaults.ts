// New submodel elements and what a parent may contain (MVP-5 plan, U3, U4).
// Shared by the UI (type picker, draft nodes) and the BFF.

export type JsonRecord = Record<string, unknown>

export const elementModelTypes = [
  'Property',
  'MultiLanguageProperty',
  'Range',
  'File',
  'Blob',
  'ReferenceElement',
  'RelationshipElement',
  'AnnotatedRelationshipElement',
  'Entity',
  'SubmodelElementCollection',
  'SubmodelElementList',
  'Operation',
  'Capability',
  'BasicEventElement',
] as const
export type ElementModelType = (typeof elementModelTypes)[number]

/** The data elements an annotated relationship may carry as annotations. */
const dataElementTypes: readonly ElementModelType[] = [
  'Property', 'MultiLanguageProperty', 'Range', 'File', 'Blob', 'ReferenceElement',
]

export function isElementModelType (value: unknown): value is ElementModelType {
  return (elementModelTypes as readonly unknown[]).includes(value)
}

/** The property that holds a container's children, by its model type; `Submodel` for a submodel's top level. */
export const childProperties: Record<string, string> = {
  Submodel: 'submodelElements',
  SubmodelElementCollection: 'value',
  SubmodelElementList: 'value',
  Entity: 'statements',
  AnnotatedRelationshipElement: 'annotations',
}

/** Whether the children of a container are addressed by idShort (a list's are addressed by index). */
export function hasNamedChildren (parentModelType: string): boolean {
  return parentModelType !== 'SubmodelElementList' && parentModelType in childProperties
}

/** Model types a parent may contain; empty for elements that cannot have children. */
export function childTypesFor (parent: JsonRecord | null): readonly ElementModelType[] {
  if (parent === null) {
    return elementModelTypes
  }
  switch (parent.modelType) {
    case 'SubmodelElementCollection':
    case 'Entity': {
      return elementModelTypes
    }
    case 'SubmodelElementList': {
      // A list holds elements of one type only.
      return isElementModelType(parent.typeValueListElement) ? [parent.typeValueListElement] : elementModelTypes
    }
    case 'AnnotatedRelationshipElement': {
      return dataElementTypes
    }
    default: {
      return []
    }
  }
}

/** Whether the element type can hold children. */
export function isContainerType (modelType: unknown): boolean {
  return typeof modelType === 'string' && modelType in childProperties && modelType !== 'Submodel'
}

const placeholderReference = { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: '' }] }

/** An idShort derived from the type that no sibling uses: `Property`, `Property1`, … */
export function uniqueIdShort (base: string, taken: Iterable<string>): string {
  const names = new Set(taken)
  if (!names.has(base)) {
    return base
  }
  for (let counter = 1; ; counter++) {
    if (!names.has(`${base}${counter}`)) {
      return `${base}${counter}`
    }
  }
}

/**
 * A new element of a type with the fields AAS requires. The result is a
 * starting point for the form, not necessarily valid: required references
 * start empty and AAS Core reports them until they are filled.
 */
export function newElement (modelType: ElementModelType, idShort: string | null, parent: JsonRecord | null = null): JsonRecord {
  const element: JsonRecord = { modelType }
  if (idShort !== null) {
    element.idShort = idShort
  }
  switch (modelType) {
    case 'Property': {
      element.valueType = parent?.modelType === 'SubmodelElementList' && typeof parent.valueTypeListElement === 'string'
        ? parent.valueTypeListElement
        : 'xs:string'
      break
    }
    case 'Range': {
      element.valueType = parent?.modelType === 'SubmodelElementList' && typeof parent.valueTypeListElement === 'string'
        ? parent.valueTypeListElement
        : 'xs:double'
      break
    }
    case 'File':
    case 'Blob': {
      element.contentType = 'application/octet-stream'
      break
    }
    case 'RelationshipElement':
    case 'AnnotatedRelationshipElement': {
      element.first = structuredClone(placeholderReference)
      element.second = structuredClone(placeholderReference)
      break
    }
    case 'Entity': {
      element.entityType = 'CoManagedEntity'
      break
    }
    case 'SubmodelElementList': {
      element.typeValueListElement = 'Property'
      element.valueTypeListElement = 'xs:string'
      break
    }
    case 'BasicEventElement': {
      element.observed = structuredClone({ type: 'ModelReference', keys: [{ type: 'Submodel', value: '' }] })
      element.direction = 'output'
      element.state = 'on'
      break
    }
    default: {
      break
    }
  }
  return element
}
