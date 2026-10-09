import type { AppInstallation } from '#shared/contract'
import { getRequestHeader, setResponseStatus } from 'nuxt/server'
import { appArchiveLimits } from '~~/server/lib/apps/package'
import { installApp, toAppInstallation } from '~~/server/lib/apps/store'
import { StudioProblem } from '~~/server/lib/problem'
import { requireAdmin, requireCsrf } from '~~/server/utils/auth'
import { defineStudioHandler, requestIdOf } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'

/** Installs an app package (developer mode): the body is the ZIP file. */
export default defineStudioHandler(async (event): Promise<AppInstallation> => {
  const actor = await requireAdmin(event)
  await requireCsrf(event)
  const declared = Number(getRequestHeader(event, 'content-length') ?? 0)
  if (declared > appArchiveLimits.maxArchiveBytes) {
    throw new StudioProblem('app_package_rejected', 'The package is larger than 20 MiB.', { violations: [{ path: '(archive)', message: 'is larger than 20 MiB' }] })
  }
  const bytes = new Uint8Array(await event.req.arrayBuffer())
  if (bytes.length === 0) {
    throw new StudioProblem('invalid_request', 'The request body must be the app package (ZIP).')
  }
  const record = await installApp(await useStudio(), actor, bytes, requestIdOf(event))
  setResponseStatus(event, 201)
  return toAppInstallation(record)
})
