<template>
  <v-container>
    <PageHeader :subtitle="t('concepts.subtitle')" :title="t('concepts.title')" />

    <ProblemAlert
      v-if="error"
      class="mb-4"
      :error="error"
      retry
      @retry="load"
    />

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
        item-value="id"
        :items="filtered"
        :loading="loading"
        :mobile="xs"
        :search="search ?? undefined"
        show-expand
      >
        <template #[`item.idShort`]="{ item }">
          <v-list-item class="px-0" :subtitle="item.id" :title="item.name" />
        </template>

        <template #[`item.source`]="{ value }">
          <v-chip v-if="value !== 'Other'" :color="value === 'IDTA' ? 'primary' : 'secondary'" :text="value" />
        </template>

        <template #[`item.actions`]="{ item }">
          <v-btn
            v-tooltip="t('concepts.copyId')"
            :aria-label="t('concepts.copyId')"
            icon="mdi-content-copy"
            size="small"
            @click="copy(item.id, t('concepts.id'))"
          />
        </template>

        <template #expanded-row="{ columns, item }">
          <tr>
            <td :colspan="columns.length">
              <v-alert
                class="my-3"
                color="primary"
                icon="mdi-information-outline"
                :text="item.definition || t('concepts.noDefinition')"
                :title="t('concepts.definition')"
              />
            </td>
          </tr>
        </template>
      </v-data-table>
    </v-card>
  </v-container>
</template>

<script lang="ts" setup>
  import type { ConceptDescriptionSummary, Page } from '#shared/contract'
  import { useDisplay } from 'vuetify'
  import { langText } from '~/utils/aas'

  const { t } = useI18n()
  const route = useRoute()
  const api = useStudioApi()
  const copy = useClipboard()
  const preferences = usePreferences().preferences
  const { xs, smAndUp } = useDisplay()

  const targetId = computed(() => String(route.params.targetId))
  const maxItems = 1000

  const items = ref<ConceptDescriptionSummary[]>([])
  const loading = ref(false)
  const truncated = ref(false)
  const error = ref<unknown>(null)
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

  const rows = computed(() => items.value.map(cd => ({
    ...cd,
    name: langText(cd.preferredName, preferences.value.valueLanguage) ?? cd.idShort ?? cd.id,
    definition: langText(cd.definition, preferences.value.valueLanguage) ?? '',
    source: sourceOf(cd.id),
  })))
  const filtered = computed(() => source.value ? rows.value.filter(row => row.source === source.value) : rows.value)

  /** Loads all pages up to a limit; filtering and sorting then happen in the browser. */
  async function load () {
    loading.value = true
    error.value = null
    items.value = []
    truncated.value = false
    try {
      let cursor: string | undefined
      do {
        const page = await api<Page<ConceptDescriptionSummary>>(`/targets/${targetId.value}/concept-descriptions`, { query: { limit: 200, cursor } })
        items.value = [...items.value, ...page.items]
        cursor = page.page.nextCursor ?? undefined
      } while (cursor && items.value.length < maxItems)
      truncated.value = Boolean(cursor)
    } catch (error_) {
      error.value = error_
    } finally {
      loading.value = false
    }
  }

  watch(targetId, load, { immediate: true })
</script>
