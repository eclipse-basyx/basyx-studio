<template>
  <div v-if="item.state === 'running'" class="d-flex align-center ga-2 text-body-small text-medium-emphasis" data-test="app-builder-build-running">
    <v-progress-circular indeterminate size="14" width="2" />
    <span>{{ t('build.running') }}</span>
  </div>

  <v-alert
    v-else-if="item.state === 'failed'"
    data-test="app-builder-build-failed"
    :title="t('build.failed')"
    type="error"
  >
    <v-expansion-panels class="mt-2">
      <v-expansion-panel>
        <v-expansion-panel-title>{{ t('build.log') }}</v-expansion-panel-title>

        <v-expansion-panel-text>
          <pre class="text-body-small overflow-auto text-pre-wrap text-break">{{ item.log }}</pre>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>

    <div class="d-flex justify-end mt-3">
      <v-btn
        data-test="app-builder-fix-build"
        :disabled="!canFix"
        prepend-icon="mdi-wrench-outline"
        :text="t('build.fix')"
        @click="emit('fix')"
      />
    </div>
  </v-alert>

  <div v-else class="d-flex align-center ga-2 text-body-small text-medium-emphasis" data-test="app-builder-build-succeeded">
    <v-icon :color="item.consentNeeded ? 'warning' : 'success'" :icon="item.consentNeeded ? 'mdi-shield-alert-outline' : 'mdi-check-circle-outline'" size="small" />
    <span>{{ item.consentNeeded ? t('build.waitsForConsent') : t('build.succeeded') }}</span>
  </div>
</template>

<script lang="ts" setup>
  import type { TranscriptItem } from './transcript'
  import { useI18n } from './i18n'

  // Studio's build after a turn (plan B1–B2): a failed one offers to hand its
  // log to the agent.
  defineProps<{ item: Extract<TranscriptItem, { kind: 'build' }>, canFix: boolean }>()
  const emit = defineEmits<{ fix: [] }>()
  const { t } = useI18n()
</script>
