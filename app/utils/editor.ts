import type { InjectionKey } from 'vue'

/** Choices of the element forms (MVP-5 plan, U2). */

export const valueTypes: readonly string[] = [
  'xs:string', 'xs:boolean', 'xs:int', 'xs:integer', 'xs:long', 'xs:short', 'xs:byte',
  'xs:unsignedInt', 'xs:unsignedLong', 'xs:unsignedShort', 'xs:unsignedByte',
  'xs:nonNegativeInteger', 'xs:positiveInteger', 'xs:negativeInteger', 'xs:nonPositiveInteger',
  'xs:double', 'xs:float', 'xs:decimal',
  'xs:date', 'xs:dateTime', 'xs:time', 'xs:duration', 'xs:gYear', 'xs:gYearMonth', 'xs:gMonth', 'xs:gMonthDay', 'xs:gDay',
  'xs:anyURI', 'xs:base64Binary', 'xs:hexBinary',
]

export const referenceTypes: readonly string[] = ['ExternalReference', 'ModelReference']

export const keyTypes: readonly string[] = [
  'GlobalReference', 'FragmentReference', 'AssetAdministrationShell', 'ConceptDescription', 'Submodel',
  'SubmodelElement', 'SubmodelElementCollection', 'SubmodelElementList', 'DataElement', 'Property',
  'MultiLanguageProperty', 'Range', 'File', 'Blob', 'ReferenceElement', 'RelationshipElement',
  'AnnotatedRelationshipElement', 'Entity', 'Operation', 'Capability', 'BasicEventElement', 'EventElement',
]

export const entityTypes: readonly string[] = ['CoManagedEntity', 'SelfManagedEntity']
export const eventDirections: readonly string[] = ['input', 'output']
export const eventStates: readonly string[] = ['on', 'off']
export const qualifierKinds: readonly string[] = ['ConceptQualifier', 'TemplateQualifier', 'ValueQualifier']
export const submodelKinds: readonly string[] = ['Instance', 'Template']

/** Element types whose list children carry the list's type (a list holds one kind). */
export const listElementTypes: readonly string[] = [
  'Property', 'MultiLanguageProperty', 'Range', 'File', 'Blob', 'ReferenceElement', 'RelationshipElement',
  'AnnotatedRelationshipElement', 'Entity', 'SubmodelElementCollection', 'SubmodelElementList', 'Operation',
  'Capability', 'BasicEventElement',
]

export type Json = Record<string, unknown>

/** A new element that is being created: where it goes and its starting point (MVP-5 plan, U4). */
export interface CreatingElement {
  submodelKey: string
  /** Element key of the parent, `null` for a submodel's top level. */
  parentKey: string | null
  parentLabel: string
  structureRevision: string
  index: number | null
  element: Json
  isListChild: boolean
}

/** A copy of an element with a field set, or removed when the value is empty. */
export function withField (element: Json, field: string, value: unknown): Json {
  const empty = value === undefined || value === null || value === ''
    || (Array.isArray(value) && value.length === 0)
  const { [field]: _, ...rest } = element
  return empty ? rest : { ...rest, [field]: value }
}

/** A reference is empty while it has no key with a value. */
export function referenceIsEmpty (reference: unknown): boolean {
  const keys = (reference as { keys?: Array<{ value?: string }> } | null)?.keys
  return !Array.isArray(keys) || keys.every(key => !key.value)
}

/**
 * Provided by a drawer with a fixed footer: the selector `FormActions`
 * teleports Apply and Discard to, so they stay in view while the form scrolls.
 */
export const formActionsFooterKey: InjectionKey<string> = Symbol('formActionsFooter')
