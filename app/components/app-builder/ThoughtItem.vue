<template>
  <div>
    <v-btn
      :append-icon="open ? 'mdi-chevron-up' : 'mdi-chevron-down'"
      class="text-medium-emphasis"
      size="small"
      :text="t('chat.thinking')"
      @click="open = !open"
    />

    <v-expand-transition>
      <div v-if="open" class="text-body-small text-medium-emphasis text-pre-wrap text-break px-3 pb-2">{{ text }}</div>
    </v-expand-transition>
  </div>
</template>

<script lang="ts" setup>
  import { ref } from 'vue'
  import { useI18n } from './i18n'

  // The agent's reasoning: one quiet line that opens on demand.
  defineProps<{ text: string }>()
  const { t } = useI18n()
  const open = ref(false)
</script>
