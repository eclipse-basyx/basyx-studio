<template>
  <!-- The App Builder's own themes (vuetify.config.ts), in the mode Studio is in. -->
  <v-theme-provider :theme="builderTheme" with-background>
    <v-sheet-app-builder>
      <div class="d-flex flex-grow-1 overflow-hidden">
        <v-sheet class="d-flex flex-column flex-shrink-0" color="sidebar" width="280">
          <div class="d-flex align-center ga-3 px-4 py-4">
            <v-icon color="primary" icon="mdi-creation" size="small" />
            <span class="text-title-medium font-weight-bold">{{ t('app.title') }}</span>
          </div>

          <div class="px-2 pb-2">
            <v-btn
              block
              class="justify-start"
              color="primary"
              data-test="app-builder-new"
              :disabled="readyAgents.length === 0"
              prepend-icon="mdi-plus"
              :text="t('projects.new')"
              @click="newApp = true"
            />
          </div>

          <div class="flex-grow-1 overflow-y-auto">
            <div class="text-label-medium text-medium-emphasis px-3 pt-1">{{ t('projects.heading') }}</div>

            <v-list
              v-if="projects.length > 0"
              v-model:opened="opened"
              class="mx-2"
              color="on-surface"
              slim
            >
              <v-list-group v-for="project in projects" :key="project.id" :value="project.id">
                <template #activator="{ props: activator, isOpen }">
                  <v-list-item
                    v-tooltip="project.appId"
                    v-bind="activator"
                    :data-test="`app-builder-project-${project.id}`"
                    :title="project.name"
                  >
                    <template #prepend>
                      <v-icon color="medium-emphasis" :icon="isOpen ? 'mdi-chevron-down' : 'mdi-chevron-right'" />
                    </template>

                    <template #append>
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

                          <v-list-item data-test="app-builder-browse-files" prepend-icon="mdi-file-tree-outline" :title="t('files.browse')" @click="openFiles(project)" />
                          <v-list-item prepend-icon="mdi-folder-open-outline" :title="t('projects.openFolder')" @click="openFolder(project)" />
                          <v-list-item prepend-icon="mdi-content-copy" :title="t('projects.copyPath')" @click="copyPath(project.folder)" />
                          <v-list-item prepend-icon="mdi-delete-outline" :title="t('projects.remove')" @click="removing = { project, deleteFolder: false }" />
                        </v-list>
                      </v-menu>
                    </template>
                  </v-list-item>
                </template>

                <v-list-item
                  v-for="conversation in project.conversations"
                  :key="conversation.id"
                  :active="conversation.id === activeId"
                  class="ps-10"
                  :data-test="`app-builder-chat-${conversation.id}`"
                  :title="conversation.title || t('chats.untitled')"
                  @click="select(conversation.id)"
                >
                  <template #append>
                    <v-progress-circular
                      v-if="chatMark(conversation) === 'working'"
                      :aria-label="t('chat.working', { agent: agentName(conversation.agentId) })"
                      indeterminate
                      role="img"
                      size="14"
                      width="2"
                    />

                    <v-icon
                      v-else-if="chatMark(conversation) === 'approval'"
                      :aria-label="t('approval.title', { agent: agentName(conversation.agentId) })"
                      color="warning"
                      icon="mdi-hand-back-left-outline"
                      role="img"
                      size="small"
                    />

                    <v-icon
                      v-else-if="chatMark(conversation) === 'unrestricted'"
                      :aria-label="t('mode.unrestricted')"
                      color="error"
                      icon="mdi-alert-octagon-outline"
                      role="img"
                      size="small"
                    />

                    <v-icon
                      v-else-if="chatMark(conversation) === 'failed'"
                      :aria-label="t('chat.failed')"
                      color="error"
                      icon="mdi-alert-circle-outline"
                      role="img"
                      size="small"
                    />
                  </template>
                </v-list-item>
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
            :files-open="rightPane === 'files'"
            :preview-open="rightPane === 'preview'"
            :project-name="active.project.name"
            :transcript="activeTranscript"
            @answer="(approvalId, decision) => answer(active!.conversation.id, approvalId, decision)"
            @delete="deleting = active!.conversation.id"
            @install="installing = active!.project"
            @send="text => send(active!.conversation.id, text)"
            @set-permission-mode="(mode, acknowledgeRisk) => setPermissionMode(active!.conversation.id, mode, acknowledgeRisk)"
            @set-setting="(setting, value) => setSetting(active!.conversation.id, setting, value)"
            @show-changes="commit => showChanges(active!.project.id, commit)"
            @show-files="rightPane === 'files' && filesProject?.id === active!.project.id ? rightPane = null : openFiles(active!.project)"
            @stop="stop(active!.conversation.id)"
            @toggle-preview="rightPane = rightPane === 'preview' ? null : 'preview'"
            @undo="commit => undoing = { conversationId: active!.conversation.id, commit }"
          />

          <div v-else class="d-flex flex-column align-center justify-center flex-grow-1 pa-6 text-center" data-test="app-builder-welcome">
            <v-icon color="primary" icon="mdi-creation" size="48" />
            <div class="text-headline-medium mt-3">{{ t('app.title') }}</div>
            <div class="text-body-medium text-medium-emphasis mt-1 mb-4">{{ t('app.subtitle') }}</div>
            <v-btn-primary v-if="readyAgents.length > 0" prepend-icon="mdi-plus" :text="t('projects.new')" @click="newApp = true" />
            <div v-else-if="status" class="text-body-medium text-medium-emphasis">{{ t('agents.noneReady') }}</div>
          </div>
        </div>

        <v-sheet v-if="rightPane === 'preview' && active" class="flex-shrink-0 border-s" width="42%">
          <PreviewPane
            :key="active.project.id"
            :build-seq="buildSeq"
            :default-target-id="active.project.previewTargetId"
            :project-id="active.project.id"
            @close="rightPane = null"
          />
        </v-sheet>

        <v-sheet v-if="filesProject" v-show="rightPane === 'files'" class="flex-shrink-0 border-s" width="52%">
          <ProjectFilesPane :project="filesProject" :working="filesWorking" @close="rightPane = null" />
        </v-sheet>
      </div>

      <NewAppDialog
        v-model="newApp"
        :agents="readyAgents"
        :bundled="bundled"
        :busy="creating"
        :error="newApp ? error : null"
        :preset-app-id="presetAppId"
        @create="createApp"
      />

      <ChangesDialog :patch="patch" @close="patch = null" />

      <InstallDialog :project="installing" @close="installing = null" @installed="onInstalled" />

      <v-dialog max-width="480" :model-value="deleting !== null" @update:model-value="open => { if (!open) deleting = null }">
        <DialogCard :title="t('chats.deleteTitle')">
          {{ t('chats.deleteText') }}

          <template #actions>
            <v-btn :text="t('chats.cancel')" @click="deleting = null" />
            <v-btn-primary color="error" data-test="app-builder-delete-confirm" :text="t('chats.delete')" @click="deleteChat" />
          </template>
        </DialogCard>
      </v-dialog>

      <v-dialog max-width="520" :model-value="undoing !== null" @update:model-value="open => { if (!open) undoing = null }">
        <DialogCard :title="t('checkpoint.undoTitle')">
          {{ t('checkpoint.undoText') }}

          <template #actions>
            <v-btn :text="t('chats.cancel')" @click="undoing = null" />
            <v-btn-primary data-test="app-builder-undo-confirm" :text="t('checkpoint.undoConfirm')" @click="undo" />
          </template>
        </DialogCard>
      </v-dialog>

      <v-dialog max-width="560" :model-value="removing !== null" @update:model-value="open => { if (!open) removing = null }">
        <DialogCard v-if="removing" :title="t('projects.removeTitle', { name: removing.project.name })">
          <div class="text-body-medium">{{ t('projects.removeText') }}</div>

          <div v-if="removing.project.origin === 'folder'" class="text-body-medium mt-2">{{ t('projects.keepsFolder', { folder: removing.project.folder }) }}</div>

          <v-checkbox
            v-else
            v-model="removing.deleteFolder"
            class="mt-2"
            data-test="app-builder-remove-folder"
            hide-details
            :label="t('projects.deleteFolder', { folder: removing.project.folder })"
          />

          <template #actions>
            <v-btn :text="t('chats.cancel')" @click="removing = null" />
            <v-btn-primary color="error" data-test="app-builder-remove-confirm" :text="t('projects.removeConfirm')" @click="removeProject" />
          </template>
        </DialogCard>
      </v-dialog>
    </v-sheet-app-builder>
  </v-theme-provider>
</template>

<script lang="ts" setup>
  import type { AgentId, AgentSettingKind, AppBuilderStatus, AppProject, ApprovalDecision, BundledAppSource, ConversationSummary, PermissionMode } from '#shared/contract'
  import type { NewAppRequest } from './NewAppDialog.vue'
  import type { Transcript } from './transcript'
  import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowReactive, watch } from 'vue'
  import { StudioApiError } from '~/composables/useStudioApi'
  import AgentStatusList from './AgentStatusList.vue'
  import ChangesDialog from './ChangesDialog.vue'
  import { chatStreamIds } from './chat-streams'
  import ChatView from './ChatView.vue'
  import { provideI18n } from './i18n'
  import InstallDialog from './InstallDialog.vue'
  import NewAppDialog from './NewAppDialog.vue'
  import PreviewPane from './PreviewPane.vue'
  import ProjectFilesPane from './ProjectFilesPane.vue'
  import { applyEvent, emptyTranscript } from './transcript'

  // The App Builder (ADR 0054): apps on this computer, each a folder with a
  // git repository, and chats with the coding agents that build them. The
  // Studio Service runs the agents; chats are saved and resume.
  const { t } = provideI18n()
  const client = useAppBuilderClient()
  const notifications = useNotificationsStore()

  const builderTheme = useAppBuilderTheme()

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
  const rightPane = ref<'preview' | 'files' | null>('preview')
  const installing = ref<AppProject | null>(null)
  const filesProject = ref<AppProject | null>(null)
  const filesWorking = computed(() => filesProject.value?.conversations.some(conversation => ['working', 'starting'].includes(transcripts.get(conversation.id)?.state ?? conversation.state)) ?? false)
  const bundled = ref<BundledAppSource[]>([])
  const route = useRoute()
  /** A bundled app the Apps page sent here to copy (plan P4). */
  const presetAppId = ref<string | null>(typeof route.query.copy === 'string' ? route.query.copy : null)
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
  watch(() => active.value?.project.id, () => {
    if (rightPane.value === 'files' && active.value) {
      filesProject.value = active.value.project
    }
  })
  /** Changes with each finished build of the open chat, so the preview loads again. */
  const buildSeq = computed(() => activeTranscript.value?.items.filter(item => item.kind === 'build' && item.state !== 'running').length ?? 0)

  function openFiles (project: AppProject) {
    filesProject.value = project
    rightPane.value = 'files'
  }

  function agentName (id: AgentId): string {
    return status.value?.agents.find(agent => agent.id === id)?.name ?? id
  }

  /** What a chat in the list shows beside its title: nothing, unless the agent works, waits for an answer, failed or runs unrestricted. */
  function chatMark (conversation: ConversationSummary): 'working' | 'approval' | 'failed' | 'unrestricted' | null {
    const transcript = transcripts.get(conversation.id)
    const state = transcript?.state ?? conversation.state
    if (state === 'working') {
      return transcript?.items.some(item => item.kind === 'approval' && item.state === 'pending') ? 'approval' : 'working'
    }
    if (state === 'failed') {
      return 'failed'
    }
    return (transcript?.permissionMode ?? conversation.permissionMode) === 'unrestricted' ? 'unrestricted' : null
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

  // Release idle chats as soon as another one is selected. Keeping every
  // visited EventSource open exhausts Chromium's HTTP/1 connection pool.
  watch(() => ({
    activeId: activeId.value,
    conversations: projects.value.flatMap(project => project.conversations).map(conversation => ({
      id: conversation.id,
      state: transcripts.get(conversation.id)?.state ?? conversation.state,
    })),
  }), ({ conversations, activeId }) => {
    const ids = new Set(chatStreamIds(conversations, activeId))
    for (const [id, stopFollowing] of followers) {
      if (!ids.has(id)) {
        stopFollowing()
        followers.delete(id)
      }
    }
    for (const conversation of projects.value.flatMap(project => project.conversations)) {
      if (ids.has(conversation.id)) follow(conversation)
    }
  })

  async function createApp (request: NewAppRequest) {
    creating.value = true
    const created = await run(() => {
      switch (request.kind) {
        case 'new': {
          return client.call('createProject', { name: request.name, agentId: request.agentId, previewTargetId: request.previewTargetId, ...(request.model ? { model: request.model } : {}), prompt: request.prompt, ...(request.planning ? { planning: { requirements: request.planning.requirements, plan: request.planning.plan, ...(request.planning.draftId ? { draftId: request.planning.draftId } : {}) } } : {}) })
        }
        case 'copy': {
          return client.call('createProject', { name: request.name, agentId: request.agentId, previewTargetId: request.previewTargetId, ...(request.model ? { model: request.model } : {}), source: request.source, ...(request.prompt ? { prompt: request.prompt } : {}) })
        }
        default: {
          return client.call('addFolder', { folderHandle: request.folderHandle, agentId: request.agentId, previewTargetId: request.previewTargetId, ...(request.model ? { model: request.model } : {}), ...(request.name ? { name: request.name } : {}) })
        }
      }
    })
    creating.value = false
    if (created) {
      newApp.value = false
      projects.value = [created.project, ...projects.value]
      select(created.conversation.id)
    }
  }

  async function startChat (project: AppProject, agentId: AgentId) {
    // A new chat starts with the model the agent ran last.
    const model = status.value?.agents.find(agent => agent.id === agentId)?.model?.current
    const conversation = await run(() => client.call('startConversation', { projectId: project.id, agentId, ...(model ? { model } : {}) }))
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
      // The agent no longer waits for it (its turn ended): the card says so.
      if (error.value instanceof StudioApiError && error.value.code === 'not_found') {
        error.value = null
        for (const item of transcripts.get(conversationId)?.items ?? []) {
          if (item.kind === 'approval' && item.id === approvalId) {
            item.state = 'cancelled'
          }
        }
      }
    }
  }

  async function setSetting (conversationId: string, setting: AgentSettingKind, value: string) {
    await run(() => client.call('setSetting', { conversationId, setting, value }))
  }

  async function setPermissionMode (conversationId: string, mode: PermissionMode, acknowledgeRisk: boolean) {
    await run(() => client.call('setPermissionMode', { conversationId, mode, acknowledgeRisk }))
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

  function onInstalled (text: string) {
    installing.value = null
    notifications.notify({ text, color: 'success' })
  }

  async function copyPath (folder: string) {
    await navigator.clipboard.writeText(folder)
    notifications.notify({ text: folder, color: 'success' })
  }

  // The status carries the models the agents offered in their last chats; read it again for the dialog.
  watch(newApp, open => {
    if (open) {
      void loadStatus()
    }
  })

  onMounted(async () => {
    if (presetAppId.value) {
      newApp.value = true
    }
    await Promise.all([loadStatus(), loadProjects(), (async () => {
      bundled.value = await client.call('listBundledApps', {}).catch(() => [])
    })()])
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
