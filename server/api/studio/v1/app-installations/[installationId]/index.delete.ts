import { setResponseStatus } from 'nuxt/server'
import { uninstallApp } from '~~/server/lib/apps/store'
import { requireAdmin, requireCsrf } from '~~/server/utils/auth'
import { defineStudioHandler, requestIdOf, routeParam } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'

/** Uninstalls an app and stops its backend. Open frames lose access on their next call. */
export default defineStudioHandler(async (event): Promise<null> => {
  const actor = await requireAdmin(event)
  await requireCsrf(event)
  const studio = await useStudio()
  const record = await uninstallApp(studio, actor, routeParam(event, 'installationId'), requestIdOf(event))
  await studio.backends?.stop(record.id)
  setResponseStatus(event, 204)
  return null
})
