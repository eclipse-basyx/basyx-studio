import type { ConceptDescriptionDetail } from '#shared/contract'
import { getRequestHeader } from 'nuxt/server'
import { decodeKey } from '~~/server/lib/aas/keys'
import { revisionOf } from '~~/server/lib/targets/revision'
import { requireCsrf } from '~~/server/utils/auth'
import { auditedStructureWrite } from '~~/server/utils/elements'
import { defineStudioHandler, readValidated, routeParam } from '~~/server/utils/handler'
import { openTarget, requireCapability } from '~~/server/utils/target'
import { conceptDescriptionInputSchema } from '#shared/contract'

/** Replaces a concept description; `If-Match` carries the revision the user saw (MVP-6 plan, W1). */
export default defineStudioHandler(async (event): Promise<ConceptDescriptionDetail> => {
  await requireCsrf(event)
  const key = routeParam(event, 'cdKey')
  const id = decodeKey(key, 'concept description key')
  const { conceptDescription } = await readValidated(event, conceptDescriptionInputSchema)
  const opened = await openTarget(event)
  await requireCapability(opened, 'conceptDescriptions')
  await requireCapability(opened, 'writeStructure')
  const stored = await auditedStructureWrite(
    opened,
    { operation: 'replaceConceptDescription', conceptDescriptionId: id },
    () => opened.target.replaceConceptDescription(id, conceptDescription, getRequestHeader(event, 'if-match') ?? ''),
  )
  event.res.headers.set('ETag', `"${revisionOf(stored)}"`)
  return { key, conceptDescription: stored, revision: revisionOf(stored) }
})
