<template>
  <v-alert
    v-if="item.state === 'pending'"
    data-test="app-builder-approval"
    icon="mdi-shield-alert-outline"
    :title="t('approval.title', { agent })"
    type="warning"
  >
    <div class="text-body-medium mb-2">{{ item.title }}</div>

    <template v-if="item.command">
      <div class="text-label-large">{{ t('approval.command') }}</div>
      <pre class="bg-surface rounded pa-2 mb-2 text-body-small overflow-x-auto text-pre-wrap text-break">{{ item.command }}</pre>
    </template>

    <template v-if="item.paths.length > 0">
      <div class="text-label-large">{{ t('approval.files') }}</div>
      <div v-for="path in item.paths" :key="path" class="text-body-small text-break mb-1">{{ path }}</div>
    </template>

    <div v-if="item.denyEndsTurn" class="text-body-small mt-2">{{ t('approval.denyEndsTurn') }}</div>

    <div class="d-flex flex-wrap justify-end mt-3">
      <v-btn-group>
        <v-btn :disabled="busy" :text="t('approval.deny')" @click="emit('answer', 'deny')" />
        <v-btn :disabled="busy" :text="t('approval.allowInChat')" @click="emit('answer', 'allowInChat')" />
        <v-btn :disabled="busy" :text="t('approval.allowOnce')" @click="emit('answer', 'allowOnce')" />
      </v-btn-group>
    </div>
  </v-alert>

  <div v-else class="d-flex align-center ga-2 text-body-small text-medium-emphasis">
    <v-icon :icon="stateIcons[item.state]" size="small" />
    <span>{{ t(`approval.${item.state}`) }}:</span>
    <span class="text-truncate">{{ item.command ?? item.title }}</span>
  </div>
</template>

<script lang="ts" setup>
  import type { ApprovalDecision, ApprovalState } from '#shared/contract'
  import type { TranscriptItem } from './transcript'
  import { useI18n } from './i18n'

  // A permission request of the agent (ADR 0054): pending ones ask the user;
  // answered ones stay in the chat as one line.
  defineProps<{ item: Extract<TranscriptItem, { kind: 'approval' }>, agent: string, busy: boolean }>()
  const emit = defineEmits<{ answer: [decision: ApprovalDecision] }>()
  const { t } = useI18n()

  const stateIcons: Record<ApprovalState, string> = {
    pending: 'mdi-help-circle-outline',
    allowed: 'mdi-check',
    autoAllowed: 'mdi-check',
    denied: 'mdi-cancel',
    cancelled: 'mdi-minus-circle-outline',
  }
</script>
