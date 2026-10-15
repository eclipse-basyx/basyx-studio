import type { ElementDetail } from '#shared/contract'
import { getRequestHeader } from 'nuxt/server'
import { StudioProblem } from '~~/server/lib/problem'
import { requireCsrf } from '~~/server/utils/auth'
import { auditedStructureWrite, elementRoute, structureDetail } from '~~/server/utils/elements'
import { defineStudioHandler, readValidated } from '~~/server/utils/handler'
import { openTarget, requireCapability } from '~~/server/utils/target'
import { elementMoveSchema } from '#shared/contract'

/**
 * Moves an element to `index` among its siblings. `If-Match` carries the
 * parent's structure revision.
 */
export default defineStudioHandler(async (event): Promise<ElementDetail> => {
  await requireCsrf(event)
  const route = elementRoute(event)
  if (route.rest.length > 0) {
    throw new StudioProblem('unsupported_operation', 'Operation variables cannot be moved.')
  }
  const { index } = await readValidated(event, elementMoveSchema)
  const opened = await openTarget(event)
  await requireCapability(opened, 'writeStructure')
  const result = await auditedStructureWrite(
    opened,
    { operation: 'moveElement', submodelId: route.submodelId, path: route.idShortPath, index },
    () => opened.target.moveElement(route.submodelId, route.idShortPath, index, getRequestHeader(event, 'if-match') ?? ''),
  )
  return structureDetail(event, route.submodelId, result)
})
