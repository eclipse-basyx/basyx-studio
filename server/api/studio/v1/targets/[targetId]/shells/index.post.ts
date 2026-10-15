import type { ShellCreateResult } from '#shared/contract'
import { setResponseStatus } from 'nuxt/server'
import { createShell } from '~~/server/lib/aas/creation'
import { toShellSummary } from '~~/server/lib/aas/shells'
import { requireCsrf } from '~~/server/utils/auth'
import { auditedStructureWrite } from '~~/server/utils/elements'
import { defineStudioHandler, readValidated } from '~~/server/utils/handler'
import { openTarget, requireCapability } from '~~/server/utils/target'
import { shellCreateSchema } from '#shared/contract'

/**
 * Creates a shell, optionally with new submodels (the creation wizard):
 * submodels first, then the shell, then registries and discovery. A failure
 * stops the later steps and answers `partial_write` with what was written.
 */
export default defineStudioHandler(async (event): Promise<ShellCreateResult> => {
  await requireCsrf(event)
  const input = await readValidated(event, shellCreateSchema)
  const opened = await openTarget(event)
  await requireCapability(opened, 'createResources')
  const result = await auditedStructureWrite(
    opened,
    { operation: 'createShell', submodels: input.submodels.length },
    async () => createShell({ target: opened.target, scheme: opened.idScheme, plan: await opened.syncPlan() }, input),
  )
  setResponseStatus(event, 201)
  return { shell: toShellSummary(result.shell), steps: result.steps }
})
