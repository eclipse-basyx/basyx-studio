import type { Preferences } from '#shared/contract'
import { readBody } from 'nuxt/server'
import { preferencePolicy, resolveBranding } from '~~/server/lib/branding'
import { savePreferences } from '~~/server/lib/preferences'
import { StudioProblem } from '~~/server/lib/problem'
import { requireActor, requireCsrf } from '~~/server/utils/auth'
import { defineStudioHandler } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'

/**
 * Replaces the signed-in user's preferences (validated in `savePreferences`).
 * Settings the deployment locks keep its value, whatever the request says (ADR 0055).
 */
export default defineStudioHandler(async (event): Promise<Preferences> => {
  const actor = await requireActor(event)
  await requireCsrf(event)
  const body = await readBody(event).catch(() => {
    throw new StudioProblem('invalid_request', 'The request body is not valid JSON.')
  })
  const studio = await useStudio()
  return savePreferences(studio, actor.subject, body, preferencePolicy((await resolveBranding(studio)).settings))
})
