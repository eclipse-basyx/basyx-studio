<template>
  <v-card :data-test="`app-builder-checkpoint-${item.commit.slice(0, 7)}`">
    <v-card-item prepend-icon="mdi-source-commit" :subtitle="item.message" :title="title">
      <template v-if="item.undone" #append>
        <v-chip :text="t('checkpoint.undone')" />
      </template>
    </v-card-item>

    <v-card-text>
      <div class="d-flex flex-wrap ga-1">
        <v-chip
          v-for="file in item.files.slice(0, maxFiles)"
          :key="file.path"
          :prepend-icon="icons[file.status]"
          :text="file.path"
          :title="t(`checkpoint.${file.status}`)"
        />

        <v-chip v-if="item.files.length > maxFiles" :text="`+${item.files.length - maxFiles}`" />
      </div>
    </v-card-text>

    <v-card-actions>
      <v-btn-group>
        <v-btn data-test="app-builder-show-changes" prepend-icon="mdi-file-compare" :text="t('checkpoint.show')" @click="emit('show')" />

        <v-btn
          data-test="app-builder-undo"
          :disabled="item.undone || !canUndo"
          prepend-icon="mdi-undo"
          :text="t('checkpoint.undo')"
          @click="emit('undo')"
        />
      </v-btn-group>
    </v-card-actions>
  </v-card>
</template>

<script lang="ts" setup>
  import type { ChangedFile } from '#shared/contract'
  import type { TranscriptItem } from './transcript'
  import { computed } from 'vue'
  import { useI18n } from './i18n'

  // What a turn changed, as Studio committed it (plan A5).
  const props = defineProps<{ item: Extract<TranscriptItem, { kind: 'checkpoint' }>, canUndo: boolean }>()
  const emit = defineEmits<{ show: [], undo: [] }>()
  const { t } = useI18n()

  const maxFiles = 12
  const icons: Record<ChangedFile['status'], string> = {
    added: 'mdi-file-plus-outline',
    modified: 'mdi-file-edit-outline',
    deleted: 'mdi-file-remove-outline',
    renamed: 'mdi-file-move-outline',
  }
  const title = computed(() => props.item.files.length === 1 ? t('checkpoint.titleOne') : t('checkpoint.title', { count: props.item.files.length }))
</script>
