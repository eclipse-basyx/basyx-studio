import type { ConceptDescriptionUsages } from '#shared/contract'
import { decodeKey } from '~~/server/lib/aas/keys'
import { defineStudioHandler, routeParam } from '~~/server/utils/handler'
import { openTarget, requireCapability } from '~~/server/utils/target'

/** How many submodels and elements reference a concept description, for the delete confirmation (MVP-6 plan, L5). */
export default defineStudioHandler(async (event): Promise<ConceptDescriptionUsages> => {
  const id = decodeKey(routeParam(event, 'cdKey'), 'concept description key')
  const opened = await openTarget(event)
  await requireCapability(opened, 'conceptDescriptions')
  return opened.target.conceptDescriptionUsages(id)
})
