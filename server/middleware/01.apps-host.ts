import { createError, defineEventHandler, getRequestHost } from 'nuxt/server'
import { useStudio } from '../utils/studio'

/**
 * The apps origin serves app files only (ADR 0017): never Studio pages or
 * the Studio API, so app code cannot reach them as same-origin requests.
 */
export default defineEventHandler(async event => {
  const studio = await useStudio()
  const { baseUrl } = studio.config.apps
  if (!baseUrl || studio.config.deploymentMode === 'desktop' || event.url.pathname.startsWith('/app/')) {
    return
  }
  if (getRequestHost(event) === new URL(baseUrl).host) {
    throw createError({ status: 404, statusText: 'Not Found' })
  }
})
