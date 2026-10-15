import type { ElementDetail } from '#shared/contract'
import { getRequestHeader } from 'nuxt/server'
import { StudioProblem } from '~~/server/lib/problem'
import { requireCsrf } from '~~/server/utils/auth'
import { auditedStructureWrite, elementRoute, structureDetail } from '~~/server/utils/elements'
import { defineStudioHandler, readValidated } from '~~/server/utils/handler'
import { openTarget, requireCapability } from '~~/server/utils/target'
import { elementReplaceSchema } from '#shared/contract'

/**
 * Replaces an element with its edited version: metadata, value and a new
 * idShort. A container keeps its children. `If-Match` carries the element's
 * revision.
 */
export default defineStudioHandler(async (event): Promise<ElementDetail> => {
  await requireCsrf(event)
  const route = elementRoute(event)
  if (route.rest.length > 0) {
    throw new StudioProblem('unsupported_operation', 'Operation variables cannot be edited separately.')
  }
  const { element } = await readValidated(event, elementReplaceSchema)
  const opened = await openTarget(event)
  await requireCapability(opened, 'writeStructure')
  const result = await auditedStructureWrite(
    opened,
    { operation: 'replaceElement', submodelId: route.submodelId, path: route.idShortPath },
    () => opened.target.replaceElement(route.submodelId, route.idShortPath, element, getRequestHeader(event, 'if-match') ?? ''),
  )
  return structureDetail(event, route.submodelId, result)
})
