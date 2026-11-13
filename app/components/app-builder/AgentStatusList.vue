<template>
  <div>
    <div class="d-flex align-center ps-3 pe-2 pt-1">
      <div class="text-label-medium text-medium-emphasis flex-grow-1">{{ t('agents.heading') }}</div>

      <v-btn
        v-tooltip="t('agents.recheck')"
        :aria-label="t('agents.recheck')"
        data-test="app-builder-recheck"
        icon="mdi-refresh"
        :loading="checking"
        size="small"
        @click="emit('recheck')"
      />
    </div>

    <v-list slim>
      <v-list-item
        v-for="agent in status.agents"
        :key="agent.id"
        :data-test="`app-builder-agent-${agent.id}`"
        :subtitle="agent.state === 'signedOut' || agent.state === 'error' ? detail(agent) : undefined"
        :title="agent.name"
      >
        <template #prepend>
          <v-icon :color="colors[agent.state]" icon="mdi-circle" size="x-small" />
        </template>

        <template #append>
          <span class="text-body-small text-medium-emphasis ms-2">{{ summary(agent) }}</span>

          <v-btn
            v-if="agent.state === 'missing'"
            v-tooltip="t('agents.install', { agent: agent.name })"
            :aria-label="t('agents.install', { agent: agent.name })"
            :href="agent.installUrl"
            icon="mdi-open-in-new"
            size="small"
            target="_blank"
          />
        </template>
      </v-list-item>
    </v-list>

    <div class="px-3 pb-2 text-label-small text-medium-emphasis">
      {{ t('agents.tools') }}: {{ status.tools.map(tool => `${tool.name} ${tool.path ? tool.version ?? '' : t('agents.toolMissing')}`.trim()).join(' · ') }}
    </div>
  </div>
</template>

<script lang="ts" setup>
  import type { AgentState, AgentStatus, AppBuilderStatus } from '#shared/contract'
  import { useI18n } from './i18n'

  // Which coding agents and tools Studio found, and what to do about the rest.
  defineProps<{ status: AppBuilderStatus, checking: boolean }>()
  const emit = defineEmits<{ recheck: [] }>()
  const { t } = useI18n()

  const colors: Record<AgentState, string> = {
    ready: 'success',
    missing: 'medium-emphasis',
    signedOut: 'warning',
    error: 'error',
  }

  /** The agent's state in a word or two, beside its name. */
  function summary (agent: AgentStatus): string {
    switch (agent.state) {
      case 'ready': {
        return agent.version ? `${t('agents.ready')} · ${agent.version}` : t('agents.ready')
      }
      case 'signedOut':
      case 'error': {
        return ''
      }
      default: {
        return t('agents.missing')
      }
    }
  }

  /** What to do about an agent that cannot run, under its name. */
  function detail (agent: AgentStatus): string {
    return agent.state === 'signedOut' ? t('agents.signIn', { command: agent.signInCommand }) : (agent.state === 'error' ? agent.detail ?? t('agents.error') : '')
  }
</script>
