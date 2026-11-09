<template>
  <v-sheet-full-page>
    <div class="d-flex flex-grow-1 overflow-hidden">
      <v-sheet class="d-flex flex-column flex-shrink-0 border-e" width="300">
        <div class="pa-3">
          <v-menu>
            <template #activator="{ props: activator }">
              <v-btn-primary
                v-bind="activator"
                block
                data-test="app-builder-new"
                :disabled="readyAgents.length === 0 || starting"
                :loading="starting"
                prepend-icon="mdi-plus"
                :text="t('chats.new')"
              />
            </template>

            <v-list>
              <v-list-item
                v-for="agent in readyAgents"
                :key="agent.id"
                :data-test="`app-builder-new-${agent.id}`"
                prepend-icon="mdi-robot-outline"
                :subtitle="agent.version ?? undefined"
                :title="agent.name"
                @click="startChat(agent.id)"
              />
            </v-list>
          </v-menu>
        </div>

        <div class="flex-grow-1 overflow-y-auto">
          <div class="text-label-large text-medium-emphasis px-4">{{ t('chats.heading') }}</div>

          <v-list v-if="conversations.length > 0" :selected="activeId ? [activeId] : []">
            <v-list-item
              v-for="conversation in conversations"
              :key="conversation.id"
              :active="conversation.id === activeId"
              :data-test="`app-builder-chat-${conversation.id}`"
              :prepend-icon="chatIcon(conversation.id)"
              :subtitle="agentName(conversation.agentId)"
              :title="conversation.title || t('chats.untitled')"
              :value="conversation.id"
              @click="activeId = conversation.id"
            />
          </v-list>

          <div v-else class="px-4 py-2 text-body-small text-medium-emphasis">{{ t('chats.empty') }}</div>
        </div>

        <v-divider />
        <AgentStatusList v-if="status" :checking="checking" :status="status" @recheck="loadStatus(true)" />
        <v-progress-linear v-else />
      </v-sheet>

      <div class="d-flex flex-column flex-grow-1 overflow-hidden">
        <ProblemAlert v-if="error" class="ma-3" :error="error" />

        <ChatView
          v-if="active && activeTranscript"
          :key="active.id"
          :agent-name="agentName(active.agentId)"
          :answering="answering"
          :connected="connected.get(active.id) ?? true"
          :conversation="active"
          :transcript="activeTranscript"
          @answer="(approvalId, decision) => answer(active!.id, approvalId, decision)"
          @close="closing = active!.id"
          @copy-folder="copyFolder(active!.folder)"
          @send="text => send(active!.id, text)"
          @set-model="value => setModel(active!.id, value)"
          @stop="stop(active!.id)"
        />

        <div v-else class="d-flex flex-column align-center justify-center flex-grow-1 pa-6 text-center">
          <v-icon color="medium-emphasis" icon="mdi-creation-outline" size="48" />
          <div class="text-headline-small mt-3">{{ t('app.title') }}</div>
          <div class="text-body-medium text-medium-emphasis mt-1 mb-4">{{ t('app.subtitle') }}</div>
          <div v-if="status && readyAgents.length === 0" class="text-body-medium text-medium-emphasis">{{ t('agents.noneReady') }}</div>
        </div>
      </div>
    </div>

    <v-dialog max-width="480" :model-value="closing !== null" @update:model-value="open => { if (!open) closing = null }">
      <v-card :text="t('chats.closeText')" :title="t('chats.closeTitle')">
        <template #actions>
          <v-btn-secondary :text="t('chats.cancel')" @click="closing = null" />
          <v-btn-primary data-test="app-builder-close-confirm" :text="t('chats.close')" @click="closeChat" />
        </template>
      </v-card>
    </v-dialog>
  </v-sheet-full-page>
</template>

<script lang="ts" setup>
  import type { AgentId, AppBuilderStatus, ApprovalDecision, ConversationSummary } from '#shared/contract'
  import type { Transcript } from './transcript'
  import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowReactive } from 'vue'
  import AgentStatusList from './AgentStatusList.vue'
  import ChatView from './ChatView.vue'
  import { provideI18n } from './i18n'
  import { applyEvent, emptyTranscript } from './transcript'

  // The App Builder (ADR 0054): chats with coding agents that the Studio
  // Service runs on this computer. Phase A: chats in scratch folders.
  const { t } = provideI18n()
  const client = useAppBuilderClient()
  const notifications = useNotificationsStore()

  const status = ref<AppBuilderStatus | null>(null)
  const checking = ref(false)
  const starting = ref(false)
  const error = ref<unknown>(null)
  const conversations = ref<ConversationSummary[]>([])
  const transcripts = reactive(new Map<string, Transcript>())
  const connected = reactive(new Map<string, boolean>())
  const answering = shallowReactive(new Set<string>())
  const followers = new Map<string, () => void>()
  const activeId = ref<string | null>(null)
  const closing = ref<string | null>(null)

  const readyAgents = computed(() => status.value?.agents.filter(agent => agent.state === 'ready') ?? [])
  const active = computed(() => conversations.value.find(conversation => conversation.id === activeId.value) ?? null)
  const activeTranscript = computed(() => activeId.value ? transcripts.get(activeId.value) ?? null : null)

  function agentName (id: AgentId): string {
    return status.value?.agents.find(agent => agent.id === id)?.name ?? id
  }

  function chatIcon (id: string): string {
    const state = transcripts.get(id)?.state
    if (state === 'working') {
      return transcripts.get(id)!.items.some(item => item.kind === 'approval' && item.state === 'pending') ? 'mdi-hand-back-left-outline' : 'mdi-dots-horizontal-circle-outline'
    }
    return state === 'failed' ? 'mdi-alert-circle-outline' : 'mdi-chat-outline'
  }

  async function run<T> (action: () => Promise<T>): Promise<T | undefined> {
    error.value = null
    try {
      return await action()
    } catch (error_) {
      error.value = error_
      return undefined
    }
  }

  async function loadStatus (refresh = false) {
    checking.value = true
    await run(async () => {
      status.value = await client.call('getStatus', { refresh })
    })
    checking.value = false
  }

  function follow (conversation: ConversationSummary) {
    if (followers.has(conversation.id)) {
      return
    }
    const transcript = transcripts.get(conversation.id) ?? emptyTranscript()
    transcripts.set(conversation.id, transcript)
    const reactiveTranscript = transcripts.get(conversation.id)!
    followers.set(conversation.id, client.follow(conversation.id, reactiveTranscript.seq, envelope => {
      applyEvent(reactiveTranscript, envelope)
      if (envelope.event.type === 'approval' && envelope.event.state !== 'pending') {
        answering.delete(envelope.event.approvalId)
      }
      if (envelope.event.type === 'userMessage') {
        const summary = conversations.value.find(entry => entry.id === conversation.id)
        if (summary && !summary.title) {
          summary.title = envelope.event.text.split('\n', 1)[0]!.slice(0, 80)
        }
      }
    }, open => connected.set(conversation.id, open)))
  }

  function unfollow (id: string) {
    followers.get(id)?.()
    followers.delete(id)
    transcripts.delete(id)
    connected.delete(id)
  }

  async function startChat (agentId: AgentId) {
    starting.value = true
    const conversation = await run(() => client.call('startConversation', { agentId }))
    starting.value = false
    if (conversation) {
      conversations.value.unshift(conversation)
      follow(conversation)
      activeId.value = conversation.id
    }
  }

  async function send (conversationId: string, text: string) {
    await run(() => client.call('sendPrompt', { conversationId, text }))
  }

  async function stop (conversationId: string) {
    await run(() => client.call('cancelTurn', { conversationId }))
  }

  async function answer (conversationId: string, approvalId: string, decision: ApprovalDecision) {
    answering.add(approvalId)
    const done = await run(() => client.call('answerApproval', { conversationId, approvalId, decision }))
    if (done === undefined) {
      answering.delete(approvalId)
    }
  }

  async function setModel (conversationId: string, value: string) {
    const summary = await run(() => client.call('setModel', { conversationId, value }))
    if (summary) {
      conversations.value = conversations.value.map(entry => entry.id === summary.id ? summary : entry)
    }
  }

  async function closeChat () {
    const id = closing.value
    closing.value = null
    if (!id) {
      return
    }
    await run(() => client.call('closeConversation', { conversationId: id }))
    unfollow(id)
    conversations.value = conversations.value.filter(entry => entry.id !== id)
    if (activeId.value === id) {
      activeId.value = conversations.value[0]?.id ?? null
    }
  }

  async function copyFolder (folder: string) {
    await navigator.clipboard.writeText(folder)
    notifications.notify({ text: t('chat.copied'), color: 'success' })
  }

  onMounted(async () => {
    await loadStatus()
    const list = await run(() => client.call('listConversations', {}))
    if (list) {
      conversations.value = list.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
      for (const conversation of conversations.value) {
        follow(conversation)
      }
      activeId.value = conversations.value[0]?.id ?? null
    }
  })

  onBeforeUnmount(() => {
    for (const stop of followers.values()) {
      stop()
    }
    followers.clear()
  })
</script>
