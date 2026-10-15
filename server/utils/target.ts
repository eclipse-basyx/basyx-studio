import type { IdScheme } from '#shared/aas/identifiers'
import type { AuthenticationState, Target } from '#shared/contract'
import type { SyncPlan } from '../lib/aas/sync'
import type { Actor } from '../lib/deps'
import type { InfrastructureRecord } from '../lib/infrastructures'
import type { AasTarget } from '../lib/targets/aas-target'
import type { RequestEvent } from 'nuxt/server'
import { defaultIdScheme, workspaceIdScheme } from '#shared/aas/identifiers'
import { serviceUrl } from '#shared/contract'
import { decodeKey } from '../lib/aas/keys'
import { syncPlan } from '../lib/aas/sync'
import { recordAudit } from '../lib/audit'
import { getInfrastructure, resolveClientCertificate, targetPolicy } from '../lib/infrastructures'
import { getPreferences } from '../lib/preferences'
import { StudioProblem } from '../lib/problem'
import { liveCapabilities } from '../lib/targets/capabilities'
import { LiveAasTarget } from '../lib/targets/live-target'
import { isWorkspaceId } from '../lib/workspaces/manager'
import { requireActor } from './auth'
import { requireWorkspaces } from './desktop'
import { requestIdOf, routeParam } from './handler'
import { useStudio } from './studio'

export interface OpenedTarget {
  actor: Actor
  target: AasTarget
  /** Records the outcome of a write in the audit log. */
  auditWrite: (outcome: 'success' | 'failure', details: Record<string, unknown>) => Promise<void>
  /** What Studio writes to registries and discovery after uploads and deletes, for this user (I5). */
  syncPlan: () => Promise<SyncPlan>
  /** How new shells and submodels get their identifiers (W5). */
  idScheme: IdScheme
}

/** Who opens which target, for what; the audit records come from this. */
export interface TargetAccess {
  actor: Actor
  targetId: string
  requestId: string
  /** The Studio route or capability method, for the audit log. */
  operation: string
  /** Reads of client-credentials targets are audited, because the target only sees Studio. */
  read: boolean
  /** Set when an app calls on the user's behalf (ADR 0018). */
  appInstallationId?: string
  /** The shell the request is about, if known: infrastructures with an AAS repository only reach submodels through it. */
  shellId?: string
}

/**
 * Opens a target for a user: a live infrastructure with the credentials of
 * this user and target, or a desktop workspace. Callers only see the
 * `AasTarget` interface.
 */
export async function openTargetFor (access: TargetAccess): Promise<OpenedTarget> {
  const { actor, targetId, requestId } = access
  const studio = await useStudio()
  const appInstallationId = access.appInstallationId ?? null

  if (isWorkspaceId(targetId)) {
    return {
      actor,
      target: requireWorkspaces(studio).target(targetId),
      syncPlan: async () => ({ registry: false, discovery: false }),
      idScheme: workspaceIdScheme,
      auditWrite: (outcome, details) => recordAudit(studio, {
        action: 'workspace.write',
        outcome,
        requestId,
        actorSubject: actor.subject,
        targetId,
        appInstallationId,
        details,
      }),
    }
  }

  const record = await getInfrastructure(studio, targetId)
  const grant = await studio.broker.access(record, actor.sessionId)
  const audit = (action: string, outcome: 'success' | 'failure', details: Record<string, unknown>) => recordAudit(studio, {
    action,
    outcome,
    requestId,
    actorSubject: actor.subject,
    targetId: record.id,
    downstreamIdentity: grant.downstreamIdentity,
    appInstallationId,
    details: { route: access.operation, ...details },
  })

  if (access.read && record.security.mode === 'deployment_client_credentials') {
    // The target only sees Studio's identity, so Studio records who read.
    await audit('target.read', 'success', {})
  }

  const target = new LiveAasTarget({
    record,
    access: grant,
    policy: targetPolicy(studio, record, await resolveClientCertificate(studio, record)),
    requestId,
    onUnauthorized: () => studio.broker.invalidate(record, actor.sessionId),
    shellContext: access.shellId,
  })
  return {
    actor,
    auditWrite: (outcome, details) => audit('target.write', outcome, details),
    target,
    syncPlan: async () => syncPlan(record, (await getPreferences(studio, actor.subject)).syncOverrides[record.id]),
    idScheme: { type: record.sync.idScheme ?? 'iri', prefix: record.sync.idPrefix ?? defaultIdScheme.prefix },
  }
}

/** The shell named by the `shell` query parameter (a shell key), if any. */
function shellOf (event: RequestEvent): string | undefined {
  const key = event.url.searchParams.get('shell')
  return key ? decodeKey(key, 'shell key') : undefined
}

/** Opens the target of the `targetId` route parameter for the signed-in user. */
export async function openTarget (event: RequestEvent): Promise<OpenedTarget> {
  return openTargetFor({
    actor: await requireActor(event),
    targetId: routeParam(event, 'targetId'),
    requestId: requestIdOf(event),
    operation: event.url.pathname,
    read: event.req.method === 'GET',
    shellId: shellOf(event),
  })
}

export function toTarget (record: InfrastructureRecord, authenticationState: AuthenticationState): Target {
  return {
    id: record.id,
    kind: 'live',
    name: record.name,
    description: record.description,
    securityMode: record.security.mode,
    authenticationState,
    capabilities: liveCapabilities(record),
    workspace: null,
    registrySync: studioSyncs(record) ? { studioDefault: record.sync.studioDefault, userOverride: record.sync.userOverride } : null,
  }
}

/** Whether Studio, not the server, keeps a registry or the discovery in step (I5). */
function studioSyncs (record: InfrastructureRecord): boolean {
  return (!record.sync.serverSyncsRegistry && serviceUrl(record, 'aasRegistry') !== undefined)
    || (!record.sync.serverSyncsDiscovery && serviceUrl(record, 'aasDiscovery') !== undefined)
}

type FlagCapability = Exclude<keyof Target['capabilities'], 'persistence' | 'search'>

/** Fails unless the target supports a capability, before any downstream request. */
export async function requireCapability (opened: OpenedTarget, capability: FlagCapability): Promise<void> {
  if (!opened.target.capabilities[capability]) {
    throw new StudioProblem('unsupported_operation', 'This target does not support this operation.')
  }
}
