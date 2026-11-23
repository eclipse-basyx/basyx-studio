import type { EndpointType } from '#shared/contract'
import type { InfrastructureRecord } from '../infrastructures'
import type { FailureRecorder, OutboundPolicy } from '../network/guarded-fetch'
import type { TargetAccess } from './credentials'
import { Configuration } from 'basyx-typescript-sdk'
import { serviceUrl } from '#shared/contract'
import { environmentUrl } from '../infrastructures'
import { createGuardedFetch } from '../network/guarded-fetch'
import { StudioProblem } from '../problem'

/**
 * Where a request goes: a configured service type, or an explicit base URL
 * that a registry descriptor resolved to (already checked against the
 * infrastructure's base URLs).
 */
export type TargetBase = EndpointType | { url: string }

export interface TargetHttpOptions {
  record: InfrastructureRecord
  access: TargetAccess
  policy: OutboundPolicy
  requestId: string
  /** Called when the target rejects the credentials (HTTP 401). */
  onUnauthorized: () => Promise<void>
}

export interface TargetRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Query parameters; `undefined` values are left out, arrays repeat the key. */
  query?: Record<string, string | string[] | number | boolean | undefined>
  /** A JSON value, or a `FormData`/`Uint8Array` body sent as is. */
  body?: unknown
  headers?: Record<string, string>
  /** Statuses returned to the caller instead of being turned into a problem. */
  passStatuses?: number[]
}

/** Encodes an AAS identifier for a URL path (base64url without padding). */
export function encodeIdentifier (id: string): string {
  return Buffer.from(id, 'utf8').toString('base64url')
}

/**
 * Credentialed, guarded HTTP access to one live target for one request. The
 * SDK clients get their `Configuration` here; BaSyx Go endpoints the SDK does
 * not cover use `request` (ADR 0022). Both map failures to the same problems.
 */
export class TargetHttp {
  constructor (readonly options: TargetHttpOptions) {}

  get securityMode () {
    return this.options.record.security.mode
  }

  /** The base URL of a service (or of the AAS environment itself), or `null` if the target has no such endpoint. */
  baseUrl (type: EndpointType): string | null {
    return (type === 'aasEnvironment' ? environmentUrl(this.options.record) : serviceUrl(this.options.record, type)) ?? null
  }

  /** `returnRedirects` passes redirects to the SDK unfollowed, which reports them as failed results. */
  configuration (base: TargetBase, recorder: FailureRecorder, options: { returnRedirects?: boolean } = {}): Configuration {
    return new Configuration({ basePath: this.#requireBase(base), fetchApi: this.#fetch(recorder, options.returnRedirects) })
  }

  /** Sends a request to a service endpoint; non-2xx answers become problems unless passed. */
  async request (base: TargetBase, path: string, request: TargetRequest = {}): Promise<Response> {
    const recorder: FailureRecorder = {}
    const url = new URL(`${this.#requireBase(base)}${path}`)
    for (const [name, value] of Object.entries(request.query ?? {})) {
      for (const item of Array.isArray(value) ? value : [value]) {
        if (item !== undefined) {
          url.searchParams.append(name, String(item))
        }
      }
    }
    const headers: Record<string, string> = { Accept: 'application/json', ...request.headers }
    let body: BodyInit | undefined
    if (request.body instanceof FormData || request.body instanceof Uint8Array) {
      body = request.body as BodyInit
    } else if (request.body !== undefined) {
      body = JSON.stringify(request.body)
      headers['Content-Type'] = 'application/json'
    }
    let response: Response
    try {
      response = await this.#fetch(recorder)(url, { method: request.method ?? 'GET', headers, body })
    } catch {
      throw await this.problem(undefined, recorder)
    }
    if (response.ok || request.passStatuses?.includes(response.status)) {
      return response
    }
    const detail = await messageOf(response)
    throw await this.problem(response.status, recorder, detail)
  }

  async json<T> (base: TargetBase, path: string, request: TargetRequest = {}): Promise<T> {
    const response = await this.request(base, path, request)
    try {
      return await response.json() as T
    } catch {
      throw new StudioProblem('target_invalid_response', 'The target did not answer with JSON.')
    }
  }

  async problem (status: number | undefined, recorder: FailureRecorder, detail?: string): Promise<StudioProblem> {
    const failure = recorder.failure
    if (failure) {
      switch (failure.kind) {
        case 'blocked': {
          return new StudioProblem('target_blocked', failure.message)
        }
        case 'too_large': {
          return new StudioProblem('target_invalid_response', failure.message)
        }
        case 'timeout': {
          return new StudioProblem('target_unreachable', `The target did not answer in time (${failure.message}).`)
        }
        case 'client_certificate_required': {
          return new StudioProblem('target_client_certificate_required', failure.message)
        }
        case 'client_certificate_rejected': {
          return new StudioProblem('target_client_certificate_rejected', failure.message)
        }
        default: {
          return new StudioProblem('target_unreachable', failure.message)
        }
      }
    }
    if (recorder.answer) {
      // The target answered 2xx, and the SDK could not deserialize the payload.
      return new StudioProblem('target_invalid_response', invalidPayloadDetail(recorder.answer))
    }
    const mode = this.securityMode
    switch (status) {
      case 401: {
        await this.options.onUnauthorized()
        if (mode === 'deployment_client_credentials') {
          return new StudioProblem('target_credentials_rejected')
        }
        return new StudioProblem('target_auth_required', mode === 'unsecured'
          ? 'The target requires authentication, but it is configured as unsecured.'
          : 'The target rejected the authorization. Authorize this target again.')
      }
      case 403: {
        return new StudioProblem('target_forbidden')
      }
      case 412: {
        // Without a precondition, nothing Studio could reload would change the answer.
        return recorder.conditional === false
          ? new StudioProblem('target_request_rejected', 'The target answered 412 Precondition Failed, although Studio sent no precondition (If-Match). Reloading does not help: the target server, or a proxy in front of it, rejects this request.')
          : new StudioProblem('revision_conflict')
      }
      case 428: {
        return new StudioProblem('target_request_rejected', 'The target requires a revision (If-Match) for this write.')
      }
      case 404: {
        return new StudioProblem('target_resource_not_found', detail)
      }
      case 400:
      case 422: {
        return new StudioProblem('target_request_rejected', detail)
      }
      case 501: {
        return new StudioProblem('unsupported_operation', detail ?? 'The target does not implement this operation.')
      }
      case undefined:
      case 0: {
        return new StudioProblem('target_unreachable')
      }
      default: {
        if (status >= 500) {
          return new StudioProblem('target_error', `The target answered with HTTP ${status}.`)
        }
        return new StudioProblem('target_invalid_response', `Unexpected answer (HTTP ${status}).`)
      }
    }
  }

  #requireBase (base: TargetBase): string {
    if (typeof base === 'object') {
      return base.url
    }
    const url = this.baseUrl(base)
    if (!url) {
      throw new StudioProblem('unsupported_operation', `The target has no ${base} endpoint.`)
    }
    return url
  }

  #fetch (recorder: FailureRecorder, returnRedirects = false): typeof fetch {
    const headers: Record<string, string> = { 'X-Request-ID': this.options.requestId }
    if (this.options.access.accessToken) {
      headers.Authorization = `Bearer ${this.options.access.accessToken}`
    }
    const guarded = createGuardedFetch(this.options.policy, { recorder, headers, returnRedirects })
    return async (input, init) => {
      recorder.conditional = isConditional(input, init)
      const response = await guarded(input, init)
      recordAnswer(recorder, response)
      return response
    }
  }
}

const preconditionHeaders = ['if-match', 'if-none-match', 'if-modified-since', 'if-unmodified-since', 'if-range']

/** Whether a request carries a precondition, the only reason for a target to answer 412. */
function isConditional (input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]): boolean {
  const headers = new Headers(input instanceof Request ? input.headers : undefined)
  for (const [name, value] of new Headers(init?.headers)) {
    headers.set(name, value)
  }
  return preconditionHeaders.some(name => headers.has(name))
}

/** Notes a 2xx answer and the JSON the SDK reads from it, and forgets it on any other answer. */
function recordAnswer (recorder: FailureRecorder, response: Response): void {
  if (!response.ok) {
    recorder.answer = undefined
    return
  }
  const answer: NonNullable<FailureRecorder['answer']> = { status: response.status }
  recorder.answer = answer
  const json = response.json.bind(response)
  response.json = async () => {
    answer.payload = await json()
    return answer.payload
  }
}

/**
 * The path of the first `null` in a JSON value, e.g.
 * `$.result[0].referredSemanticId`, or `null` without any. The AAS JSON
 * schema allows `null` nowhere: an unset attribute is omitted.
 */
export function nullPathOf (value: unknown, path = '$'): string | null {
  if (value === null) {
    return path
  }
  if (typeof value !== 'object') {
    return null
  }
  const entries = Array.isArray(value)
    ? value.map((item, index) => [`${path}[${index}]`, item] as const)
    : Object.entries(value).map(([key, item]) => [`${path}.${key}`, item] as const)
  for (const [itemPath, item] of entries) {
    const found = nullPathOf(item, itemPath)
    if (found) {
      return found
    }
  }
  return null
}

/** Why a 2xx payload is not AAS JSON, naming the first `null` field of the content (not of the paging envelope). */
function invalidPayloadDetail (answer: NonNullable<FailureRecorder['answer']>): string {
  const { payload } = answer
  const paged = typeof payload === 'object' && payload !== null && 'result' in payload
  const field = paged ? nullPathOf((payload as { result: unknown }).result, '$.result') : nullPathOf(payload)
  const summary = `The target answered with HTTP ${answer.status}, but the payload is not valid AAS JSON`
  return field ? `${summary}: ${field} is null (AAS JSON omits unset attributes).` : `${summary}.`
}

/** The first message text of a BaSyx error body or SDK error result (`messages[].text`), if any. */
export function messageText (body: unknown): string | undefined {
  const messages = (body as { messages?: unknown } | null | undefined)?.messages
  const text = Array.isArray(messages)
    ? (messages as Array<{ text?: unknown }>).find(message => typeof message?.text === 'string')?.text as string | undefined
    : undefined
  // Keep server messages short; they may echo request data.
  return text ? text.slice(0, 300) : undefined
}

async function messageOf (response: Response): Promise<string | undefined> {
  try {
    return messageText(await response.json())
  } catch {
    return undefined
  }
}
