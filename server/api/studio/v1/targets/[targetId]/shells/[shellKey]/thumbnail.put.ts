import type { ShellDetail } from '#shared/contract'
import { shellMetadata } from '~~/server/lib/aas/edits'
import { decodeKey } from '~~/server/lib/aas/keys'
import { revisionOf } from '~~/server/lib/targets/revision'
import { requireCsrf } from '~~/server/utils/auth'
import { auditedStructureWrite } from '~~/server/utils/elements'
import { readFileBody } from '~~/server/utils/files'
import { defineStudioHandler, routeParam } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'
import { openTarget, requireCapability } from '~~/server/utils/target'

/** Sets the shell's default thumbnail; the body is the image. */
export default defineStudioHandler(async (event): Promise<ShellDetail> => {
  await requireCsrf(event)
  const key = routeParam(event, 'shellKey')
  const shellId = decodeKey(key, 'shell key')
  const file = await readFileBody(event, (await useStudio()).config.uploadMaxBytes)
  const opened = await openTarget(event)
  await requireCapability(opened, 'files')
  await requireCapability(opened, 'createResources')
  const shell = await auditedStructureWrite(
    opened,
    { operation: 'setThumbnail', shellId, size: file.bytes.length },
    () => opened.target.setThumbnail(shellId, file),
  )
  return { key, shell, revision: revisionOf(shellMetadata(shell)) }
})
