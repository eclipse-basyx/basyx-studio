<template>
  <div :data-test="`app-builder-checkpoint-${item.commit.slice(0, 7)}`">
    <v-btn
      :append-icon="open ? 'mdi-chevron-up' : 'mdi-chevron-down'"
      :aria-expanded="open"
      class="text-medium-emphasis"
      data-test="app-builder-checkpoint-toggle"
      max-width="100%"
      prepend-icon="mdi-source-commit"
      size="small"
      @click="open = !open"
    >
      <span class="text-truncate">{{ title }}</span>
      <span v-if="item.undone" class="text-disabled ms-1">· {{ t('checkpoint.undone') }}</span>
    </v-btn>

    <v-expand-transition>
      <div v-if="open" class="border-s ms-3 ps-2 mt-1">
        <div class="text-body-small text-medium-emphasis text-pre-wrap text-break mb-2">{{ item.message }}</div>

        <v-btn-group>
          <v-btn
            data-test="app-builder-show-changes"
            :text="t('checkpoint.show')"
            :title="item.files.map(file => file.path).join('\n')"
            @click="emit('show')"
          />

          <v-btn
            data-test="app-builder-undo"
            :disabled="item.undone || !canUndo"
            :text="t('checkpoint.undo')"
            @click="emit('undo')"
          />
        </v-btn-group>
      </div>
    </v-expand-transition>
  </div>
</template>

<script lang="ts" setup>
  import type { TranscriptItem } from './transcript'
  import { computed, ref } from 'vue'
  import { useI18n } from './i18n'

  // What a turn changed, as Studio committed it (plan A5).
  const props = defineProps<{ item: Extract<TranscriptItem, { kind: 'checkpoint' }>, canUndo: boolean }>()
  const emit = defineEmits<{ show: [], undo: [] }>()
  const { t } = useI18n()
  const open = ref(false)

  const title = computed(() => props.item.files.length === 1 ? t('checkpoint.titleOne') : t('checkpoint.title', { count: props.item.files.length }))
</script>
