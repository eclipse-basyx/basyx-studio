import type { SegmentKind } from '#shared/contract'
import type { JsonObject } from '../aas/outline'
import { segmentKinds, segmentSemanticIds, timeSeriesSemanticId } from '#shared/contract'
import { StudioProblem } from '../problem'

// The parts of an IDTA 02008 Time Series Data submodel (1.1) that a read
// needs. As in the BaSyx AAS Web UI, segments are recognized by semantic ID
// and everything else by idShort, ignoring case: `Segments`,
// `Metadata.Record`, `Records`, `Endpoint` and `Query`. The data of an
// ExternalSegment is the `File` or `Blob` of the template, found by semantic
// ID or idShort; `Data`, the idShort of earlier BaSyx examples, also counts.

const externalDataSemanticIds = new Set([
  'https://admin-shell.io/idta/TimeSeries/File/1/1',
  'https://admin-shell.io/idta/TimeSeries/Blob/1/1',
])
const externalDataIdShorts = new Set(['file', 'blob', 'data'])

export function children (element: JsonObject | undefined): JsonObject[] {
  const value = element?.submodelElements ?? element?.value
  return Array.isArray(value) ? value.filter((child): child is JsonObject => typeof child === 'object' && child !== null) : []
}

export function childNamed (element: JsonObject | undefined, idShort: string): JsonObject | undefined {
  const wanted = idShort.toLowerCase()
  return children(element).find(child => typeof child.idShort === 'string' && child.idShort.toLowerCase() === wanted)
}

export function semanticIdsOf (element: JsonObject | undefined): string[] {
  const keys = (element?.semanticId as { keys?: unknown } | undefined)?.keys
  return Array.isArray(keys) ? keys.map(key => (key as { value?: unknown }).value).filter((value): value is string => typeof value === 'string') : []
}

/**
 * The File or Blob with the data of an ExternalSegment. The template has
 * both: a File with a path wins, then the Blob, whose value a submodel read
 * may leave out.
 */
export function externalDataOf (segment: JsonObject | undefined): JsonObject | undefined {
  const candidates = children(segment).filter(child => (child.modelType === 'File' || child.modelType === 'Blob')
    && (semanticIdsOf(child).some(id => externalDataSemanticIds.has(id))
      || (typeof child.idShort === 'string' && externalDataIdShorts.has(child.idShort.toLowerCase()))))
  return candidates.find(child => child.modelType === 'File' && typeof child.value === 'string' && child.value.trim() !== '')
    ?? candidates.find(child => child.modelType === 'Blob')
    ?? candidates[0]
}

export function segmentKindOf (segment: JsonObject): SegmentKind | null {
  const ids = semanticIdsOf(segment)
  return segmentKinds.find(kind => ids.includes(segmentSemanticIds[kind])) ?? null
}

export interface TimeSeriesSelection {
  segment: JsonObject
  kind: SegmentKind
  /** The segment's idShort as stored, for messages. */
  segmentIdShort: string
  /** The segment's idShort path as stored (`Segments.<segment>`), for elements below it. */
  segmentPath: string
  /** The `Metadata.Record` entries of the time and of each value, as stored. */
  time: JsonObject
  values: JsonObject[]
}

function invalid (message: string): StudioProblem {
  return new StudioProblem('timeseries_invalid', message)
}

/**
 * Finds the segment and the records a read names (K3): the submodel must
 * have the Time Series semantic ID, the segment one of the segment kinds,
 * and the time and values must be entries of `Metadata.Record`.
 */
export function selectTimeSeries (submodel: JsonObject, request: { segment: string, time: string, values: string[] }): TimeSeriesSelection {
  if (!semanticIdsOf(submodel).includes(timeSeriesSemanticId)) {
    throw invalid(`The submodel is not a Time Series Data submodel (${timeSeriesSemanticId}).`)
  }
  const segments = childNamed(submodel, 'Segments')
  const segment = childNamed(segments, request.segment)
  if (!segment) {
    throw invalid(`The submodel has no segment ${request.segment}.`)
  }
  const kind = segmentKindOf(segment)
  if (!kind) {
    throw invalid(`The segment ${request.segment} is not an internal, linked or external segment.`)
  }
  const record = childNamed(childNamed(submodel, 'Metadata'), 'Record')
  const entry = (idShort: string) => {
    const found = childNamed(record, idShort)
    if (!found) {
      throw invalid(`${idShort} is not a record of the submodel's metadata.`)
    }
    return found
  }
  return {
    segment,
    kind,
    segmentIdShort: segment.idShort as string,
    segmentPath: `${segments!.idShort as string}.${segment.idShort as string}`,
    time: entry(request.time),
    values: request.values.map(value => entry(value)),
  }
}

/** The unit an IEC 61360 data specification names, if any. */
export function unitOf (holder: JsonObject | null | undefined): string | null {
  const specifications = holder?.embeddedDataSpecifications
  if (!Array.isArray(specifications)) {
    return null
  }
  for (const specification of specifications) {
    const unit = (specification as { dataSpecificationContent?: { unit?: unknown } })?.dataSpecificationContent?.unit
    if (typeof unit === 'string' && unit.trim()) {
      return unit.trim()
    }
  }
  return null
}

/**
 * A time as epoch milliseconds: an RFC 3339 / ISO 8601 date-time, or a
 * number of seconds (below 10^11) or milliseconds since the epoch.
 */
export function parseTime (value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? (Math.abs(value) < 1e11 ? value * 1000 : value) : null
  }
  if (typeof value !== 'string' || !value.trim()) {
    return null
  }
  const text = value.trim()
  if (/^-?\d+(?:\.\d+)?$/.test(text)) {
    return parseTime(Number(text))
  }
  const time = Date.parse(text)
  return Number.isFinite(time) ? time : null
}
