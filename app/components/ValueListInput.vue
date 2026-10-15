<template>
  <div class="d-flex flex-column ga-3">
    <div v-for="(pair, index) in pairs" :key="index" class="d-flex align-start ga-3">
      <v-text-field
        class="flex-grow-0"
        :label="t('dataSpec.value')"
        :model-value="String(pair.value ?? '')"
        width="160"
        @update:model-value="text => change(index, { value: text })"
      />

      <ReferenceInput
        class="flex-grow-1"
        :model-value="pair.valueId"
        :placeholder="t('dataSpec.valueId')"
        required
        @update:model-value="reference => change(index, { valueId: reference })"
      />

      <v-btn
        :aria-label="t('editor.remove')"
        class="mt-2"
        icon="mdi-close"
        size="small"
        @click="pairs = pairs.filter((_, position) => position !== index)"
      />
    </div>

    <v-btn
      class="align-self-start"
      prepend-icon="mdi-plus"
      size="small"
      :text="t('dataSpec.addPair')"
      @click="pairs = [...pairs, { value: '', valueId: { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: '' }] } }]"
    />

    <div v-for="message in errorMessages ?? []" :key="message" class="text-body-small text-error">{{ message }}</div>
  </div>
</template>

<script lang="ts" setup>
  // The value list of an IEC 61360 data specification: value and value ID
  // pairs as rows, like qualifiers.
  defineProps<{ errorMessages?: string[] }>()
  const pairs = defineModel<Array<Record<string, unknown>>>({ required: true })

  const { t } = useI18n()

  function change (index: number, patch: Record<string, unknown>) {
    pairs.value = pairs.value.map((pair, position) => position === index ? { ...pair, ...patch } : pair)
  }
</script>
