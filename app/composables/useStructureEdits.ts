import type { ElementDetail } from '#shared/contract'
import { uniqueIdShort } from '#shared/aas/defaults'

/**
 * The structural writes of the tree actions (MVP-5 plan, U3): delete, move and
 * paste. Each one reads the element first, so the write is based on the
 * revision the user is looking at, and fails with a conflict if it changed.
 */
export function useStructureEdits (targetId: () => string) {
  const api = useStudioApi()

  const base = (submodelKey: string) => `/targets/${targetId()}/submodels/${submodelKey}/elements`
  const ifMatch = (revision: string) => ({ 'If-Match': `"${revision}"` })

  function read (submodelKey: string, elementKey: string): Promise<ElementDetail> {
    return api<ElementDetail>(`${base(submodelKey)}/${elementKey}`)
  }

  async function remove (submodelKey: string, elementKey: string): Promise<void> {
    const detail = await read(submodelKey, elementKey)
    await api(`${base(submodelKey)}/${elementKey}`, { method: 'DELETE', headers: ifMatch(detail.revision!) })
  }

  async function move (submodelKey: string, elementKey: string, index: number, structureRevision: string): Promise<ElementDetail> {
    return api<ElementDetail>(`${base(submodelKey)}/${elementKey}/moves`, {
      method: 'POST',
      headers: ifMatch(structureRevision),
      body: { index },
    })
  }

  /**
   * Inserts a copied element below a parent. A name that a sibling has
   * already is made unique (`_copy`, `_copy1`, C1); list children have none.
   */
  async function paste (
    submodelKey: string,
    parentKey: string | null,
    structureRevision: string,
    element: Record<string, unknown>,
    siblings: string[],
    inList: boolean,
  ): Promise<ElementDetail> {
    const next = { ...element }
    if (inList) {
      delete next.idShort
    } else if (typeof next.idShort === 'string' && siblings.includes(next.idShort)) {
      next.idShort = uniqueIdShort(`${next.idShort}_copy`, siblings)
    }
    return api<ElementDetail>(base(submodelKey), {
      method: 'POST',
      headers: ifMatch(structureRevision),
      body: { parentElementKey: parentKey ?? undefined, element: next },
    })
  }

  return { read, remove, move, paste }
}
