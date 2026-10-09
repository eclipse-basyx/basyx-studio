import type { SubmodelRef } from '#shared/contract'
import { decodeKey } from '~~/server/lib/aas/keys'
import { resolveSubmodelRefs } from '~~/server/lib/aas/submodel-refs'
import { defineStudioHandler, routeParam } from '~~/server/utils/handler'
import { openTarget } from '~~/server/utils/target'

export default defineStudioHandler(async (event): Promise<{ items: SubmodelRef[] }> => {
  const shellId = decodeKey(routeParam(event, 'shellKey'), 'shell key')
  const { target } = await openTarget(event)
  return { items: await resolveSubmodelRefs(target, await target.submodelIds(shellId)) }
})
