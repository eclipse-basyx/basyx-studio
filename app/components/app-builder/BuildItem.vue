<template>
  <div v-if="item.state === 'running'" class="d-flex align-center ga-2 px-3 py-1 text-body-small text-medium-emphasis" data-test="app-builder-build-running">
    <v-progress-circular indeterminate size="14" width="2" />
    <span>{{ t('build.running') }}</span>
  </div>

  <div v-else-if="item.state === 'failed'" data-test="app-builder-build-failed">
    <v-btn
      :append-icon="open ? 'mdi-chevron-up' : 'mdi-chevron-down'"
      :aria-expanded="open"
      class="text-error"
      data-test="app-builder-build-log-toggle"
      max-width="100%"
      prepend-icon="mdi-alert-circle-outline"
      size="small"
      :text="t('build.failed')"
      @click="open = !open"
    />

    <v-expand-transition>
      <div v-if="open" class="border-s ms-3 ps-2 mt-1">
        <div class="text-label-small text-medium-emphasis mb-1">{{ t('build.log') }}</div>
        <pre class="text-body-small overflow-auto text-pre-wrap text-break mb-2">{{ item.log }}</pre>

        <v-btn
          data-test="app-builder-fix-build"
          :disabled="!canFix"
          prepend-icon="mdi-wrench-outline"
          size="small"
          :text="t('build.fix')"
          @click="emit('fix')"
        />
      </div>
    </v-expand-transition>
  </div>

  <div v-else class="d-flex align-center ga-2 px-3 py-1 text-body-small text-medium-emphasis" data-test="app-builder-build-succeeded">
    <v-icon :color="item.consentNeeded ? 'warning' : 'success'" :icon="item.consentNeeded ? 'mdi-shield-alert-outline' : 'mdi-check-circle-outline'" size="x-small" />
    <span>{{ item.consentNeeded ? t('build.waitsForConsent') : t('build.succeeded') }}</span>
  </div>
</template>

<script lang="ts" setup>
  import type { TranscriptItem } from './transcript'
  import { ref } from 'vue'
  import { useI18n } from './i18n'

  // Studio's build after a turn (plan B1–B2): a failed one offers to hand its
  // log to the agent.
  defineProps<{ item: Extract<TranscriptItem, { kind: 'build' }>, canFix: boolean }>()
  const emit = defineEmits<{ fix: [] }>()
  const { t } = useI18n()
  const open = ref(false)
</script>
