import type { Target } from '#shared/contract'
import { setResponseStatus } from 'nuxt/server'
import { z } from 'zod'
import { toWorkspaceTarget } from '~~/server/lib/workspaces/manager'
import { requireActor, requireCsrf } from '~~/server/utils/auth'
import { requireWorkspaces } from '~~/server/utils/desktop'
import { defineStudioHandler, readValidated } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'
import { newWorkspaceInputSchema, openWorkspaceInputSchema } from '#shared/contract'

/** Opens the AASX package behind a file handle as a workspace target. */
export default defineStudioHandler(async (event): Promise<Target> => {
  await requireActor(event)
  await requireCsrf(event)
  const workspaces = requireWorkspaces(await useStudio())
  const body = await readValidated(event, z.union([openWorkspaceInputSchema, newWorkspaceInputSchema]))
  const info = 'empty' in body ? await workspaces.create() : await workspaces.open(body.fileHandle)
  setResponseStatus(event, 201)
  return toWorkspaceTarget(info)
})
