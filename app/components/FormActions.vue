<template>
  <!-- Always in reach: the actions stick to the bottom of the scrolling form. -->
  <div class="position-sticky bottom-0 bg-surface px-4 py-3 d-flex align-center ga-2">
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
</template>

<script lang="ts" setup>
  defineProps<{
    dirty: boolean
    busy: boolean
    creating?: boolean
    blocked?: boolean
    message?: string | null
    applyText: string
  }>()
  const emit = defineEmits<{ apply: [], discard: [] }>()

  const { t } = useI18n()
</script>
