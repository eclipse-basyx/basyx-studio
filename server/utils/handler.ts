import type { Problem } from '#shared/contract'
import type { ResolvedSession } from './auth'
import type { RequestEvent } from 'nuxt/server'
import type { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { defineEventHandler, getQuery, getRequestHeader, getRouterParam, readBody, setResponseStatus } from 'nuxt/server'
import { StudioProblem } from '../lib/problem'
import { useStudio } from './studio'

declare module 'nuxt/schema' {
  interface RequestEventContext {
    requestId?: string
    studioSession?: ResolvedSession | null
  }
}

/** The request's correlation ID, created on first use. */
export function requestIdOf (event: RequestEvent): string {
  event.context.requestId ??= randomUUID()
  return event.context.requestId
}

const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function allowedOrigins (publicUrl: string, desktop: boolean): Set<string> {
  const origins = new Set([new URL(publicUrl).origin])
  if (desktop) {
    // The desktop renderer may address the loopback service by either name.
    const url = new URL(publicUrl)
    origins.add(`${url.protocol}//localhost:${url.port}`)
    origins.add(`${url.protocol}//127.0.0.1:${url.port}`)
  }
  return origins
}

/**
 * Rejects cross-site state changes before the handler runs. Browsers always
 * send Origin on these methods; handlers acting on a session additionally
 * check the CSRF token.
 */
export async function rejectCrossOrigin (event: RequestEvent): Promise<void> {
  if (!unsafeMethods.has(event.req.method)) {
    return
  }
  const studio = await useStudio()
  const origin = getRequestHeader(event, 'origin')
  if (!origin || !allowedOrigins(studio.config.publicUrl, studio.config.deploymentMode === 'desktop').has(origin)) {
    throw new StudioProblem('csrf_rejected')
  }
}

function toProblem (event: RequestEvent, error: unknown): Problem {
  const problem = error instanceof StudioProblem ? error : new StudioProblem('internal_error')
  if (!(error instanceof StudioProblem)) {
    // Log the failure without request data; error messages never contain tokens.
    console.error(`[studio] request ${requestIdOf(event)} failed:`, error)
  }
  return {
    type: 'about:blank',
    title: problem.title,
    status: problem.status,
    code: problem.code,
    detail: problem.detail,
    requestId: requestIdOf(event),
    retryable: problem.retryable,
    violations: problem.violations,
  }
}

/**
 * Wraps a Studio API handler: sets the request ID and no-store caching,
 * enforces the Origin check for state changes, and turns expected failures
 * into `application/problem+json` with a stable code.
 */
export function defineStudioHandler<T> (
  handler: (event: RequestEvent) => Promise<T>,
  options: {
    /**
     * `false` only for endpoints of the Electron main process, which sends no
     * Origin and authenticates with the broker secret instead of a cookie.
     */
    originCheck?: boolean
  } = {},
) {
  return defineEventHandler(async (event): Promise<T | Problem> => {
    event.res.headers.set('X-Request-ID', requestIdOf(event))
    event.res.headers.set('Cache-Control', 'no-store')
    try {
      if (options.originCheck !== false) {
        await rejectCrossOrigin(event)
      }
      return await handler(event)
    } catch (error) {
      const problem = toProblem(event, error)
      setResponseStatus(event, problem.status)
      event.res.headers.set('Content-Type', 'application/problem+json')
      return problem
    }
  })
}

function violations (error: z.ZodError) {
  return error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message }))
}

export async function readValidated<T extends z.ZodType> (event: RequestEvent, schema: T): Promise<z.infer<T>> {
  const body = await readBody(event).catch(() => {
    throw new StudioProblem('invalid_request', 'The request body is not valid JSON.')
  })
  const parsed = schema.safeParse(body ?? {})
  if (!parsed.success) {
    throw new StudioProblem('invalid_request', undefined, { violations: violations(parsed.error) })
  }
  return parsed.data
}

export function queryValidated<T extends z.ZodType> (event: RequestEvent, schema: T): z.infer<T> {
  const parsed = schema.safeParse(getQuery(event))
  if (!parsed.success) {
    throw new StudioProblem('invalid_request', undefined, { violations: violations(parsed.error) })
  }
  return parsed.data
}

export function routeParam (event: RequestEvent, name: string): string {
  const value = getRouterParam(event, name, { decode: true })
  if (!value) {
    throw new StudioProblem('invalid_request', `Missing ${name}.`)
  }
  return value
}
