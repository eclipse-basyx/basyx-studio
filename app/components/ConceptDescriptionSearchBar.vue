<template>
  <!-- The search of the shell list, with the fields the query language knows
       for concept descriptions (id, idShort), the source as a facet filter
       and the advanced query in its menu; the Concepts page and the link
       picker share it (MVP-6 plan, S1). -->
  <div class="d-flex align-center ga-2 pa-2">
    <div class="flex-grow-1">
      <SearchExpressionField
        v-model="search"
        v-model:selected="selected"
        :advanced-enabled="state.queryable.value"
        :fields="conceptDescriptionSearchFields"
        :groups="state.filterGroups.value"
        :loading="state.loading.value"
        :placeholder="t('concepts.search')"
        :query-active="state.rawQuery.value !== null"
        @advanced="queryDialog = true"
        @clear-query="rawQuery = null"
      />
    </div>

    <slot name="append" />
  </div>

  <v-alert
    v-if="state.pageFilterOnly.value"
    density="compact"
    rounded="0"
    :text="t('concepts.localOnly')"
    type="info"
  />

  <ShellQueryDialog
    v-if="state.queryable.value"
    v-model="queryDialog"
    :expression="state.search.value ?? ''"
    :query="state.rawQuery.value"
    query-target="conceptDescriptions"
    :target-id="targetId"
    @apply="query => (rawQuery = query)"
  />
</template>

<script lang="ts" setup>
  import type { ConceptDescriptionSearch } from '~/composables/useConceptDescriptionSearch'
  import { conceptDescriptionSearchFields } from '#shared/search/expression'

  const props = defineProps<{
    targetId: string
    /** The search it edits (`useConceptDescriptionSearch`). */
    state: ConceptDescriptionSearch
  }>()
  defineSlots<{ append?: () => unknown }>()

  const { t } = useI18n()
  const queryDialog = ref(false)

  // The search belongs to the page or dialog around; the bar changes it through its setters.
  const search = computed({ get: () => props.state.search.value ?? '', set: value => props.state.setSearch(value) })
  const selected = computed({ get: () => props.state.selected.value, set: value => props.state.setSelected(value) })
  const rawQuery = computed({ get: () => props.state.rawQuery.value, set: value => props.state.setRawQuery(value) })
</script>
