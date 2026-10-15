import type { ValidationResult } from '#shared/contract'
import { findings } from '~~/server/lib/aas/edits'
import { requireCsrf } from '~~/server/utils/auth'
import { defineStudioHandler, readValidated } from '~~/server/utils/handler'
import { openTarget } from '~~/server/utils/target'
import { validationInputSchema } from '#shared/contract'

/** AAS Core findings for a JSON value (the insert dialog); nothing is written. */
export default defineStudioHandler(async (event): Promise<ValidationResult> => {
  await requireCsrf(event)
  const { kind, value } = await readValidated(event, validationInputSchema)
  await openTarget(event)
  return { violations: findings(kind, value) }
})
