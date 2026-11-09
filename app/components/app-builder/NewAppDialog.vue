<template>
  <v-dialog v-model="open" max-width="640">
    <v-card data-test="app-builder-new-dialog" :title="t('newApp.title')">
      <v-card-text>
        <v-form-fields class="d-flex flex-column ga-4">
          <v-text-field
            v-model="name"
            autofocus
            data-test="app-builder-new-name"
            :label="t('newApp.name')"
          />

          <v-select
            v-model="agentId"
            data-test="app-builder-new-agent"
            item-title="name"
            item-value="id"
            :items="agents"
            :label="t('newApp.agent')"
          />

          <v-textarea
            v-model="prompt"
            auto-grow
            data-test="app-builder-new-prompt"
            :hint="t('newApp.promptHint')"
            :label="t('newApp.prompt')"
            persistent-hint
            rows="4"
          />
        </v-form-fields>

        <div class="text-body-small text-medium-emphasis mt-4">{{ t('newApp.where') }}</div>
      </v-card-text>

      <template #actions>
        <v-btn-secondary :text="t('newApp.cancel')" @click="open = false" />

        <v-btn-primary
          data-test="app-builder-new-create"
          :disabled="!valid"
          :loading="busy"
          :text="t('newApp.create')"
          @click="create"
        />
      </template>
    </v-card>
  </v-dialog>
</template>

<script lang="ts" setup>
  import type { AgentId, AgentStatus } from '#shared/contract'
  import { computed, ref, watch } from 'vue'
  import { useI18n } from './i18n'

  // A new app: its name, the agent that builds it, and what it should do.
  const open = defineModel<boolean>({ required: true })
  const props = defineProps<{ agents: AgentStatus[], busy: boolean }>()
  const emit = defineEmits<{ create: [values: { name: string, agentId: AgentId, prompt: string }] }>()
  const { t } = useI18n()

  const name = ref('')
  const prompt = ref('')
  const agentId = ref<AgentId | null>(null)

  watch(open, value => {
    if (value) {
      name.value = ''
      prompt.value = ''
      agentId.value = agentId.value && props.agents.some(agent => agent.id === agentId.value) ? agentId.value : props.agents[0]?.id ?? null
    }
  })

  const valid = computed(() => name.value.trim().length > 0 && /[\p{L}\p{N}]/u.test(name.value) && prompt.value.trim().length > 0 && agentId.value !== null)

  function create () {
    if (valid.value) {
      emit('create', { name: name.value.trim(), agentId: agentId.value!, prompt: prompt.value.trim() })
    }
  }
</script>
