import type { Preferences } from '#shared/contract'
import { preferencePolicy, resolveBranding } from '~~/server/lib/branding'
import { getPreferences } from '~~/server/lib/preferences'
import { requireActor } from '~~/server/utils/auth'
import { defineStudioHandler } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'

/** The user's preferences in effect, with the deployment's defaults and locks (ADR 0055). */
export default defineStudioHandler(async (event): Promise<Preferences> => {
  const actor = await requireActor(event)
  const studio = await useStudio()
  return getPreferences(studio, actor.subject, preferencePolicy((await resolveBranding(studio)).settings))
})
