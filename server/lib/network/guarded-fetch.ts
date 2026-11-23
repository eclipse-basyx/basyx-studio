import type { AddressPolicy } from './address-policy'
import type { OutboundProxy } from './proxy'
import type { LookupAddress } from 'node:dns'
import type { ConnectionOptions, TLSSocket } from 'node:tls'
import type { Dispatcher, Response as UndiciResponse } from 'undici'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { connect as tlsConnect } from 'node:tls'
import { Agent, Client, ProxyAgent, fetch as undiciFetch } from 'undici'
import { rejectAddress, rejectUrl } from './address-policy'
import { proxyFor, redactProxyUrl } from './proxy'

/**
 * A TLS client certificate (mutual TLS). `identity` names the certificate for
 * the agent cache, e.g. infrastructure ID and revision; it never contains key
 * material, so certificates are never shared between infrastructures.
 */
export interface ClientCertificate {
  identity: string
  /** PEM private key. */
  key: string
  /** PEM certificate chain, leaf first. */
  cert: string
}

export interface OutboundPolicy extends AddressPolicy {
  /** Origins this client may contact, e.g. the configured endpoint origins. */
  allowedOrigins: ReadonlySet<string>
  timeoutMs: number
  maxResponseBytes: number
  /** Presented on HTTPS connections only; never on plain HTTP. */
  clientCertificate?: ClientCertificate
}

export type NetworkFailureKind = 'blocked' | 'timeout' | 'unreachable' | 'too_large' | 'client_certificate_required' | 'client_certificate_rejected'

/** Thrown by the guarded fetch; carries why a request failed before or during transport. */
export class NetworkFailure extends Error {
  constructor (readonly kind: NetworkFailureKind, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'NetworkFailure'
  }
}

/** The network failure behind an error, e.g. one that a client library wrapped. */
export function networkFailureOf (error: unknown): NetworkFailure | undefined {
  let current = error
  for (let depth = 0; current && depth < 5; depth++) {
    if (current instanceof NetworkFailure) {
      return current
    }
    current = (current as { cause?: unknown }).cause
  }
  return undefined
}

/** Collects the first transport failure, because the SDK hides fetch errors behind status 0. */
export interface FailureRecorder {
  failure?: NetworkFailure
  /**
   * The last answer if it was 2xx, with the JSON read from it (set by
   * `TargetHttp`), because the SDK reports a payload it cannot deserialize
   * as HTTP 500.
   */
  answer?: { status: number, payload?: unknown }
  /**
   * Whether the last request carried a precondition (`If-Match` and the
   * like; set by `TargetHttp`), so a 412 answer to a request without one
   * is not mistaken for someone else's change.
   */
  conditional?: boolean
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void

// Re-validates the resolved address at connect time, so a DNS answer that
// changes after the pre-flight check (DNS rebinding) cannot reach a forbidden
// address.
function guardedLookup (policy: AddressPolicy, protocol: string) {
  return (hostname: string, options: object, callback: LookupCallback): void => {
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
  }
}

function createGuardedAgent (policy: AddressPolicy, protocol: string, certificate: ClientCertificate | undefined): Agent {
  return new Agent({
    connect: {
      ...(certificate && protocol === 'https:' ? { key: certificate.key, cert: certificate.cert } : {}),
      lookup: guardedLookup(policy, protocol),
    },
  })
}

// Tunnels https requests with CONNECT and forwards http requests to the
// proxy. Studio never connects to the target itself, so no lookup guards the
// target's address at connect time; the pre-flight check in `checkHost` does
// (ADR 0052). The proxy is connected to as configured: its own address is
// the deployment's choice, not a target.
function createProxyAgent (proxy: URL, protocol: string, certificate: ClientCertificate | undefined): ProxyAgent {
  return new ProxyAgent({
    uri: proxy.href,
    ...(certificate && protocol === 'https:' ? { requestTls: { key: certificate.key, cert: certificate.cert } } : {}),
  })
}

const agents = new Map<string, Dispatcher>()

let outboundProxy: OutboundProxy | null = null

/**
 * Sets the deployment's outbound proxy (ADR 0052), once at startup; `null`
 * sends every request direct. Closes the agents made for the previous one.
 */
export function configureOutboundProxy (proxy: OutboundProxy | null): void {
  outboundProxy = proxy
  for (const agent of agents.values()) {
    agent.close().catch(() => {})
  }
  agents.clear()
}

/**
 * The agent cache key of a request: one agent per address policy, protocol,
 * client certificate, and whether it goes through the proxy.
 */
export function agentKey (policy: OutboundPolicy, protocol: string, proxied = false): string {
  const certificate = protocol === 'https:' ? policy.clientCertificate : undefined
  return `${policy.allowPrivateNetwork}:${protocol}:${certificate ? `cert:${certificate.identity}` : ''}${proxied ? ':proxy' : ''}`
}

function agentFor (policy: OutboundPolicy, protocol: string, proxy: URL | null): Dispatcher {
  const key = agentKey(policy, protocol, proxy !== null)
  let agent = agents.get(key)
  if (!agent) {
    const certificate = protocol === 'https:' ? policy.clientCertificate : undefined
    agent = proxy ? createProxyAgent(proxy, protocol, certificate) : createGuardedAgent(policy, protocol, certificate)
    agents.set(key, agent)
  }
  return agent
}

/**
 * Closes the agents of client certificates whose identity starts with
 * `prefix` (e.g. an infrastructure ID), so replaced or deleted certificates do
 * not stay in memory.
 */
export function releaseCertificateAgents (prefix: string): void {
  for (const [key, agent] of agents) {
    if (key.includes(`:cert:${prefix}`)) {
      agents.delete(key)
      agent.close().catch(() => {})
    }
  }
}

// OpenSSL codes of the TLS alerts a server sends about the client certificate.
const certificateRequiredCodes = new Set(['ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED'])
const certificateRejectedCodes = new Set([
  'ERR_SSL_SSLV3_ALERT_BAD_CERTIFICATE',
  'ERR_SSL_SSLV3_ALERT_UNSUPPORTED_CERTIFICATE',
  'ERR_SSL_SSLV3_ALERT_CERTIFICATE_REVOKED',
  'ERR_SSL_SSLV3_ALERT_CERTIFICATE_EXPIRED',
  'ERR_SSL_SSLV3_ALERT_CERTIFICATE_UNKNOWN',
  'ERR_SSL_TLSV1_ALERT_UNKNOWN_CA',
  'ERR_SSL_TLSV1_ALERT_ACCESS_DENIED',
])

/** The first error code in a cause chain (undici wraps socket errors). */
function errorCode (error: unknown): string | undefined {
  let current = error
  for (let depth = 0; current && depth < 5; depth++) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string') {
      return code
    }
    current = (current as { cause?: unknown }).cause
  }
  return undefined
}

/**
 * Reads the TLS alert a server sends after the handshake. undici reports a
 * connection that the server closed right after its alert as "other side
 * closed" when the close arrives first, so a failed HTTPS request is
 * diagnosed with one more handshake (same address guard and certificate, no
 * HTTP request), through a tunnel of the outbound proxy if the request went
 * through it. Resolves with the alert error; with `ESTUDIOTLSCLOSED` if the
 * server closed the connection right after the handshake without an alert,
 * as Node's TLS servers do; or undefined.
 */
function readTlsAlert (url: URL, policy: OutboundPolicy, proxy: URL | null): Promise<unknown> {
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const port = Number(url.port || 443)
  const certificate = policy.clientCertificate
  return new Promise(resolve => {
    let socket: TLSSocket | undefined
    let tunnel: Client | undefined
    const settle = (error?: unknown) => {
      clearTimeout(timer)
      socket?.destroy()
      tunnel?.destroy().catch(() => {})
      resolve(error)
    }
    // A server that accepts the certificate stays silent until the request.
    const timer = setTimeout(settle, Math.min(policy.timeoutMs, 2000))
    const handshake = (connection: ConnectionOptions) => {
      socket = tlsConnect({
        ...connection,
        servername: isIP(host) ? undefined : host,
        ...(certificate ? { key: certificate.key, cert: certificate.cert } : {}),
      })
      let secured = false
      socket.on('secureConnect', () => {
        secured = true
      })
      socket.on('error', settle)
      socket.on('close', () => settle(secured ? Object.assign(new Error('closed after the handshake'), { code: 'ESTUDIOTLSCLOSED' }) : undefined))
    }
    if (!proxy) {
      handshake({ host, port, lookup: guardedLookup(policy, 'https:') })
      return
    }
    tunnel = new Client(proxy.origin)
    tunnel.connect({ path: `${url.hostname}:${port}`, headers: { host: `${url.hostname}:${port}`, ...proxyAuthorization(proxy) } })
      .then(({ socket: raw, statusCode }) => statusCode === 200 ? handshake({ socket: raw }) : settle(), () => settle())
  })
}

/** The Proxy-Authorization header for the credentials in a proxy URL, as undici's ProxyAgent sends it. */
function proxyAuthorization (proxy: URL): Record<string, string> {
  if (!proxy.username && !proxy.password) {
    return {}
  }
  const credentials = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`
  return { 'proxy-authorization': `Basic ${Buffer.from(credentials).toString('base64')}` }
}

/** Maps TLS alerts about the client certificate to typed failures. */
function certificateFailure (error: unknown, origin: string, presented: boolean): NetworkFailure | undefined {
  const code = errorCode(error)
  if (!code) {
    return undefined
  }
  if (code === 'ESTUDIOTLSCLOSED') {
    return presented
      ? new NetworkFailure('client_certificate_rejected', `${origin} closed the connection after the TLS handshake; it did not accept the client certificate`, { cause: error })
      : new NetworkFailure('client_certificate_required', `${origin} closed the connection after the TLS handshake; it probably requires a TLS client certificate`, { cause: error })
  }
  if (certificateRequiredCodes.has(code) || (!presented && certificateRejectedCodes.has(code))) {
    return new NetworkFailure('client_certificate_required', `${origin} requires a TLS client certificate${presented ? ', but did not accept the configured one' : ''}`, { cause: error })
  }
  if (certificateRejectedCodes.has(code)) {
    const reason = code === 'ERR_SSL_SSLV3_ALERT_CERTIFICATE_EXPIRED' ? ' as expired' : (code === 'ERR_SSL_SSLV3_ALERT_CERTIFICATE_REVOKED' ? ' as revoked' : '')
    return new NetworkFailure('client_certificate_rejected', `${origin} rejected the TLS client certificate${reason}`, { cause: error })
  }
  return undefined
}

/**
 * Resolves a host and checks every address against the policy. A name that
 * only the outbound proxy can resolve passes for https: the proxy resolves
 * it, and IP literals are checked all the same (ADR 0052). Plain HTTP must
 * resolve here, because it may only reach private networks.
 */
export async function checkHost (url: URL, policy: AddressPolicy): Promise<void> {
  const staticReason = rejectUrl(url)
  if (staticReason) {
    throw new NetworkFailure('blocked', staticReason)
  }
  let addresses: LookupAddress[]
  try {
    addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true, verbatim: true })
  } catch (error) {
    if (url.protocol === 'https:' && proxyFor(url, outboundProxy)) {
      return
    }
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

/** Why a request through the outbound proxy failed, with the proxy's status if it refused the tunnel. */
function proxyFailureMessage (url: URL, proxy: URL, error: unknown): string {
  let current = error
  for (let depth = 0; current && depth < 5; depth++) {
    const status = /Proxy response \((\d{3})\)/.exec((current as Error).message ?? '')?.[1]
    if (status) {
      return `the outbound proxy ${redactProxyUrl(proxy)} refused the connection to ${url.origin} with HTTP ${status}`
    }
    current = (current as { cause?: unknown }).cause
  }
  return `request to ${url.origin} through the outbound proxy ${redactProxyUrl(proxy)} failed`
}

/**
 * A fetch implementation for all outbound Studio requests (AAS targets and
 * IdPs). It enforces the origin allowlist and address policy, never follows
 * redirects, and bounds time and response size. There is no generic proxy:
 * callers only obtain a guarded fetch for a configured target or IdP. The
 * deployment's outbound proxy (ADR 0052), if any, carries the request after
 * these checks.
 *
 * A redirect is a failure, unless `returnRedirects` hands it to a caller that
 * reads it as an answer; it is never followed either way.
 */
export function createGuardedFetch (
  policy: OutboundPolicy,
  options: { recorder?: FailureRecorder, headers?: Record<string, string>, returnRedirects?: boolean } = {},
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

    const proxy = proxyFor(url, outboundProxy)
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
        dispatcher: agentFor(policy, url.protocol, proxy),
        duplex: request.body ? 'half' : undefined,
      })
    } catch (error) {
      const cause = (error as { cause?: { code?: string } }).cause
      if (cause?.code === 'ESTUDIOBLOCKED') {
        return fail(new NetworkFailure('blocked', String((cause as Error).message), { cause: error }))
      }
      const presented = url.protocol === 'https:' && policy.clientCertificate !== undefined
      let tlsFailure = certificateFailure(error, url.origin, presented)
      if (!tlsFailure && url.protocol === 'https:' && errorCode(error) === 'UND_ERR_SOCKET') {
        tlsFailure = certificateFailure(await readTlsAlert(url, policy, proxy), url.origin, presented)
      }
      if (tlsFailure) {
        return fail(tlsFailure)
      }
      if ((error as Error).name === 'TimeoutError') {
        return fail(new NetworkFailure('timeout', `no response within ${policy.timeoutMs} ms`, { cause: error }))
      }
      return fail(new NetworkFailure('unreachable', proxy ? proxyFailureMessage(url, proxy, error) : `request to ${url.origin} failed`, { cause: error }))
    }

    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel()
      if (options.returnRedirects) {
        return new Response(null, { status: response.status, statusText: response.statusText, headers: [...response.headers] })
      }
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
