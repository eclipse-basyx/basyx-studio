import type { ShellDetail } from '#shared/contract'
import { shellMetadata } from '~~/server/lib/aas/edits'
import { decodeKey } from '~~/server/lib/aas/keys'
import { revisionOf } from '~~/server/lib/targets/revision'
import { defineStudioHandler, routeParam } from '~~/server/utils/handler'
import { openTarget } from '~~/server/utils/target'

export default defineStudioHandler(async (event): Promise<ShellDetail> => {
  const key = routeParam(event, 'shellKey')
  const shellId = decodeKey(key, 'shell key')
  const { target } = await openTarget(event)
  const shell = await target.shell(shellId)
  return { key, shell, revision: revisionOf(shellMetadata(shell)) }
})
