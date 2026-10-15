import type { SyncStep } from '#shared/contract'
import { setResponseStatus } from 'nuxt/server'
import { addSubmodel } from '~~/server/lib/aas/creation'
import { decodeKey, encodeKey } from '~~/server/lib/aas/keys'
import { requireCsrf } from '~~/server/utils/auth'
import { auditedStructureWrite } from '~~/server/utils/elements'
import { defineStudioHandler, readValidated, routeParam } from '~~/server/utils/handler'
import { openTarget, requireCapability } from '~~/server/utils/target'
import { submodelRefCreateSchema } from '#shared/contract'

/** Adds a submodel to a shell: a new one (empty, from a template or JSON) or a reference to an existing one. */
export default defineStudioHandler(async (event): Promise<{ submodelKey: string, steps: SyncStep[] }> => {
  await requireCsrf(event)
  const shellId = decodeKey(routeParam(event, 'shellKey'), 'shell key')
  const { submodel } = await readValidated(event, submodelRefCreateSchema)
  const opened = await openTarget(event)
  await requireCapability(opened, 'createResources')
  const result = await auditedStructureWrite(
    opened,
    { operation: 'addSubmodel', shellId, source: submodel.source },
    async () => addSubmodel({ target: opened.target, scheme: opened.idScheme, plan: await opened.syncPlan() }, shellId, submodel),
  )
  setResponseStatus(event, 201)
  return { submodelKey: encodeKey(result.submodelId), steps: result.steps }
})
