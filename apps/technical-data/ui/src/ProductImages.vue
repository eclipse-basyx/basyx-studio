<template>
  <div class="d-flex flex-wrap ga-2" data-test="product-images">
    <!-- Compact cards as the Nameplate's markings; a click shows the image in Studio's viewer. -->
    <v-card
      v-for="entry in entries"
      :key="entry.image.path"
      :aria-label="t('image.open', { name: entry.name })"
      data-test="product-image"
      width="160"
      @click="preview?.(entry.image.file)"
    >
      <PreviewImage
        :alt="entry.name"
        :client="client"
        :file="entry.image.file"
        height="120"
        :submodel-id="submodelId"
        width="160"
      />

      <v-card-text v-if="entry.note" class="pa-2 text-body-small text-break" data-test="product-image-note">{{ entry.note }}</v-card-text>
    </v-card>
  </div>
</template>

<script lang="ts" setup>
  import type { ProductImage } from './technicalData'
  import type { StudioClient } from '@basyx/studio-sdk'
  import { fieldText } from '@basyx/studio-app-kit/aas'
  import { useRowActions } from '@basyx/studio-app-kit/editing'
  import { computed } from 'vue'
  import { useI18n } from './i18n'
  import PreviewImage from './PreviewImage.vue'

  // The product's images with their notes, each read once it is in view.
  const props = defineProps<{ client: StudioClient, submodelId: string, images: ProductImage[] }>()

  const { t, formatLocale } = useI18n()
  const { preview } = useRowActions()

  const entries = computed(() => props.images.map(image => {
    const note = fieldText(image.note, formatLocale.value)
    return { image, note, name: note || image.file.name }
  }))
</script>
