import type { ConceptDescriptionSummary, Page } from '#shared/contract'
import { defineStudioHandler, queryValidated } from '~~/server/utils/handler'
import { openTarget, requireCapability } from '~~/server/utils/target'
import { listQuerySchema } from '#shared/contract'

export default defineStudioHandler(async (event): Promise<Page<ConceptDescriptionSummary>> => {
  const { limit, cursor } = queryValidated(event, listQuerySchema)
  const opened = await openTarget(event)
  await requireCapability(opened, 'conceptDescriptions')
  return opened.target.conceptDescriptions(limit, cursor)
})
