import type { AppInstallation } from '#shared/contract'
import { listInstallations, toAppInstallation } from '~~/server/lib/apps/store'
import { requireActor } from '~~/server/utils/auth'
import { defineStudioHandler } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'

export default defineStudioHandler(async (event): Promise<{ items: AppInstallation[], allowUnsigned: boolean, enabled: boolean }> => {
  await requireActor(event)
  const studio = await useStudio()
  return {
    items: (await listInstallations(studio)).map(record => toAppInstallation(record)),
    enabled: studio.config.apps.baseUrl !== null,
    allowUnsigned: studio.config.apps.allowUnsigned,
  }
})
