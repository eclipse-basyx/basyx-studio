import type { AppContributions } from '#shared/contract'
import { contributionsFor } from '~~/server/lib/apps/contributions'
import { listInstallations } from '~~/server/lib/apps/store'
import { requireAppsBaseUrl } from '~~/server/utils/apps'
import { requireActor } from '~~/server/utils/auth'
import { defineStudioHandler, queryValidated } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'
import { appContributionsQuerySchema } from '#shared/contract'

/** Modules of the installed apps, and the submodel views for a semantic ID. */
export default defineStudioHandler(async (event): Promise<AppContributions> => {
  await requireActor(event)
  const { semanticId } = queryValidated(event, appContributionsQuerySchema)
  const studio = await useStudio()
  if (!studio.config.apps.baseUrl) {
    return { submodelViews: [], modules: [] }
  }
  return contributionsFor(await listInstallations(studio), requireAppsBaseUrl(studio), semanticId)
})
