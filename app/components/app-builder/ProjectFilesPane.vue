<template>
  <div class="d-flex flex-column fill-height overflow-hidden" data-test="app-builder-files" @keydown.ctrl.s.prevent="save" @keydown.meta.s.prevent="save">
    <div class="d-flex align-center ga-2 ps-4 pe-2 py-1 border-b">
      <span class="text-title-small flex-grow-1 text-truncate">{{ project.name }}</span>

      <v-btn
        v-tooltip="t('files.heading')"
        :active="treeOpen"
        :aria-label="t('files.heading')"
        :aria-pressed="treeOpen"
        icon="mdi-file-tree-outline"
        @click="treeOpen = !treeOpen"
      />

      <v-btn
        v-tooltip="t('files.close')"
        :aria-label="t('files.close')"
        data-test="app-builder-files-close"
        icon="mdi-close"
        @click="emit('close')"
      />
    </div>

    <div class="d-flex flex-grow-1 overflow-hidden">
      <div class="d-flex flex-column flex-grow-1 overflow-hidden">
        <div v-if="tabs.length > 0" class="d-flex align-center border-b flex-shrink-0">
          <v-tabs v-model="activePath" class="flex-grow-1 overflow-hidden" show-arrows>
            <v-tab
              v-for="document in tabs"
              :key="document.path"
              data-test="app-builder-file-tab"
              tag="div"
              :title="document.path"
              :value="document.path"
            >
              <span class="text-body-small">{{ document.path.split('/').at(-1) }}</span>

              <v-icon
                v-if="document.draft !== document.content"
                v-tooltip="t('files.unsaved')"
                :aria-label="t('files.unsaved')"
                class="ms-1"
                color="warning"
                icon="mdi-circle-small"
                role="img"
                size="x-small"
              />

              <v-btn
                :aria-label="`${t('files.closeFile')}: ${document.path}`"
                class="ms-1"
                :disabled="saving || opening"
                icon="mdi-close"
                size="x-small"
                @click.stop="closeTab(document)"
              />
            </v-tab>
          </v-tabs>
        </div>

        <ProblemAlert v-if="error" class="ma-2 flex-0-0" :error="error" />
        <div v-if="working && activeFile" class="text-body-small text-medium-emphasis px-3 py-1">{{ t('files.agentWorking') }}</div>
        <v-progress-linear v-if="opening" />

        <template v-if="activeFile">
          <div class="d-flex align-center ga-1 ps-3 pe-1 py-1 border-b flex-shrink-0">
            <span class="text-body-small text-medium-emphasis text-truncate flex-grow-1">{{ activeFile.path }}</span>

            <v-btn
              v-tooltip="t('files.reload')"
              :aria-label="t('files.reload')"
              data-test="app-builder-file-reload"
              :disabled="saving || opening"
              icon="mdi-reload"
              size="small"
              @click="reload"
            />

            <v-btn
              color="primary"
              data-test="app-builder-file-save"
              :disabled="!dirty || working || opening"
              :loading="saving"
              prepend-icon="mdi-content-save-outline"
              size="small"
              :text="t('files.save')"
              @click="save"
            />
          </div>

          <div class="flex-grow-1 overflow-hidden" data-test="app-builder-file-editor">
            <CodeView
              :key="`${activeFile.projectId}:${activeFile.path}`"
              v-model="activeFile.draft"
              :editable="!saving && !opening"
              hide-toolbar
              :label="activeFile.path"
              :language="language"
              model-namespace="app-builder-files"
            />
          </div>
        </template>

        <div v-else class="d-flex align-center justify-center flex-grow-1 pa-4 text-body-small text-medium-emphasis text-center">{{ t('files.choose') }}</div>
      </div>

      <v-sheet v-show="treeOpen" class="d-flex flex-column flex-shrink-0 border-s" width="220">
        <div class="d-flex align-center ga-2 ps-3 pe-1 py-1 border-b">
          <span class="text-label-medium flex-grow-1">{{ t('files.heading') }}</span>

          <v-btn
            v-tooltip="t('files.refresh')"
            :aria-label="t('files.refresh')"
            data-test="app-builder-files-refresh"
            icon="mdi-refresh"
            :loading="loading"
            size="small"
            @click="refresh"
          />
        </div>

        <ProblemAlert v-if="treeError" class="ma-2 flex-0-0" :error="treeError" />
        <v-progress-linear v-if="loading" />

        <div class="flex-grow-1 overflow-auto">
          <v-treeview
            :activated="activeFile ? [activeFile.path] : []"
            active-strategy="single-independent"
            class="pa-1"
            data-test="app-builder-file-tree"
            indent-lines="default"
            item-props
            item-title="name"
            item-value="path"
            :items="items"
            :load-children="loadChildren"
            @update:activated="activate"
          >
            <template #prepend="{ item, isOpen }">
              <v-icon :icon="item.kind === 'directory' ? (isOpen ? 'mdi-folder-open-outline' : 'mdi-folder-outline') : item.kind === 'symlink' ? 'mdi-file-link-outline' : 'mdi-file-document-outline'" size="small" />
            </template>

            <template #title="{ item }">
              <span class="text-body-small">{{ item.name }}</span>
            </template>
          </v-treeview>
        </div>
      </v-sheet>
    </div>
  </div>

  <v-dialog max-width="480" :model-value="pending !== null" @update:model-value="value => { if (!value) cancelDiscard() }">
    <DialogCard :title="t('files.discardTitle')">
      {{ t('files.discardText') }}

      <template #actions>
        <v-btn :text="t('files.cancel')" @click="cancelDiscard" />
        <v-btn-primary color="error" data-test="app-builder-file-discard" :text="t('files.discard')" @click="discard" />
      </template>
    </DialogCard>
  </v-dialog>
</template>

<script lang="ts" setup>
  import type { AppProject, ProjectFileEntry } from '#shared/contract'
  import type { OpenProjectFile } from './file-workspace'
  import { detectViewerKind } from '@basyx/file-viewer'
  import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
  import { onBeforeRouteLeave } from 'vue-router'
  import { FileWorkspace } from './file-workspace'
  import { useI18n } from './i18n'

  interface TreeNode extends ProjectFileEntry {
    children?: TreeNode[]
    props: { activatable: boolean, disabled: boolean }
  }

  const props = defineProps<{ project: AppProject, working: boolean }>()
  const emit = defineEmits<{ close: [] }>()
  const { t } = useI18n()
  const client = useAppBuilderClient()
  const workspace = reactive(new FileWorkspace())
  const tabs = computed(() => workspace.tabs(props.project.id))
  const activeFile = computed(() => workspace.active(props.project.id))
  const activePath = computed({ get: () => workspace.activePaths[props.project.id], set: value => {
    workspace.activePaths[props.project.id] = value
  } })
  const dirty = computed(() => activeFile.value !== null && activeFile.value.draft !== activeFile.value.content)
  const language = computed(() => activeFile.value?.path.endsWith('.vue') ? 'html' : detectViewerKind({ fileName: activeFile.value?.path, contentType: null }).language)
  const items = ref<TreeNode[]>([])
  const treeOpen = ref(true)
  const loading = ref(false)
  const treeError = ref<unknown>(null)
  const error = ref<unknown>(null)
  const opening = ref(false)
  const saving = ref(false)
  const pending = ref<(() => void | Promise<void>) | null>(null)
  let generation = 0

  function nodes (entries: ProjectFileEntry[]): TreeNode[] {
    return entries.map(entry => ({ ...entry, ...(entry.kind === 'directory' ? { children: [] } : {}), props: { activatable: entry.kind === 'file', disabled: entry.kind === 'symlink' } }))
  }

  async function refresh () {
    const version = ++generation
    loading.value = true
    treeError.value = null
    try {
      const entries = await client.call('listProjectFiles', { projectId: props.project.id })
      if (version === generation) items.value = nodes(entries)
    } catch (error_) {
      if (version === generation) treeError.value = error_
    } finally {
      if (version === generation) loading.value = false
    }
  }

  async function loadChildren (raw: unknown) {
    const item = raw as TreeNode
    const version = generation
    try {
      const entries = await client.call('listProjectFiles', { projectId: props.project.id, path: item.path })
      if (version === generation) item.children = nodes(entries)
    } catch (error_) {
      if (version === generation) treeError.value = error_
    }
  }

  function activate (paths: unknown) {
    const path = Array.isArray(paths) ? paths[0] : null
    if (typeof path === 'string') void openFile(path)
  }

  async function openFile (path: string) {
    if (opening.value || saving.value) return
    if (tabs.value.some(document => document.path === path)) {
      workspace.activePaths[props.project.id] = path
      return
    }
    const projectId = props.project.id
    opening.value = true
    error.value = null
    try {
      workspace.open(projectId, await client.call('readProjectFile', { projectId, path }))
    } catch (error_) {
      error.value = error_
    } finally {
      opening.value = false
    }
  }

  async function save () {
    const document = activeFile.value
    if (!document || !dirty.value || saving.value || opening.value || props.working) return
    saving.value = true
    error.value = null
    try {
      workspace.saved(document, await client.call('saveProjectFile', { projectId: document.projectId, path: document.path, content: document.draft, revision: document.revision }))
    } catch (error_) {
      error.value = error_
    } finally {
      saving.value = false
    }
  }

  function confirmDiscard (action: () => void | Promise<void>) {
    pending.value = action
  }

  function closeTab (document: OpenProjectFile) {
    if (!workspace.close(document)) confirmDiscard(() => {
      workspace.close(document, true)
    })
  }

  function reload () {
    const document = activeFile.value
    if (!document || opening.value || saving.value) return
    const action = async () => {
      opening.value = true
      error.value = null
      try {
        const loaded = await client.call('readProjectFile', { projectId: document.projectId, path: document.path })
        workspace.saved(document, loaded)
        document.draft = loaded.content
      } catch (error_) {
        error.value = error_
      } finally {
        opening.value = false
      }
    }
    if (dirty.value) confirmDiscard(action)
    else void action()
  }

  function cancelDiscard () {
    pending.value = null
  }
  function discard () {
    const action = pending.value
    pending.value = null
    void action?.()
  }

  function beforeUnload (event: BeforeUnloadEvent) {
    if (workspace.dirty) {
      event.preventDefault()
      event.returnValue = ''
    }
  }

  onBeforeRouteLeave(to => {
    if (!workspace.dirty) return true
    confirmDiscard(() => {
      workspace.discardAll()
      void navigateTo(to.fullPath)
    })
    return false
  })

  watch(() => props.project.id, () => {
    items.value = []
    error.value = null
    void refresh()
  }, { immediate: true })
  onMounted(() => window.addEventListener('beforeunload', beforeUnload))
  onBeforeUnmount(() => {
    generation++
    window.removeEventListener('beforeunload', beforeUnload)
  })
</script>
