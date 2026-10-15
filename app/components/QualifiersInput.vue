<template>
  <div class="d-flex flex-column ga-3">
    <div v-for="(qualifier, index) in qualifiers" :key="index" class="d-flex align-start ga-3">
      <v-text-field
        class="flex-grow-1"
        :label="t('editor.qualifierType')"
        :model-value="String(qualifier.type ?? '')"
        @update:model-value="text => change(index, { type: text })"
      />

      <v-select
        class="flex-grow-0"
        :items="valueTypes"
        :label="t('details.valueType')"
        :model-value="String(qualifier.valueType ?? 'xs:string')"
        width="150"
        @update:model-value="type => change(index, { valueType: type })"
      />

      <v-text-field
        class="flex-grow-1"
        :label="t('editor.qualifierValue')"
        :model-value="String(qualifier.value ?? '')"
        @update:model-value="text => change(index, { value: text })"
      />

      <v-btn
        :aria-label="t('editor.remove')"
        class="mt-2"
        icon="mdi-close"
        size="small"
        @click="qualifiers = qualifiers.filter((_, position) => position !== index)"
      />
    </div>

    <v-btn prepend-icon="mdi-plus" size="small" :text="t('editor.addQualifier')" @click="qualifiers = [...qualifiers, { type: '', valueType: 'xs:string', value: '' }]" />
  </div>
</template>

<script lang="ts" setup>
  import { valueTypes } from '~/utils/editor'

  // Qualifiers as rows: type, value type and value.
  const qualifiers = defineModel<Array<Record<string, unknown>>>({ required: true })

  const { t } = useI18n()

  function change (index: number, patch: Record<string, unknown>) {
    qualifiers.value = qualifiers.value.map((qualifier, position) => position === index ? { ...qualifier, ...patch } : qualifier)
  }
</script>
