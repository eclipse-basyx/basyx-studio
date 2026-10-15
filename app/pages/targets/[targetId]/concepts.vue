<template>
  <div>
    <v-container>
      <PageHeader :subtitle="t('concepts.subtitle')" :title="t('concepts.title')" />

      <ProblemAlert
        v-if="error"
        class="mb-4"
        :error="error"
        retry
        @retry="load"
      />

      <ProblemAlert v-if="actionError" class="mb-4" :error="actionError" />

      <v-card>
        <v-toolbar class="px-3" color="transparent">
          <v-text-field
            v-model="search"
            clearable
            density="compact"
            max-width="420"
            :placeholder="t('concepts.search')"
            prepend-inner-icon="mdi-magnify"
          />

          <v-spacer />

          <v-chip-group v-if="smAndUp && sources.length > 0" v-model="source" selected-class="text-primary">
            <v-chip
              v-for="entry in sources"
              :key="entry"
              filter
              :text="entry"
              :value="entry"
            />
          </v-chip-group>

          <WorkspaceActions
            v-if="target.data.value?.workspace"
            class="ms-2"
            :target="target.data.value"
            @error="value => (actionError = value)"
            @restored="onRestored"
          />

          <!-- Creating needs edit mode (UX-006): new, or from JSON. -->
          <v-btn-group v-if="canWrite" class="ms-2" density="compact">
            <v-btn prepend-icon="mdi-plus" :text="xs ? undefined : t('cd.new')" @click="adding = true" />

            <v-menu>
              <template #activator="{ props: activator }">
                <v-btn v-bind="activator" :aria-label="t('cd.moreCreate')" icon="mdi-chevron-down" />
              </template>

              <v-list>
                <v-list-item prepend-icon="mdi-code-json" :title="t('cd.fromJson')" @click="inserting = true" />
              </v-list>
            </v-menu>
          </v-btn-group>
        </v-toolbar>

        <v-divider />

        <v-alert
          v-if="truncated"
          density="compact"
          rounded="0"
          :text="t('concepts.truncated', { count: maxItems })"
          type="info"
        />

        <v-data-table
          :headers="headers"
          item-value="key"
          :items="filtered"
          :loading="loading"
          :mobile="xs"
          :row-props="rowProps"
          :search="search ?? undefined"
          @click:row="(_: unknown, row: { item: Row }) => select(row.item.key)"
        >
          <template #[`item.idShort`]="{ item }">
            <v-list-item class="px-0" :subtitle="item.id" :title="item.name">
              <template v-if="drafts.has(targetId, conceptDescriptionDraftSlot(item.key), 'concept-description')" #append>
                <v-icon v-tooltip="t('editor.unapplied')" color="warning" icon="mdi-circle-medium" />
              </template>
            </v-list-item>
          </template>

          <template #[`item.source`]="{ value }">
            <v-chip v-if="value !== 'Other'" :color="value === 'IDTA' ? 'primary' : 'secondary'" :text="value" />
          </template>

          <template #[`item.actions`]="{ item }">
            <v-menu>
              <template #activator="{ props: activator }">
                <v-btn
                  v-bind="activator"
                  :aria-label="t('cd.actions')"
                  icon="mdi-dots-vertical"
                  size="small"
                  @click.stop
                />
              </template>

              <v-list>
                <v-list-item prepend-icon="mdi-content-copy" :title="t('concepts.copyId')" @click="copy(item.id, t('concepts.id'))" />

                <v-list-item
                  v-if="canWrite"
                  base-color="error"
                  prepend-icon="mdi-delete-outline"
                  :title="t('cd.delete')"
                  @click="askDelete(item.key, item.name)"
                />
              </v-list>
            </v-menu>
          </template>
        </v-data-table>
      </v-card>

      <ConceptDescriptionAddDialog v-model="adding" :target-id="targetId" @created="onCreated" />

      <JsonInsertDialog
        v-model="inserting"
        kind="conceptDescription"
        :submit="insertJson"
        :target-id="targetId"
        :title="t('cd.fromJsonTitle')"
      />

      <!-- Deleting names the concept description and what references it (L5, UX-003). -->
      <v-dialog v-model="confirmDelete" max-width="460">
        <DialogCard :title="t('cd.deleteTitle')">
          <p class="text-body-medium mb-3">{{ t('cd.deleteText', { name: deleting?.name ?? '' }) }}</p>

          <v-skeleton-loader v-if="usages.isPending.value" type="text" />

          <v-alert
            v-else-if="usages.data.value && !usages.data.value.checked"
            density="compact"
            :text="t('cd.usagesUnknown')"
            type="info"
          />

          <v-alert
            v-else-if="usages.data.value && (usages.data.value.submodels > 0 || usages.data.value.elements > 0)"
            density="compact"
            :text="usageText(usages.data.value)"
            type="warning"
          />

          <v-alert v-else-if="usages.data.value" density="compact" :text="t('cd.unused')" type="success" />

          <template #actions>
            <v-btn :text="t('common.cancel')" @click="confirmDelete = false" />
            <v-btn-primary color="error" :loading="removing" :text="t('cd.delete')" @click="remove" />
          </template>
        </DialogCard>
      </v-dialog>
    </v-container>

    <ConceptDescriptionDrawer
      v-if="target.data.value"
      v-model:mode="mode"
      :can-write="canWrite"
      :capabilities="capabilities"
      :cd-key="selectedKey"
      :target-id="targetId"
      @changed="onChanged"
      @delete="detail => askDelete(detail.key, rowName(detail.key))"
    />
  </div>
</template>

<script lang="ts" setup>
  import type { ConceptDescriptionDetail, ConceptDescriptionSummary, ConceptDescriptionUsages, Page, TargetCapabilities } from '#shared/contract'
  import { useQuery, useQueryCache } from '@pinia/colada'
  import { useDisplay } from 'vuetify'
  import { noCapabilities } from '#shared/contract'
  import { conceptDescriptionDraftSlot } from '~/stores/drafts'
  import { langText, resourceKey } from '~/utils/aas'

  type Row = Omit<ConceptDescriptionSummary, 'definition'> & { key: string, name: string, definition: string, source: string }

  const { t } = useI18n()
  const route = useRoute()
  const router = useRouter()
  const api = useStudioApi()
  const copy = useClipboard()
  const ui = useUiStore()
  const drafts = useDraftStore()
  const queryCache = useQueryCache()
  const notifications = useNotificationsStore()
  const structureActions = useStructureActionsStore()
  const preferences = usePreferences().preferences
  const { xs, smAndUp } = useDisplay()

  const targetId = computed(() => String(route.params.targetId))
  const target = useTarget(targetId)
  const capabilities = computed<TargetCapabilities>(() => target.data.value?.capabilities ?? noCapabilities)
  // Concept descriptions change like submodels: edit mode and a target that takes structural writes (MVP-6 plan, W4).
  const canWrite = computed(() => ui.editing && capabilities.value.conceptDescriptions && capabilities.value.writeStructure && capabilities.value.createResources)
  const maxItems = 1000

  const items = ref<ConceptDescriptionSummary[]>([])
  const loading = ref(false)
  const truncated = ref(false)
  const error = ref<unknown>(null)
  const actionError = ref<unknown>(null)
  // Kept per target while the user visits other pages (usePageState).
  const search = usePageState<string | null>(() => `concepts:${targetId.value}:search`, () => '')
  const source = usePageState<string | null>(() => `concepts:${targetId.value}:source`, () => null)

  // Columns and filters only for what the data has (D18).
  const sources = computed(() => [...new Set(rows.value.map(row => row.source))].filter(entry => entry !== 'Other').toSorted())
  const hasUnits = computed(() => items.value.some(cd => cd.unit))
  const headers = computed(() => [
    { title: t('concepts.concept'), key: 'idShort' },
    { title: t('concepts.dataType'), key: 'dataType', width: 160 },
    ...(hasUnits.value ? [{ title: t('concepts.unit'), key: 'unit', width: 100 }] : []),
    ...(sources.value.length > 0 ? [{ title: t('concepts.source'), key: 'source', width: 120 }] : []),
    { title: '', key: 'actions', sortable: false, align: 'end' as const, width: 64 },
  ])

  // By IRDI prefix: ECLASS (0173-) and the IEC Common Data Dictionary (0112/);
  // IDTA templates live under admin-shell.io.
  function sourceOf (id: string): string {
    if (id.startsWith('0173-')) {
      return 'ECLASS'
    }
    if (id.startsWith('0112/')) {
      return 'IEC CDD'
    }
    return id.includes('admin-shell.io') ? 'IDTA' : 'Other'
  }

  const rows = computed<Row[]>(() => items.value.map(cd => ({
    ...cd,
    key: resourceKey(cd.id),
    name: langText(cd.preferredName, preferences.value.valueLanguage) ?? cd.idShort ?? cd.id,
    definition: langText(cd.definition, preferences.value.valueLanguage) ?? '',
    source: sourceOf(cd.id),
  })))
  const filtered = computed(() => source.value ? rows.value.filter(row => row.source === source.value) : rows.value)

  function rowName (key: string): string {
    return rows.value.find(row => row.key === key)?.name ?? key
  }

  /** Loads all pages up to a limit; filtering and sorting then happen in the browser. */
  async function load () {
    loading.value = true
    error.value = null
    truncated.value = false
    try {
      const loaded: ConceptDescriptionSummary[] = []
      let cursor: string | undefined
      do {
        const page = await api<Page<ConceptDescriptionSummary>>(`/targets/${targetId.value}/concept-descriptions`, { query: { limit: 200, cursor } })
        loaded.push(...page.items)
        cursor = page.page.nextCursor ?? undefined
      } while (cursor && loaded.length < maxItems)
      items.value = loaded
      truncated.value = Boolean(cursor)
    } catch (error_) {
      items.value = []
      error.value = error_
    } finally {
      loading.value = false
    }
  }

  watch(targetId, load, { immediate: true })

  // The selection and the drawer's mode are in the URL (L3): `cd` and `mode`.
  const selectedKey = computed(() => typeof route.query.cd === 'string' ? route.query.cd : null)
  const mode = computed({
    get: () => (route.query.mode === 'json' || route.query.mode === 'xml' ? route.query.mode : 'details'),
    set: (value: 'details' | 'json' | 'xml') => router.replace({ query: { ...route.query, mode: value === 'details' ? undefined : value } }),
  })

  function select (key: string | null) {
    void router.replace({ query: { ...route.query, cd: key ?? undefined } })
    ui.detailsDrawer = key !== null
  }

  // A deep link opens the drawer.
  onMounted(() => {
    if (selectedKey.value) {
      ui.detailsDrawer = true
    }
  })

  function rowProps ({ item }: { item: Row }) {
    return { class: item.key === selectedKey.value ? 'bg-surface-light cursor-pointer' : 'cursor-pointer' }
  }

  /** The list row of a concept description, updated in place without reloading the whole list. */
  function upsert (detail: ConceptDescriptionDetail) {
    const summary = toSummary(detail.conceptDescription)
    const index = items.value.findIndex(item => item.id === summary.id)
    items.value = index === -1 ? [...items.value, summary] : items.value.map((item, position) => position === index ? summary : item)
  }

  function toSummary (cd: Record<string, any>): ConceptDescriptionSummary {
    const content = ((cd.embeddedDataSpecifications ?? []) as Array<Record<string, any>>)
      .map(entry => entry.dataSpecificationContent)
      .find(value => value && typeof value === 'object') ?? {}
    return {
      id: String(cd.id),
      idShort: typeof cd.idShort === 'string' ? cd.idShort : null,
      preferredName: Array.isArray(content.preferredName) ? content.preferredName : [],
      definition: Array.isArray(content.definition) ? content.definition : [],
      dataType: typeof content.dataType === 'string' ? content.dataType : null,
      unit: typeof content.unit === 'string' ? content.unit : null,
    }
  }

  /** A workspace now has unsaved changes; the target's state says so. Units beside values follow (E6). */
  function afterWrite () {
    void queryCache.invalidateQueries({ key: conceptDescriptionsKey(targetId.value) })
    if (target.data.value?.workspace) {
      void queryCache.invalidateQueries({ key: ['targets', targetId.value], exact: true })
    }
  }

  function onChanged (detail: ConceptDescriptionDetail) {
    upsert(detail)
    afterWrite()
  }

  // Creating: empty or from JSON (L4).
  const adding = ref(false)
  const inserting = ref(false)

  function onCreated (detail: ConceptDescriptionDetail) {
    upsert(detail)
    queryCache.setQueryData(['targets', targetId.value, 'concept-descriptions', detail.key], detail)
    notifications.notify({ text: t('cd.created', { name: rowName(detail.key) }), color: 'success' })
    select(detail.key)
    afterWrite()
  }

  async function insertJson (value: Record<string, unknown>) {
    const detail = await api<ConceptDescriptionDetail>(`/targets/${targetId.value}/concept-descriptions`, { method: 'POST', body: { conceptDescription: value } })
    onCreated(detail)
  }

  // Deleting (L5)
  const confirmDelete = ref(false)
  const deleting = ref<{ key: string, name: string } | null>(null)
  const removing = ref(false)
  const usages = useQuery({
    key: () => ['targets', targetId.value, 'concept-descriptions', deleting.value?.key ?? '', 'usages'],
    query: ({ signal }) => api<ConceptDescriptionUsages>(`/targets/${targetId.value}/concept-descriptions/${deleting.value!.key}/usages`, { signal }),
    enabled: () => confirmDelete.value && deleting.value !== null,
    staleTime: 0,
  })

  function usageText (counted: ConceptDescriptionUsages): string {
    const text = t('cd.usages', { submodels: t('cd.usageSubmodels', counted.submodels), elements: t('cd.usageElements', counted.elements) })
    return counted.truncated ? `${text} ${t('cd.usagesTruncated')}` : text
  }

  function askDelete (key: string, name: string) {
    deleting.value = { key, name }
    confirmDelete.value = true
  }

  async function remove () {
    const entry = deleting.value
    if (!entry) {
      return
    }
    removing.value = true
    actionError.value = null
    try {
      // The revision the user saw: the drawer's, or a fresh read from the list.
      const detail = queryCache.getQueryData<ConceptDescriptionDetail>(['targets', targetId.value, 'concept-descriptions', entry.key])
        ?? await api<ConceptDescriptionDetail>(`/targets/${targetId.value}/concept-descriptions/${entry.key}`)
      await api(`/targets/${targetId.value}/concept-descriptions/${entry.key}`, { method: 'DELETE', headers: { 'If-Match': `"${detail.revision}"` } })
      items.value = items.value.filter(item => resourceKey(item.id) !== entry.key)
      drafts.discard(targetId.value, conceptDescriptionDraftSlot(entry.key), 'concept-description')
      queryCache.remove(queryCache.get(['targets', targetId.value, 'concept-descriptions', entry.key])!)
      notifications.notify({ text: t('cd.deleted', { name: entry.name }), color: 'success' })
      if (selectedKey.value === entry.key) {
        select(null)
      }
      afterWrite()
    } catch (error_) {
      actionError.value = error_
    } finally {
      removing.value = false
      confirmDelete.value = false
    }
  }

  // Undo and redo on a workspace change concept descriptions too (W3).
  async function onRestored () {
    await load()
    await queryCache.invalidateQueries({ key: ['targets', targetId.value, 'concept-descriptions'] })
  }

  // The palette offers the page's actions in edit mode (L6).
  watch([canWrite, selectedKey], ([writable, key]) => {
    structureActions.set(writable
      ? [
        { key: 'cd:new', title: t('cd.new'), icon: 'mdi-plus', run: () => (adding.value = true) },
        { key: 'cd:json', title: t('cd.fromJson'), icon: 'mdi-code-json', run: () => (inserting.value = true) },
        ...(key ? [{ key: 'cd:delete', title: t('cd.delete'), icon: 'mdi-delete-outline', run: () => askDelete(key, rowName(key)) }] : []),
      ]
      : [])
  }, { immediate: true })
  onBeforeUnmount(() => structureActions.set([]))

  // Switching targets closes the drawer: its selection belongs to the old one.
  watch(targetId, () => {
    ui.detailsDrawer = false
  })

</script>
