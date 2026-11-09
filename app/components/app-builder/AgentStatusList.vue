<template>
  <div>
    <div class="d-flex align-center px-4 pt-3">
      <div class="text-label-large text-medium-emphasis flex-grow-1">{{ t('agents.heading') }}</div>

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

    <v-list>
      <v-list-item
        v-for="agent in status.agents"
        :key="agent.id"
        :data-test="`app-builder-agent-${agent.id}`"
        :subtitle="subtitle(agent)"
        :title="agent.name"
      >
        <template #prepend>
          <v-icon :color="colors[agent.state]" :icon="icons[agent.state]" />
        </template>

        <template v-if="agent.state === 'missing'" #append>
          <v-btn
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

    <div class="text-label-large text-medium-emphasis px-4">{{ t('agents.tools') }}</div>

    <div class="px-4 pb-3 text-body-small text-medium-emphasis">
      <div v-for="tool in status.tools" :key="tool.name">
        {{ tool.name }} {{ tool.path ? tool.version ?? '' : t('agents.toolMissing') }}
      </div>
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

  const icons: Record<AgentState, string> = {
    ready: 'mdi-check-circle-outline',
    missing: 'mdi-download-outline',
    signedOut: 'mdi-account-alert-outline',
    error: 'mdi-alert-circle-outline',
  }
  const colors: Record<AgentState, string> = {
    ready: 'success',
    missing: 'medium-emphasis',
    signedOut: 'warning',
    error: 'error',
  }

  function subtitle (agent: AgentStatus): string {
    switch (agent.state) {
      case 'ready': {
        return agent.version ? `${t('agents.ready')} · ${agent.version}` : t('agents.ready')
      }
      case 'signedOut': {
        return t('agents.signIn', { command: agent.signInCommand })
      }
      case 'error': {
        return agent.detail ?? t('agents.error')
      }
      default: {
        return t('agents.missing')
      }
    }
  }
</script>
