import { timingSafeEqual } from 'node:crypto'
import { createError, defineEventHandler, getRequestHeader } from 'nuxt/server'
import { apiBasePath } from '#shared/contract'
import { capabilityTokenPrefix } from '../lib/apps/tokens'
import { callbackPath } from '../lib/urls'

const launchSecretHeader = 'x-studio-launch-secret'
const appCallsPath = `${apiBasePath}/app-calls`

export default defineEventHandler(event => {
  const expected = process.env.STUDIO_LAUNCH_SECRET
  if (!expected) {
    return
  }

  // The OIDC callback reaches the desktop service from the system browser,
  // which cannot know the launch secret. It is authenticated by its
  // single-use, server-side `state` instead.
  if (event.req.method === 'GET' && event.url.pathname === callbackPath) {
    return
  }

  // Backend apps run in Deno and know only their capability token, which the
  // handler verifies (ADR 0019).
  if (event.req.method === 'POST' && event.url.pathname === appCallsPath
    && getRequestHeader(event, 'authorization')?.startsWith(`Bearer ${capabilityTokenPrefix}`)) {
    return
  }

  const provided = getRequestHeader(event, launchSecretHeader)
  const expectedBytes = Buffer.from(expected)
  const providedBytes = Buffer.from(provided ?? '')

  if (
    expectedBytes.length !== providedBytes.length
    || !timingSafeEqual(expectedBytes, providedBytes)
  ) {
    throw createError({ status: 401, statusText: 'Unauthorized' })
  }
})
