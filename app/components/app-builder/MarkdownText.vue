<template>
  <!-- Sanitized (@basyx/file-viewer/markdown): no raw HTML, scripts, frames or remote images. -->
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div v-if="html !== null" class="text-body-medium text-break" v-html="html" />
  <div v-else class="text-body-medium text-pre-wrap text-break">{{ text }}</div>
</template>

<script lang="ts" setup>
  import { ref, watch } from 'vue'

  // An agent's message as Markdown. Its text comes from the agent, so it is
  // rendered as the file viewer renders AAS Markdown: sanitized, links open
  // in a new tab, no remote images.
  const props = defineProps<{ text: string }>()
  const html = ref<string | null>(null)

  let render: ((text: string) => string) | null = null
  watch(() => props.text, async text => {
    render ??= (await import('@basyx/file-viewer/markdown')).renderMarkdown
    if (text === props.text) {
      html.value = render(text)
    }
  }, { immediate: true })
</script>
