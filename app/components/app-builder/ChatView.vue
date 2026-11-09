<template>
  <div class="d-flex flex-column flex-grow-1 overflow-hidden">
    <div class="d-flex align-center ga-2 px-4 py-2 border-b">
      <div class="flex-grow-1 overflow-hidden">
        <div class="text-title-medium text-truncate">{{ conversation.title || t('chats.untitled') }}</div>

        <div class="text-body-small text-medium-emphasis text-truncate">{{ projectName }} · {{ agentName }}</div>
      </div>

      <v-select
        v-if="transcript.model && transcript.model.options.length > 1"
        data-test="app-builder-model"
        :disabled="transcript.state !== 'idle' && transcript.state !== 'inactive'"
        hide-details
        item-title="name"
        item-value="value"
        :items="transcript.model.options"
        :label="t('chat.model')"
        max-width="260"
        :model-value="transcript.model.current"
        @update:model-value="value => emit('set-model', value)"
      />

      <v-btn-secondary
        data-test="app-builder-install-open"
        :disabled="busy"
        prepend-icon="mdi-package-variant-closed-plus"
        :text="t('install.action')"
        @click="emit('install')"
      />

      <v-btn
        v-tooltip="t('preview.toggle')"
        :active="previewOpen"
        :aria-label="t('preview.toggle')"
        data-test="app-builder-toggle-preview"
        icon="mdi-application-outline"
        @click="emit('toggle-preview')"
      />

      <v-btn
        v-tooltip="t('chats.delete')"
        :aria-label="t('chats.delete')"
        data-test="app-builder-delete-chat"
        :disabled="busy"
        icon="mdi-delete-outline"
        @click="emit('delete')"
      />
    </div>

    <div ref="scroller" class="flex-grow-1 overflow-y-auto">
      <div class="d-flex flex-column ga-3 pa-4 mx-auto" data-test="app-builder-transcript">
        <template v-for="item in transcript.items" :key="`${item.kind}:${item.id}`">
          <div v-if="item.kind === 'user'" class="d-flex justify-end">
            <v-sheet class="px-4 py-2 text-body-medium text-pre-wrap text-break" color="surface-light" max-width="85%" rounded="lg">{{ item.text }}</v-sheet>
          </div>

          <MarkdownText v-else-if="item.kind === 'agent'" :text="item.text" />

          <v-expansion-panels v-else-if="item.kind === 'thought'">
            <v-expansion-panel>
              <v-expansion-panel-title>
                <v-icon class="me-3" color="medium-emphasis" icon="mdi-thought-bubble-outline" />
                <span class="text-body-medium text-medium-emphasis">{{ t('chat.thinking') }}</span>
              </v-expansion-panel-title>

              <v-expansion-panel-text>
                <div class="text-body-small text-medium-emphasis text-pre-wrap text-break">{{ item.text }}</div>
              </v-expansion-panel-text>
            </v-expansion-panel>
          </v-expansion-panels>

          <ToolCallItem v-else-if="item.kind === 'tool'" :folder="conversation.folder" :item="item" />

          <v-card v-else-if="item.kind === 'plan'">
            <v-card-header prepend-icon="mdi-format-list-checks" :title="t('plan.title')" />

            <v-list>
              <v-list-item
                v-for="(entry, index) in item.entries"
                :key="index"
                :prepend-icon="entry.status === 'completed' ? 'mdi-checkbox-marked-outline' : entry.status === 'in_progress' ? 'mdi-progress-clock' : 'mdi-checkbox-blank-outline'"
                :title="entry.content"
              />
            </v-list>
          </v-card>

          <ApprovalCard
            v-else-if="item.kind === 'approval'"
            :agent="agentName"
            :busy="answering.has(item.id)"
            :item="item"
            @answer="decision => emit('answer', item.id, decision)"
          />

          <div v-else-if="item.kind === 'notice'" class="text-body-small text-medium-emphasis text-center">{{ t(`notice.${item.stopReason}`) }}</div>

          <CheckpointItem
            v-else-if="item.kind === 'checkpoint'"
            :can-undo="!busy"
            :item="item"
            @show="emit('show-changes', item.commit)"
            @undo="emit('undo', item.commit)"
          />

          <BuildItem
            v-else-if="item.kind === 'build'"
            :can-fix="['idle', 'inactive', 'failed'].includes(transcript.state)"
            :item="item"
            @fix="emit('send', fixPrompt(item.log))"
          />

          <v-alert v-else-if="item.kind === 'info'" density="compact" :text="item.text" type="info" />

          <v-alert
            v-else-if="item.kind === 'error'"
            class="text-pre-wrap"
            density="compact"
            :text="item.message"
            type="error"
          />
        </template>

        <div v-if="transcript.items.length === 0 && transcript.state !== 'starting'" class="text-center text-medium-emphasis py-12">
          <v-icon icon="mdi-creation-outline" size="40" />
          <div class="text-title-medium mt-2">{{ t('chat.emptyTitle') }}</div>
          <div class="text-body-medium mt-1">{{ t('chat.emptyText') }}</div>
        </div>
      </div>
    </div>

    <div class="px-4 pb-4 pt-2">
      <div v-if="status" class="d-flex align-center ga-2 text-body-small text-medium-emphasis mb-2">
        <v-progress-circular v-if="transcript.state === 'working' || transcript.state === 'starting' || !connected" indeterminate size="14" width="2" />
        <span>{{ status }}</span>
      </div>

      <v-textarea
        v-model="draft"
        auto-grow
        data-test="app-builder-prompt"
        :disabled="transcript.state === 'closed'"
        hide-details
        max-rows="10"
        :placeholder="t('chat.placeholder')"
        rows="2"
        @keydown.enter.exact.prevent="send"
      >
        <template #append-inner>
          <v-btn
            v-if="transcript.state === 'working'"
            v-tooltip="t('chat.stop')"
            :aria-label="t('chat.stop')"
            data-test="app-builder-stop"
            icon="mdi-stop"
            @click="emit('stop')"
          />

          <v-btn
            v-else
            v-tooltip="t('chat.send')"
            :aria-label="t('chat.send')"
            data-test="app-builder-send"
            :disabled="!canSend"
            icon="mdi-arrow-up"
            @click="send"
          />
        </template>
      </v-textarea>
    </div>
  </div>
</template>

<script lang="ts" setup>
  import type { ApprovalDecision, ConversationSummary } from '#shared/contract'
  import type { Transcript } from './transcript'
  import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
  import ApprovalCard from './ApprovalCard.vue'
  import BuildItem from './BuildItem.vue'
  import CheckpointItem from './CheckpointItem.vue'
  import { useI18n } from './i18n'
  import MarkdownText from './MarkdownText.vue'
  import ToolCallItem from './ToolCallItem.vue'

  // One chat: the transcript, the agent's state, and the prompt box.
  const props = defineProps<{
    conversation: ConversationSummary
    projectName: string
    transcript: Transcript
    previewOpen: boolean
    agentName: string
    connected: boolean
    answering: Set<string>
  }>()
  const emit = defineEmits<{
    'send': [text: string]
    'stop': []
    'answer': [approvalId: string, decision: ApprovalDecision]
    'set-model': [value: string]
    'show-changes': [commit: string]
    'undo': [commit: string]
    'delete': []
    'toggle-preview': []
    'install': []
  }>()
  const { t } = useI18n()

  const draft = ref('')
  /** While the agent starts or works, the chat's files and history change. */
  const busy = computed(() => props.transcript.state === 'working' || props.transcript.state === 'starting')
  const canSend = computed(() => ['idle', 'inactive', 'failed'].includes(props.transcript.state) && draft.value.trim().length > 0)

  const status = computed(() => {
    if (!props.connected) {
      return t('chat.reconnecting')
    }
    switch (props.transcript.state) {
      case 'starting': {
        return t('chat.starting', { agent: props.agentName })
      }
      case 'working': {
        return t('chat.working', { agent: props.agentName })
      }
      case 'inactive': {
        return t('chat.inactive')
      }
      case 'failed': {
        return t('chat.failed')
      }
      default: {
        return ''
      }
    }
  })

  /** The prompt that hands a failed build to the agent (plan B2). */
  function fixPrompt (log: string | null): string {
    return `Studio's build of this app failed (pnpm install, pnpm build, studio-app pack). Fix the cause, then run pnpm typecheck, pnpm test and pnpm build again.\n\n\`\`\`\n${(log ?? '').split('\n').slice(-80).join('\n')}\n\`\`\``
  }

  function send () {
    if (!canSend.value) {
      return
    }
    emit('send', draft.value.trim())
    draft.value = ''
  }

  // Follows new output while the user is at the bottom.
  const scroller = useTemplateRef<HTMLElement>('scroller')
  watch(() => [props.transcript.seq, props.conversation.id], async () => {
    const element = scroller.value
    if (!element) {
      return
    }
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 120
    await nextTick()
    if (atBottom) {
      element.scrollTop = element.scrollHeight
    }
  })
</script>
