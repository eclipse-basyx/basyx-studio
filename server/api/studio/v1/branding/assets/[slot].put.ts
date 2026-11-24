import type { BrandingAdminView, BrandingAssetSlot } from '#shared/branding'
import { getRequestHeader } from 'nuxt/server'
import { recordAudit } from '~~/server/lib/audit'
import { brandingAdminView, saveAdminAsset } from '~~/server/lib/branding'
import { StudioProblem } from '~~/server/lib/problem'
import { requireAdmin, requireCsrf } from '~~/server/utils/auth'
import { defineStudioHandler, requestIdOf, routeParam } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'
import { brandingAssetMaxBytes, brandingAssetSlots } from '#shared/branding'

/** Uploads a logo, the favicon or the font: the body is the file, its Content-Type the file's type (ADR 0055). */
export default defineStudioHandler(async (event): Promise<BrandingAdminView> => {
  const actor = await requireAdmin(event)
  await requireCsrf(event)
  const slot = routeParam(event, 'slot')
  if (!(brandingAssetSlots as readonly string[]).includes(slot)) {
    throw new StudioProblem('not_found', `There is no branding file ${slot}.`)
  }
  if (Number(getRequestHeader(event, 'content-length') ?? 0) > brandingAssetMaxBytes) {
    throw new StudioProblem('invalid_request', `The file is larger than ${brandingAssetMaxBytes / 1024 / 1024} MB.`)
  }
  const bytes = new Uint8Array(await event.req.arrayBuffer())
  const studio = await useStudio()
  await saveAdminAsset(studio, slot as BrandingAssetSlot, bytes, getRequestHeader(event, 'content-type'), actor.subject)
  await recordAudit(studio, { action: 'branding.asset.upload', outcome: 'success', requestId: requestIdOf(event), actorSubject: actor.subject, details: { slot, bytes: bytes.byteLength } })
  return brandingAdminView(studio)
})
