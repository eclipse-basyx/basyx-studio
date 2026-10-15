<template>
  <v-dialog v-model="open" max-width="640" scrollable>
    <DialogCard flush :title="t('cd.linkTitle')">
      <div class="pa-3">
        <v-text-field
          v-model="search"
          autofocus
          clearable
          :placeholder="t('concepts.search')"
          prepend-inner-icon="mdi-magnify"
        />
      </div>

      <v-divider />

      <ProblemAlert
        v-if="list.error.value"
        class="ma-3"
        :error="list.error.value"
        retry
        @retry="list.refetch()"
      />

      <v-skeleton-loader v-else-if="list.isPending.value" type="list-item-two-line@4" />

      <v-empty-state
        v-else-if="matches.length === 0"
        icon="mdi-book-search-outline"
        size="48"
        :text="t('cd.linkEmpty')"
      />

      <v-list v-else lines="two" max-height="420">
        <v-list-item
          v-for="row in matches.slice(0, shown)"
          :key="row.id"
          :active="row.id === current"
          prepend-icon="mdi-book-open-page-variant-outline"
          :subtitle="row.id"
          :title="row.name"
          @click="pick(row.id)"
        >
          <template v-if="row.dataType || row.unit" #append>
            <div class="d-flex ga-1">
              <v-chip v-if="row.dataType" :text="row.dataType" />
              <v-chip v-if="row.unit" :text="row.unit" />
            </div>
          </template>
        </v-list-item>

        <v-list-item v-if="matches.length > shown" :title="t('cd.linkMore', { count: matches.length - shown })" @click="shown += 50" />
      </v-list>

      <template #actions>
        <v-btn :text="t('common.cancel')" @click="open = false" />
      </template>
    </DialogCard>
  </v-dialog>
</template>

<script lang="ts" setup>
  import { langText } from '~/utils/aas'

  // Picks an existing concept description of the target, so an element's
  // semantic ID can point to it (MVP-6 plan, E5). Searches the loaded page by
  // name, idShort and ID, as the Concepts page does.
  const props = defineProps<{
    targetId: string
    /** The concept description the element names now, marked in the list. */
    current?: string | null
  }>()
  const emit = defineEmits<{ pick: [id: string] }>()
  const open = defineModel<boolean>({ required: true })

  const { t } = useI18n()
  const preferences = usePreferences().preferences

  const list = useConceptDescriptions(() => props.targetId, open)

  const search = ref<string | null>('')
  const shown = ref(50)
  watch(open, value => {
    if (value) {
      search.value = ''
      shown.value = 50
      // Concept descriptions created meanwhile appear.
      void list.refetch()
    }
  })

  const rows = computed(() => (list.data.value ?? []).map(cd => ({
    id: cd.id,
    name: langText(cd.preferredName, preferences.value.valueLanguage) ?? cd.idShort ?? cd.id,
    idShort: cd.idShort ?? '',
    dataType: cd.dataType,
    unit: cd.unit,
  })))

  const matches = computed(() => {
    const needle = (search.value ?? '').trim().toLowerCase()
    return needle === ''
      ? rows.value
      : rows.value.filter(row => [row.name, row.idShort, row.id].some(text => text.toLowerCase().includes(needle)))
  })

  function pick (id: string) {
    emit('pick', id)
    open.value = false
  }
</script>
