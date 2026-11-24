import type { BrandingAdminView } from '#shared/branding'
import { readBody } from 'nuxt/server'
import { recordAudit } from '~~/server/lib/audit'
import { brandingAdminView, saveAdminSettings } from '~~/server/lib/branding'
import { StudioProblem } from '~~/server/lib/problem'
import { requireAdmin, requireCsrf } from '~~/server/utils/auth'
import { defineStudioHandler, requestIdOf } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'

/** Replaces the branding settings administrators set; files are uploaded apart (ADR 0055). */
export default defineStudioHandler(async (event): Promise<BrandingAdminView> => {
  const actor = await requireAdmin(event)
  await requireCsrf(event)
  const body = await readBody(event).catch(() => {
    throw new StudioProblem('invalid_request', 'The request body is not valid JSON.')
  })
  const studio = await useStudio()
  const settings = await saveAdminSettings(studio, body, actor.subject)
  await recordAudit(studio, { action: 'branding.update', outcome: 'success', requestId: requestIdOf(event), actorSubject: actor.subject, details: { fields: Object.keys(settings) } })
  return brandingAdminView(studio)
})
