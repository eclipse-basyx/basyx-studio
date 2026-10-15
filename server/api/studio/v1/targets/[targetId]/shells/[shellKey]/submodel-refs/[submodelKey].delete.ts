import type { SyncStep } from '#shared/contract'
import { removeSubmodel } from '~~/server/lib/aas/creation'
import { decodeKey } from '~~/server/lib/aas/keys'
import { requireCsrf } from '~~/server/utils/auth'
import { auditedStructureWrite } from '~~/server/utils/elements'
import { defineStudioHandler, queryValidated, routeParam } from '~~/server/utils/handler'
import { openTarget, requireCapability } from '~~/server/utils/target'
import { submodelRefDeleteQuerySchema } from '#shared/contract'

/** Removes a submodel reference from a shell, and the submodel too with `deleteSubmodel=true` (U6). */
export default defineStudioHandler(async (event): Promise<{ steps: SyncStep[] }> => {
  await requireCsrf(event)
  const shellId = decodeKey(routeParam(event, 'shellKey'), 'shell key')
  const submodelId = decodeKey(routeParam(event, 'submodelKey'), 'submodel key')
  const { deleteSubmodel } = queryValidated(event, submodelRefDeleteQuerySchema)
  const opened = await openTarget(event)
  await requireCapability(opened, 'createResources')
  const steps = await auditedStructureWrite(
    opened,
    { operation: 'removeSubmodel', shellId, submodelId, deleteSubmodel },
    async () => removeSubmodel({ target: opened.target, scheme: opened.idScheme, plan: await opened.syncPlan() }, shellId, submodelId, deleteSubmodel),
  )
  return { steps }
})
