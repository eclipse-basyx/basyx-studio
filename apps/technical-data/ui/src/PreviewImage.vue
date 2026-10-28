<template>
  <FileThumbnail
    :alt="alt"
    :height="height"
    :source="source"
    :width="width"
  >
    <template #icon>
      <v-icon class="text-medium-emphasis" :icon="icon" />
    </template>
  </FileThumbnail>
</template>

<script lang="ts" setup>
  import type { FileSource } from '@basyx/file-viewer/vue'
  import type { FileRef } from '@basyx/studio-app-kit/aas'
  import type { StudioClient } from '@basyx/studio-sdk'
  import { FileThumbnail, withCachedContent } from '@basyx/file-viewer/vue'
  import { computed } from 'vue'

  // A logo or product image, read through Studio once it is in view (the
  // file viewer's thumbnail, ADR 0052), fitted into its box; an icon where
  // there is none or it cannot be shown.
  const props = withDefaults(defineProps<{
    client: StudioClient
    submodelId: string
    file: FileRef | null
    alt?: string
    icon?: string
    width?: number | string
    height?: number | string
  }>(), { alt: '', icon: 'mdi-image-outline', width: 72, height: 72 })

  const source = computed<FileSource | null>(() => {
    const file = props.file
    if (!file || file.external) {
      return null
    }
    return withCachedContent({
      key: `${file.path}:${file.value}`,
      name: file.name,
      contentType: file.contentType,
      load: () => props.client.ui.readFile(props.submodelId, file.path),
    })
  })
</script>
