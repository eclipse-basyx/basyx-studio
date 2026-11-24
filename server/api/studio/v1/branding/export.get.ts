import { resolveBrandingForExport } from '~~/server/lib/branding'
import { exportBrandingArchive } from '~~/server/lib/branding/archive'
import { requireAdmin } from '~~/server/utils/auth'
import { defineStudioHandler } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'

/**
 * The branding in effect as a ZIP archive: `branding.yml` and its files, to
 * roll out with STUDIO_BRANDING_FILE or import elsewhere (ADR 0055).
 */
export default defineStudioHandler(async (event): Promise<Buffer> => {
  await requireAdmin(event)
  const archive = exportBrandingArchive(await resolveBrandingForExport(await useStudio()))
  event.res.headers.set('Content-Type', 'application/zip')
  event.res.headers.set('Content-Disposition', 'attachment; filename="branding.zip"')
  return Buffer.from(archive.buffer, archive.byteOffset, archive.byteLength)
})
