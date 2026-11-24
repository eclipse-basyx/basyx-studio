import type { BrandingAdminView } from '#shared/branding'
import { brandingAdminView } from '~~/server/lib/branding'
import { requireAdmin } from '~~/server/utils/auth'
import { defineStudioHandler } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'

/** The branding administrators set, what is in effect and where each value comes from (ADR 0055). */
export default defineStudioHandler(async (event): Promise<BrandingAdminView> => {
  await requireAdmin(event)
  return brandingAdminView(await useStudio())
})
