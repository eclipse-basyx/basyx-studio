import type { SubmodelTemplateFields } from '#shared/contract'
import { bundledTemplate } from '~~/server/lib/templates'
import { requireActor } from '~~/server/utils/auth'
import { defineStudioHandler, routeParam } from '~~/server/utils/handler'
import { templateFields } from '#shared/aas/templates'

/** A bundled submodel template's elements, without a target. */
export default defineStudioHandler(async (event): Promise<SubmodelTemplateFields> => {
  await requireActor(event)
  const templateId = routeParam(event, 'templateId')
  const template = bundledTemplate(templateId)
  return { id: templateId, title: String(template.idShort ?? templateId), fields: templateFields(template) }
})
