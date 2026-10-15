import type { ConceptDescriptionSummary, Page } from '#shared/contract'
import type { MaybeRefOrGetter } from 'vue'
import { useQuery } from '@pinia/colada'

/** Concept descriptions loaded at most; the Concepts page uses the same limit. */
const maxItems = 1000

/** The query key of a target's concept description summaries, for invalidation after writes. */
export function conceptDescriptionsKey (targetId: string): string[] {
  return ['targets', targetId, 'concept-descriptions', 'all']
}

/**
 * The concept description summaries of a target (up to 1,000), shared by
 * the link picker and the units shown beside values (MVP-6 plan, E5, E6).
 * Writes to concept descriptions invalidate `conceptDescriptionsKey`.
 */
export function useConceptDescriptions (targetId: MaybeRefOrGetter<string>, enabled: MaybeRefOrGetter<boolean>) {
  const api = useStudioApi()
  return useQuery({
    key: () => conceptDescriptionsKey(toValue(targetId)),
    query: async ({ signal }) => {
      const loaded: ConceptDescriptionSummary[] = []
      let cursor: string | undefined
      do {
        const page = await api<Page<ConceptDescriptionSummary>>(`/targets/${toValue(targetId)}/concept-descriptions`, { query: { limit: 200, cursor }, signal })
        loaded.push(...page.items)
        cursor = page.page.nextCursor ?? undefined
      } while (cursor && loaded.length < maxItems)
      return loaded
    },
    enabled: () => toValue(enabled) && toValue(targetId) !== '',
  })
}

/**
 * The unit a semantic ID's concept description gives (E6): looked up by the
 * semantic ID's first key value, `null` without a concept description or unit.
 */
export function useConceptUnits (targetId: MaybeRefOrGetter<string>, enabled: MaybeRefOrGetter<boolean>) {
  const list = useConceptDescriptions(targetId, enabled)
  const units = computed(() => new Map((list.data.value ?? []).filter(cd => cd.unit).map(cd => [cd.id, cd.unit!])))
  return (semanticId: string | null | undefined): string | null => (semanticId ? units.value.get(semanticId) ?? null : null)
}
