import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * What a backend app may do with one capability token: act for one session
 * on one target, on behalf of one installation, until it expires. The
 * permissions come from the installed manifest at use time, so uninstalling
 * revokes outstanding tokens.
 */
export interface CapabilityClaims {
  installationId: string
  sessionId: string
  targetId: string | null
  /** Expiry, milliseconds since the epoch. */
  expiresAt: number
}

export const capabilityTokenPrefix = 'sct.'
export const capabilityTokenTtlMs = 60_000

export function capabilityTokenKey (dataKey: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', dataKey, Buffer.alloc(0), 'studio-app-capability-token', 32))
}

function sign (key: Buffer, payload: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url')
}

export function issueCapabilityToken (key: Buffer, claims: Omit<CapabilityClaims, 'expiresAt'>, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({
    i: claims.installationId,
    s: claims.sessionId,
    t: claims.targetId,
    e: now + capabilityTokenTtlMs,
    n: randomBytes(8).toString('base64url'),
  })).toString('base64url')
  return `${capabilityTokenPrefix}${payload}.${sign(key, payload)}`
}

/** The claims of a valid, unexpired token, or `null`. */
export function verifyCapabilityToken (key: Buffer, token: string, now = Date.now()): CapabilityClaims | null {
  if (!token.startsWith(capabilityTokenPrefix) || token.length > 2000) {
    return null
  }
  const [payload, mac, ...rest] = token.slice(capabilityTokenPrefix.length).split('.')
  if (!payload || !mac || rest.length > 0) {
    return null
  }
  const expected = Buffer.from(sign(key, payload))
  const provided = Buffer.from(mac)
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return null
  }
  let claims: { i?: unknown, s?: unknown, t?: unknown, e?: unknown }
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (typeof claims.i !== 'string' || typeof claims.s !== 'string' || (claims.t !== null && typeof claims.t !== 'string')
    || typeof claims.e !== 'number' || claims.e <= now) {
    return null
  }
  return { installationId: claims.i, sessionId: claims.s, targetId: claims.t, expiresAt: claims.e }
}
