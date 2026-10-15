import type { ConceptDescriptionDetail } from '#shared/contract'
import { setResponseStatus } from 'nuxt/server'
import { verifyConceptDescription } from '~~/server/lib/aas/edits'
import { encodeKey } from '~~/server/lib/aas/keys'
import { revisionOf } from '~~/server/lib/targets/revision'
import { requireCsrf } from '~~/server/utils/auth'
import { auditedStructureWrite } from '~~/server/utils/elements'
import { defineStudioHandler, readValidated } from '~~/server/utils/handler'
import { openTarget, requireCapability } from '~~/server/utils/target'
import { generateId } from '#shared/aas/identifiers'
import { conceptDescriptionInputSchema } from '#shared/contract'

/**
 * Creates a concept description (MVP-6 plan, L4). Without an ID, Studio
 * generates one by the infrastructure's scheme; an existing ID is refused
 * with `identifier_conflict`.
 */
export default defineStudioHandler(async (event): Promise<ConceptDescriptionDetail> => {
  await requireCsrf(event)
  const { conceptDescription } = await readValidated(event, conceptDescriptionInputSchema)
  const opened = await openTarget(event)
  await requireCapability(opened, 'conceptDescriptions')
  await requireCapability(opened, 'createResources')
  const id = typeof conceptDescription.id === 'string' && conceptDescription.id !== '' ? conceptDescription.id : generateId('cd', opened.idScheme)
  const verified = verifyConceptDescription({ ...conceptDescription, id })
  await auditedStructureWrite(opened, { operation: 'createConceptDescription', conceptDescriptionId: id }, () => opened.target.createConceptDescription(verified))
  const stored = await opened.target.conceptDescription(id)
  event.res.headers.set('ETag', `"${revisionOf(stored)}"`)
  setResponseStatus(event, 201)
  return { key: encodeKey(id), conceptDescription: stored, revision: revisionOf(stored) }
})
