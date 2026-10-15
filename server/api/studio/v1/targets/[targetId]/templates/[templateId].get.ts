import type { SubmodelTemplateFields } from '#shared/contract'
import { templateSubmodel } from '~~/server/lib/aas/creation'
import { defineStudioHandler, routeParam } from '~~/server/utils/handler'
import { openTarget } from '~~/server/utils/target'
import { templateFields } from '#shared/aas/templates'

/** The elements of a template with their cardinality, for the wizard's generic form (T3). */
export default defineStudioHandler(async (event): Promise<SubmodelTemplateFields> => {
  const templateId = routeParam(event, 'templateId')
  const opened = await openTarget(event)
  const template = await templateSubmodel(opened.target, templateId)
  return { id: templateId, title: String(template.idShort ?? templateId), fields: templateFields(template) }
})
