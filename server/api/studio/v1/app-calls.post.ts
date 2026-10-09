import type { AppCallResult } from '#shared/contract'
import type { AppCall } from '~~/server/utils/apps'
import { getRequestHeader } from 'nuxt/server'
import { getInstallation } from '~~/server/lib/apps/store'
import { capabilityTokenPrefix, verifyCapabilityToken } from '~~/server/lib/apps/tokens'
import { StudioProblem } from '~~/server/lib/problem'
import { findSessionById } from '~~/server/lib/sessions'
import { performAppCall } from '~~/server/utils/apps'
import { actorOf, requireActor, requireCsrf } from '~~/server/utils/auth'
import { defineStudioHandler, readValidated, rejectCrossOrigin } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'
import { appCallInputSchema } from '#shared/contract'

/**
 * A capability call (ADR 0018), either from the host bridge on behalf of an
 * app frame (session cookie, Origin and CSRF checks) or from a backend app
 * (short-lived capability token, which also fixes installation, user and
 * target).
 */
export default defineStudioHandler(async (event): Promise<AppCallResult> => {
  const studio = await useStudio()
  const authorization = getRequestHeader(event, 'authorization') ?? ''
  let call: AppCall

  if (authorization.startsWith(`Bearer ${capabilityTokenPrefix}`)) {
    const claims = verifyCapabilityToken(studio.capabilityKey, authorization.slice('Bearer '.length))
    if (!claims) {
      throw new StudioProblem('unauthenticated', 'The capability token is invalid or expired.')
    }
    const session = await findSessionById(studio, claims.sessionId)
    if (!session || (session.expiresAt && session.expiresAt <= new Date())) {
      throw new StudioProblem('unauthenticated', 'The session behind the capability token has ended.')
    }
    const input = await readValidated(event, appCallInputSchema)
    call = {
      caller: 'backend',
      actor: actorOf(session, studio.config.adminRole),
      installation: await getInstallation(studio, claims.installationId),
      targetId: claims.targetId,
      method: input.method,
      params: input.params,
    }
  } else {
    await rejectCrossOrigin(event)
    const actor = await requireActor(event)
    await requireCsrf(event)
    const input = await readValidated(event, appCallInputSchema)
    if (!input.installationId) {
      throw new StudioProblem('invalid_request', 'installationId is required.')
    }
    call = {
      caller: 'host',
      actor,
      installation: await getInstallation(studio, input.installationId),
      targetId: input.targetId ?? null,
      method: input.method,
      params: input.params,
    }
  }

  return { result: await performAppCall(event, call) }
}, { originCheck: false })
