import { StudioProblem } from '~~/server/lib/problem'
import { isAppBuilderOperation, performAppBuilderOperation } from '~~/server/utils/app-builder'
import { requireActor, requireCsrf } from '~~/server/utils/auth'
import { defineStudioHandler, readValidated, requestIdOf, routeParam } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'
import { appBuilderOperationSchemas } from '#shared/contract'

/**
 * The App Builder's operations (ADR 0054): agent status, conversations,
 * prompts, approvals. Desktop only; progress arrives on the conversation's
 * event stream.
 */
export default defineStudioHandler(async (event): Promise<unknown> => {
  const operation = routeParam(event, 'operation')
  if (!isAppBuilderOperation(operation)) {
    throw new StudioProblem('not_found', 'The App Builder operation does not exist.')
  }
  const actor = await requireActor(event)
  await requireCsrf(event)
  const params = await readValidated(event, appBuilderOperationSchemas[operation])
  return await performAppBuilderOperation(await useStudio(), operation, params as never, { actor, requestId: requestIdOf(event) })
})
