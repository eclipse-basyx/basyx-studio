import type { ClientCertificate } from '../network/guarded-fetch'
import * as oidc from 'openid-client'
import { createGuardedFetch, NetworkFailure } from '../network/guarded-fetch'

export interface OidcClientSettings {
  issuer: string
  clientId: string
  /** Absent for public clients (desktop, RFC 8252), which rely on PKCE alone. */
  clientSecret: string | undefined
  allowPrivateNetwork: boolean
  /** The target's TLS client certificate, for IdPs behind mutual TLS. */
  clientCertificate?: ClientCertificate
}

export interface TokenSet {
  accessToken: string
  refreshToken: string | undefined
  /** Absolute expiry of the access token, if the IdP reported one. */
  expiresAt: Date | undefined
  idToken: string | undefined
  claims: Record<string, unknown> | undefined
}

export class OidcError extends Error {
  constructor (readonly kind: 'unreachable' | 'rejected' | 'invalid_grant', message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'OidcError'
  }
}

const clients = new Map<string, Promise<oidc.Configuration>>()

function cacheKey (settings: OidcClientSettings): string {
  // The certificate by its identity only, never by its key material.
  return JSON.stringify([settings.issuer, settings.clientId, settings.clientSecret ?? null, settings.allowPrivateNetwork, settings.clientCertificate?.identity ?? null])
}

function toOidcError (error: unknown): OidcError {
  if (error instanceof OidcError) {
    return error
  }
  if (error instanceof NetworkFailure || (error as { cause?: unknown }).cause instanceof NetworkFailure) {
    return new OidcError('unreachable', 'The identity provider could not be reached.', { cause: error })
  }
  const code = (error as { error?: string }).error
  if (code === 'invalid_grant') {
    return new OidcError('invalid_grant', 'The identity provider rejected the grant.', { cause: error })
  }
  return new OidcError('rejected', `The identity provider rejected the request${code ? ` (${code})` : ''}.`, { cause: error })
}

/**
 * Discovers and caches an OIDC client. Only the issuer's origin and the
 * origins announced in its discovery document can be contacted.
 */
export function getOidcClient (settings: OidcClientSettings): Promise<oidc.Configuration> {
  const key = cacheKey(settings)
  let client = clients.get(key)
  if (!client) {
    client = discover(settings)
    clients.set(key, client)
    // Retry discovery on the next request instead of caching a failure.
    client.catch(() => clients.delete(key))
  }
  return client
}

export function forgetOidcClients (): void {
  clients.clear()
}

async function discover (settings: OidcClientSettings): Promise<oidc.Configuration> {
  const issuer = new URL(settings.issuer)
  const allowedOrigins = new Set([issuer.origin])
  const guardedFetch = createGuardedFetch({
    allowedOrigins,
    allowPrivateNetwork: settings.allowPrivateNetwork,
    timeoutMs: 10_000,
    maxResponseBytes: 1_000_000,
    ...(settings.clientCertificate ? { clientCertificate: settings.clientCertificate } : {}),
  })
  const idpFetch: oidc.CustomFetch = (url, options) => guardedFetch(url, options as RequestInit)
  const insecure = issuer.protocol === 'http:'
  try {
    const config = await oidc.discovery(
      issuer,
      settings.clientId,
      undefined,
      settings.clientSecret ? oidc.ClientSecretPost(settings.clientSecret) : oidc.None(),
      {
        [oidc.customFetch]: idpFetch,
        // The address policy already restricts plain HTTP to loopback and private networks.
        execute: insecure ? [oidc.allowInsecureRequests] : [],
      },
    )
    const metadata = config.serverMetadata()
    for (const endpoint of [metadata.token_endpoint, metadata.jwks_uri, metadata.end_session_endpoint, metadata.userinfo_endpoint]) {
      if (endpoint) {
        allowedOrigins.add(new URL(endpoint).origin)
      }
    }
    config[oidc.customFetch] = idpFetch
    return config
  } catch (error) {
    throw toOidcError(error)
  }
}

export interface PendingAuthorization {
  url: string
  state: string
  nonce: string
  codeVerifier: string
}

export async function startAuthorization (
  client: oidc.Configuration,
  options: { redirectUri: string, scopes: string[] },
): Promise<PendingAuthorization> {
  const codeVerifier = oidc.randomPKCECodeVerifier()
  const state = oidc.randomState()
  const nonce = oidc.randomNonce()
  const url = oidc.buildAuthorizationUrl(client, {
    redirect_uri: options.redirectUri,
    scope: options.scopes.join(' '),
    response_type: 'code',
    code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: 'S256',
    state,
    nonce,
  })
  return { url: url.href, state, nonce, codeVerifier }
}

function toTokenSet (response: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers): TokenSet {
  const expiresIn = response.expiresIn()
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    expiresAt: expiresIn === undefined ? undefined : new Date(Date.now() + expiresIn * 1000),
    idToken: response.id_token,
    claims: response.claims() as Record<string, unknown> | undefined,
  }
}

/** Exchanges the authorization code; validates state, nonce, PKCE and the `iss` response parameter. */
export async function completeAuthorization (
  client: oidc.Configuration,
  callbackUrl: URL,
  checks: { state: string, nonce: string, codeVerifier: string, idTokenExpected: boolean },
): Promise<TokenSet> {
  try {
    const response = await oidc.authorizationCodeGrant(client, callbackUrl, {
      expectedState: checks.state,
      expectedNonce: checks.nonce,
      pkceCodeVerifier: checks.codeVerifier,
      idTokenExpected: checks.idTokenExpected,
    })
    return toTokenSet(response)
  } catch (error) {
    throw toOidcError(error)
  }
}

export async function refreshTokens (client: oidc.Configuration, refreshToken: string): Promise<TokenSet> {
  try {
    return toTokenSet(await oidc.refreshTokenGrant(client, refreshToken))
  } catch (error) {
    throw toOidcError(error)
  }
}

export async function clientCredentialsTokens (client: oidc.Configuration, scopes: string[], audience?: string): Promise<TokenSet> {
  try {
    return toTokenSet(await oidc.clientCredentialsGrant(client, {
      ...(scopes.length > 0 ? { scope: scopes.join(' ') } : {}),
      ...(audience ? { audience } : {}),
    }))
  } catch (error) {
    throw toOidcError(error)
  }
}

const tokenExchangeGrant = 'urn:ietf:params:oauth:grant-type:token-exchange'
const accessTokenType = 'urn:ietf:params:oauth:token-type:access_token'

/**
 * Exchanges a user's access token for one issued to another audience
 * (RFC 8693), e.g. a service behind a connection (ADR 0040). The IdP must
 * allow the exchange for this client.
 */
export async function exchangeToken (client: oidc.Configuration, subjectToken: string, request: { audience: string, scopes: string[] }): Promise<TokenSet> {
  try {
    return toTokenSet(await oidc.genericGrantRequest(client, tokenExchangeGrant, {
      subject_token: subjectToken,
      subject_token_type: accessTokenType,
      requested_token_type: accessTokenType,
      audience: request.audience,
      ...(request.scopes.length > 0 ? { scope: request.scopes.join(' ') } : {}),
    }))
  } catch (error) {
    throw toOidcError(error)
  }
}

/**
 * The audiences of a JWT access token, read without verifying it: Studio got
 * the token from the IdP itself and only checks where it may be forwarded.
 * `null` for tokens that are not JWTs.
 */
export function tokenAudiences (token: string): string[] | null {
  const [, payload] = token.split('.')
  if (!payload) {
    return null
  }
  try {
    const { aud } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { aud?: unknown }
    if (typeof aud === 'string') {
      return [aud]
    }
    return Array.isArray(aud) ? aud.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return null
  }
}

export function endSessionUrl (client: oidc.Configuration, options: { idToken: string | undefined, postLogoutRedirectUri: string }): string | null {
  if (!client.serverMetadata().end_session_endpoint) {
    return null
  }
  return oidc.buildEndSessionUrl(client, {
    post_logout_redirect_uri: options.postLogoutRedirectUri,
    ...(options.idToken ? { id_token_hint: options.idToken } : { client_id: client.clientMetadata().client_id }),
  }).href
}

/** Reads a claim by name or by RFC 6901 JSON pointer (e.g. `/realm_access/roles`). */
export function readClaim (claims: Record<string, unknown> | undefined, claim: string): unknown {
  if (!claims) {
    return undefined
  }
  if (!claim.startsWith('/')) {
    return claims[claim]
  }
  let current: unknown = claims
  for (const segment of claim.slice(1).split('/').map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'))) {
    if (typeof current !== 'object' || current === null) {
      return undefined
    }
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

export function readRoles (claims: Record<string, unknown> | undefined, claim: string): string[] {
  const value = readClaim(claims, claim)
  if (Array.isArray(value)) {
    return value.filter((role): role is string => typeof role === 'string')
  }
  return typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : []
}
