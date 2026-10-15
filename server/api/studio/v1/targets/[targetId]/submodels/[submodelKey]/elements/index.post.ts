import type { ElementDetail } from '#shared/contract'
import { getRequestHeader } from 'nuxt/server'
import { decodeKey } from '~~/server/lib/aas/keys'
import { requireCsrf } from '~~/server/utils/auth'
import { auditedStructureWrite, structureDetail } from '~~/server/utils/elements'
import { defineStudioHandler, readValidated, routeParam } from '~~/server/utils/handler'
import { openTarget, requireCapability } from '~~/server/utils/target'
import { elementCreateSchema } from '#shared/contract'

/**
 * Adds an element at the top level of a submodel or below `parentElementKey`.
 * `If-Match` carries the parent's structure revision (MVP-5 plan, W2).
 */
export default defineStudioHandler(async (event): Promise<ElementDetail> => {
  await requireCsrf(event)
  const submodelId = decodeKey(routeParam(event, 'submodelKey'), 'submodel key')
  const body = await readValidated(event, elementCreateSchema)
  const opened = await openTarget(event)
  await requireCapability(opened, 'writeStructure')
  const parentPath = body.parentElementKey ? decodeKey(body.parentElementKey, 'element key') : null
  const result = await auditedStructureWrite(
    opened,
    { operation: 'addElement', submodelId, parent: parentPath },
    () => opened.target.addElement(submodelId, parentPath, body.element, body.index ?? null, getRequestHeader(event, 'if-match') ?? ''),
  )
  return structureDetail(event, submodelId, result)
})
