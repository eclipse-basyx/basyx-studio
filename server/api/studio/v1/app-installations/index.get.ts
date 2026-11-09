import type { AppInstallationList } from '#shared/contract'
import { hasInstallationOrigins } from '~~/server/lib/apps/origins'
import { describeInstallation, listInstallations } from '~~/server/lib/apps/store'
import { requireActor } from '~~/server/utils/auth'
import { defineStudioHandler } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'

export default defineStudioHandler(async (event): Promise<AppInstallationList> => {
  await requireActor(event)
  const studio = await useStudio()
  const { trustStore } = studio.config.apps
  return {
    items: await Promise.all((await listInstallations(studio)).filter(record => !record.preview).map(record => describeInstallation(studio, record))),
    enabled: studio.config.apps.baseUrl !== null,
    allowUnsigned: studio.config.apps.allowUnsigned,
    trustedPublishers: trustStore.publishers.map(publisher => publisher.name),
    installationOrigins: studio.config.apps.baseUrl !== null && hasInstallationOrigins(studio.config.apps.baseUrl),
  }
})
