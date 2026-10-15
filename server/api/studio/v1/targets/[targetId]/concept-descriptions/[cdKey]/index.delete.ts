import { getRequestHeader } from 'nuxt/server'
import { decodeKey } from '~~/server/lib/aas/keys'
import { requireCsrf } from '~~/server/utils/auth'
import { auditedStructureWrite } from '~~/server/utils/elements'
import { defineStudioHandler, routeParam } from '~~/server/utils/handler'
import { openTarget, requireCapability } from '~~/server/utils/target'

/** Deletes a concept description; `If-Match` carries its revision. Elements that reference it stay as they are. */
export default defineStudioHandler(async (event): Promise<{ deleted: true }> => {
  await requireCsrf(event)
  const id = decodeKey(routeParam(event, 'cdKey'), 'concept description key')
  const opened = await openTarget(event)
  await requireCapability(opened, 'conceptDescriptions')
  await requireCapability(opened, 'writeStructure')
  await auditedStructureWrite(
    opened,
    { operation: 'deleteConceptDescription', conceptDescriptionId: id },
    () => opened.target.deleteConceptDescription(id, getRequestHeader(event, 'if-match') ?? ''),
  )
  return { deleted: true }
})
