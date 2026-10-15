import type { ConceptDescriptionDetail } from '#shared/contract'
import { decodeKey } from '~~/server/lib/aas/keys'
import { toAasXml } from '~~/server/lib/aas/xml'
import { revisionOf } from '~~/server/lib/targets/revision'
import { sendBinary } from '~~/server/utils/files'
import { defineStudioHandler, queryValidated, routeParam } from '~~/server/utils/handler'
import { openTarget, requireCapability } from '~~/server/utils/target'
import { conceptDescriptionQuerySchema } from '#shared/contract'

/** One concept description with its revision, or as AAS XML (MVP-6 plan, L2). */
export default defineStudioHandler(async (event): Promise<ConceptDescriptionDetail | Uint8Array> => {
  const key = routeParam(event, 'cdKey')
  const id = decodeKey(key, 'concept description key')
  const { format } = queryValidated(event, conceptDescriptionQuerySchema)
  const opened = await openTarget(event)
  await requireCapability(opened, 'conceptDescriptions')
  const conceptDescription = await opened.target.conceptDescription(id)
  if (format === 'xml') {
    const name = String(conceptDescription.idShort ?? 'concept-description').replaceAll(/[^\w-]/g, '_')
    return sendBinary(event, { bytes: new TextEncoder().encode(toAasXml(conceptDescription, 'concept description')), contentType: 'application/xml', fileName: `${name}.xml` })
  }
  event.res.headers.set('ETag', `"${revisionOf(conceptDescription)}"`)
  return { key, conceptDescription, revision: revisionOf(conceptDescription) }
})
