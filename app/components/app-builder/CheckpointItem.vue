<template>
  <v-card :data-test="`app-builder-checkpoint-${item.commit.slice(0, 7)}`">
    <v-card-item :subtitle="item.message" :title="title">
      <template #prepend>
        <v-icon color="primary" icon="mdi-source-commit" />
      </template>

      <template v-if="item.undone" #append>
        <v-chip :text="t('checkpoint.undone')" />
      </template>
    </v-card-item>

    <v-card-actions class="pt-0 ps-12">
      <v-btn
        border
        data-test="app-builder-show-changes"
        size="small"
        :text="t('checkpoint.show')"
        :title="item.files.map(file => file.path).join('\n')"
        @click="emit('show')"
      />

      <v-btn
        class="text-medium-emphasis"
        data-test="app-builder-undo"
        :disabled="item.undone || !canUndo"
        size="small"
        :text="t('checkpoint.undo')"
        @click="emit('undo')"
      />
    </v-card-actions>
  </v-card>
</template>

<script lang="ts" setup>
  import type { TranscriptItem } from './transcript'
  import { computed } from 'vue'
  import { useI18n } from './i18n'

  // What a turn changed, as Studio committed it (plan A5).
  const props = defineProps<{ item: Extract<TranscriptItem, { kind: 'checkpoint' }>, canUndo: boolean }>()
  const emit = defineEmits<{ show: [], undo: [] }>()
  const { t } = useI18n()

  const title = computed(() => props.item.files.length === 1 ? t('checkpoint.titleOne') : t('checkpoint.title', { count: props.item.files.length }))
</script>
