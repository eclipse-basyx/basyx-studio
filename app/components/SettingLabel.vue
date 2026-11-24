<template>
  <!-- A setting's label; a lock where the deployment fixes the setting (ADR 0055). -->
  <div class="d-flex align-center ga-1 text-label-large mb-2">
    <span :id="id">{{ text }}</span>

    <v-icon
      v-if="locked"
      v-tooltip="t('settings.locked')"
      :aria-label="t('settings.locked')"
      icon="mdi-lock-outline"
      role="img"
      size="small"
    />
  </div>
</template>

<script lang="ts" setup>
  defineProps<{ text: string, locked?: boolean, id?: string }>()
  const { t } = useI18n()
</script>
