import { getRequestHeader } from 'nuxt/server'
import { StudioProblem } from '~~/server/lib/problem'
import { requireCsrf } from '~~/server/utils/auth'
import { auditedStructureWrite, elementRoute } from '~~/server/utils/elements'
import { defineStudioHandler } from '~~/server/utils/handler'
import { openTarget, requireCapability } from '~~/server/utils/target'

/** Deletes an element with its children; `If-Match` carries the element's revision. */
export default defineStudioHandler(async (event): Promise<{ deleted: true }> => {
  await requireCsrf(event)
  const route = elementRoute(event)
  if (route.rest.length > 0) {
    throw new StudioProblem('unsupported_operation', 'Operation variables cannot be deleted separately.')
  }
  const opened = await openTarget(event)
  await requireCapability(opened, 'writeStructure')
  await auditedStructureWrite(
    opened,
    { operation: 'deleteElement', submodelId: route.submodelId, path: route.idShortPath },
    () => opened.target.deleteElement(route.submodelId, route.idShortPath, getRequestHeader(event, 'if-match') ?? ''),
  )
  return { deleted: true }
})
