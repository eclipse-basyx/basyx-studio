import type { AppInstallation } from '#shared/contract'
import { getInstallation, toAppInstallation } from '~~/server/lib/apps/store'
import { requireActor } from '~~/server/utils/auth'
import { defineStudioHandler, routeParam } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'

export default defineStudioHandler(async (event): Promise<AppInstallation> => {
  await requireActor(event)
  return toAppInstallation(await getInstallation(await useStudio(), routeParam(event, 'installationId')))
})
