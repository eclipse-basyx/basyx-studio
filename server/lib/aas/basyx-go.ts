import type { AccessGrant, ChangeEvent, ConceptDescriptionSummary, EffectiveRights, LangString, OperationArgument, RightAction } from '#shared/contract'
import type { JsonObject } from './outline'
import type { ConceptInfo } from '@basyx/studio-sdk/protocol'
import { changeActions, changeEntities, rightActions } from '#shared/contract'
import { encodeKey } from './keys'

// Pure mappings for BaSyx Go endpoints that `basyx-typescript-sdk` does not
// cover (ADR 0022): the event feed, ReBAC access documents, concept
// description summaries and operation arguments. No I/O here.

function objects (value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter((item): item is JsonObject => typeof item === 'object' && item !== null && !Array.isArray(item)) : []
}

function langStrings (value: unknown): LangString[] {
  return objects(value)
    .filter(entry => typeof entry.language === 'string' && typeof entry.text === 'string')
    .map(entry => ({ language: entry.language as string, text: entry.text as string }))
}

/** The value of the `assetIds` query parameter of the discovery lookup. */
export function assetIdParameter (name: string, value: string): string {
  return encodeKey(JSON.stringify({ name, value }))
}

/**
 * An RSQL filter for events about the given identifiers. Identifiers contain
 * reserved RSQL characters, so each is quoted; quotes inside are escaped.
 */
export function subjectFilter (subjects: string[]): string {
  const quoted = subjects.map(subject => `"${subject.replaceAll('\\', '\\\\').replaceAll('"', String.raw`\"`)}"`)
  return `rsql:event.subject=in=(${quoted.join(',')})`
}

/** Maps a CloudEvent record of the feed (`io.admin-shell.<entity>.<action>.v1`) to a Studio change event. */
export function toChangeEvent (record: JsonObject): ChangeEvent | null {
  const match = /^io\.admin-shell\.([a-z]+)\.([a-z]+)\.v\d+$/.exec(String(record.type ?? ''))
  if (!match || typeof record.id !== 'string' || typeof record.subject !== 'string') {
    return null
  }
  const [, entity, action] = match
  if (!(changeEntities as readonly string[]).includes(entity!) || !(changeActions as readonly string[]).includes(action!)) {
    return null
  }
  return {
    id: record.id,
    time: typeof record.time === 'string' ? record.time : new Date(0).toISOString(),
    action: action as ChangeEvent['action'],
    entity: entity as ChangeEvent['entity'],
    subject: record.subject,
    subjectKey: encodeKey(record.subject),
  }
}

/** The content of a concept description's (first) data specification, e.g. IEC 61360's. */
function dataSpecificationContent (cd: JsonObject): JsonObject {
  return objects(cd.embeddedDataSpecifications)
    .map(spec => spec.dataSpecificationContent)
    .find((value): value is JsonObject => typeof value === 'object' && value !== null) ?? {}
}

/** A concept description's IEC 61360 summary for the list view. */
export function toConceptDescriptionSummary (cd: JsonObject): ConceptDescriptionSummary {
  const content = dataSpecificationContent(cd)
  return {
    id: String(cd.id),
    idShort: typeof cd.idShort === 'string' ? cd.idShort : null,
    preferredName: langStrings(content.preferredName),
    definition: langStrings(content.definition),
    dataType: typeof content.dataType === 'string' ? content.dataType : null,
    unit: typeof content.unit === 'string' ? content.unit : null,
  }
}

/** What an app learns of a concept description (`studio.aas.describeConcepts`, app API 0.1.15), under the ID it asked for. */
export function toConceptInfo (id: string, cd: JsonObject): ConceptInfo {
  const { preferredName, definition, unit, dataType } = toConceptDescriptionSummary(cd)
  return { id, preferredName, shortName: langStrings(dataSpecificationContent(cd).shortName), definition, unit, dataType }
}

const numericTypes = new Set(['xs:double', 'xs:float', 'xs:decimal', 'xs:int', 'xs:integer', 'xs:long', 'xs:short', 'xs:byte',
  'xs:unsignedInt', 'xs:unsignedLong', 'xs:unsignedShort', 'xs:unsignedByte', 'xs:positiveInteger', 'xs:negativeInteger',
  'xs:nonNegativeInteger', 'xs:nonPositiveInteger'])

/** A typed value-only JSON value for a Property: numbers and booleans as JSON, everything else as string. */
export function typedValue (valueType: string | null, value: string | null): unknown {
  if (value === null) {
    return null
  }
  if (valueType && numericTypes.has(valueType) && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value)
  }
  if (valueType === 'xs:boolean' && (value === 'true' || value === 'false')) {
    return value === 'true'
  }
  return value
}

/** The variables (input, output or in-out) of an operation, as `{ idShort, valueType }`. */
export function operationVariables (operation: JsonObject, group: 'inputVariables' | 'outputVariables' | 'inoutputVariables'): Array<{ idShort: string, valueType: string | null }> {
  return objects(operation[group])
    .map(variable => variable.value)
    .filter((value): value is JsonObject => typeof value === 'object' && value !== null && typeof (value as JsonObject).idShort === 'string')
    .map(value => ({ idShort: value.idShort as string, valueType: typeof value.valueType === 'string' ? value.valueType : null }))
}

/**
 * The value-only invocation body: `inputArguments` and `inoutputArguments`
 * keyed by idShort, typed by the operation's variable definitions.
 */
export function invocationBody (operation: JsonObject, args: Array<{ idShort: string, value: string | null }>, timeout?: string): JsonObject {
  const byName = new Map(args.map(arg => [arg.idShort, arg.value]))
  const typed = (variables: Array<{ idShort: string, valueType: string | null }>) =>
    Object.fromEntries(variables.filter(variable => byName.has(variable.idShort)).map(variable => [variable.idShort, typedValue(variable.valueType, byName.get(variable.idShort) ?? null)]))
  const body: JsonObject = { inputArguments: typed(operationVariables(operation, 'inputVariables')) }
  const inoutput = typed(operationVariables(operation, 'inoutputVariables'))
  if (Object.keys(inoutput).length > 0) {
    body.inoutputArguments = inoutput
  }
  if (timeout) {
    body.clientTimeoutDuration = timeout
  }
  return body
}

/** Output and in-out arguments of a value-only result, in the order the operation declares them. */
export function invocationOutputs (operation: JsonObject, result: JsonObject): OperationArgument[] {
  const values = {
    ...(result.inoutputArguments as JsonObject | undefined),
    ...(result.outputArguments as JsonObject | undefined),
  }
  return [...operationVariables(operation, 'outputVariables'), ...operationVariables(operation, 'inoutputVariables')]
    .filter(variable => variable.idShort in values)
    .map(variable => ({ idShort: variable.idShort, valueType: variable.valueType, value: values[variable.idShort] }))
}

export function toAccessGrants (document: JsonObject): AccessGrant[] {
  return objects(document.grants)
    .filter(grant => ['relation', 'subjectType', 'issuer', 'subject'].every(field => typeof grant[field] === 'string'))
    .filter(grant => grant.subjectType === 'user' || grant.subjectType === 'group')
    .map(grant => ({
      relation: grant.relation as string,
      subjectType: grant.subjectType as AccessGrant['subjectType'],
      issuer: grant.issuer as string,
      subject: grant.subject as string,
    }))
}

/** Rights from `$access/effective`; an action with source `none` is not granted. */
export function toEffectiveRights (document: JsonObject): EffectiveRights {
  const granted = new Set(objects(document.rights)
    .filter(right => right.source !== 'none' && typeof right.action === 'string')
    .map(right => right.action as RightAction))
  return Object.fromEntries(rightActions.map(action => [action, granted.has(action)])) as EffectiveRights
}

export const allRights: EffectiveRights = Object.fromEntries(rightActions.map(action => [action, true])) as EffectiveRights
