<template>
  <div class="d-flex align-start ga-4" data-test="technical-data-header">
    <PreviewImage
      v-if="data.logo"
      :alt="t('technicalData.logo', { name: heading.manufacturer || heading.title })"
      :client="client"
      data-test="company-logo"
      :file="data.logo"
      height="64"
      icon="mdi-factory"
      :submodel-id="submodelId"
      width="128"
    />

    <div class="flex-grow-1">
      <div class="text-title-medium text-break" data-test="product-title">{{ heading.title }}</div>

      <div v-if="heading.manufacturer" class="text-body-medium" data-test="manufacturer-name">{{ heading.manufacturer }}</div>

      <div v-if="heading.details" class="text-body-small text-medium-emphasis" data-test="product-details">{{ heading.details }}</div>

      <div class="d-flex flex-wrap align-center ga-2 mt-2">
        <!-- A class opens the data sheet of the area it refers to. -->
        <v-chip
          v-for="chip in classifications"
          :key="chip.path"
          v-tooltip="chip.name || undefined"
          data-test="classification-chip"
          prepend-icon="mdi-shape-outline"
          :text="chip.text"
          v-on="chip.areaPath ? { click: () => emit('area', chip.areaPath!) } : {}"
        />

        <v-chip
          v-if="validDate"
          data-test="valid-date"
          prepend-icon="mdi-calendar-check-outline"
          :text="t('further.validFrom', { date: validDate })"
        />

        <v-chip data-test="template-version" :text="templateLabel(data.version)" variant="outlined" />
      </div>
    </div>

    <slot />
  </div>
</template>

<script lang="ts" setup>
  import type { TechnicalData } from './technicalData'
  import type { StudioClient } from '@basyx/studio-sdk'
  import { fieldText } from '@basyx/studio-app-kit/aas'
  import { computed } from 'vue'
  import { useI18n } from './i18n'
  import { classificationChip, className, dateText, headline, templateLabel } from './presentation'
  import PreviewImage from './PreviewImage.vue'

  // The product at a glance: the manufacturer's logo, the product's
  // designation, manufacturer, article number and order code, its classes,
  // the date the data is valid from and the template version; the default
  // slot takes the full-screen button.
  const props = defineProps<{ client: StudioClient, submodelId: string, data: TechnicalData }>()
  const emit = defineEmits<{ area: [path: string] }>()

  const { t, formatLocale } = useI18n()
  const heading = computed(() => headline(t, props.data, formatLocale.value))
  const classifications = computed(() => props.data.classifications
    .map(classification => ({
      path: classification.path,
      text: classificationChip(classification, formatLocale.value),
      name: className(classification, formatLocale.value),
      areaPath: classification.areaPath,
    }))
    .filter(chip => chip.text !== ''))
  const validDate = computed(() => dateText(fieldText(props.data.further?.validDate, formatLocale.value), formatLocale.value))
</script>
