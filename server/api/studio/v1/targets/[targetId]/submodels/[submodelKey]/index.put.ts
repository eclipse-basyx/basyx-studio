import type { SubmodelDetail } from '#shared/contract'
import { getRequestHeader } from 'nuxt/server'
import { decodeKey } from '~~/server/lib/aas/keys'
import { revisionOf } from '~~/server/lib/targets/revision'
import { requireCsrf } from '~~/server/utils/auth'
import { auditedStructureWrite } from '~~/server/utils/elements'
import { defineStudioHandler, readValidated, routeParam } from '~~/server/utils/handler'
import { openTarget, requireCapability } from '~~/server/utils/target'
import { submodelReplaceSchema } from '#shared/contract'

/** Replaces a submodel's metadata and keeps its elements; `If-Match` carries the metadata's revision. */
export default defineStudioHandler(async (event): Promise<SubmodelDetail> => {
  await requireCsrf(event)
  const key = routeParam(event, 'submodelKey')
  const submodelId = decodeKey(key, 'submodel key')
  const { submodel } = await readValidated(event, submodelReplaceSchema)
  const opened = await openTarget(event)
  await requireCapability(opened, 'writeStructure')
  const metadata = await auditedStructureWrite(
    opened,
    { operation: 'replaceSubmodelMetadata', submodelId },
    () => opened.target.replaceSubmodelMetadata(submodelId, submodel, getRequestHeader(event, 'if-match') ?? ''),
  )
  event.res.headers.set('ETag', `"${revisionOf(metadata)}"`)
  return { key, submodel: metadata, revision: revisionOf(metadata) }
})
