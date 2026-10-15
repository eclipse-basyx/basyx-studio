import type { Target } from '#shared/contract'
import { getInfrastructure } from '~~/server/lib/infrastructures'
import { isWorkspaceId, toWorkspaceTarget } from '~~/server/lib/workspaces/manager'
import { requireActor } from '~~/server/utils/auth'
import { requireWorkspaces } from '~~/server/utils/desktop'
import { defineStudioHandler, routeParam } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'
import { toTarget } from '~~/server/utils/target'

/**
 * One target with its capabilities. Opening a target checks its stored
 * authorization (refreshing it if needed); the target list does not.
 */
export default defineStudioHandler(async (event): Promise<Target> => {
  const actor = await requireActor(event)
  const studio = await useStudio()
  const targetId = routeParam(event, 'targetId')
  if (isWorkspaceId(targetId)) {
    return toWorkspaceTarget(await requireWorkspaces(studio).info(targetId))
  }
  const record = await getInfrastructure(studio, targetId)
  return toTarget(record, await studio.broker.verifiedAuthenticationState(record, actor.sessionId))
})
