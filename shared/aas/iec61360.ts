// IEC 61360 data specifications (MVP-6 plan, F2, E3): the template IRI, new
// entries and concept descriptions, and the data type an element suggests.
// Shared by the forms and the BFF's tests.

import type { JsonRecord } from './defaults'

/** The data specification template every IEC 61360 entry refers to (AASc-3a-050). */
export const iec61360Iri = 'https://admin-shell.io/DataSpecificationTemplates/DataSpecificationIEC61360/3/0'

/** `DataTypeIec61360` of AAS 3.1, in the JSON spelling. */
export const iec61360DataTypes = [
  'DATE', 'STRING', 'STRING_TRANSLATABLE', 'INTEGER_MEASURE', 'INTEGER_COUNT', 'INTEGER_CURRENCY',
  'REAL_MEASURE', 'REAL_COUNT', 'REAL_CURRENCY', 'BOOLEAN', 'IRI', 'IRDI', 'RATIONAL', 'RATIONAL_MEASURE',
  'TIME', 'TIMESTAMP', 'FILE', 'HTML', 'BLOB',
] as const
export type Iec61360DataType = (typeof iec61360DataTypes)[number]

/** Data types that need a unit or unit ID (AASc-3a-009). */
export const measuredDataTypes: readonly string[] = ['INTEGER_MEASURE', 'REAL_MEASURE', 'RATIONAL_MEASURE', 'INTEGER_CURRENCY', 'REAL_CURRENCY']

export function iec61360Reference (): JsonRecord {
  return { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: iec61360Iri }] }
}

/** Whether an embedded data specification holds IEC 61360 content, the only kind Studio edits. */
export function isIec61360 (specification: unknown): boolean {
  const content = (specification as { dataSpecificationContent?: { modelType?: unknown } } | null)?.dataSpecificationContent
  return content?.modelType === 'DataSpecificationIec61360'
}

/** The unit of a node's own IEC 61360 data specification, or `null` (MVP-6 plan, E6). */
export function ownUnit (node: JsonRecord): string | null {
  const own = (Array.isArray(node.embeddedDataSpecifications) ? node.embeddedDataSpecifications : [])
    .find(entry => isIec61360(entry)) as { dataSpecificationContent: JsonRecord } | undefined
  const unit = own?.dataSpecificationContent.unit
  return typeof unit === 'string' && unit !== '' ? unit : null
}

/** A new IEC 61360 entry with a preferred name, which AAS Core requires. */
export function newIec61360 (preferredName: string, language = 'en'): JsonRecord {
  return {
    dataSpecification: iec61360Reference(),
    dataSpecificationContent: {
      modelType: 'DataSpecificationIec61360',
      preferredName: [{ language, text: preferredName }],
    },
  }
}

/** A new concept description with one IEC 61360 entry. */
export function newConceptDescription (id: string, idShort: string, language = 'en'): JsonRecord {
  return {
    modelType: 'ConceptDescription',
    id,
    ...(idShort ? { idShort } : {}),
    embeddedDataSpecifications: [newIec61360(idShort || id, language)],
  }
}

const dataTypeByValueType: Record<string, Iec61360DataType> = {
  'xs:string': 'STRING',
  'xs:boolean': 'BOOLEAN',
  'xs:date': 'DATE',
  'xs:time': 'TIME',
  'xs:dateTime': 'TIMESTAMP',
  'xs:anyURI': 'IRI',
  'xs:double': 'REAL_MEASURE',
  'xs:float': 'REAL_MEASURE',
  'xs:decimal': 'REAL_MEASURE',
  'xs:base64Binary': 'BLOB',
  'xs:hexBinary': 'BLOB',
}

/** The IEC 61360 data type an element's `valueType` suggests, or `null` if none fits. */
export function dataTypeFor (element: JsonRecord): Iec61360DataType | null {
  if (element.modelType === 'MultiLanguageProperty') {
    return 'STRING_TRANSLATABLE'
  }
  if (element.modelType === 'File') {
    return 'FILE'
  }
  if (element.modelType === 'Blob') {
    return 'BLOB'
  }
  const valueType = typeof element.valueType === 'string' ? element.valueType : null
  if (!valueType) {
    return null
  }
  if (/^xs:(?:int|long|short|byte|unsigned|nonNegative|positive|negative|nonPositive)/.test(valueType)) {
    return 'INTEGER_COUNT'
  }
  return dataTypeByValueType[valueType] ?? null
}

function langStrings (value: unknown): Array<{ language: string, text: string }> {
  return Array.isArray(value)
    ? value.filter((entry): entry is { language: string, text: string } => typeof entry?.language === 'string' && typeof entry?.text === 'string' && entry.text !== '')
    : []
}

/**
 * A concept description for an element's semantic ID, prefilled from the
 * element (E3): its idShort, names, description, the data type its value
 * type suggests, and the unit of its own IEC 61360 entry.
 */
export function conceptDescriptionFromElement (element: JsonRecord, id: string, language = 'en'): JsonRecord {
  const idShort = typeof element.idShort === 'string' ? element.idShort : ''
  const names = langStrings(element.displayName)
  const own = (Array.isArray(element.embeddedDataSpecifications) ? element.embeddedDataSpecifications : [])
    .find(entry => isIec61360(entry)) as { dataSpecificationContent: JsonRecord } | undefined
  const content: JsonRecord = {
    modelType: 'DataSpecificationIec61360',
    preferredName: names.length > 0 ? names : [{ language, text: idShort || id }],
  }
  const definition = langStrings(element.description)
  if (definition.length > 0) {
    content.definition = definition
  }
  const dataType = dataTypeFor(element)
  if (dataType) {
    content.dataType = dataType
  }
  for (const field of ['unit', 'unitId', 'symbol']) {
    if (own?.dataSpecificationContent[field] !== undefined) {
      content[field] = own.dataSpecificationContent[field]
    }
  }
  // A measured type needs a unit (AASc-3a-009); without one the value is a plain count.
  if (content.dataType === 'REAL_MEASURE' && content.unit === undefined && content.unitId === undefined) {
    content.dataType = 'REAL_COUNT'
  }
  return {
    modelType: 'ConceptDescription',
    id,
    ...(idShort ? { idShort } : {}),
    embeddedDataSpecifications: [{ dataSpecification: iec61360Reference(), dataSpecificationContent: content }],
  }
}
