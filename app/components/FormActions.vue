<template>
  <!-- Drawer actions stay in the drawer footer. An inline row scrolls with
       the form; the remaining forms use a sticky row. -->
  <Teleport defer :disabled="!footer" :to="footer ?? 'body'">
    <div
      class="py-3 d-flex align-center ga-2"
      :class="footer ? 'bg-surface px-4 border-t' : inline ? 'flex-wrap' : 'bg-surface px-4 position-sticky bottom-0'"
    >
      <span v-if="message" class="text-body-small text-medium-emphasis">{{ message }}</span>
      <v-chip v-else-if="dirty" color="warning" :text="t('editor.unapplied')" />
      <v-spacer />
      <v-btn :disabled="(!dirty && !creating) || busy" :text="creating ? t('common.cancel') : t('editor.discard')" @click="emit('discard')" />

      <v-btn-primary
        :disabled="(!dirty && !creating) || busy || blocked"
        :loading="busy"
        :text="applyText"
        @click="emit('apply')"
      />
    </div>
  </Teleport>
</template>

<script lang="ts" setup>
  import { formActionsFooterKey } from '~/utils/editor'

  defineProps<{
    dirty: boolean
    busy: boolean
    creating?: boolean
    inline?: boolean
    blocked?: boolean
    message?: string | null
    applyText: string
  }>()
  const emit = defineEmits<{ apply: [], discard: [] }>()

  const { t } = useI18n()
  // The selector of the drawer's footer, provided by the details drawers.
  const footer = inject(formActionsFooterKey, null)
</script>
