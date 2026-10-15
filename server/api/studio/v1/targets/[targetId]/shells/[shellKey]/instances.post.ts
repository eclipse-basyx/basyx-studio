import type { ShellCreateResult } from '#shared/contract'
import { setResponseStatus } from 'nuxt/server'
import { createInstance } from '~~/server/lib/aas/creation'
import { decodeKey } from '~~/server/lib/aas/keys'
import { toShellSummary } from '~~/server/lib/aas/shells'
import { requireCsrf } from '~~/server/utils/auth'
import { auditedStructureWrite } from '~~/server/utils/elements'
import { defineStudioHandler, readValidated, routeParam } from '~~/server/utils/handler'
import { openTarget, requireCapability } from '~~/server/utils/target'
import { instanceCreateSchema } from '#shared/contract'

/** Creates an instance from a shell of asset kind Type (new IDs, `derivedFrom`, kind Instance). */
export default defineStudioHandler(async (event): Promise<ShellCreateResult> => {
  await requireCsrf(event)
  const typeShellId = decodeKey(routeParam(event, 'shellKey'), 'shell key')
  const input = await readValidated(event, instanceCreateSchema)
  const opened = await openTarget(event)
  await requireCapability(opened, 'createResources')
  const result = await auditedStructureWrite(
    opened,
    { operation: 'createInstance', typeShellId },
    async () => createInstance({ target: opened.target, scheme: opened.idScheme, plan: await opened.syncPlan() }, typeShellId, input),
  )
  setResponseStatus(event, 201)
  return { shell: toShellSummary(result.shell), steps: result.steps }
})
