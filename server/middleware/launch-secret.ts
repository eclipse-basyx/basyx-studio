import { timingSafeEqual } from 'node:crypto'

const launchSecretHeader = 'x-studio-launch-secret'

export default defineEventHandler((event) => {
  const expected = process.env.STUDIO_LAUNCH_SECRET
  if (!expected) {
    return
  }

  const provided = getHeader(event, launchSecretHeader)
  const expectedBytes = Buffer.from(expected)
  const providedBytes = Buffer.from(provided ?? '')

  if (
    expectedBytes.length !== providedBytes.length
    || !timingSafeEqual(expectedBytes, providedBytes)
  ) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
})
