import type { ConnectionCallWireParams, ConnectionCallWireResult, HttpConnection } from '#shared/contract'
import type { AppInstallationRecord } from '../apps/store'
import type { Actor, StudioDeps } from '../deps'
import type { InfrastructureRecord } from '../infrastructures'
import type { Violation } from '../problem'
import type { TargetAccess } from '../targets/credentials'
import type { ConnectionTokenSource } from './auth'
import type { ConnectionClient } from './client'
import type { ConnectionCheck } from './registry'
import type { ApiOperation, ConnectionApi, OperationValidators } from '@basyx/studio-app-kit/manifest'
import type { ErrorObject, ValidateFunction } from 'ajv/dist/2020.js'
import { bodyKindOf } from '@basyx/studio-app-kit/manifest'
import { connectionCallMaxBodyBytes } from '@basyx/studio-sdk/protocol'
import { connectionWireFormSchema } from '#shared/contract'
import { recordAudit } from '../audit'
import { networkFailureOf } from '../network/guarded-fetch'
import { StudioProblem } from '../problem'
import { connectionMaxResponseBytes, openConnection } from './client'

// HTTP connections (ADR 0047): an app calls an operation it declares in the
// OpenAPI document of one of its connections, and Studio sends it to the
// infrastructure connection an administrator bound to that app connection.
// The URL is the connection's, the path the operation's template, the method
// the operation's; parameters and JSON bodies are validated against the
// document's schemas. Nothing else can be sent.

/** Concurrent calls per session and connection (MVP-7 plan K7). */
export const maxCallsInFlight = 4

/** The request Studio sends for an operation, before credentials are added. */
export interface HttpRequest {
  method: string
  /** The expanded path template, below the connection's URL. */
  path: string
  query: [string, string][]
  headers: Record<string, string>
  body?: string | Uint8Array<ArrayBuffer>
}

function invalid (violations: Violation[]): StudioProblem {
  return new StudioProblem('invalid_request', 'The call does not match the operation.', { violations })
}

function errorViolations (errors: ErrorObject[] | null | undefined, base: string, wrapped: boolean): Violation[] {
  return (errors ?? []).slice(0, 20).map(error => {
    const pointer = wrapped ? error.instancePath.replace(/^\/value/, '') : error.instancePath
    const path = [base, ...pointer.split('/').filter(Boolean)].join('.')
    return { path, message: error.message ?? 'is invalid' }
  })
}

/** Validates a parameter or form field with its coercing validator; returns the coerced value. */
function coerced (validate: ValidateFunction | undefined, value: unknown, path: string, violations: Violation[]): unknown {
  if (!validate) {
    return value
  }
  const wrapper = { value }
  if (!validate(wrapper)) {
    violations.push(...errorViolations(validate.errors, path, true))
  }
  return wrapper.value
}

function serialize (value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/** The media type the call's body is sent as: the app's choice among the declared ones, or the first. */
function chooseMediaType (operation: ApiOperation, requested: string | undefined, violations: Violation[]): { declared: string, sent: string } | null {
  const content = operation.requestBody?.content ?? []
  if (content.length === 0) {
    return null
  }
  if (requested === undefined) {
    const { mediaType } = content[0]!
    return { declared: mediaType, sent: mediaType.includes('*') ? 'application/octet-stream' : mediaType }
  }
  const wanted = requested.split(';', 1)[0]!.trim().toLowerCase()
  const match = content.find(media => {
    const declared = media.mediaType.split(';', 1)[0]!.trim()
    if (declared === wanted) {
      return true
    }
    const [type, subtype] = declared.split('/')
    return declared === '*/*' || (subtype === '*' && wanted.startsWith(`${type}/`))
  })
  if (!match) {
    violations.push({ path: 'contentType', message: `must be one of ${content.map(media => media.mediaType).join(', ')}` })
    return null
  }
  return { declared: match.mediaType, sent: requested }
}

function byteLength (body: string | Uint8Array): number {
  return typeof body === 'string' ? Buffer.byteLength(body, 'utf8') : body.byteLength
}

/** Decodes a base64 string of the HTTP binding strictly; `null` when it is not base64. */
function decodeBase64 (value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Z0-9+/]*={0,2}$/i.test(value) || value.length % 4 === 1) {
    return null
  }
  return new Uint8Array(Buffer.from(value, 'base64'))
}

async function formBody (
  kind: 'form' | 'multipart',
  validators: OperationValidators,
  mediaType: string,
  value: unknown,
  violations: Violation[],
): Promise<{ body: string | Uint8Array<ArrayBuffer>, contentType: string } | null> {
  const parsed = connectionWireFormSchema.safeParse(value ?? {})
  if (!parsed.success) {
    violations.push({ path: 'body', message: kind === 'form' ? 'must be { fields }' : 'must be { fields, files }' })
    return null
  }
  const { fields = {}, files = {} } = parsed.data
  const form = validators.forms.get(mediaType)
  const names = [...Object.keys(fields), ...Object.keys(files)]
  if (kind === 'form' && Object.keys(files).length > 0) {
    violations.push({ path: 'body.files', message: `${mediaType} takes fields only` })
  }
  if (form) {
    for (const name of form.schema.required) {
      if (!names.includes(name)) {
        violations.push({ path: `body.${name}`, message: 'is required' })
      }
    }
    if (form.schema.closed) {
      for (const name of names.filter(name => !form.schema.properties.has(name))) {
        violations.push({ path: `body.${name}`, message: 'is not a property of the operation\'s body' })
      }
    }
    for (const [name, field] of Object.entries(fields)) {
      coerced(form.fields.get(name), field, `body.fields.${name}`, violations)
    }
  }
  if (kind === 'form') {
    return { body: new URLSearchParams(fields).toString(), contentType: 'application/x-www-form-urlencoded' }
  }
  const data = new FormData()
  for (const [name, field] of Object.entries(fields)) {
    data.append(name, field)
  }
  for (const [name, file] of Object.entries(files)) {
    const bytes = decodeBase64(file.base64)
    if (!bytes) {
      violations.push({ path: `body.files.${name}`, message: 'must be bytes' })
      continue
    }
    data.append(name, new Blob([bytes], { type: file.contentType ?? 'application/octet-stream' }), file.fileName)
  }
  if (violations.length > 0) {
    return null
  }
  const encoded = new Response(data)
  return { body: new Uint8Array(await encoded.arrayBuffer()), contentType: encoded.headers.get('content-type')! }
}

type Location = ApiOperation['parameters'][number]['in']

function declaredParameters (operation: ApiOperation, location: Location) {
  return operation.parameters.filter(parameter => parameter.in === location)
}

/** The path template filled one segment per value; never `.` or `..`. */
function pathOf (operation: ApiOperation, validators: OperationValidators, values: Record<string, unknown>, violations: Violation[]): string {
  for (const name of Object.keys(values)) {
    if (!declaredParameters(operation, 'path').some(parameter => parameter.name === name)) {
      violations.push({ path: `path.${name}`, message: 'is not a path parameter of the operation' })
    }
  }
  return operation.path.replaceAll(/\{([^}]+)\}/g, (_match, name: string) => {
    if (!Object.hasOwn(values, name)) {
      violations.push({ path: `path.${name}`, message: 'is required' })
      return ''
    }
    const value = coerced(validators.parameters.get(`path:${name}`), values[name], `path.${name}`, violations)
    const text = Array.isArray(value) ? value.map(item => serialize(item)).join(',') : serialize(value)
    if (['', '.', '..'].includes(text)) {
      violations.push({ path: `path.${name}`, message: 'must not be empty, . or ..' })
    }
    return encodeURIComponent(text)
  })
}

/** Declared query parameters only, repeated or comma-separated for arrays. */
function queryOf (operation: ApiOperation, validators: OperationValidators, values: Record<string, unknown>, violations: Violation[]): [string, string][] {
  const declared = declaredParameters(operation, 'query')
  for (const name of Object.keys(values)) {
    if (!declared.some(parameter => parameter.name === name)) {
      violations.push({ path: `query.${name}`, message: 'is not a query parameter of the operation' })
    }
  }
  const query: [string, string][] = []
  for (const parameter of declared) {
    if (!Object.hasOwn(values, parameter.name)) {
      if (parameter.required) {
        violations.push({ path: `query.${parameter.name}`, message: 'is required' })
      }
      continue
    }
    const value = coerced(validators.parameters.get(`query:${parameter.name}`), values[parameter.name], `query.${parameter.name}`, violations)
    const texts = Array.isArray(value) ? value.map(item => serialize(item)) : [serialize(value)]
    if (parameter.array && !parameter.explode) {
      query.push([parameter.name, texts.join(',')])
    } else {
      query.push(...texts.map((text): [string, string] => [parameter.name, text]))
    }
  }
  return query
}

/** Declared header parameters only, matched without regard to case, without control characters. */
function headersOf (operation: ApiOperation, validators: OperationValidators, values: Record<string, unknown>, violations: Violation[]): Record<string, string> {
  const declared = declaredParameters(operation, 'header')
  const given = new Map(Object.entries(values).map(([name, value]) => [name.toLowerCase(), { name, value }]))
  for (const { name } of given.values()) {
    if (!declared.some(parameter => parameter.name.toLowerCase() === name.toLowerCase())) {
      violations.push({ path: `headers.${name}`, message: 'is not a header parameter of the operation' })
    }
  }
  const headers: Record<string, string> = {}
  for (const parameter of declared) {
    const entry = given.get(parameter.name.toLowerCase())
    if (!entry) {
      if (parameter.required) {
        violations.push({ path: `headers.${parameter.name}`, message: 'is required' })
      }
      continue
    }
    const value = coerced(validators.parameters.get(`header:${parameter.name}`), entry.value, `headers.${parameter.name}`, violations)
    const text = Array.isArray(value) ? value.map(item => serialize(item)).join(',') : serialize(value)
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001F\u007F]/.test(text)) {
      violations.push({ path: `headers.${parameter.name}`, message: 'must not contain control characters' })
    }
    headers[parameter.name] = text
  }
  return headers
}

/** What each kind of media type takes, for messages. */
const bodyShapes = { json: 'a JSON value', text: 'a string', form: 'fields', multipart: 'fields and files', bytes: 'bytes (a Uint8Array)' } as const

/** The body as its media type takes it, with its `Content-Type`; `null` without a body. */
async function bodyOf (operation: ApiOperation, validators: OperationValidators, params: ConnectionCallWireParams, violations: Violation[]): Promise<{ body: string | Uint8Array<ArrayBuffer>, contentType: string } | null> {
  if (params.body === undefined) {
    if (operation.requestBody?.required) {
      violations.push({ path: 'body', message: 'is required' })
    }
    if (params.contentType !== undefined && !operation.requestBody) {
      violations.push({ path: 'contentType', message: 'the operation takes no body' })
    }
    return null
  }
  if (!operation.requestBody) {
    violations.push({ path: 'body', message: 'the operation takes no body' })
    return null
  }
  const media = chooseMediaType(operation, params.contentType, violations)
  if (!media) {
    return null
  }
  const kind = bodyKindOf(media.sent)
  if ((params.encoding === 'base64') !== (kind === 'bytes') || (kind === 'bytes' && typeof params.body !== 'string')) {
    violations.push({ path: 'body', message: `${media.declared} takes ${bodyShapes[kind]}` })
    return null
  }
  switch (kind) {
    case 'json': {
      const validate = validators.bodies.get(media.declared)
      if (validate && !validate(params.body)) {
        violations.push(...errorViolations(validate.errors, 'body', false))
      }
      return { body: JSON.stringify(params.body), contentType: media.sent }
    }
    case 'text': {
      if (typeof params.body === 'string') {
        return { body: params.body, contentType: media.sent }
      }
      violations.push({ path: 'body', message: `${media.declared} takes ${bodyShapes.text}` })
      return null
    }
    case 'bytes': {
      const bytes = decodeBase64(params.body as string)
      if (bytes) {
        return { body: bytes, contentType: media.sent }
      }
      violations.push({ path: 'body', message: 'is not base64' })
      return null
    }
    case 'form':
    case 'multipart': {
      return formBody(kind, validators, media.declared, params.body, violations)
    }
  }
}

/**
 * The request for a call of an operation, with every value checked against
 * the operation: path values fill the template one segment each, only
 * declared query and header parameters are sent, and the body must be what
 * its media type takes. Violations are refused together as `invalid_request`.
 */
export async function buildHttpRequest (operation: ApiOperation, validators: OperationValidators, params: ConnectionCallWireParams): Promise<HttpRequest> {
  const violations: Violation[] = []
  const path = pathOf(operation, validators, params.path ?? {}, violations)
  const query = queryOf(operation, validators, params.query ?? {}, violations)
  const headers = headersOf(operation, validators, params.headers ?? {}, violations)
  headers.Accept = operation.responseMediaTypes.length > 0 ? operation.responseMediaTypes.join(', ') : '*/*'
  const body = await bodyOf(operation, validators, params, violations)
  if (body) {
    headers['Content-Type'] = body.contentType
    if (byteLength(body.body) > connectionCallMaxBodyBytes) {
      violations.push({ path: 'body', message: `is larger than ${connectionCallMaxBodyBytes / 1024 / 1024} MiB; send it in parts through the service's own operations` })
    }
  }
  if (violations.length > 0) {
    throw invalid(violations)
  }
  return { method: operation.method, path, query, headers, body: body?.body }
}

function textOf (bytes: Uint8Array, contentType: string): string {
  const utf8 = new TextDecoder()
  const charset = /charset="?([\w-]+)"?/i.exec(contentType)?.[1]
  try {
    return charset ? new TextDecoder(charset).decode(bytes) : utf8.decode(bytes)
  } catch {
    return utf8.decode(bytes)
  }
}

/**
 * A `Location` as the app may see it: relative to the connection's URL, as
 * the operations' paths are (`/orders/7`), so the service's address stays
 * with Studio; `null` when it points elsewhere.
 */
export function locationBelow (connectionUrl: string, requestPath: string, location: string | null): string | null {
  if (!location) {
    return null
  }
  const base = new URL(connectionUrl)
  const basePath = base.pathname.replace(/\/+$/, '')
  const resolved = URL.parse(location, `${base.origin}${basePath}${requestPath}`)
  if (!resolved || resolved.origin !== base.origin || !(resolved.pathname === basePath || resolved.pathname.startsWith(`${basePath}/`))) {
    return null
  }
  return `${resolved.pathname.slice(basePath.length) || '/'}${resolved.search}`
}

/**
 * An answer as the app receives it: every status is a result; the body by
 * its media type. `location` is the answer's `Location` as `locationBelow`
 * gives it.
 */
export function callResult (status: number, headers: Headers, bytes: Uint8Array, location: string | null = null): ConnectionCallWireResult {
  const contentType = headers.get('content-type')
  const result = { status, contentType, etag: headers.get('etag'), location }
  if (bytes.byteLength === 0) {
    return { ...result, body: null }
  }
  const kind = contentType ? bodyKindOf(contentType) : 'bytes'
  if (kind === 'json') {
    const text = textOf(bytes, contentType!)
    try {
      return { ...result, body: JSON.parse(text) }
    } catch {
      return { ...result, body: text }
    }
  }
  if (kind === 'text' || kind === 'form') {
    return { ...result, body: textOf(bytes, contentType!) }
  }
  return { ...result, body: Buffer.from(bytes).toString('base64'), encoding: 'base64' }
}

/** Calls in flight per session and connection, so one page cannot flood a service (K7). */
export class CallLimiter {
  readonly #inFlight = new Map<string, number>()

  constructor (readonly limit = maxCallsInFlight) {}

  /** Takes a slot, or returns `null` when all are taken; call the returned function when done. */
  acquire (key: string): (() => void) | null {
    const current = this.#inFlight.get(key) ?? 0
    if (current >= this.limit) {
      return null
    }
    this.#inFlight.set(key, current + 1)
    let released = false
    return () => {
      if (released) {
        return
      }
      released = true
      const left = (this.#inFlight.get(key) ?? 1) - 1
      if (left > 0) {
        this.#inFlight.set(key, left)
      } else {
        this.#inFlight.delete(key)
      }
    }
  }
}

/**
 * A transport failure as the app may see it: its kind, without the host
 * names and addresses the network layer reports, which stay with Studio
 * (ADR 0047). The original is the problem's cause, and the audit keeps it.
 */
export function appFacingProblem (error: unknown, connection: Pick<HttpConnection, 'key'>, timeoutMs: number): unknown {
  // Only failures of the network layer name hosts; Studio's own refusals stay as they are.
  const failure = error instanceof StudioProblem ? networkFailureOf(error.cause) : undefined
  if (!failure) {
    return error
  }
  const { key } = connection
  switch (failure.kind) {
    case 'blocked': {
      return new StudioProblem('connection_request_refused', `Studio does not send requests to the address of the connection ${key}; the deployment's network policy refuses it.`, { cause: error })
    }
    case 'timeout': {
      return new StudioProblem('connection_unavailable', `The connection ${key} did not answer within ${timeoutMs / 1000} s.`, { cause: error })
    }
    case 'too_large': {
      return new StudioProblem('connection_unavailable', `The connection ${key} answered with more than ${connectionMaxResponseBytes / 1024 / 1024} MiB.`, { cause: error })
    }
    default: {
      return new StudioProblem('connection_unavailable', `The connection ${key} could not be reached.`, { cause: error })
    }
  }
}

/** What a call needs of the credential broker. */
export interface HttpCallBroker extends ConnectionTokenSource {
  access: (record: InfrastructureRecord, sessionId: string) => Promise<TargetAccess>
  invalidateConnection: (record: InfrastructureRecord, connectionKey: string) => void
}

export interface HttpCall {
  actor: Actor
  installation: Pick<AppInstallationRecord, 'id' | 'appId' | 'manifest'> & { previewOf?: string | null }
  /** The app connections' indexed documents, by connection ID. */
  apis: ReadonlyMap<string, ConnectionApi>
  /** The infrastructure of the frame's or token's target; `null` without one, or for a workspace. */
  record: InfrastructureRecord | null
  caller: 'host' | 'backend'
  requestId: string
  params: ConnectionCallWireParams
}

/** The `http` connection of an infrastructure that binds an app connection, if any (K3). */
/**
 * The app ID under which infrastructures hold an installation's settings and
 * connection bindings: an App Builder preview uses those of the installed app
 * it previews (ADR 0054), every other installation its own.
 */
export function configurationAppId (installation: Pick<AppInstallationRecord, 'appId'> & { previewOf?: string | null }): string {
  return installation.previewOf ?? installation.appId
}

export function boundConnection (record: Pick<InfrastructureRecord, 'connections'>, appId: string, connectionId: string): HttpConnection | undefined {
  return record.connections.find((connection): connection is HttpConnection =>
    connection.type === 'http' && connection.apps.some(binding => binding.app === appId && binding.connection === connectionId))
}

/**
 * Runs `studio.connections.call` (ADR 0047): checks that the app declares
 * the operation and that the infrastructure binds the app connection, that
 * the user may open the infrastructure, and that the call matches the
 * operation; then sends it with the connection's credentials and returns the
 * answer, whatever its status. Redirects are refused. Every call and every
 * refusal is audited, without parameters or bodies.
 */
export async function callHttpConnection (deps: StudioDeps, broker: HttpCallBroker, limiter: CallLimiter, call: HttpCall): Promise<ConnectionCallWireResult> {
  const { actor, installation, params, record } = call
  const started = performance.now()
  let connection: HttpConnection | undefined
  let client: ConnectionClient | undefined
  let method: string | null = null
  const audit = (outcome: 'success' | 'failure', details: Record<string, unknown>) => recordAudit(deps, {
    action: 'connection.call',
    outcome,
    requestId: call.requestId,
    actorSubject: actor.subject,
    targetId: record?.id ?? null,
    appInstallationId: installation.id,
    downstreamIdentity: client?.downstreamIdentity ?? null,
    details: {
      appId: installation.appId,
      caller: call.caller,
      appConnection: params.connection,
      connection: connection?.key ?? null,
      operation: params.operation,
      method,
      delegation: client?.delegation ?? null,
      durationMs: Math.round(performance.now() - started),
      ...details,
    },
  })

  let release: (() => void) | null = null
  try {
    const declared = installation.manifest.connections?.find(candidate => candidate.id === params.connection)
    const api = declared && call.apis.get(declared.id)
    if (!declared || !api) {
      throw new StudioProblem('connection_operation_not_declared', `${installation.appId} declares no connection ${params.connection}.`)
    }
    const operation = declared.operations.includes(params.operation) ? api.index.operations.get(params.operation) : undefined
    const validators = api.validators.get(params.operation)
    if (!operation || !validators) {
      throw new StudioProblem('connection_operation_not_declared', `${installation.appId} does not declare the operation ${params.operation} of its connection ${params.connection}.`)
    }
    method = operation.method
    if (!record) {
      throw new StudioProblem('connection_not_bound', 'Connections belong to infrastructures; open the app on a target of an infrastructure.')
    }
    connection = boundConnection(record, configurationAppId(installation), declared.id)
    if (!connection) {
      throw new StudioProblem('connection_not_bound', `No connection of ${record.name} is bound to ${configurationAppId(installation)} ${declared.id}.`)
    }
    // With a service identity too: only users who may open the infrastructure use its connections (SEC-005).
    await broker.access(record, actor.sessionId)
    const request = await buildHttpRequest(operation, validators, params)
    release = limiter.acquire(`${actor.sessionId} ${record.id} ${connection.key}`)
    if (!release) {
      throw new StudioProblem('connection_busy', `${maxCallsInFlight} calls to the connection ${connection.key} are in progress; try again when one has finished.`)
    }
    // Credential problems name no address; failures of the request to the service may, so the app gets them without it.
    client = await openConnection(deps, broker, record, connection, actor.sessionId, { returnRedirects: true })
    const opened = client
    const bound = connection
    const redacted = async <T>(step: () => Promise<T>): Promise<T> => {
      try {
        return await step()
      } catch (error) {
        throw appFacingProblem(error, bound, opened.timeoutMs)
      }
    }
    const response = await redacted(() => opened.request(request.path, { method: request.method, query: request.query, headers: request.headers, body: request.body }))
    if (response.status >= 300 && response.status < 400 && response.status !== 304) {
      await response.body?.cancel()
      throw new StudioProblem('connection_request_refused', `The connection ${connection.key} answered ${params.operation} with a redirect (HTTP ${response.status}), which Studio does not follow.`, { violations: [{ path: 'status', message: String(response.status) }] })
    }
    if ((response.status === 401 || response.status === 403) && (connection.auth.scheme === 'oauth2ClientCredentials' || connection.auth.scheme === 'delegatedUser')) {
      // The next call gets a new token; this answer is still the app's.
      broker.invalidateConnection(record, connection.key)
    }
    const bytes = await redacted(() => opened.bytes(response))
    const result = callResult(response.status, response.headers, bytes, locationBelow(connection.url, request.path, response.headers.get('location')))
    await audit('success', { status: response.status })
    return result
  } catch (error) {
    // The audit keeps the network layer's own message, the app gets the redacted one.
    const cause = error instanceof StudioProblem && error.cause instanceof StudioProblem ? error.cause : null
    await audit('failure', { code: error instanceof StudioProblem ? error.code : 'internal_error', ...(cause ? { reason: cause.detail ?? cause.title } : {}) })
    throw error
  } finally {
    release?.()
  }
}

/**
 * *Test connection* for `http`: the service answers its URL without
 * refusing the credentials. A redirect counts as an answer; it is not
 * followed.
 */
export async function testHttp (client: ConnectionClient): Promise<ConnectionCheck[]> {
  const started = performance.now()
  try {
    const response = await client.request('')
    await response.body?.cancel()
    const ok = response.status < 500 && response.status !== 401 && response.status !== 403
    return [{ check: 'health', ok, status: response.status, latencyMs: Math.round(performance.now() - started), message: ok ? null : `HTTP ${response.status}` }]
  } catch (error) {
    return [{ check: 'health', ok: false, status: null, latencyMs: null, message: error instanceof Error ? error.message : 'request failed' }]
  }
}
