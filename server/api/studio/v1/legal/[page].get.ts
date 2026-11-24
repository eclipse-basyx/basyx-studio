import type { LegalPage } from '#shared/branding'
import { getQuery } from 'nuxt/server'
import { resolveBranding } from '~~/server/lib/branding'
import { StudioProblem } from '~~/server/lib/problem'
import { defineStudioHandler, routeParam } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'
import { legalPages, pickLocalized } from '#shared/branding'

/**
 * A legal page's Markdown in a language (`?language=de`), else the closest
 * one (ADR 0055). Public: the imprint and the privacy policy must be
 * readable before signing in.
 */
export default defineStudioHandler(async (event): Promise<{ page: LegalPage, markdown: string | null, url: string | null }> => {
  const page = routeParam(event, 'page')
  if (!(legalPages as readonly string[]).includes(page)) {
    throw new StudioProblem('not_found', `There is no legal page ${page}.`)
  }
  const language = String(getQuery(event).language ?? 'en').slice(0, 20)
  const { settings } = await resolveBranding(await useStudio())
  const entry = pickLocalized(settings.legal?.[page as LegalPage], language, settings.uiLanguage)
  if (!entry) {
    throw new StudioProblem('not_found', 'This deployment has no such page.')
  }
  return { page: page as LegalPage, markdown: 'markdown' in entry ? entry.markdown : null, url: 'url' in entry ? entry.url : null }
})
