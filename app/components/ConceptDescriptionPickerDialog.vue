<template>
  <v-dialog v-model="open" max-width="720" scrollable>
    <DialogCard flush :title="t('cd.linkTitle')">
      <!-- The search bar of the Concepts page: text, source filters, advanced query (MVP-6 plan, S1). -->
      <ConceptDescriptionSearchBar :state="cds" :target-id="targetId" />

      <v-divider />

      <ProblemAlert
        v-if="cds.error.value"
        class="ma-3"
        :error="cds.error.value"
        retry
        @retry="cds.reload()"
      />

      <v-skeleton-loader v-else-if="cds.loading.value && cds.rows.value.length === 0" type="list-item-two-line@4" />

      <v-empty-state
        v-else-if="cds.rows.value.length === 0"
        icon="mdi-book-search-outline"
        size="48"
        :text="t('cd.linkEmpty')"
      />

      <v-list v-else lines="two">
        <v-list-item
          v-for="row in cds.rows.value"
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
      </v-list>

      <v-divider />

      <CursorPager
        v-model:page-size="pageSize"
        :count="cds.rows.value.length"
        :has-next="cds.hasNext.value"
        :has-previous="cds.hasPrevious.value"
        :loading="cds.loading.value"
        :page="cds.pageIndex.value"
        :sizes="conceptDescriptionPageSizes"
        @next="cds.next()"
        @previous="cds.previous()"
      />

      <template #actions>
        <v-btn :text="t('common.cancel')" @click="open = false" />
      </template>
    </DialogCard>
  </v-dialog>
</template>

<script lang="ts" setup>
  import { noCapabilities } from '#shared/contract'
  import { conceptDescriptionPageSizes } from '~/composables/useConceptDescriptionSearch'

  // Picks an existing concept description of the target, so an element's
  // semantic ID can point to it (MVP-6 plan, E5), with the search and the
  // paging of the Concepts page.
  const props = defineProps<{
    targetId: string
    /** The concept description the element names now, marked in the list. */
    current?: string | null
  }>()
  const emit = defineEmits<{ pick: [id: string] }>()
  const open = defineModel<boolean>({ required: true })

  const { t } = useI18n()
  const target = useTarget(() => props.targetId)
  const pageSize = ref(25)
  const cds = useConceptDescriptionSearch({
    targetId: () => props.targetId,
    capabilities: () => target.data.value?.capabilities ?? noCapabilities,
    enabled: () => open.value && target.data.value !== undefined,
    state: { search: ref<string | null>(''), selected: ref<string[]>([]), pageSize },
  })

  // Every opening starts with an empty search; concept descriptions created meanwhile appear.
  watch(open, value => {
    if (value) {
      cds.search.value = ''
      cds.selected.value = []
      cds.rawQuery.value = null
    }
  })

  function pick (id: string) {
    emit('pick', id)
    open.value = false
  }
</script>
