import type { TreeNode } from '#shared/contract'
import type { JsonObject } from '~~/server/lib/aas/outline'
import { containerChildren } from '~~/server/lib/aas/edits'
import { decodeKey, parseLocator, splitAddressable } from '~~/server/lib/aas/keys'
import { childrenOf, navigate, submodelChildren } from '~~/server/lib/aas/outline'
import { buildLevels } from '~~/server/lib/aas/tree'
import { StudioProblem } from '~~/server/lib/problem'
import { structureRevisionOf } from '~~/server/lib/targets/revision'
import { defineStudioHandler, queryValidated, routeParam } from '~~/server/utils/handler'
import { openTarget, requireCapability } from '~~/server/utils/target'
import { elementLevelQuerySchema } from '#shared/contract'

/**
 * Tree nodes below the submodel or one of its elements, with as many levels
 * as fit into the node budget (MVP-4 plan, T1), now or (with `at`) as they
 * were at a point in time.
 */
export default defineStudioHandler(async (event): Promise<{ items: TreeNode[], structureRevision?: string }> => {
  const submodelId = decodeKey(routeParam(event, 'submodelKey'), 'submodel key')
  const { parentElementKey, at, budget } = queryValidated(event, elementLevelQuerySchema)
  const opened = await openTarget(event)
  const steps = parentElementKey ? parseLocator(decodeKey(parentElementKey, 'element key')) : []

  let parent: JsonObject | JsonObject[] | undefined
  if (at) {
    await requireCapability(opened, 'history')
    const submodel = await opened.target.submodelAt(submodelId, new Date(at).toISOString())
    if (steps.length === 0) {
      return { items: buildLevels(submodelChildren(submodel), budget) }
    }
    // The submodel's elements, addressed like the children of a collection.
    parent = navigate({ modelType: 'SubmodelElementCollection', value: submodel.submodelElements }, steps)
  } else if (steps.length === 0) {
    const submodel = await opened.target.submodel(submodelId)
    return {
      items: buildLevels(submodelChildren(submodel), budget),
      structureRevision: structureRevisionOf(Array.isArray(submodel.submodelElements) ? submodel.submodelElements : []),
    }
  } else {
    const { idShortPath, rest } = splitAddressable(steps)
    parent = navigate((await opened.target.element(submodelId, idShortPath)).value, rest)
  }
  if (parent === undefined) {
    throw new StudioProblem('target_resource_not_found')
  }
  const structureRevision = at || Array.isArray(parent) ? undefined : structureRevisionOf(containerChildren(parent))
  return { items: buildLevels(childrenOf(parent, steps), budget), structureRevision }
})
