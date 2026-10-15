import type { ElementDetail } from '#shared/contract'
import type { LocatorStep } from '../lib/aas/keys'
import type { ElementSnapshot, StructureResult } from '../lib/targets/aas-target'
import type { OpenedTarget } from './target'
import type { RequestEvent } from 'nuxt/server'
import { childProperty, containerChildren } from '../lib/aas/edits'
import { ancestorsOf, decodeKey, encodeKey, parseLocator, splitAddressable } from '../lib/aas/keys'
import { navigate } from '../lib/aas/outline'
import { StudioProblem } from '../lib/problem'
import { structureRevisionOf } from '../lib/targets/revision'
import { routeParam } from './handler'

export interface ElementRoute {
  submodelId: string
  key: string
  locator: string
  idShortPath: string
  /** Steps below the API-addressable part (operation variables). */
  rest: LocatorStep[]
}

export function elementRoute (event: RequestEvent): ElementRoute {
  const submodelId = decodeKey(routeParam(event, 'submodelKey'), 'submodel key')
  const key = routeParam(event, 'elementKey')
  const locator = decodeKey(key, 'element key')
  const { idShortPath, rest } = splitAddressable(parseLocator(locator))
  return { submodelId, key, locator, idShortPath, rest }
}

/**
 * The element detail for the UI. Only API-addressable elements carry a
 * revision, because operation variables cannot be written separately. The
 * revision is also sent as `ETag`.
 */
export function toElementDetail (event: RequestEvent, route: ElementRoute, snapshot: ElementSnapshot): ElementDetail {
  const value = navigate(snapshot.value, route.rest)
  if (value === undefined) {
    throw new StudioProblem('target_resource_not_found')
  }
  const writable = route.rest.length === 0
  if (writable) {
    event.res.headers.set('ETag', `"${snapshot.revision}"`)
  }
  return {
    key: route.key,
    path: route.locator,
    value,
    revision: writable ? snapshot.revision : null,
    concurrency: writable ? snapshot.concurrency : null,
    ancestors: ancestorsOf(parseLocator(route.locator)),
    structureRevision: writable && !Array.isArray(value) && childProperty(value.modelType)
      ? structureRevisionOf(containerChildren(value))
      : null,
  }
}

/** The route of an element addressed by its locator, e.g. one a structural write returned. */
export function routeForPath (submodelId: string, locator: string): ElementRoute {
  const { idShortPath, rest } = splitAddressable(parseLocator(locator))
  return { submodelId, key: encodeKey(locator), locator, idShortPath, rest }
}

/** The detail of the element a structural write produced (add, rename, move). */
export function structureDetail (event: RequestEvent, submodelId: string, result: StructureResult): ElementDetail {
  if (!result.path || !result.snapshot) {
    throw new StudioProblem('internal_error')
  }
  return toElementDetail(event, routeForPath(submodelId, result.path), result.snapshot)
}

/** Runs a structural write and records its outcome in the audit log. */
export async function auditedStructureWrite<T> (opened: OpenedTarget, details: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
  try {
    const result = await run()
    await opened.auditWrite('success', details)
    return result
  } catch (error) {
    await opened.auditWrite('failure', { ...details, code: error instanceof StudioProblem ? error.code : 'internal_error' })
    throw error
  }
}
