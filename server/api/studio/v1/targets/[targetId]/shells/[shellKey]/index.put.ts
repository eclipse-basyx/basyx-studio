import type { ShellDetail } from '#shared/contract'
import { getRequestHeader } from 'nuxt/server'
import { shellMetadata } from '~~/server/lib/aas/edits'
import { decodeKey } from '~~/server/lib/aas/keys'
import { revisionOf } from '~~/server/lib/targets/revision'
import { requireCsrf } from '~~/server/utils/auth'
import { auditedStructureWrite } from '~~/server/utils/elements'
import { defineStudioHandler, readValidated, routeParam } from '~~/server/utils/handler'
import { openTarget, requireCapability } from '~~/server/utils/target'
import { shellReplaceSchema } from '#shared/contract'

/**
 * Replaces a shell's metadata and asset information; its submodel references
 * stay. `If-Match` carries the revision of the metadata as read. Registries
 * and discovery follow the sync setting (asset links change with the IDs).
 */
export default defineStudioHandler(async (event): Promise<ShellDetail> => {
  await requireCsrf(event)
  const key = routeParam(event, 'shellKey')
  const shellId = decodeKey(key, 'shell key')
  const { shell } = await readValidated(event, shellReplaceSchema)
  const opened = await openTarget(event)
  await requireCapability(opened, 'createResources')
  const saved = await auditedStructureWrite(
    opened,
    { operation: 'replaceShell', shellId },
    () => opened.target.replaceShell(shellId, shell, getRequestHeader(event, 'if-match') ?? ''),
  )
  const sync = await opened.target.registerShells([shellId], await opened.syncPlan())
  if (sync.some(step => step.outcome === 'failed')) {
    await opened.auditWrite('failure', { operation: 'sync', shellId, failed: sync.filter(step => step.outcome === 'failed').length })
  }
  const revision = revisionOf(shellMetadata(saved))
  event.res.headers.set('ETag', `"${revision}"`)
  return { key, shell: saved, revision }
})
