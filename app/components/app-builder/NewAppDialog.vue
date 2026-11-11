<template>
  <v-dialog v-model="open" max-width="640">
    <v-card data-test="app-builder-new-dialog" :title="t('newApp.title')">
      <v-card-text>
        <div class="text-label-medium mb-1">{{ t('newApp.startFrom') }}</div>

        <v-btn-toggle v-model="kind" class="mb-3" data-test="app-builder-new-kind" mandatory>
          <v-btn :text="t('newApp.empty')" value="new" />
          <v-btn :text="t('newApp.copy')" value="copy" />
          <v-btn :text="t('newApp.folder')" value="folder" />
        </v-btn-toggle>

        <div class="d-flex flex-column ga-3">
          <v-select
            v-if="kind === 'copy'"
            v-model="source"
            data-test="app-builder-new-source"
            item-title="title"
            item-value="source"
            :items="bundled"
            :label="t('newApp.source')"
            :loading="bundled.length === 0"
          >
            <template #item="{ props: item, item: entry }">
              <v-list-item v-bind="item" :subtitle="entry.description ?? entry.appId" />
            </template>
          </v-select>

          <div v-if="kind === 'folder'" class="d-flex flex-wrap align-center ga-2">
            <v-btn-secondary data-test="app-builder-new-folder" prepend-icon="mdi-folder-open-outline" :text="folder?.fileName ?? t('newApp.chooseFolder')" @click="chooseFolder" />
            <span class="text-body-small text-medium-emphasis">{{ t('newApp.folderHint') }}</span>
          </div>

          <v-text-field
            v-model="name"
            data-test="app-builder-new-name"
            :hint="kind === 'folder' ? t('newApp.nameFromFolder') : undefined"
            :label="t('newApp.name')"
            :persistent-hint="kind === 'folder'"
          />

          <v-select
            v-model="agentId"
            data-test="app-builder-new-agent"
            item-title="name"
            item-value="id"
            :items="agents"
            :label="t('newApp.agent')"
          />

          <v-select
            v-if="loadingModels || models.length > 1"
            v-model="model"
            data-test="app-builder-new-model"
            :disabled="loadingModels"
            item-title="name"
            item-value="value"
            :items="models"
            :label="t('newApp.model')"
            :loading="loadingModels"
          >
            <template #item="{ props: item, item: entry }">
              <v-list-item v-bind="item" :subtitle="entry.description ?? undefined" />
            </template>
          </v-select>

          <div v-else-if="selectedAgent && agentId! in asked && !setting" class="text-body-small text-medium-emphasis mt-n1">{{ t('newApp.modelLater', { agent: selectedAgent.name }) }}</div>

          <v-textarea
            v-if="kind !== 'folder'"
            v-model="prompt"
            auto-grow
            data-test="app-builder-new-prompt"
            :hint="kind === 'new' ? t('newApp.promptHint') : t('newApp.promptOptional')"
            :label="t('newApp.prompt')"
            persistent-hint
            rows="3"
          />
        </div>

        <div class="text-body-small text-medium-emphasis mt-3">{{ kind === 'folder' ? t('newApp.whereFolder') : t('newApp.where') }}</div>
      </v-card-text>

      <template #actions>
        <v-btn-secondary :text="t('newApp.cancel')" @click="open = false" />

        <v-btn-primary
          data-test="app-builder-new-create"
          :disabled="!valid"
          :loading="busy"
          :text="kind === 'folder' ? t('newApp.add') : t('newApp.create')"
          @click="create"
        />
      </template>
    </v-card>
  </v-dialog>
</template>

<script lang="ts" setup>
  import type { AgentId, AgentSetting, AgentStatus, BundledAppSource } from '#shared/contract'
  import { computed, ref, watch } from 'vue'
  import { useI18n } from './i18n'

  export type NewAppRequest
    = | { kind: 'new', name: string, agentId: AgentId, model: string | null, prompt: string }
      | { kind: 'copy', name: string, agentId: AgentId, model: string | null, prompt: string | null, source: string }
      | { kind: 'folder', name: string | null, agentId: AgentId, model: string | null, folderHandle: string }

  // A new app (plan P2, P4, P5): from Studio's template, as a copy of a
  // bundled app, or from a folder with an app's sources.
  const open = defineModel<boolean>({ required: true })
  const props = defineProps<{ agents: AgentStatus[], busy: boolean, bundled: BundledAppSource[], presetAppId: string | null }>()
  const emit = defineEmits<{ create: [request: NewAppRequest] }>()
  const { t } = useI18n()
  const desktop = useDesktopBridge()

  const kind = ref<'new' | 'copy' | 'folder'>('new')
  const name = ref('')
  const prompt = ref('')
  const agentId = ref<AgentId | null>(null)
  const source = ref<string | null>(null)
  const folder = ref<{ handle: string, fileName: string } | null>(null)
  const model = ref<string | null>(null)

  // The agent's models: those of its last chat (in the status), else asked
  // from the agent once (getAgentModels); its current one is preselected.
  const client = useAppBuilderClient()
  const asked = ref<Partial<Record<AgentId, AgentSetting | null>>>({})
  const loadingModels = ref(false)
  const selectedAgent = computed(() => props.agents.find(agent => agent.id === agentId.value) ?? null)
  const setting = computed(() => selectedAgent.value?.model ?? (agentId.value ? asked.value[agentId.value] : null) ?? null)
  const models = computed(() => setting.value?.options ?? [])
  watch(setting, value => {
    model.value = value?.current ?? null
  }, { immediate: true })
  watch([open, agentId], async ([isOpen, id]) => {
    if (!isOpen || !id || selectedAgent.value?.model || id in asked.value) {
      return
    }
    loadingModels.value = true
    const found = await client.call('getAgentModels', { agentId: id }).catch(() => null)
    asked.value = { ...asked.value, [id]: found }
    loadingModels.value = false
  }, { immediate: true })

  function titleOf (entry: string | null): string {
    return props.bundled.find(app => app.source === entry)?.title ?? ''
  }

  function presetSource () {
    const preset = props.bundled.find(app => app.appId === props.presetAppId)
    source.value = preset?.source ?? source.value ?? props.bundled[0]?.source ?? null
  }

  watch(open, value => {
    if (value) {
      name.value = ''
      prompt.value = ''
      folder.value = null
      kind.value = props.presetAppId ? 'copy' : 'new'
      agentId.value = agentId.value && props.agents.some(agent => agent.id === agentId.value) ? agentId.value : props.agents[0]?.id ?? null
      presetSource()
      if (kind.value === 'copy') {
        name.value = `${titleOf(source.value)} (copy)`
      }
    }
  })
  // The bundled app the Apps page asked for, once the list is there.
  watch(() => props.bundled, presetSource)
  // The first ready agent, once the status is there.
  watch(() => props.agents, agents => {
    if (agentId.value === null || !agents.some(agent => agent.id === agentId.value)) {
      agentId.value = agents[0]?.id ?? null
    }
  })

  // A copy is called after its source until the user names it.
  watch(source, (value, previous) => {
    if (kind.value === 'copy' && (!name.value || name.value === `${titleOf(previous)} (copy)`)) {
      name.value = `${titleOf(value)} (copy)`
    }
  })
  watch(kind, value => {
    if (value === 'copy' && !name.value) {
      name.value = `${titleOf(source.value)} (copy)`
    }
  })

  async function chooseFolder () {
    const [grant] = await desktop?.chooseStackFiles?.('app-project') ?? []
    if (grant) {
      folder.value = { handle: grant.handle, fileName: grant.fileName }
    }
  }

  const named = computed(() => name.value.trim().length > 0 && /[\p{L}\p{N}]/u.test(name.value))
  const valid = computed(() => {
    if (agentId.value === null) {
      return false
    }
    switch (kind.value) {
      case 'new': {
        return named.value && prompt.value.trim().length > 0
      }
      case 'copy': {
        return named.value && source.value !== null
      }
      default: {
        return folder.value !== null && (name.value.trim() === '' || named.value)
      }
    }
  })

  function create () {
    if (!valid.value) {
      return
    }
    const text = prompt.value.trim()
    if (kind.value === 'new') {
      emit('create', { kind: 'new', name: name.value.trim(), agentId: agentId.value!, model: model.value, prompt: text })
    } else if (kind.value === 'copy') {
      emit('create', { kind: 'copy', name: name.value.trim(), agentId: agentId.value!, model: model.value, prompt: text || null, source: source.value! })
    } else {
      emit('create', { kind: 'folder', name: name.value.trim() || null, agentId: agentId.value!, model: model.value, folderHandle: folder.value!.handle })
    }
  }
</script>
