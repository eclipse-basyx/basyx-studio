import type { BrandingAssetSlot } from '#shared/branding'
import { createError, defineEventHandler, getQuery, getRouterParam } from 'nuxt/server'
import { readBrandingAsset } from '~~/server/lib/branding'
import { useStudio } from '~~/server/utils/studio'
import { brandingAssetSlots } from '#shared/branding'

/**
 * The brand's files (ADR 0055): logos, favicon and font, from mounted files,
 * the branding file or administrators' uploads. An SVG opened directly runs
 * no script on Studio's origin: the policy sandboxes it.
 */
export default defineEventHandler(async event => {
  const studio = await useStudio()
  const slot = getRouterParam(event, 'file') ?? ''
  if (!(brandingAssetSlots as readonly string[]).includes(slot)) {
    throw createError({ status: 404, statusText: 'Not Found' })
  }
  const resolved = await readBrandingAsset(studio, slot as BrandingAssetSlot)
  if (!resolved) {
    throw createError({ status: 404, statusText: 'Not Found' })
  }
  const headers = event.res.headers
  headers.set('Content-Type', resolved.contentType)
  headers.set('Content-Security-Policy', 'default-src \'none\'; style-src \'unsafe-inline\'; sandbox')
  headers.set('X-Content-Type-Options', 'nosniff')
  // The context names each file with its version, so a versioned URL never changes.
  headers.set('Cache-Control', getQuery(event).v === resolved.version ? 'public, max-age=31536000, immutable' : 'public, max-age=300')
  const { bytes } = resolved
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
})
