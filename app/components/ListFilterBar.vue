<template>
  <!-- Search and filters above a record list (infrastructures, targets,
       apps), as in the shell list: the filters are in a menu that opens from
       the field (click or ↓); one chip in the field says how many apply.
       The `append` slot adds controls to the right of the field, e.g. a view. -->
  <div class="d-flex align-center ga-2 pa-2">
    <v-menu
      v-model="menu"
      :close-on-content-click="false"
      location="bottom start"
      :open-on-click="false"
    >
      <template #activator="{ props: activator }">
        <v-text-field
          v-bind="activator"
          v-model="search"
          :aria-label="placeholder"
          class="flex-grow-1"
          clearable
          density="compact"
          :placeholder="placeholder"
          prepend-inner-icon="mdi-magnify"
          @click="menu = groups.length > 0"
          @keydown.down.prevent="menu = groups.length > 0"
          @keydown.esc="menu = false"
          @update:model-value="menu = false"
        >
          <template v-if="selected.length > 0" #default>
            <v-chip
              :aria-label="t('lists.filtersApplied', selected.length)"
              class="ms-n1 me-2"
              closable
              color="primary"
              prepend-icon="mdi-filter-variant"
              :text="t('lists.filters', selected.length)"
              @click.stop="menu = true"
              @click:close.stop="selected = []"
            />
          </template>

          <!-- A hint that the field has filters, not a second way to open them. -->
          <template v-if="groups.length > 0" #append-inner>
            <v-icon :color="selected.length > 0 ? 'primary' : undefined" icon="mdi-filter-variant" />
          </template>
        </v-text-field>
      </template>

      <v-card min-width="280">
        <v-list v-model:selected="selected" max-height="420" select-strategy="leaf" selectable>
          <template v-for="(group, index) in groups" :key="group.title">
            <v-divider v-if="index > 0" class="my-1" />

            <v-list-subheader :title="group.title" />

            <v-list-item
              v-for="option in group.options"
              :key="option.value"
              :prepend-icon="option.icon"
              :title="option.title"
              :value="option.value"
            >
              <template #append="{ isSelected }">
                <v-icon v-if="isSelected" color="primary" icon="mdi-check" size="small" />
              </template>
            </v-list-item>
          </template>
        </v-list>
      </v-card>
    </v-menu>

    <slot name="append" />
  </div>
</template>

<script lang="ts" setup>
  import type { FilterGroup } from '~/utils/records'

  defineProps<{
    placeholder: string
    groups: FilterGroup[]
  }>()
  defineSlots<{ append?: () => unknown }>()
  const search = defineModel<string | null>('search', { required: true })
  const selected = defineModel<string[]>('selected', { required: true })

  const { t } = useI18n()
  const menu = ref(false)
</script>
