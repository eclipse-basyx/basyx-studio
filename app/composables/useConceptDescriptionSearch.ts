import type { ConceptDescriptionSummary, Page, TargetCapabilities } from '#shared/contract'
import type { ConceptDescriptionSource } from '#shared/search/expression'
import type { MaybeRefOrGetter, Ref } from 'vue'
import type { FilterGroup } from '~/utils/records'
import { conceptDescriptionSearchFields, conceptDescriptionSource, conceptDescriptionSources, parseSearch } from '#shared/search/expression'
import { langText } from '~/utils/aas'

/** A concept description as a row of the Concepts page or the link picker. */
export type ConceptDescriptionRow = Omit<ConceptDescriptionSummary, 'definition'> & {
  name: string
  definition: string
  source: ConceptDescriptionSource
}

export const conceptDescriptionPageSizes = [10, 25, 50, 100] as const

interface Options {
  targetId: MaybeRefOrGetter<string>
  capabilities: MaybeRefOrGetter<TargetCapabilities>
  /** Loads only while true, e.g. while the picker is open. */
  enabled?: MaybeRefOrGetter<boolean>
  /** Where the search, filters and page size live (the page keeps them per target); local refs otherwise. */
  state?: { search: Ref<string | null>, selected: Ref<string[]>, pageSize: Ref<number> }
}

/**
 * The concept description search of the Concepts page and the link picker
 * (MVP-6 plan, S1): the search text, the source filters and a raw query from
 * the advanced dialog, run on the server one page at a time with the AAS
 * API's cursors. The query language has no total count, so pages go forward
 * and back. Workspaces evaluate the search themselves; targets without a
 * query endpoint list their pages and filter the page shown, with a note.
 */
export function useConceptDescriptionSearch (options: Options) {
  const api = useStudioApi()
  const { t } = useI18n()
  const preferences = usePreferences().preferences

  const search = options.state?.search ?? ref<string | null>('')
  const selected = options.state?.selected ?? ref<string[]>([])
  const pageSize = options.state?.pageSize ?? ref(25)
  const rawQuery = ref<Record<string, unknown> | null>(null)

  const mode = computed(() => toValue(options.capabilities).conceptDescriptionSearch)
  const queryable = computed(() => mode.value === 'query')
  const localOnly = computed(() => mode.value === 'filter')

  // The text is applied after a pause in typing.
  const applied = ref((search.value ?? '').trim())
  let timer: ReturnType<typeof setTimeout> | undefined
  watch(search, value => {
    clearTimeout(timer)
    timer = setTimeout(() => (applied.value = (value ?? '').trim()), 300)
  })

  const sources = computed(() => selected.value
    .filter(value => value.startsWith('source:'))
    .map(value => value.slice('source:'.length) as ConceptDescriptionSource)
    .filter(source => conceptDescriptionSources.includes(source)))
  const filterGroups = computed<FilterGroup[]>(() => [{
    title: t('concepts.source'),
    options: conceptDescriptionSources.map(source => ({
      value: `source:${source}`,
      title: source === 'Other' ? t('concepts.otherSource') : source,
      icon: 'mdi-book-outline',
    })),
  }])

  /** The server searches when anything narrows the list and it can: with a query endpoint or in a workspace. */
  const searching = computed(() => !localOnly.value && (rawQuery.value !== null || applied.value !== '' || sources.value.length > 0))

  // One page at a time: the cursor of every page visited so far, the first page's is none.
  const cursors = ref<Array<string | undefined>>([undefined])
  const nextCursor = ref<string | null>(null)
  const items = ref<ConceptDescriptionSummary[]>([])
  const loading = ref(false)
  const error = ref<unknown>(null)
  const pageIndex = computed(() => cursors.value.length - 1)

  let sequence = 0
  async function load () {
    if (options.enabled !== undefined && !toValue(options.enabled)) {
      return
    }
    const current = ++sequence
    loading.value = true
    error.value = null
    const targetId = toValue(options.targetId)
    const cursor = cursors.value.at(-1)
    try {
      const page = searching.value
        ? await api<Page<ConceptDescriptionSummary>>(`/targets/${targetId}/searches`, {
            method: 'POST',
            body: {
              scope: 'conceptDescriptions',
              ...(rawQuery.value ? { query: rawQuery.value } : { expression: applied.value }),
              ...(sources.value.length > 0 ? { sources: sources.value } : {}),
              limit: pageSize.value,
              cursor,
            },
          })
        : await api<Page<ConceptDescriptionSummary>>(`/targets/${targetId}/concept-descriptions`, { query: { limit: pageSize.value, cursor } })
      if (current === sequence) {
        items.value = page.items
        nextCursor.value = page.page.nextCursor
      }
    } catch (error_) {
      if (current === sequence) {
        items.value = []
        nextCursor.value = null
        error.value = error_
      }
    } finally {
      if (current === sequence) {
        loading.value = false
      }
    }
  }

  /** Back to the first page, e.g. after the search changed. */
  function restart () {
    cursors.value = [undefined]
    void load()
  }

  function next () {
    if (nextCursor.value) {
      cursors.value = [...cursors.value, nextCursor.value]
      void load()
    }
  }

  function previous () {
    if (cursors.value.length > 1) {
      cursors.value = cursors.value.slice(0, -1)
      void load()
    }
  }

  const request = computed(() => JSON.stringify([toValue(options.targetId), mode.value, searching.value ? [rawQuery.value ?? applied.value, sources.value] : null, pageSize.value]))
  watch([request, () => options.enabled === undefined || toValue(options.enabled)], ([, enabled]) => {
    if (enabled) {
      restart()
    }
  }, { immediate: true })

  /** Without a server search, the text and sources narrow the page shown: name, idShort, ID and definition, `id:` and `idShort:`. */
  function matchesLocally (row: ConceptDescriptionRow): boolean {
    if (sources.value.length > 0 && !sources.value.includes(row.source)) {
      return false
    }
    const parsed = parseSearch(applied.value, conceptDescriptionSearchFields)
    const needle = parsed.text.toLowerCase()
    if (needle && ![row.name, row.idShort ?? '', row.id, row.definition].some(value => value.toLowerCase().includes(needle))) {
      return false
    }
    return parsed.filters.every(filter => {
      const value = filter.field === 'id' ? row.id : (row.idShort ?? '')
      const found = filter.operator === 'contains' ? value.includes(filter.value) : value === filter.value
      return filter.operator === 'not-equals' ? !found : found
    })
  }

  const rows = computed<ConceptDescriptionRow[]>(() => {
    const all = items.value.map(cd => ({
      ...cd,
      name: langText(cd.preferredName, preferences.value.valueLanguage) ?? cd.idShort ?? cd.id,
      definition: langText(cd.definition, preferences.value.valueLanguage) ?? '',
      source: conceptDescriptionSource(cd.id),
    }))
    return localOnly.value ? all.filter(row => matchesLocally(row)) : all
  })

  /** The list says it filters the page shown only, where the target cannot search. */
  const pageFilterOnly = computed(() => localOnly.value && (applied.value !== '' || sources.value.length > 0))

  return {
    search,
    selected,
    pageSize,
    rawQuery,
    queryable,
    pageFilterOnly,
    filterGroups,
    items,
    rows,
    loading,
    error,
    pageIndex,
    hasNext: computed(() => nextCursor.value !== null),
    hasPrevious: computed(() => cursors.value.length > 1),
    next,
    previous,
    /** Loads the page shown again, e.g. after a write. */
    reload: load,
    restart,
    /** For the search bar, which gets the search as a prop. */
    setSearch: (value: string | null) => (search.value = value),
    setSelected: (value: string[]) => (selected.value = value),
    setRawQuery: (value: Record<string, unknown> | null) => (rawQuery.value = value),
  }
}

export type ConceptDescriptionSearch = ReturnType<typeof useConceptDescriptionSearch>
