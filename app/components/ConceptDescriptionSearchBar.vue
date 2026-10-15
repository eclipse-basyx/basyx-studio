<template>
  <!-- The search of the record lists (infrastructures, targets, apps), with
       the source in its filter menu and the advanced query beside it; the
       Concepts page and the link picker share it (MVP-6 plan, S1). -->
  <ListFilterBar
    v-model:search="search"
    v-model:selected="selected"
    :groups="state.filterGroups.value"
    :placeholder="t('concepts.search')"
  >
    <template #append>
      <v-chip
        v-if="state.rawQuery.value"
        closable
        color="primary"
        prepend-icon="mdi-code-braces"
        :text="t('shells.query.active')"
        @click="queryDialog = true"
        @click:close="rawQuery = null"
      />

      <v-btn
        v-if="state.queryable.value"
        v-tooltip="t('shells.query.title')"
        :aria-label="t('shells.query.title')"
        :color="state.rawQuery.value ? 'primary' : undefined"
        icon="mdi-code-braces"
        @click="queryDialog = true"
      />

      <slot name="append" />
    </template>
  </ListFilterBar>

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

  const props = defineProps<{
    targetId: string
    /** The search it edits (`useConceptDescriptionSearch`). */
    state: ConceptDescriptionSearch
  }>()
  defineSlots<{ append?: () => unknown }>()

  const { t } = useI18n()
  const queryDialog = ref(false)

  // The search belongs to the page or dialog around; the bar changes it through its setters.
  const search = computed({ get: () => props.state.search.value, set: value => props.state.setSearch(value) })
  const selected = computed({ get: () => props.state.selected.value, set: value => props.state.setSelected(value) })
  const rawQuery = computed({ get: () => props.state.rawQuery.value, set: value => props.state.setRawQuery(value) })
</script>
