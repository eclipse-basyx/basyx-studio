import type { Actor } from '../lib/deps'
import type { SessionRecord } from '../lib/sessions'
import type { RequestEvent } from 'nuxt/server'
import { timingSafeEqual } from 'node:crypto'
import { getCookie, getRequestHeader } from 'nuxt/server'
import { StudioProblem } from '../lib/problem'
import { desktopSessionId, findSession, findSessionById } from '../lib/sessions'
import { useStudio } from './studio'

export function sessionCookieName (secure: boolean): string {
  // The __Host- prefix pins the cookie to this origin, but requires HTTPS.
  return secure ? '__Host-studio_session' : 'studio_session'
}

export interface ResolvedSession {
  actor: Actor
  session: SessionRecord
}

export function actorOf (session: SessionRecord, adminRole: string): Actor {
  return {
    subject: session.subject,
    name: session.displayName,
    roles: session.roles,
    isAdmin: session.roles.includes(adminRole),
    sessionId: session.id,
  }
}

async function resolveSession (event: RequestEvent): Promise<ResolvedSession | null> {
  if (event.context.studioSession !== undefined) {
    return event.context.studioSession
  }
  const studio = await useStudio()
  let session: SessionRecord | undefined
  if (studio.config.deploymentMode === 'desktop') {
    // The renderer is authenticated by the launch secret; it acts as the local user.
    session = await findSessionById(studio, desktopSessionId)
  } else {
    const token = getCookie(event, sessionCookieName(studio.config.secureCookies))
    session = token ? await findSession(studio, token) : undefined
  }
  const resolved = session ? { session, actor: actorOf(session, studio.config.adminRole) } : null
  event.context.studioSession = resolved
  return resolved
}

export async function currentSession (event: RequestEvent): Promise<ResolvedSession | null> {
  return resolveSession(event)
}

export async function requireActor (event: RequestEvent): Promise<Actor> {
  const resolved = await resolveSession(event)
  if (!resolved) {
    throw new StudioProblem('unauthenticated')
  }
  return resolved.actor
}

export async function requireAdmin (event: RequestEvent): Promise<Actor> {
  const actor = await requireActor(event)
  if (!actor.isAdmin) {
    throw new StudioProblem('forbidden', 'Studio administrator role required.')
  }
  return actor
}

/** Double-submit check for state-changing requests that act on a session. */
export async function requireCsrf (event: RequestEvent): Promise<void> {
  const resolved = await resolveSession(event)
  const provided = getRequestHeader(event, 'x-csrf-token') ?? ''
  const expected = resolved?.session.csrfToken ?? ''
  const providedBytes = Buffer.from(provided)
  const expectedBytes = Buffer.from(expected)
  if (!expected || providedBytes.length !== expectedBytes.length || !timingSafeEqual(providedBytes, expectedBytes)) {
    throw new StudioProblem('csrf_rejected')
  }
}
