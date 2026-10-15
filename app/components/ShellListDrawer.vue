<template>
  <v-navigation-drawer v-model="open" width="340">
    <div class="d-flex flex-column h-100">
      <!-- The search of the Web UI: suggestions for filters, the advanced query in its menu. -->
      <div class="px-3 pt-3 pb-1">
        <SearchExpressionField
          v-model="search"
          :advanced-enabled="Boolean(queryTarget)"
          :loading="searching && found.isLoading.value"
          :query-active="rawQuery !== null"
          :scannable="canScan"
          @advanced="queryDialog = true"
          @clear-query="rawQuery = null"
          @scan="scanOpen = true"
        />

        <div v-if="localOnly && search" class="text-body-small text-medium-emphasis mt-1">{{ t('shells.localOnly') }}</div>

        <v-btn-secondary
          v-if="canCreate"
          block
          class="mt-2"
          prepend-icon="mdi-plus"
          :text="t('wizard.newShell')"
          @click="wizardOpen = true"
        />

        <v-chip-group v-model="filter" class="mt-1" mandatory selected-class="text-primary">
          <v-chip filter :text="t('shells.all')" value="all" />
          <v-chip filter :text="t('shells.instances')" value="Instance" />
          <v-chip filter :text="t('shells.types')" value="Type" />
        </v-chip-group>
      </div>

      <v-divider />

      <!-- A deep link to a shell the list has not loaded yet keeps it in sight (DoD 6). -->
      <v-list v-if="pinned" class="flex-shrink-0 px-2 py-1" lines="two" nav>
        <v-list-item
          active
          prepend-icon="mdi-pin-outline"
          :subtitle="pinned.id"
          :title="pinned.title"
          :to="{ path: `/targets/${targetId}/shells/${activeKey}`, query: searchState }"
        />
      </v-list>

      <ProblemAlert
        v-if="source.error.value && items.length === 0"
        class="ma-2"
        :error="source.error.value"
        retry
        @retry="source.refetch()"
      />

      <v-skeleton-loader v-else-if="loading && items.length === 0" type="list-item-avatar-two-line@6" />

      <!-- Virtualized (DoD 6): only the visible rows exist, so thousands of shells scroll smoothly.
         Rows near the end load the next page. -->
      <v-list
        v-else-if="filtered.length > 0"
        class="flex-grow-1 px-2 py-0"
        height="0"
        lines="two"
        nav
      >
        <v-virtual-scroll ref="scroller" height="100%" item-key="key" :items="filtered">
          <template #default="{ item: shell, index }">
            <v-list-item
              v-intersect.once="(visible: boolean) => visible && onRowSeen(shell.key, index)"
              :active="shell.key === activeKey"
              :class="index === 0 ? 'mt-2' : undefined"
              :title="shellTitle(shell)"
              :to="{ path: `/targets/${targetId}/shells/${shell.key}`, query: searchState }"
              @click="onOpen"
            >
              <template #prepend>
                <ShellAvatar :shell="shell" size="36" :target-id="targetId" :thumbnails="thumbnails" />
              </template>

              <template #subtitle>{{ shell.id }}</template>

              <template #append>
                <v-icon
                  v-if="availability[shell.key] && availability[shell.key] !== 'available'"
                  v-tooltip="t(`shells.availability.${availability[shell.key]}`)"
                  :aria-label="t(`shells.availability.${availability[shell.key]}`)"
                  class="me-1"
                  color="error"
                  :icon="availabilityIcons[availability[shell.key]!]"
                  size="small"
                />

                <v-chip
                  v-if="shell.assetKind === 'Type'"
                  class="me-1"
                  color="warning"
                  size="x-small"
                  :text="t('shells.type')"
                />
              </template>
            </v-list-item>
          </template>
        </v-virtual-scroll>
      </v-list>

      <v-empty-state
        v-else-if="source.data.value"
        icon="mdi-cube-off-outline"
        size="64"
        :text="t('shells.noneText')"
        :title="t('shells.none')"
      >
        <template #actions>
          <v-btn :text="t('shells.reset')" variant="tonal" @click="reset" />
        </template>
      </v-empty-state>

      <!-- Outside the v-if chain above: the next page is loading below the rows. -->
      <v-progress-linear v-if="loadingMore" class="flex-shrink-0" />
    </div>

    <template #append>
      <v-divider />

      <v-list class="px-2">
        <v-list-item
          :prepend-icon="target ? targetIcon(target) : 'mdi-server-network'"
          :subtitle="preferences.preferences.value.autoRefresh ? t('shells.refreshOn', { seconds: preferences.preferences.value.refreshIntervalSeconds }) : t('shells.refreshOff')"
          :title="target?.name"
          :to="`/targets/${targetId}`"
        />
      </v-list>
    </template>
  </v-navigation-drawer>

  <ShellQueryDialog
    v-if="queryTarget"
    v-model="queryDialog"
    :expression="search ?? ''"
    :query="rawQuery"
    :query-target="queryTarget"
    :target-id="targetId"
    @apply="rawQuery = $event"
  />

  <QrScanDialog v-if="canScan" v-model="scanOpen" :target-id="targetId" />

  <ShellWizard v-if="canCreate" v-model="wizardOpen" :target-id="targetId" @created="onCreated" />
</template>

<script lang="ts" setup>
  import type { LangString, Page, ShellAvailability, ShellCreateResult, ShellDetail, ShellSearchPage, ShellSummary } from '#shared/contract'
  import type { ParsedSearch } from '#shared/search/expression'
  import { useInfiniteQuery, useQueryCache } from '@pinia/colada'
  import { useDisplay } from 'vuetify'
  import { parseSearch } from '#shared/search/expression'
  import { decodeResourceKey, langText, resourceKey, targetIcon } from '~/utils/aas'

  const props = defineProps<{ targetId: string, activeKey: string | null }>()

  const { t } = useI18n()
  const api = useStudioApi()
  const ui = useUiStore()
  const preferences = usePreferences()
  const { mdAndUp, mobile } = useDisplay()
  const target = useTarget(() => props.targetId).data
  // Lookup by asset ID needs discovery or queries on the repository (lookupShells).
  const canScan = computed(() => Boolean(target.value?.capabilities.discovery || target.value?.capabilities.queryTarget === 'repository'))
  const scanOpen = ref(false)
  // The creation wizard (MVP-5 plan, T3), in edit mode only.
  const canCreate = computed(() => ui.editing && Boolean(target.value?.capabilities.createResources))
  const wizardOpen = ref(false)

  async function onCreated (result: ShellCreateResult) {
    await queryCache.invalidateQueries({ key: ['targets', props.targetId] })
    await router.push(`/targets/${props.targetId}/shells/${result.shell.key}`)
  }

  const open = computed({
    get: () => ui.listDrawer ?? mdAndUp.value,
    set: (value: boolean) => (ui.listDrawer = value),
  })

  const route = useRoute()
  const router = useRouter()

  const filter = ref<'all' | 'Instance' | 'Type'>('all')

  // The search (MVP-4 plan, S2): the Web UI's expression syntax, or a raw
  // query from the advanced dialog, kept in the URL as `?search=` and
  // `?query=` (base64url JSON) so that links and reloads keep the list.
  function queryFromRoute (): Record<string, unknown> | null {
    const encoded = route.query.query
    const json = typeof encoded === 'string' ? decodeResourceKey(encoded) : null
    try {
      const value: unknown = json ? JSON.parse(json) : null
      return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
    } catch {
      return null
    }
  }
  const searchFromRoute = () => (typeof route.query.search === 'string' ? route.query.search : '')

  const search = ref(searchFromRoute())
  const rawQuery = ref<Record<string, unknown> | null>(queryFromRoute())
  const applied = ref(searchFromRoute().trim())
  const queryDialog = ref(false)

  let searchTimer: ReturnType<typeof setTimeout> | undefined
  watch(search, value => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => (applied.value = value.trim()), 300)
  })

  const searchState = computed(() => ({
    search: applied.value || undefined,
    query: rawQuery.value ? resourceKey(JSON.stringify(rawQuery.value)) : undefined,
  }))
  watch(searchState, state => {
    if (state.search !== route.query.search || state.query !== route.query.query) {
      void router.replace({ query: { ...route.query, ...state } })
    }
  })
  // Back and forward restore the search of the URL.
  watch(() => [route.query.search, route.query.query], () => {
    if (searchFromRoute().trim() !== applied.value) {
      search.value = searchFromRoute()
      applied.value = searchFromRoute().trim()
    }
    if (route.query.query !== searchState.value.query) {
      rawQuery.value = queryFromRoute()
    }
  })

  const queryTarget = computed(() => target.value?.capabilities.queryTarget ?? null)
  // AASX workspaces evaluate expressions themselves; other targets need a query endpoint.
  const serverSearch = computed(() => target.value !== undefined && target.value.capabilities.search !== 'filter')
  const localOnly = computed(() => target.value !== undefined && !serverSearch.value)
  const kindFilter = computed(() => (filter.value === 'Instance' || filter.value === 'Type' ? `assetKind=${filter.value}` : ''))
  const expression = computed(() => [applied.value, kindFilter.value].filter(Boolean).join(' '))
  const searching = computed(() => serverSearch.value && (rawQuery.value !== null || expression.value !== ''))

  const shells = useInfiniteQuery({
    key: () => ['targets', props.targetId, 'shells'],
    query: ({ pageParam, signal }) => api<Page<ShellSummary>>(`/targets/${props.targetId}/shells`, {
      query: { limit: 100, cursor: pageParam ?? undefined },
      signal,
    }),
    initialPageParam: null as string | null,
    getNextPageParam: lastPage => lastPage.page.nextCursor,
    enabled: () => target.value !== undefined && target.value.authenticationState !== 'required',
  })

  const mounted = ref(false)
  onMounted(() => (mounted.value = true))
  const found = useInfiniteQuery({
    key: () => ['targets', props.targetId, 'shells', 'search', rawQuery.value ?? expression.value],
    query: ({ pageParam, signal }) => api<ShellSearchPage>(`/targets/${props.targetId}/searches`, {
      method: 'POST',
      body: {
        scope: 'shells',
        ...(rawQuery.value ? { query: rawQuery.value } : { expression: expression.value }),
        limit: 100,
        cursor: pageParam ?? undefined,
      },
      signal,
    }),
    initialPageParam: null as string | null,
    getNextPageParam: lastPage => lastPage.page.nextCursor,
    // Searches are POST requests, which only the browser can make (they need
    // its Origin); the server renders the list as loading.
    enabled: () => mounted.value && searching.value && target.value?.authenticationState !== 'required',
  })
  const loading = computed(() => source.value.isLoading.value || (searching.value && !mounted.value))

  const source = computed(() => (searching.value ? found : shells))
  const items = computed(() => source.value.data.value?.pages.flatMap(page => page.items) ?? [])
  const thumbnails = computed(() => target.value?.capabilities.files ?? false)

  function shellTitle (shell: ShellSummary): string {
    return langText(shell.displayName) ?? shell.idShort ?? shell.id
  }

  // Without a query endpoint, the search filters the loaded shells by the
  // fields a list row has, with the hint that it does not cover the target.
  const summaryFields: Partial<Record<ParsedSearch['filters'][number]['field'], (shell: ShellSummary) => string | null>> = {
    id: shell => shell.id,
    idShort: shell => shell.idShort,
    assetKind: shell => shell.assetKind,
    globalAssetId: shell => shell.globalAssetId,
  }
  function matchesLocally (shell: ShellSummary, search: ParsedSearch): boolean {
    const needle = search.text.toLowerCase()
    if (needle && ![shellTitle(shell), shell.idShort, shell.id, shell.globalAssetId].some(value => value?.toLowerCase().includes(needle))) {
      return false
    }
    return search.filters.every(item => {
      const value = summaryFields[item.field]?.(shell) ?? null
      const found = value !== null && (item.operator === 'contains' ? value.includes(item.value) : value === item.value)
      return item.operator === 'not-equals' ? !found : found
    })
  }

  const filtered = computed(() => {
    const local = parseSearch(applied.value)
    const list = items.value.filter(shell => {
      // Server searches include the kind, except raw queries, which stay as written.
      const kindOnServer = searching.value && rawQuery.value === null
      if (!kindOnServer && (filter.value === 'Instance' || filter.value === 'Type') && shell.assetKind !== filter.value) {
        return false
      }
      return searching.value || matchesLocally(shell, local)
    })
    // In the infrastructure's order: sorting loaded pages would only sort what is loaded.
    return list
  })

  // The open shell stays in sight: the list scrolls to it once it is loaded,
  // and until then it is pinned above the list (DoD 6).
  const scroller = useTemplateRef<{ scrollToIndex: (index: number) => void }>('scroller')
  const queryCache = useQueryCache()
  let scrolledTo: string | null = null
  watch([() => props.activeKey, () => filtered.value.length], async ([key]) => {
    const index = key ? filtered.value.findIndex(shell => shell.key === key) : -1
    if (key && index >= 0 && scrolledTo !== key) {
      scrolledTo = key
      await nextTick()
      scroller.value?.scrollToIndex(Math.max(0, index - 2))
    }
  }, { immediate: true })
  const pinned = computed(() => {
    const key = props.activeKey
    if (!key || items.value.some(shell => shell.key === key)) {
      return null
    }
    const detail = queryCache.getQueryData<ShellDetail>(['targets', props.targetId, 'shells', key])
    const shell = detail?.shell as { id?: string, idShort?: string, displayName?: LangString[] } | undefined
    return shell?.id ? { id: shell.id, title: langText(shell.displayName ?? []) ?? shell.idShort ?? shell.id } : null
  })

  // The next page, once one of the last rows is on screen.
  const loadingMore = ref(false)
  async function onRowSeen (key: string, index: number) {
    seen(key)
    const list = source.value
    if (index < filtered.value.length - 20 || !list.hasNextPage.value || loadingMore.value) {
      return
    }
    loadingMore.value = true
    try {
      await list.loadNextPage()
    } finally {
      loadingMore.value = false
    }
  }

  // Online markers (as in the BaSyx AAS Web UI): registry entries may point to
  // shells that cannot be opened. Rows are checked once when they come into
  // view, in batches; the markers are a hint, so failures are ignored.
  type Status = ShellAvailability['items'][number]['status']
  const availabilityIcons: Record<Status, string> = {
    available: 'mdi-check',
    forbidden: 'mdi-lock-outline',
    not_found: 'mdi-help-circle-outline',
    blocked: 'mdi-link-variant-off',
    unreachable: 'mdi-cloud-off-outline',
  }
  const availability = ref<Record<string, Status>>({})
  const pending = new Set<string>()
  let checkTimer: ReturnType<typeof setTimeout> | undefined
  function seen (key: string) {
    if (target.value?.capabilities.listSource !== 'registry' || key in availability.value) {
      return
    }
    pending.add(key)
    clearTimeout(checkTimer)
    checkTimer = setTimeout(checkAvailability, 300)
  }
  async function checkAvailability () {
    const keys = [...pending].slice(0, 50)
    for (const key of keys) {
      pending.delete(key)
    }
    if (keys.length === 0) {
      return
    }
    const targetId = props.targetId
    try {
      const result = await api<ShellAvailability>(`/targets/${targetId}/shell-availability`, { method: 'POST', body: { keys } })
      if (targetId === props.targetId) {
        availability.value = { ...availability.value, ...Object.fromEntries(result.items.map(item => [item.key, item.status])) }
      }
    } catch {
      // Without markers the list still works.
    }
    if (pending.size > 0) {
      checkTimer = setTimeout(checkAvailability, 300)
    }
  }
  watch(() => props.targetId, () => {
    availability.value = {}
    pending.clear()
  })
  onScopeDispose(() => clearTimeout(checkTimer))

  function onOpen () {
    if (mobile.value) {
      ui.listDrawer = false
    }
  }

  function reset () {
    search.value = ''
    applied.value = ''
    rawQuery.value = null
    filter.value = 'all'
  }

  onScopeDispose(() => clearTimeout(searchTimer))
</script>
