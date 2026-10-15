import type { Target } from '#shared/contract'
import { StudioProblem } from '~~/server/lib/problem'
import { isWorkspaceId, toWorkspaceTarget } from '~~/server/lib/workspaces/manager'
import { requireActor, requireCsrf } from '~~/server/utils/auth'
import { requireWorkspaces } from '~~/server/utils/desktop'
import { defineStudioHandler, routeParam } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'

/** Applies the change that was taken back last, until Save or Close (W8). */
export default defineStudioHandler(async (event): Promise<Target> => {
  await requireActor(event)
  await requireCsrf(event)
  const workspaceId = routeParam(event, 'workspaceId')
  if (!isWorkspaceId(workspaceId)) {
    throw new StudioProblem('not_found')
  }
  const workspaces = requireWorkspaces(await useStudio())
  await workspaces.target(workspaceId).redo()
  return toWorkspaceTarget(await workspaces.info(workspaceId))
})
