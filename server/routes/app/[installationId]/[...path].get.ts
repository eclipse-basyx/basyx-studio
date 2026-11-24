import { createError, defineEventHandler, getQuery, getRequestHost, getRouterParam } from 'nuxt/server'
import { appContentSecurityPolicy } from '~~/server/lib/apps/csp'
import { verifyEmbedToken } from '~~/server/lib/apps/embeds'
import { appBaseUrl, appsHostOf, coversStudioOrigin, hasInstallationOrigins, installationOriginsSource } from '~~/server/lib/apps/origins'
import { isInstallationId, readAppFile } from '~~/server/lib/apps/store'
import { readBrandingAsset } from '~~/server/lib/branding'
import { allowedOrigins } from '~~/server/lib/urls'
import { hasBrokerSecret } from '~~/server/utils/desktop'
import { useStudio } from '~~/server/utils/studio'
import { appBrandFontPath } from '#shared/branding'
import { embedTokenParameter } from '#shared/contract'

/**
 * Serves the files of installed apps (ADR 0017). Hosted, only on the apps
 * origin, and with one origin per installation only on the installation's
 * own (ADR 0045). On desktop, only to the Electron main process, which
 * serves them to the renderer under the `studio-app:` protocol. A view's
 * entry with Studio's embed token may be framed by the embedding app's
 * origin as well (ADR 0051).
 */
export default defineEventHandler(async event => {
  const studio = await useStudio()
  const { baseUrl } = studio.config.apps
  const desktop = studio.config.deploymentMode === 'desktop'
  const installationId = getRouterParam(event, 'installationId') ?? ''
  const path = getRouterParam(event, 'path', { decode: true }) ?? ''
  const host = baseUrl === null || desktop ? null : appsHostOf(baseUrl, getRequestHost(event))
  const allowed = baseUrl !== null && (desktop ? hasBrokerSecret(event) : host !== null && (host.installationId === null || host.installationId === installationId))
  // Fonts use the existing app file origin and policy on web and desktop.
  // They are public and carry no cookies, like app package files.
  const version = getQuery(event).v
  if (allowed && isInstallationId(installationId) && path === appBrandFontPath && typeof version === 'string' && /^[a-f0-9]{12}$/.test(version)) {
    const font = await readBrandingAsset(studio, 'font', version)
    if (!font) {
      throw createError({ status: 404, statusText: 'Not Found' })
    }
    const headers = event.res.headers
    headers.set('Content-Type', font.contentType)
    headers.set('X-Content-Type-Options', 'nosniff')
    headers.set('Access-Control-Allow-Origin', '*')
    headers.set('Cross-Origin-Resource-Policy', 'cross-origin')
    headers.set('Cache-Control', 'public, max-age=31536000, immutable')
    const { bytes } = font
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }
  const file = allowed ? await readAppFile(studio, installationId, path) : null
  if (!file) {
    throw createError({ status: 404, statusText: 'Not Found' })
  }
  const studioOrigins = allowedOrigins(studio.config.publicUrl, desktop)
  const embedToken = getQuery(event)[embedTokenParameter]
  const embed = typeof embedToken === 'string' && !desktop ? verifyEmbedToken(studio.embedKey, embedToken) : null
  const frameAncestors = embed && embed.installationId === installationId && embed.path === path ? [...studioOrigins, embed.embedderOrigin] : studioOrigins
  const headers = event.res.headers
  headers.set('Content-Type', file.contentType)
  headers.set('Content-Security-Policy', appContentSecurityPolicy(appBaseUrl(baseUrl!, installationId), frameAncestors, file.sandbox, {
    sameOrigin: hasInstallationOrigins(baseUrl!),
    // Refused at install; dropped here too, in case Studio's URLs changed since.
    excludeOrigin: entry => coversStudioOrigin(entry, studioOrigins, baseUrl),
    viewOrigins: file.embedsViews && !desktop ? installationOriginsSource(baseUrl!) : null,
  }))
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Referrer-Policy', 'no-referrer')
  if (!desktop) {
    // Sandboxed documents cannot set document.domain; this keeps it so. Not
    // under studio-app:, where the header makes Electron 44 stop.
    headers.set('Origin-Agent-Cluster', '?1')
  }
  // With a shared apps origin the frame is opaque, so module scripts are
  // CORS requests with `Origin: null`; Studio's page reads entries to tell
  // why a frame did not start. App files are not secret and carry no cookies.
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin')
  headers.set('Cache-Control', 'no-cache')
  headers.set('ETag', `"${file.digest}"`)
  return file.content
})
