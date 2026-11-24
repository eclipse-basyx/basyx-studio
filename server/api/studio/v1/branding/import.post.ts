import type { BrandingAdminView } from '#shared/branding'
import { getRequestHeader } from 'nuxt/server'
import { recordAudit } from '~~/server/lib/audit'
import { brandingAdminView, replaceAdminBranding } from '~~/server/lib/branding'
import { importBrandingArchive } from '~~/server/lib/branding/archive'
import { BrandingFileError } from '~~/server/lib/branding/file'
import { StudioProblem } from '~~/server/lib/problem'
import { requireAdmin, requireCsrf } from '~~/server/utils/auth'
import { defineStudioHandler, requestIdOf } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'

const maxArchiveBytes = 20 * 1024 * 1024

/** Replaces the administrators' branding with an archive from the export (ADR 0055); the body is the ZIP file. */
export default defineStudioHandler(async (event): Promise<BrandingAdminView> => {
  const actor = await requireAdmin(event)
  await requireCsrf(event)
  if (Number(getRequestHeader(event, 'content-length') ?? 0) > maxArchiveBytes) {
    throw new StudioProblem('invalid_request', 'The archive is larger than 20 MB.')
  }
  const bytes = new Uint8Array(await event.req.arrayBuffer())
  let layer
  try {
    layer = importBrandingArchive(bytes)
  } catch (error) {
    if (error instanceof BrandingFileError) {
      throw new StudioProblem('invalid_request', error.message)
    }
    throw error
  }
  const studio = await useStudio()
  await replaceAdminBranding(studio, layer, actor.subject)
  await recordAudit(studio, { action: 'branding.import', outcome: 'success', requestId: requestIdOf(event), actorSubject: actor.subject, details: { fields: Object.keys(layer.settings), files: Object.keys(layer.assets) } })
  return brandingAdminView(studio)
})
