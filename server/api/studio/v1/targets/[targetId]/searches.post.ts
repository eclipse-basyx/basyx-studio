import type { ConceptDescriptionSummary, ElementSearchResult, Page, ShellSearchPage } from '#shared/contract'
import { defineStudioHandler, readValidated } from '~~/server/utils/handler'
import { openTarget } from '~~/server/utils/target'
import { searchRequestSchema } from '#shared/contract'

/**
 * Searches the target (MVP-4 plan, S2): shells or concept descriptions (MVP-6
 * plan, S1) by the search field's expression or a raw AAS Query Language
 * query, cursor-paged, or submodel elements by text. A POST because queries
 * are JSON; nothing is changed.
 */
export default defineStudioHandler(async (event): Promise<ShellSearchPage | ElementSearchResult | Page<ConceptDescriptionSummary>> => {
  const request = await readValidated(event, searchRequestSchema)
  const { target } = await openTarget(event)
  if (request.scope === 'elements') {
    return { items: await target.searchElements(request.expression!, request.limit) }
  }
  const search = request.query === undefined ? { expression: request.expression! } : { query: request.query }
  if (request.scope === 'conceptDescriptions') {
    return target.searchConceptDescriptions(search, request.sources ?? [], request.limit, request.cursor)
  }
  return target.searchShells(search, request.limit, request.cursor)
})
