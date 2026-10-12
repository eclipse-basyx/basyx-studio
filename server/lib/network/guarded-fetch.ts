import type { AddressPolicy } from './address-policy'
import type { LookupAddress } from 'node:dns'
import type { Response as UndiciResponse } from 'undici'
import { lookup } from 'node:dns/promises'
import { Agent, fetch as undiciFetch } from 'undici'
import { rejectAddress, rejectUrl } from './address-policy'

export interface OutboundPolicy extends AddressPolicy {
  /** Origins this client may contact, e.g. the configured endpoint origins. */
  allowedOrigins: ReadonlySet<string>
  timeoutMs: number
  maxResponseBytes: number
}

export type NetworkFailureKind = 'blocked' | 'timeout' | 'unreachable' | 'too_large'

/** Thrown by the guarded fetch; carries why a request failed before or during transport. */
export class NetworkFailure extends Error {
  constructor (readonly kind: NetworkFailureKind, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'NetworkFailure'
  }
}

/** Collects the first transport failure, because the SDK hides fetch errors behind status 0. */
export interface FailureRecorder {
  failure?: NetworkFailure
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void

// Re-validates the resolved address at connect time, so a DNS answer that
// changes after the pre-flight check (DNS rebinding) cannot reach a forbidden
// address.
function createGuardedAgent (policy: AddressPolicy, protocol: string): Agent {
  return new Agent({
    connect: {
      lookup (hostname: string, options: object, callback: LookupCallback) {
        lookup(hostname, { all: true, verbatim: true })
          .then(addresses => {
            for (const address of addresses) {
              const reason = rejectAddress(address.address, protocol, policy)
              if (reason) {
                callback(Object.assign(new Error(reason), { code: 'ESTUDIOBLOCKED' }), [])
                return
              }
            }
            const wantsAll = (options as { all?: boolean }).all === true
            if (wantsAll) {
              callback(null, addresses)
            } else {
              callback(null, addresses[0]!.address, addresses[0]!.family)
            }
          })
          .catch(error => callback(error as NodeJS.ErrnoException, []))
      },
    },
  })
}

const agents = new Map<string, Agent>()
function agentFor (policy: AddressPolicy, protocol: string): Agent {
  const key = `${policy.allowPrivateNetwork}:${protocol}`
  let agent = agents.get(key)
  if (!agent) {
    agent = createGuardedAgent(policy, protocol)
    agents.set(key, agent)
  }
  return agent
}

/** Resolves a host and checks every address against the policy. */
export async function checkHost (url: URL, policy: AddressPolicy): Promise<void> {
  const staticReason = rejectUrl(url)
  if (staticReason) {
    throw new NetworkFailure('blocked', staticReason)
  }
  let addresses: LookupAddress[]
  try {
    addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true, verbatim: true })
  } catch (error) {
    throw new NetworkFailure('unreachable', `host ${url.hostname} could not be resolved`, { cause: error })
  }
  for (const address of addresses) {
    const reason = rejectAddress(address.address, url.protocol, policy)
    if (reason) {
      throw new NetworkFailure('blocked', reason)
    }
  }
}

// Returns a built-in Response, because callers such as openid-client and the
// BaSyx SDK expect Node's fetch types rather than those of the undici package.
function limitBody (response: UndiciResponse, maxBytes: number, onExceeded: (failure: NetworkFailure) => void): Response {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new NetworkFailure('too_large', `response exceeds ${maxBytes} bytes`)
  }
  const init = { status: response.status, statusText: response.statusText, headers: new Headers([...response.headers]) }
  if (!response.body) {
    return new Response(null, init)
  }
  let received = 0
  const limited = (response.body as ReadableStream<Uint8Array>).pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform (chunk, controller) {
      received += chunk.byteLength
      if (received > maxBytes) {
        const failure = new NetworkFailure('too_large', `response exceeds ${maxBytes} bytes`)
        onExceeded(failure)
        controller.error(failure)
        return
      }
      controller.enqueue(chunk)
    },
  }))
  return new Response(limited, init)
}

/**
 * A fetch implementation for all outbound Studio requests (AAS targets and
 * IdPs). It enforces the origin allowlist and address policy, never follows
 * redirects, and bounds time and response size. There is no generic proxy:
 * callers only obtain a guarded fetch for a configured target or IdP.
 */
export function createGuardedFetch (
  policy: OutboundPolicy,
  options: { recorder?: FailureRecorder, headers?: Record<string, string> } = {},
): typeof fetch {
  const fail = (failure: NetworkFailure): never => {
    options.recorder && (options.recorder.failure ??= failure)
    throw failure
  }

  return async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (!policy.allowedOrigins.has(url.origin)) {
      fail(new NetworkFailure('blocked', `origin ${url.origin} is not configured for this target`))
    }
    try {
      await checkHost(url, policy)
    } catch (error) {
      fail(error as NetworkFailure)
    }

    const headers = new Headers(request.headers)
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      headers.set(name, value)
    }

    const signals = [AbortSignal.timeout(policy.timeoutMs)]
    if (init?.signal) {
      signals.push(init.signal)
    }

    // The fetch of the undici package, not Node's built-in one: a dispatcher
    // only works with the fetch of the same undici major, and Node bundles its
    // own undici independently of the one installed here.
    let response: UndiciResponse
    try {
      response = await undiciFetch(request.url, {
        method: request.method,
        headers: [...headers],
        body: request.body,
        redirect: 'manual',
        signal: AbortSignal.any(signals),
        dispatcher: agentFor(policy, url.protocol),
        duplex: request.body ? 'half' : undefined,
      })
    } catch (error) {
      const cause = (error as { cause?: { code?: string } }).cause
      if (cause?.code === 'ESTUDIOBLOCKED') {
        return fail(new NetworkFailure('blocked', String((cause as Error).message), { cause: error }))
      }
      if ((error as Error).name === 'TimeoutError') {
        return fail(new NetworkFailure('timeout', `no response within ${policy.timeoutMs} ms`, { cause: error }))
      }
      return fail(new NetworkFailure('unreachable', `request to ${url.origin} failed`, { cause: error }))
    }

    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel()
      return fail(new NetworkFailure('blocked', `redirect to ${response.headers.get('location') ?? 'unknown'} was not followed`))
    }

    try {
      return limitBody(response, policy.maxResponseBytes, failure => {
        options.recorder && (options.recorder.failure ??= failure)
      })
    } catch (error) {
      await response.body?.cancel()
      return fail(error as NetworkFailure)
    }
  }
}
