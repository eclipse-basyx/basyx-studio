import type { SubmodelDetail } from '#shared/contract'
import { setResponseStatus } from 'nuxt/server'
import { convertSubmodelToInstance } from '~~/server/lib/aas/creation'
import { decodeKey } from '~~/server/lib/aas/keys'
import { revisionOf } from '~~/server/lib/targets/revision'
import { requireCsrf } from '~~/server/utils/auth'
import { auditedStructureWrite } from '~~/server/utils/elements'
import { defineStudioHandler, routeParam } from '~~/server/utils/handler'
import { openTarget, requireCapability } from '~~/server/utils/target'

/** Converts a template submodel to an instance in place: template qualifiers are removed (T5). */
export default defineStudioHandler(async (event): Promise<SubmodelDetail & { removedQualifiers: number }> => {
  await requireCsrf(event)
  const key = routeParam(event, 'submodelKey')
  const submodelId = decodeKey(key, 'submodel key')
  const opened = await openTarget(event)
  await requireCapability(opened, 'createResources')
  const { submodel, removedQualifiers } = await auditedStructureWrite(
    opened,
    { operation: 'convertToInstance', submodelId },
    () => convertSubmodelToInstance(opened.target, submodelId),
  )
  const { submodelElements: _, ...metadata } = submodel
  setResponseStatus(event, 201)
  return { key, submodel: metadata, revision: revisionOf(metadata), removedQualifiers }
})
