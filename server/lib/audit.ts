import type { StudioDeps } from './deps'
import { randomUUID } from 'node:crypto'
import { auditEvents } from '../database/schema'

export interface AuditEvent {
  action: string
  outcome: 'success' | 'failure'
  requestId?: string
  actorSubject?: string | null
  targetId?: string | null
  /** Identity the downstream service saw, e.g. the Studio client-credentials client. */
  downstreamIdentity?: string | null
  /** Sanitized details only: never tokens, secrets, request or response bodies. */
  details?: Record<string, unknown>
  /** The app installation on whose behalf the action ran (ADR 0018). */
  appInstallationId?: string | null
}

export async function recordAudit (deps: Pick<StudioDeps, 'db'>, event: AuditEvent): Promise<void> {
  await deps.db.insert(auditEvents).values({
    id: randomUUID(),
    requestId: event.requestId ?? null,
    actorSubject: event.actorSubject ?? null,
    action: event.action,
    targetId: event.targetId ?? null,
    downstreamIdentity: event.downstreamIdentity ?? null,
    outcome: event.outcome,
    details: event.details ?? {},
    appInstallationId: event.appInstallationId ?? null,
  })
}
