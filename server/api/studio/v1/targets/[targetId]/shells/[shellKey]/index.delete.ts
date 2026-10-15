import type { DeleteResult } from '#shared/contract'
import { z } from 'zod'
import { deleteShellWithSubmodels } from '~~/server/lib/aas/creation'
import { decodeKey } from '~~/server/lib/aas/keys'
import { StudioProblem } from '~~/server/lib/problem'
import { requireCsrf } from '~~/server/utils/auth'
import { defineStudioHandler, queryValidated, routeParam } from '~~/server/utils/handler'
import { openTarget, requireCapability } from '~~/server/utils/target'

const querySchema = z.object({
  deleteSubmodels: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
})

/**
 * Deletes a shell, and with `deleteSubmodels=true` the submodels it
 * references. Descriptors and asset links are removed where Studio keeps the
 * registries and discovery in step (MVP-4 plan, I5). Without the option the
 * submodels stay in the submodel repository.
 */
export default defineStudioHandler(async (event): Promise<DeleteResult> => {
  await requireCsrf(event)
  const shellId = decodeKey(routeParam(event, 'shellKey'), 'shell key')
  const { deleteSubmodels } = queryValidated(event, querySchema)
  const opened = await openTarget(event)
  await requireCapability(opened, 'deleteShells')
  const plan = await opened.syncPlan()
  let sync
  try {
    sync = await deleteShellWithSubmodels({ target: opened.target, scheme: opened.idScheme, plan }, shellId, deleteSubmodels)
    await opened.auditWrite('success', { operation: 'deleteShell', shellId, deleteSubmodels })
  } catch (error) {
    await opened.auditWrite('failure', { operation: 'deleteShell', shellId, deleteSubmodels, code: error instanceof StudioProblem ? error.code : 'internal_error' })
    throw error
  }
  if (sync.some(step => step.outcome === 'failed')) {
    await opened.auditWrite('failure', { operation: 'sync', shellId, failed: sync.filter(step => step.outcome === 'failed').length })
  }
  return { sync }
})
