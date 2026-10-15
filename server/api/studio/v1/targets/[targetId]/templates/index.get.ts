import type { SubmodelTemplate } from '#shared/contract'
import type { JsonObject } from '~~/server/lib/aas/outline'
import { encodeKey } from '~~/server/lib/aas/keys'
import { firstKeyValue } from '~~/server/lib/aas/outline'
import { bundledTemplates } from '~~/server/lib/templates'
import { defineStudioHandler } from '~~/server/utils/handler'
import { openTarget } from '~~/server/utils/target'

/** Submodel templates for a target: the bundled IDTA templates, and Template-kind submodels on the target (T1). */
export default defineStudioHandler(async (event): Promise<{ items: SubmodelTemplate[] }> => {
  const opened = await openTarget(event)
  const items = bundledTemplates()
  // Template-kind submodels the target lists; a target that cannot list them offers the bundled ones only.
  if (opened.target.capabilities.createResources) {
    try {
      const shells = await opened.target.listShells(50, undefined)
      const seen = new Set<string>()
      for (const shell of shells.items) {
        for (const id of await opened.target.submodelIds(shell.id).catch(() => [])) {
          if (seen.has(id)) {
            continue
          }
          seen.add(id)
          const metadata: JsonObject | null = await opened.target.submodelMetadata(id).catch(() => null)
          if (metadata?.kind === 'Template') {
            items.push({
              id: `target:${encodeKey(id)}`,
              title: String(metadata.idShort ?? id),
              semanticId: firstKeyValue(metadata.semanticId),
              source: 'target',
              version: ((metadata.administration as { version?: string } | undefined)?.version) ?? null,
            })
          }
        }
      }
    } catch {
      // The bundled templates remain.
    }
  }
  return { items }
})
