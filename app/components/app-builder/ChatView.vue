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
        v-tooltip="t('files.browse')"
        :active="filesOpen"
        :aria-label="t('files.browse')"
        data-test="app-builder-open-files"
        icon="mdi-file-tree-outline"
        @click="emit('show-files')"
      />

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

          <ToolGroup
            v-else-if="item.kind === 'activity'"
            :active="busy && item === blocks.at(-1)"
            :entries="item.entries"
            :folder="conversation.folder"
          />

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
      </v-sheet-composer>

      <!-- Under the prompt box, as in the coding agents' apps: the model, how freely the agent works, and its context. -->
      <div class="d-flex align-center justify-end mt-2 pe-4">
        <ModelMenu
          v-if="transcript.model"
          :disabled="transcript.state !== 'idle' && transcript.state !== 'inactive'"
          :effort="transcript.effort"
          :model="transcript.model"
          :speed="transcript.speed"
          @set="(setting, value) => emit('set-setting', setting, value)"
        />

        <PermissionModeMenu
          :agent="agentName"
          :mode="transcript.permissionMode"
          @set="(mode, acknowledgeRisk) => emit('set-permission-mode', mode, acknowledgeRisk)"
        />

        <v-progress-circular
          v-tooltip="context?.label ?? t('chat.contextUnavailable')"
          :aria-label="context?.label ?? t('chat.contextUnavailable')"
          class="ms-2"
          :color="(context?.percent ?? 0) >= 80 ? 'warning' : 'primary'"
          data-test="app-builder-context"
          :model-value="context?.percent ?? 0"
          role="img"
          size="14"
          width="2"
        />
      </div>
    </v-container>
  </div>
</template>

<script lang="ts" setup>
  import type { AgentSettingKind, ApprovalDecision, ConversationSummary, PermissionMode } from '#shared/contract'
  import type { ActivityEntry } from './ToolGroup.vue'
  import type { Transcript, TranscriptItem } from './transcript'
  import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
  import ApprovalCard from './ApprovalCard.vue'
  import BuildItem from './BuildItem.vue'
  import CheckpointItem from './CheckpointItem.vue'
  import { useI18n } from './i18n'
  import MarkdownText from './MarkdownText.vue'
  import ModelMenu from './ModelMenu.vue'
  import PermissionModeMenu from './PermissionModeMenu.vue'
  import ToolGroup from './ToolGroup.vue'

  // One chat: the transcript, the agent's state, and the prompt box.
  const props = defineProps<{
    conversation: ConversationSummary
    projectName: string
    transcript: Transcript
    previewOpen: boolean
    filesOpen: boolean
    agentName: string
    connected: boolean
    answering: Set<string>
  }>()
  const emit = defineEmits<{
    'send': [text: string]
    'stop': []
    'answer': [approvalId: string, decision: ApprovalDecision]
    'set-setting': [setting: AgentSettingKind, value: string]
    'set-permission-mode': [mode: PermissionMode, acknowledgeRisk: boolean]
    'show-changes': [commit: string]
    'undo': [commit: string]
    'delete': []
    'toggle-preview': []
    'install': []
    'show-files': []
  }>()
  const { t, locale } = useI18n()

  /** How full the model's context window is, as the agent last reported it. */
  const context = computed(() => {
    const usage = props.transcript.usage
    if (!usage || usage.size <= 0) {
      return null
    }
    const percent = Math.min(100, Math.round(usage.used / usage.size * 100))
    const format = new Intl.NumberFormat(locale.value, { notation: 'compact', maximumFractionDigits: 1 })
    return { percent, label: t('chat.context', { used: format.format(usage.used), size: format.format(usage.size), percent }) }
  })

  type Block = Exclude<TranscriptItem, { kind: 'tool' | 'thought' }> | { kind: 'activity', id: string, entries: ActivityEntry[] }
  /**
   * The transcript's items, with each stretch of the agent's thinking and
   * tool calls folded into one quiet line, and without Studio's own approvals,
   * which are the tool calls themselves.
   */
  const blocks = computed<Block[]>(() => {
    const result: Block[] = []
    for (const item of props.transcript.items) {
      if (item.kind === 'approval' && item.state === 'autoAllowed') {
        continue
      }
      if (item.kind !== 'tool' && item.kind !== 'thought') {
        result.push(item)
        continue
      }
      const last = result.at(-1)
      if (last?.kind === 'activity') {
        last.entries.push(item)
      } else {
        result.push({ kind: 'activity', id: item.id, entries: [item] })
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
