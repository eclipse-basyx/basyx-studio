import type { StudioContext } from '#shared/contract'
import { useRuntimeConfig } from 'nuxt/server'
import { brandingContext, resolveBranding } from '~~/server/lib/branding'
import { defineStudioHandler } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'

export default defineStudioHandler(async (): Promise<StudioContext> => {
  const studio = await useStudio()
  const { version, commit, buildDate } = useRuntimeConfig().studio as { version: string, commit: string, buildDate: string }
  const { deployment } = studio.config
  // Environment, branding file and administrators' branding (ADR 0055).
  const { productName, branding, legal } = brandingContext(await resolveBranding(studio))
  return {
    apiVersion: '1',
    deploymentMode: studio.config.deploymentMode,
    loginRequired: studio.config.login !== null,
    anonymous: studio.config.anonymous !== null,
    infrastructuresEditable: studio.config.infrastructuresEditable,
    brandingEditable: studio.config.branding.editable,
    product: { name: productName ?? 'BaSyx Studio', version, commit: commit || null, buildDate: buildDate || null },
    branding,
    legal,
    features: { readOnly: deployment.readOnly, uploads: deployment.uploads, appInstalls: deployment.appInstalls },
  }
})
