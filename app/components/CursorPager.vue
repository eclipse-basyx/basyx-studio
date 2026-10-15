<template>
  <!-- Paging by the AAS API's cursors: no total, so forward and back, as
       Vuetify's table footer looks. -->
  <div class="d-flex flex-wrap align-center justify-end ga-4 px-4 py-2 text-body-small">
    <div class="d-flex align-center ga-2">
      <span>{{ t('lists.perPage') }}</span>

      <v-select
        density="compact"
        :items="sizes"
        :model-value="pageSize"
        width="96"
        @update:model-value="value => (pageSize = value)"
      />
    </div>

    <span>{{ count === 0 ? t('lists.noRows') : t('lists.range', { from: page * pageSize + 1, to: page * pageSize + count }) }}</span>

    <div class="d-flex ga-1">
      <v-btn
        :aria-label="t('lists.previousPage')"
        :disabled="!hasPrevious || loading"
        icon="mdi-chevron-left"
        size="small"
        @click="emit('previous')"
      />

      <v-btn
        :aria-label="t('lists.nextPage')"
        :disabled="!hasNext || loading"
        icon="mdi-chevron-right"
        size="small"
        @click="emit('next')"
      />
    </div>
  </div>
</template>

<script lang="ts" setup>
  defineProps<{
    /** The page shown, from 0. */
    page: number
    /** Rows on the page shown. */
    count: number
    hasNext: boolean
    hasPrevious: boolean
    loading?: boolean
    sizes: readonly number[]
  }>()
  const emit = defineEmits<{ next: [], previous: [] }>()
  const pageSize = defineModel<number>('pageSize', { required: true })

  const { t } = useI18n()
</script>
