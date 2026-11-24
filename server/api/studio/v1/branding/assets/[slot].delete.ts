import type { BrandingAdminView, BrandingAssetSlot } from '#shared/branding'
import { recordAudit } from '~~/server/lib/audit'
import { brandingAdminView, deleteAdminAsset } from '~~/server/lib/branding'
import { StudioProblem } from '~~/server/lib/problem'
import { requireAdmin, requireCsrf } from '~~/server/utils/auth'
import { defineStudioHandler, requestIdOf, routeParam } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'
import { brandingAssetSlots } from '#shared/branding'

/** Removes an uploaded logo, favicon or font; the deployment's or BaSyx's applies again. */
export default defineStudioHandler(async (event): Promise<BrandingAdminView> => {
  const actor = await requireAdmin(event)
  await requireCsrf(event)
  const slot = routeParam(event, 'slot')
  if (!(brandingAssetSlots as readonly string[]).includes(slot)) {
    throw new StudioProblem('not_found', `There is no branding file ${slot}.`)
  }
  const studio = await useStudio()
  await deleteAdminAsset(studio, slot as BrandingAssetSlot)
  await recordAudit(studio, { action: 'branding.asset.delete', outcome: 'success', requestId: requestIdOf(event), actorSubject: actor.subject, details: { slot } })
  return brandingAdminView(studio)
})
