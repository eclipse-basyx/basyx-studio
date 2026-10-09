import { createError, defineEventHandler, getRequestHost, getRouterParam } from 'nuxt/server'
import { appFileUrl } from '~~/server/lib/apps/contributions'
import { appContentSecurityPolicy } from '~~/server/lib/apps/csp'
import { readAppFile } from '~~/server/lib/apps/store'
import { hasBrokerSecret } from '~~/server/utils/desktop'
import { allowedOrigins } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'

/**
 * Serves the files of installed apps (ADR 0017). Hosted, only on the apps
 * origin. On desktop, only to the Electron main process, which serves them
 * to the renderer under the `studio-app:` protocol.
 */
export default defineEventHandler(async event => {
  const studio = await useStudio()
  const { baseUrl } = studio.config.apps
  const desktop = studio.config.deploymentMode === 'desktop'
  const allowed = baseUrl !== null && (desktop ? hasBrokerSecret(event) : getRequestHost(event) === new URL(baseUrl).host)
  const installationId = getRouterParam(event, 'installationId') ?? ''
  const path = getRouterParam(event, 'path', { decode: true }) ?? ''
  const file = allowed ? await readAppFile(studio, installationId, path) : null
  if (!file) {
    throw createError({ status: 404, statusText: 'Not Found' })
  }
  const headers = event.res.headers
  headers.set('Content-Type', file.contentType)
  headers.set('Content-Security-Policy', appContentSecurityPolicy(appFileUrl(baseUrl!, installationId, ''), allowedOrigins(studio.config.publicUrl, desktop)))
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Referrer-Policy', 'no-referrer')
  // The frame has an opaque origin, so module scripts are CORS requests
  // with `Origin: null`. App files are not secret and carry no cookies.
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin')
  headers.set('Cache-Control', 'no-cache')
  headers.set('ETag', `"${file.digest}"`)
  return file.content
})
