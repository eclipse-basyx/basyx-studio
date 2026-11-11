<template>
  <div class="d-flex flex-column flex-grow-1 overflow-hidden">
    <div class="d-flex align-center ga-2 ps-4 pe-2 py-1">
      <div class="d-flex align-center ga-2 flex-grow-1 overflow-hidden">
        <span class="text-title-small text-truncate">{{ conversation.title || t('chats.untitled') }}</span>

        <span class="text-body-small text-medium-emphasis text-truncate">{{ projectName }} · {{ agentName }}</span>

        <v-menu>
          <template #activator="{ props: menu }">
            <v-btn
              v-bind="menu"
              :aria-label="t('projects.actions', { name: conversation.title || t('chats.untitled') })"
              data-test="app-builder-chat-menu"
              icon="mdi-chevron-down"
              size="small"
            />
          </template>

          <v-list>
            <v-list-item
              data-test="app-builder-delete-chat"
              :disabled="busy"
              prepend-icon="mdi-delete-outline"
              :title="t('chats.delete')"
              @click="emit('delete')"
            />
          </v-list>
        </v-menu>
      </div>

      <v-btn
        border
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
        icon="mdi-dock-right"
        @click="emit('toggle-preview')"
      />
    </div>

    <div ref="scroller" class="flex-grow-1 overflow-y-auto">
      <v-container class="d-flex flex-column ga-3 px-4 py-3" data-test="app-builder-transcript" max-width="760">
        <template v-for="item in blocks" :key="`${item.kind}:${item.id}`">
          <div v-if="item.kind === 'user'" class="d-flex justify-end">
            <v-sheet class="px-3 py-2 text-body-medium text-pre-wrap text-break" color="surface-light" max-width="85%" rounded="lg">{{ item.text }}</v-sheet>
          </div>

          <MarkdownText v-else-if="item.kind === 'agent'" :text="item.text" />

          <ThoughtItem v-else-if="item.kind === 'thought'" :text="item.text" />

          <v-card v-else-if="item.kind === 'tools'">
            <v-expansion-panels multiple>
              <ToolCallItem v-for="tool in item.calls" :key="tool.id" :folder="conversation.folder" :item="tool" />
            </v-expansion-panels>
          </v-card>

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

          <v-alert v-else-if="item.kind === 'info'" :text="item.text" type="info" />

          <v-alert
            v-else-if="item.kind === 'error'"
            class="text-pre-wrap"
            :text="item.message"
            type="error"
          />
        </template>

        <div v-if="transcript.items.length === 0 && transcript.state !== 'starting'" class="text-center text-medium-emphasis py-12">
          <v-icon color="primary" icon="mdi-creation" size="40" />
          <div class="text-headline-small mt-2">{{ t('chat.emptyTitle') }}</div>
          <div class="text-body-medium mt-1">{{ t('chat.emptyText') }}</div>
        </div>
      </v-container>
    </div>

    <v-container class="px-4 pt-0 pb-3" max-width="760">
      <!-- Read out as it changes; the transcript itself is not, so streamed text does not flood a screen reader. -->
      <div aria-live="polite" class="d-flex align-center ga-2 text-body-small text-medium-emphasis mb-1 px-2" role="status">
        <v-progress-circular v-if="status && (transcript.state === 'working' || transcript.state === 'starting' || !connected)" indeterminate size="14" width="2" />
        <span v-if="status">{{ status }}</span>
        <span v-else class="d-sr-only">{{ announcement }}</span>
      </div>

      <v-alert
        v-if="transcript.permissionMode === 'unrestricted'"
        class="mb-2"
        data-test="app-builder-unrestricted-banner"
        icon="mdi-alert-octagon-outline"
        :text="t('mode.active', { agent: agentName })"
        type="error"
      >
        <v-btn class="mt-1 ms-n2" data-test="app-builder-unrestricted-off" :text="t('mode.back')" @click="emit('set-permission-mode', 'ask', false)" />
      </v-alert>

      <v-sheet-composer>
        <v-textarea
          v-model="draft"
          :aria-label="t('chat.placeholder')"
          data-test="app-builder-prompt"
          :disabled="transcript.state === 'closed'"
          :placeholder="t('chat.placeholder')"
          @keydown.enter.exact.prevent="send"
        />

        <div class="d-flex align-center ga-2">
          <PermissionModeMenu
            :agent="agentName"
            :mode="transcript.permissionMode"
            @set="(mode, acknowledgeRisk) => emit('set-permission-mode', mode, acknowledgeRisk)"
          />

          <v-select
            v-if="transcript.model && transcript.model.options.length > 1"
            :aria-label="t('chat.model')"
            data-test="app-builder-model"
            :disabled="transcript.state !== 'idle' && transcript.state !== 'inactive'"
            item-title="name"
            item-value="value"
            :items="transcript.model.options"
            :model-value="transcript.model.current"
            @update:model-value="value => emit('set-model', value)"
          />

          <v-spacer />

          <v-btn-primary
            v-if="transcript.state === 'working'"
            v-tooltip="t('chat.stop')"
            :aria-label="t('chat.stop')"
            data-test="app-builder-stop"
            icon="mdi-stop"
            size="small"
            @click="emit('stop')"
          />

          <v-btn-primary
            v-else
            v-tooltip="t('chat.send')"
            :aria-label="t('chat.send')"
            data-test="app-builder-send"
            :disabled="!canSend"
            icon="mdi-arrow-up"
            size="small"
            @click="send"
          />
        </div>
      </v-sheet-composer>
    </v-container>
  </div>
</template>

<script lang="ts" setup>
  import type { ApprovalDecision, ConversationSummary, PermissionMode } from '#shared/contract'
  import type { Transcript, TranscriptItem } from './transcript'
  import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
  import ApprovalCard from './ApprovalCard.vue'
  import BuildItem from './BuildItem.vue'
  import CheckpointItem from './CheckpointItem.vue'
  import { useI18n } from './i18n'
  import MarkdownText from './MarkdownText.vue'
  import PermissionModeMenu from './PermissionModeMenu.vue'
  import ThoughtItem from './ThoughtItem.vue'
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
    'set-permission-mode': [mode: PermissionMode, acknowledgeRisk: boolean]
    'show-changes': [commit: string]
    'undo': [commit: string]
    'delete': []
    'toggle-preview': []
    'install': []
  }>()
  const { t } = useI18n()

  type ToolItem = Extract<TranscriptItem, { kind: 'tool' }>
  /** The transcript's items, with each run of tool calls folded into one group. */
  const blocks = computed<Array<Exclude<TranscriptItem, { kind: 'tool' }> | { kind: 'tools', id: string, calls: ToolItem[] }>>(() => {
    const result: Array<Exclude<TranscriptItem, { kind: 'tool' }> | { kind: 'tools', id: string, calls: ToolItem[] }> = []
    for (const item of props.transcript.items) {
      if (item.kind !== 'tool') {
        result.push(item)
        continue
      }
      const last = result.at(-1)
      if (last?.kind === 'tools') {
        last.calls.push(item)
      } else {
        result.push({ kind: 'tools', id: item.id, calls: [item] })
      }
    }
    return result
  })

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

  /** What a screen reader hears when a turn ends. */
  const announcement = ref('')
  watch(() => props.transcript.state, (state, previous) => {
    if (previous === 'working' && state === 'idle') {
      announcement.value = t('chat.finished', { agent: props.agentName })
    }
  })

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
