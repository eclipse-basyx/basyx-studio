<template>
  <v-card class="pa-3" data-test="logs">
    <div class="d-flex flex-wrap align-center ga-2 mb-2">
      <v-select
        v-model="component"
        density="compact"
        hide-details
        :items="components"
        :label="t('logs.component')"
        max-width="280"
      />

      <v-spacer />
      <v-btn :loading="loading" prepend-icon="mdi-refresh" :text="t('logs.refresh')" @click="load" />

      <v-btn
        :aria-label="t('card.copy')"
        :disabled="!text"
        icon="mdi-content-copy"
        size="small"
        :title="t('card.copy')"
        @click="copy"
      />

      <v-btn :disabled="!text" prepend-icon="mdi-content-save-outline" :text="t('logs.save')" @click="save" />
    </div>

    <ErrorAlert v-if="error" :error="error">
      <template v-if="retry" #actions>
        <v-btn :text="t('problem.retry')" @click="retry" />
      </template>
    </ErrorAlert>

    <div v-else-if="!text && !loading" class="text-body-2 text-medium-emphasis">{{ t('logs.empty') }}</div>

    <v-sheet
      v-else
      class="pa-2 overflow-auto text-caption text-mono text-pre"
      color="surface-light"
      max-height="360"
      rounded
    >{{ text }}</v-sheet>
  </v-card>
</template>

<script lang="ts" setup>
  import type { Stack, StackComponentId } from '@basyx/studio-sdk'
  import { computed, ref, watch } from 'vue'
  import ErrorAlert from './ErrorAlert.vue'
  import { useI18n } from './i18n'
  import { useClient } from './support'

  const props = defineProps<{ stack: Stack }>()
  const { t } = useI18n()
  const client = useClient()

  const components = computed(() => props.stack.components.map(component => ({ value: component.id, title: t(`component.${component.id}`) })))
  // The failing part first, else the AAS server.
  const initial = props.stack.components.find(component => component.state === 'unhealthy' || (component.state === 'exited' && component.exitCode !== 0 && component.id !== 'schema'))?.id
    ?? (props.stack.components.some(component => component.id === 'environment') ? 'environment' : props.stack.components[0]?.id)
  const component = ref<StackComponentId | undefined>(initial)
  const text = ref('')
  const loading = ref(false)
  const error = ref<unknown | null>(null)
  const retry = ref<(() => Promise<void>) | null>(null)

  async function load () {
    if (!component.value) {
      return
    }
    loading.value = true
    error.value = null
    retry.value = null
    try {
      text.value = (await client.containers.getLogs(props.stack.id, component.value, 500)).text
    } catch (error_) {
      error.value = error_
      retry.value = load
    } finally {
      loading.value = false
    }
  }

  async function save () {
    if (!component.value) {
      return
    }
    try {
      await client.containers.saveLogs(props.stack.id, component.value)
    } catch (error_) {
      error.value = error_
      retry.value = save
    }
  }

  async function copy () {
    error.value = null
    retry.value = null
    try {
      await client.ui.copyText(text.value)
      await client.ui.notify(t('card.copied'), 'success')
    } catch (error_) {
      error.value = error_
      retry.value = copy
    }
  }

  watch(component, () => void load(), { immediate: true })
</script>
