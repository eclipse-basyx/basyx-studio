import type { Connection, timeSeriesReadParamsSchema, TimeSeriesResult } from '#shared/contract'
import type { JsonObject } from '../aas/outline'
import type { ConnectionClient } from '../connections/client'
import type { RawPoint } from '../connections/influxdb2'
import type { BinaryContent } from '../targets/aas-target'
import type { FluxRange } from './flux'
import type { TimeSeriesSelection } from './segments'
import { maxTimeSeriesRangeMs } from '#shared/contract'
import { influxQueryParameters, parseFluxCsv, runFluxQuery } from '../connections/influxdb2'
import { sha256 } from '../crypto/cipher'
import { StudioProblem } from '../problem'
import { parseCsv } from './csv'
import { checkFluxQuery, fluxWindowPeriodMs, interpolateFlux, isValueTemplate, usesWindowPeriod } from './flux'
import { childNamed, children, externalDataOf, parseTime, selectTimeSeries, semanticIdsOf, unitOf } from './segments'

// `studio.timeseries.read` (ADR 0040, time series plan K2 to K7): one shape
// for the three segment kinds, so parsing and limits are tested once.

export type TimeSeriesReadParams = ReturnType<typeof timeSeriesReadParamsSchema.parse>

/** What the reader needs from the target and its infrastructure. */
export interface TimeSeriesSources {
  /** The submodel, read by Studio as the user. */
  submodel: JsonObject
  /** A concept description of the target, or `null` if it cannot be read. */
  conceptDescription: (id: string) => Promise<JsonObject | null>
  /** The content of a File element of the submodel. */
  attachment: (idShortPath: string) => Promise<BinaryContent>
  /** An element of the submodel with its Blob value, which a submodel read leaves out. */
  element: (idShortPath: string) => Promise<JsonObject>
  /** A file at an absolute URL on one of the target's endpoints; refuses others. */
  download: (url: string) => Promise<BinaryContent>
  /** The connection of the target's infrastructure that serves time series for a content endpoint; refuses when there is none. */
  linked: (endpoint: URL) => Promise<ConnectionClient>
}

export interface TimeSeriesReadOutcome {
  result: TimeSeriesResult
  /** For the audit: the connection used and the digests of the queries sent (never their text). */
  connection: { key: string, type: Connection['type'], downstreamIdentity: string | null, delegation?: string } | null
  queryDigests: string[]
}

type Warning = TimeSeriesResult['warnings'][number]

interface Range {
  startMs: number
  stopMs: number
}

/** Data per selected value idShort, before range and limits. */
type RawSeries = Map<string, RawPoint[] | undefined>

function stringValue (element: JsonObject | undefined): string | undefined {
  return typeof element?.value === 'string' ? element.value : undefined
}

function internalSeries (selection: TimeSeriesSelection, timeIdShort: string, values: string[], warnings: Warning[]): RawSeries {
  const records = children(childNamed(selection.segment, 'Records'))
  const series: RawSeries = new Map()
  const hasTime = records.length === 0 || records.some(record => childNamed(record, timeIdShort))
  if (!hasTime) {
    warnings.push({ code: 'time_missing', params: { time: timeIdShort } })
  }
  for (const value of values) {
    if (!records.every(record => childNamed(record, value))) {
      warnings.push({ code: 'value_missing', params: { value } })
      series.set(value, undefined)
      continue
    }
    series.set(value, hasTime
      ? records.map(record => ({ time: stringValue(childNamed(record, timeIdShort)) ?? '', value: Number(stringValue(childNamed(record, value))) }))
      : [])
  }
  return series
}

function columnIndex (header: string[], idShort: string): number {
  const exact = header.indexOf(idShort)
  return exact === -1 ? header.findIndex(name => name.toLowerCase() === idShort.toLowerCase()) : exact
}

async function externalSeries (selection: TimeSeriesSelection, sources: TimeSeriesSources, timeIdShort: string, values: string[], warnings: Warning[]): Promise<RawSeries> {
  const data = externalDataOf(selection.segment)
  const dataPath = `${selection.segmentPath}.${data?.idShort as string}`
  let content: BinaryContent
  if (data?.modelType === 'Blob') {
    // AAS servers leave Blob values out of a submodel unless asked for them.
    const blob = stringValue(data) === undefined ? await sources.element(dataPath) : data
    content = { bytes: Buffer.from(stringValue(blob) ?? '', 'base64'), contentType: String(blob.contentType ?? 'text/csv'), fileName: null }
  } else if (data?.modelType === 'File' && stringValue(data)?.trim()) {
    const location = stringValue(data)!.trim()
    content = /^[a-z][\d+.a-z-]*:/i.test(location)
      ? await sources.download(location)
      : await sources.attachment(dataPath)
  } else {
    throw new StudioProblem('timeseries_invalid', `The segment ${selection.segmentIdShort} has no File with a path or URL and no Blob.`)
  }

  const text = new TextDecoder().decode(content.bytes).trim()
  if (content.contentType.includes('text/html') || /^<!doctype html|^<html/i.test(text)) {
    throw new StudioProblem('timeseries_invalid', `The data of the segment ${selection.segmentIdShort} is HTML, not CSV.`)
  }
  const [header = [], ...rows] = parseCsv(text)
  const columns = header.map(name => name.trim())
  const time = columnIndex(columns, timeIdShort)
  const series: RawSeries = new Map()
  if (time === -1 && rows.length > 0) {
    warnings.push({ code: 'time_missing', params: { time: timeIdShort } })
  }
  for (const value of values) {
    const column = columnIndex(columns, value)
    if (column === -1) {
      warnings.push({ code: 'value_missing', params: { value } })
      series.set(value, undefined)
      continue
    }
    series.set(value, time === -1 ? [] : rows.map(row => ({ time: (row[time] ?? '').trim(), value: Number.parseFloat(row[column] ?? '') })))
  }
  return series
}

/**
 * The series for a value among a query's tables: by key, then ignoring
 * case; a query made for this value alone may also name its only table
 * differently (e.g. by an MQTT topic).
 */
function seriesFor (tables: Map<string, RawPoint[]>, value: string, perValue: boolean): RawPoint[] | undefined {
  const exact = tables.get(value)
  if (exact) {
    return exact
  }
  const ignoringCase = [...tables].find(([key]) => key.toLowerCase() === value.toLowerCase())
  if (ignoringCase) {
    return ignoringCase[1]
  }
  return perValue && tables.size === 1 ? [...tables.values()][0] : undefined
}

/** How much further back each search for the latest point of a LinkedSegment looks than the one before. */
const latestSearchFactor = 8

/** The selected series among the answers to a read's queries, as the result picks them. */
function selectedSeries (tables: Map<string, RawPoint[]>[], values: string[], perValue: boolean): Array<RawPoint[] | undefined> {
  return values.map((value, index) => seriesFor(tables[perValue ? index : 0]!, value, perValue))
}

/** The latest time with a numeric value among the selected series, or `null`. */
function latestTime (series: Array<RawPoint[] | undefined>): number | null {
  let latest: number | null = null
  for (const points of series) {
    for (const point of points ?? []) {
      const time = parseTime(point.time)
      if (time !== null && Number.isFinite(point.value) && (latest === null || time > latest)) {
        latest = time
      }
    }
  }
  return latest
}

/**
 * The latest point of a LinkedSegment's selected series before `stopMs` (T1
 * of the external apps plan), found with the segment's own query for
 * earlier ranges: first the range as given, then ranges reaching further
 * back, up to the longest range a read may span. A query that aggregates by
 * `v.windowPeriod` reports a window, at its start or its stop (`timeSrc`),
 * so the search narrows down to the window it found until the window is no
 * longer than the read's own (`windowMs`); `precisionMs` is that window.
 */
async function latestBefore (stopMs: number, spanMs: number, windowed: boolean, run: (range: Range) => Promise<Array<RawPoint[] | undefined>>): Promise<{ latest: number, precisionMs: number } | null> {
  const windowMs = windowPeriodMs({ startMs: stopMs - spanMs, stopMs })
  let searched = 0
  let found: { latest: number, precisionMs: number } | null = null
  for (let lookback = spanMs; !found && searched < maxTimeSeriesRangeMs; lookback *= latestSearchFactor) {
    const range = { startMs: stopMs - Math.min(lookback, maxTimeSeriesRangeMs), stopMs: stopMs - searched }
    const latest = latestTime(await run(range))
    if (latest !== null) {
      found = { latest, precisionMs: windowed ? windowPeriodMs(range) : 0 }
    }
    searched = stopMs - range.startMs
  }
  while (found && found.precisionMs > windowMs) {
    // The window the point lies in, whether the query reports its start or its stop.
    const range = { startMs: found.latest - found.precisionMs, stopMs: Math.min(found.latest + found.precisionMs, stopMs) }
    const latest = latestTime(await run(range))
    if (latest === null) {
      break
    }
    found = { latest, precisionMs: windowed ? windowPeriodMs(range) : 0 }
  }
  return found
}

function isoRange (range: Range): FluxRange {
  return { start: new Date(range.startMs).toISOString(), stop: new Date(range.stopMs).toISOString() }
}

function windowPeriodMs (range: Range): number {
  return fluxWindowPeriodMs(isoRange(range))
}

async function linkedSeries (
  selection: TimeSeriesSelection,
  sources: TimeSeriesSources,
  values: string[],
  requested: TimeSeriesReadParams['range'],
  warnings: Warning[],
): Promise<{ series: RawSeries, range: Range, connection: TimeSeriesReadOutcome['connection'], queryDigests: string[] }> {
  const endpointText = stringValue(childNamed(selection.segment, 'Endpoint'))?.trim()
  const query = stringValue(childNamed(selection.segment, 'Query'))
  if (!endpointText || !query?.trim()) {
    throw new StudioProblem('timeseries_invalid', `The LinkedSegment ${selection.segmentIdShort} needs both an Endpoint and a Query.`)
  }
  const endpoint = URL.parse(endpointText)
  if (!endpoint || !/^https?:$/.test(endpoint.protocol)) {
    throw new StudioProblem('timeseries_invalid', `The Endpoint of the LinkedSegment ${selection.segmentIdShort} is not an http(s) URL.`)
  }
  // The queries as sent: record idShorts take the place of `{{y-value}}`,
  // so the check reads each query after interpolation. Every query sent,
  // also those that look for the latest point, is checked.
  const perValue = isValueTemplate(query)
  const queriesFor = (range: Range): string[] => {
    const texts = perValue ? values.map(value => interpolateFlux(query, value, isoRange(range))) : [interpolateFlux(query, null, isoRange(range))]
    for (const text of texts) {
      checkFluxQuery(text)
    }
    return texts
  }
  let range: Range = { startMs: Date.parse(requested.start), stopMs: Date.parse(requested.stop) }
  queriesFor(range)

  const client = await sources.linked(endpoint)
  const { connection } = client
  if (connection.type !== 'influxdb2') {
    throw new StudioProblem('connection_request_refused', `The connection ${(connection as Connection).key} cannot read time series.`)
  }
  const parameters = influxQueryParameters(connection, endpoint)
  const sent: string[] = []
  // A range is read once: for current data, the search often ends at the range as given.
  const answered = new Map<string, Promise<Map<string, RawPoint[]>[]>>()
  const run = (queryRange: Range) => {
    const key = `${queryRange.startMs}/${queryRange.stopMs}`
    if (!answered.has(key)) {
      const texts = queriesFor(queryRange)
      sent.push(...texts)
      answered.set(key, Promise.all(texts.map(async text => parseFluxCsv(await runFluxQuery(client, text, parameters)))))
    }
    return answered.get(key)!
  }

  let queryRange = range
  if (requested.anchor === 'latest') {
    const spanMs = range.stopMs - range.startMs
    const windowed = usesWindowPeriod(query)
    const found = await latestBefore(range.stopMs, spanMs, windowed, async searchRange => selectedSeries(await run(searchRange), values, perValue))
    if (found) {
      // A query of windows may report the window that holds the latest point
      // by its start, so the range ends at the window's end; a query of
      // points reads up to just after the latest one, as Flux's range leaves
      // out its stop.
      const stopMs = windowed ? Math.min(found.latest + found.precisionMs, range.stopMs) : found.latest
      range = { startMs: stopMs - spanMs, stopMs }
      queryRange = windowed ? range : { ...range, stopMs: stopMs + 1 }
    }
  }
  const tables = await run(queryRange)

  const series: RawSeries = new Map()
  const selected = selectedSeries(tables, values, perValue)
  for (const [index, value] of values.entries()) {
    const found = selected[index]
    if (!found) {
      warnings.push({ code: 'value_missing', params: { value } })
    }
    series.set(value, found)
  }
  return {
    series,
    range,
    connection: { key: connection.key, type: connection.type, downstreamIdentity: client.downstreamIdentity, ...(client.delegation ? { delegation: client.delegation } : {}) },
    queryDigests: sent.map(text => sha256(text)),
  }
}

/** Evenly thins out points, keeping the first and the last. */
export function reducePoints<T> (points: T[], limit: number): T[] {
  if (points.length <= limit) {
    return points
  }
  return Array.from({ length: limit }, (_, index) => points[Math.round(index * (points.length - 1) / (limit - 1))]!)
}

/** Valid points in time order, and how many were not valid. */
function cleanPoints (raw: RawPoint[]): { points: [number, number][], skipped: number } {
  const points: [number, number][] = []
  for (const point of raw) {
    const time = parseTime(point.time)
    if (time !== null && Number.isFinite(point.value)) {
      points.push([time, point.value])
    }
  }
  points.sort((a, b) => a[0] - b[0])
  return { points, skipped: raw.length - points.length }
}

async function unitFor (record: JsonObject, sources: TimeSeriesSources): Promise<string | null> {
  for (const id of semanticIdsOf(record)) {
    const unit = unitOf(await sources.conceptDescription(id))
    if (unit) {
      return unit
    }
  }
  return unitOf(record)
}

/**
 * Reads a segment of a Time Series Data submodel (K2 to K7). The records
 * and segment must be the submodel's; a LinkedSegment's query is checked
 * and sent only through a connection of the same infrastructure.
 */
export async function readTimeSeries (params: TimeSeriesReadParams, sources: TimeSeriesSources): Promise<TimeSeriesReadOutcome> {
  const selection = selectTimeSeries(sources.submodel, params)
  const timeIdShort = selection.time.idShort as string
  const values = selection.values.map(record => record.idShort as string)
  const warnings: Warning[] = []

  let raw: RawSeries
  let connection: TimeSeriesReadOutcome['connection'] = null
  let queryDigests: string[] = []
  // A LinkedSegment's query is sent for the range to show, so the reader moves it before reading (T1).
  let linkedRange: Range | null = null
  switch (selection.kind) {
    case 'internal': {
      raw = internalSeries(selection, timeIdShort, values, warnings)
      break
    }
    case 'external': {
      raw = await externalSeries(selection, sources, timeIdShort, values, warnings)
      break
    }
    case 'linked': {
      ;({ series: raw, range: linkedRange, connection, queryDigests } = await linkedSeries(selection, sources, values, params.range, warnings))
      break
    }
  }

  const cleaned = values.map(value => {
    const found = raw.get(value)
    const { points, skipped } = found ? cleanPoints(found) : { points: [], skipped: 0 }
    if (skipped > 0) {
      warnings.push({ code: 'points_skipped', params: { value, count: skipped } })
    }
    return points
  })

  const range: Range = linkedRange ?? { startMs: Date.parse(params.range.start), stopMs: Date.parse(params.range.stop) }
  if (params.range.anchor === 'latest' && !linkedRange) {
    const latest = Math.max(...cleaned.flatMap(points => points.length > 0 ? [points.at(-1)![0]] : []))
    if (Number.isFinite(latest)) {
      range.startMs = latest - (range.stopMs - range.startMs)
      range.stopMs = latest
    }
  }

  const series = await Promise.all(values.map(async (value, index) => {
    const inRange = cleaned[index]!.filter(([time]) => time >= range.startMs && time <= range.stopMs)
    if (inRange.length > params.maxPoints) {
      warnings.push({ code: 'points_reduced', params: { value, count: inRange.length, limit: params.maxPoints } })
    }
    return { key: value, unit: await unitFor(selection.values[index]!, sources), points: reducePoints(inRange, params.maxPoints) }
  }))

  return {
    result: {
      kind: selection.kind,
      range: { start: new Date(range.startMs).toISOString(), stop: new Date(range.stopMs).toISOString() },
      series,
      warnings,
    },
    connection,
    queryDigests,
  }
}
