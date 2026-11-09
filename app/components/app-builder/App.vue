<template>
  <v-sheet-full-page>
    <div class="d-flex flex-grow-1 overflow-hidden">
      <v-sheet class="d-flex flex-column flex-shrink-0 border-e" width="320">
        <div class="pa-3">
          <v-btn-primary
            block
            data-test="app-builder-new"
            :disabled="readyAgents.length === 0"
            prepend-icon="mdi-plus"
            :text="t('projects.new')"
            @click="newApp = true"
          />
        </div>

        <div class="flex-grow-1 overflow-y-auto">
          <div class="text-label-large text-medium-emphasis px-4">{{ t('projects.heading') }}</div>

          <v-list v-if="projects.length > 0" v-model:opened="opened">
            <v-list-group v-for="project in projects" :key="project.id" :value="project.id">
              <template #activator="{ props: activator }">
                <v-list-item
                  v-bind="activator"
                  :data-test="`app-builder-project-${project.id}`"
                  prepend-icon="mdi-application-outline"
                  :subtitle="project.appId"
                  :title="project.name"
                >
                  <template #append="{ isActive }">
                    <v-menu>
                      <template #activator="{ props: menu }">
                        <v-btn
                          v-bind="menu"
                          :aria-label="t('projects.actions', { name: project.name })"
                          icon="mdi-dots-vertical"
                          size="small"
                          @click.stop
                        />
                      </template>

                      <v-list>
                        <v-list-item
                          v-for="agent in readyAgents"
                          :key="agent.id"
                          :data-test="`app-builder-new-chat-${agent.id}`"
                          prepend-icon="mdi-chat-plus-outline"
                          :title="t('projects.newChat', { agent: agent.name })"
                          @click="startChat(project, agent.id)"
                        />

                        <v-list-item prepend-icon="mdi-folder-open-outline" :title="t('projects.openFolder')" @click="openFolder(project)" />
                        <v-list-item prepend-icon="mdi-content-copy" :title="t('projects.copyPath')" @click="copyPath(project.folder)" />
                        <v-list-item prepend-icon="mdi-delete-outline" :title="t('projects.remove')" @click="removing = { project, deleteFolder: false }" />
                      </v-list>
                    </v-menu>

                    <v-icon :icon="isActive ? 'mdi-chevron-up' : 'mdi-chevron-down'" />
                  </template>
                </v-list-item>
              </template>

              <v-list-item
                v-for="conversation in project.conversations"
                :key="conversation.id"
                :active="conversation.id === activeId"
                :data-test="`app-builder-chat-${conversation.id}`"
                :prepend-icon="chatIcon(conversation)"
                :subtitle="agentName(conversation.agentId)"
                :title="conversation.title || t('chats.untitled')"
                @click="select(conversation.id)"
              />
            </v-list-group>
          </v-list>

          <div v-else class="px-4 py-2 text-body-small text-medium-emphasis">{{ t('projects.empty') }}</div>
        </div>

        <v-divider />
        <AgentStatusList v-if="status" :checking="checking" :status="status" @recheck="loadStatus(true)" />
        <v-progress-linear v-else />
      </v-sheet>

      <div class="d-flex flex-column flex-grow-1 overflow-hidden">
        <ProblemAlert v-if="error" class="ma-3" :error="error" />

        <ChatView
          v-if="active && activeTranscript"
          :key="active.conversation.id"
          :agent-name="agentName(active.conversation.agentId)"
          :answering="answering"
          :connected="connected.get(active.conversation.id) ?? true"
          :conversation="active.conversation"
          :project-name="active.project.name"
          :transcript="activeTranscript"
          @answer="(approvalId, decision) => answer(active!.conversation.id, approvalId, decision)"
          @delete="deleting = active!.conversation.id"
          @send="text => send(active!.conversation.id, text)"
          @set-model="value => setModel(active!.conversation.id, value)"
          @show-changes="commit => showChanges(active!.project.id, commit)"
          @stop="stop(active!.conversation.id)"
          @undo="commit => undoing = { conversationId: active!.conversation.id, commit }"
        />

        <div v-else class="d-flex flex-column align-center justify-center flex-grow-1 pa-6 text-center">
          <v-icon color="medium-emphasis" icon="mdi-creation-outline" size="48" />
          <div class="text-headline-small mt-3">{{ t('app.title') }}</div>
          <div class="text-body-medium text-medium-emphasis mt-1 mb-4">{{ t('app.subtitle') }}</div>
          <v-btn-primary v-if="readyAgents.length > 0" prepend-icon="mdi-plus" :text="t('projects.new')" @click="newApp = true" />
          <div v-else-if="status" class="text-body-medium text-medium-emphasis">{{ t('agents.noneReady') }}</div>
        </div>
      </div>
    </div>

    <NewAppDialog v-model="newApp" :agents="readyAgents" :busy="creating" @create="createApp" />

    <ChangesDialog :patch="patch" @close="patch = null" />

    <v-dialog max-width="480" :model-value="deleting !== null" @update:model-value="open => { if (!open) deleting = null }">
      <v-card :text="t('chats.deleteText')" :title="t('chats.deleteTitle')">
        <template #actions>
          <v-btn-secondary :text="t('chats.cancel')" @click="deleting = null" />
          <v-btn-primary data-test="app-builder-delete-confirm" :text="t('chats.delete')" @click="deleteChat" />
        </template>
      </v-card>
    </v-dialog>

    <v-dialog max-width="520" :model-value="undoing !== null" @update:model-value="open => { if (!open) undoing = null }">
      <v-card :text="t('checkpoint.undoText')" :title="t('checkpoint.undoTitle')">
        <template #actions>
          <v-btn-secondary :text="t('chats.cancel')" @click="undoing = null" />
          <v-btn-primary data-test="app-builder-undo-confirm" :text="t('checkpoint.undoConfirm')" @click="undo" />
        </template>
      </v-card>
    </v-dialog>

    <v-dialog max-width="560" :model-value="removing !== null" @update:model-value="open => { if (!open) removing = null }">
      <v-card v-if="removing" :title="t('projects.removeTitle', { name: removing.project.name })">
        <v-card-text>
          <div class="text-body-medium">{{ t('projects.removeText') }}</div>

          <v-checkbox
            v-model="removing.deleteFolder"
            class="mt-2"
            data-test="app-builder-remove-folder"
            hide-details
            :label="t('projects.deleteFolder', { folder: removing.project.folder })"
          />
        </v-card-text>

        <template #actions>
          <v-btn-secondary :text="t('chats.cancel')" @click="removing = null" />
          <v-btn-primary data-test="app-builder-remove-confirm" :text="t('projects.removeConfirm')" @click="removeProject" />
        </template>
      </v-card>
    </v-dialog>
  </v-sheet-full-page>
</template>

<script lang="ts" setup>
  import type { AgentId, AppBuilderStatus, AppProject, ApprovalDecision, ConversationSummary } from '#shared/contract'
  import type { Transcript } from './transcript'
  import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowReactive } from 'vue'
  import AgentStatusList from './AgentStatusList.vue'
  import ChangesDialog from './ChangesDialog.vue'
  import ChatView from './ChatView.vue'
  import { provideI18n } from './i18n'
  import NewAppDialog from './NewAppDialog.vue'
  import { applyEvent, emptyTranscript } from './transcript'

  // The App Builder (ADR 0054): apps on this computer, each a folder with a
  // git repository, and chats with the coding agents that build them. The
  // Studio Service runs the agents; chats are saved and resume.
  const { t } = provideI18n()
  const client = useAppBuilderClient()
  const notifications = useNotificationsStore()

  const status = ref<AppBuilderStatus | null>(null)
  const checking = ref(false)
  const creating = ref(false)
  const error = ref<unknown>(null)
  const projects = ref<AppProject[]>([])
  const opened = ref<string[]>([])
  const transcripts = reactive(new Map<string, Transcript>())
  const connected = reactive(new Map<string, boolean>())
  const answering = shallowReactive(new Set<string>())
  const followers = new Map<string, () => void>()
  const activeId = ref<string | null>(null)
  const newApp = ref(false)
  const patch = ref<string | null>(null)
  const deleting = ref<string | null>(null)
  const undoing = ref<{ conversationId: string, commit: string } | null>(null)
  const removing = ref<{ project: AppProject, deleteFolder: boolean } | null>(null)

  const readyAgents = computed(() => status.value?.agents.filter(agent => agent.state === 'ready') ?? [])
  const active = computed(() => {
    for (const project of projects.value) {
      const conversation = project.conversations.find(entry => entry.id === activeId.value)
      if (conversation) {
        return { project, conversation }
      }
    }
    return null
  })
  const activeTranscript = computed(() => activeId.value ? transcripts.get(activeId.value) ?? null : null)

  function agentName (id: AgentId): string {
    return status.value?.agents.find(agent => agent.id === id)?.name ?? id
  }

  function chatIcon (conversation: ConversationSummary): string {
    const transcript = transcripts.get(conversation.id)
    const state = transcript?.state ?? conversation.state
    if (state === 'working') {
      return transcript?.items.some(item => item.kind === 'approval' && item.state === 'pending') ? 'mdi-hand-back-left-outline' : 'mdi-dots-horizontal-circle-outline'
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

  /** Whether an action without a result succeeded; its error is shown. */
  async function succeeded (action: () => Promise<unknown>): Promise<boolean> {
    error.value = null
    try {
      await action()
      return true
    } catch (error_) {
      error.value = error_
      return false
    }
  }

  async function loadStatus (refresh = false) {
    checking.value = true
    await run(async () => {
      status.value = await client.call('getStatus', { refresh })
    })
    checking.value = false
  }

  async function loadProjects () {
    const list = await run(() => client.call('listProjects', {}))
    if (list) {
      projects.value = list
    }
  }

  /** Follows a chat's events from the time it is first opened. */
  function follow (conversation: ConversationSummary) {
    if (followers.has(conversation.id)) {
      return
    }
    if (!transcripts.has(conversation.id)) {
      transcripts.set(conversation.id, emptyTranscript())
    }
    const transcript = transcripts.get(conversation.id)!
    followers.set(conversation.id, client.follow(conversation.id, transcript.seq, envelope => {
      applyEvent(transcript, envelope)
      if (envelope.event.type === 'approval' && envelope.event.state !== 'pending') {
        answering.delete(envelope.event.approvalId)
      }
      if (envelope.event.type === 'userMessage' && !conversation.title) {
        conversation.title = envelope.event.text.split('\n', 1)[0]!.slice(0, 80)
      }
    }, open => connected.set(conversation.id, open)))
  }

  function select (conversationId: string) {
    activeId.value = conversationId
    const conversation = active.value?.conversation
    if (conversation) {
      follow(conversation)
      if (!opened.value.includes(conversation.projectId)) {
        opened.value = [...opened.value, conversation.projectId]
      }
    }
  }

  async function createApp (values: { name: string, agentId: AgentId, prompt: string }) {
    creating.value = true
    const created = await run(() => client.call('createProject', values))
    creating.value = false
    if (created) {
      newApp.value = false
      projects.value = [created.project, ...projects.value]
      select(created.conversation.id)
    }
  }

  async function startChat (project: AppProject, agentId: AgentId) {
    const conversation = await run(() => client.call('startConversation', { projectId: project.id, agentId }))
    if (conversation) {
      project.conversations.unshift(conversation)
      select(conversation.id)
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
    if (!await succeeded(() => client.call('answerApproval', { conversationId, approvalId, decision }))) {
      answering.delete(approvalId)
    }
  }

  async function setModel (conversationId: string, value: string) {
    await run(() => client.call('setModel', { conversationId, value }))
  }

  async function showChanges (projectId: string, commit: string) {
    const changes = await run(() => client.call('getChanges', { projectId, commit }))
    if (changes) {
      patch.value = changes.patch
    }
  }

  async function undo () {
    const target = undoing.value
    undoing.value = null
    if (target) {
      await run(() => client.call('undoTurn', target))
    }
  }

  function forget (conversationId: string) {
    followers.get(conversationId)?.()
    followers.delete(conversationId)
    transcripts.delete(conversationId)
    connected.delete(conversationId)
    if (activeId.value === conversationId) {
      activeId.value = null
    }
  }

  async function deleteChat () {
    const id = deleting.value
    deleting.value = null
    if (id && await succeeded(() => client.call('deleteConversation', { conversationId: id }))) {
      forget(id)
      for (const project of projects.value) {
        project.conversations = project.conversations.filter(entry => entry.id !== id)
      }
    }
  }

  async function removeProject () {
    const target = removing.value
    removing.value = null
    if (target && await succeeded(() => client.call('removeProject', { projectId: target.project.id, deleteFolder: target.deleteFolder }))) {
      for (const conversation of target.project.conversations) {
        forget(conversation.id)
      }
      projects.value = projects.value.filter(entry => entry.id !== target.project.id)
    }
  }

  async function openFolder (project: AppProject) {
    await run(() => client.call('openFolder', { projectId: project.id }))
  }

  async function copyPath (folder: string) {
    await navigator.clipboard.writeText(folder)
    notifications.notify({ text: folder, color: 'success' })
  }

  onMounted(async () => {
    await Promise.all([loadStatus(), loadProjects()])
    const latest = projects.value[0]?.conversations[0]
    if (latest) {
      select(latest.id)
    }
  })

  onBeforeUnmount(() => {
    for (const stopFollowing of followers.values()) {
      stopFollowing()
    }
    followers.clear()
  })
</script>
