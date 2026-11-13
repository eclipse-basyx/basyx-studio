<template>
  <v-empty-state
    data-test="engine-missing"
    icon="mdi-server-off"
    :text="selected ? t('engine.stoppedText', { name: selected.name }) : t('engine.missingText')"
    :title="selected ? t('engine.stoppedTitle', { name: selected.name }) : t('engine.missingTitle')"
  >
    <template #actions>
      <template v-if="!selected">
        <v-btn-primary append-icon="mdi-open-in-new" :text="t('engine.getDocker')" @click="open('https://www.docker.com/products/docker-desktop/')" />
        <v-btn-secondary append-icon="mdi-open-in-new" :text="t('engine.getPodman')" @click="open('https://podman-desktop.io/')" />
      </template>
    </template>

    <div class="d-flex align-center justify-center ga-2 text-body-small text-medium-emphasis mt-4">
      <v-icon color="warning" icon="mdi-circle" size="8" />
      {{ t('engine.checkingAutomatically') }}
    </div>
  </v-empty-state>
</template>

<script lang="ts" setup>
  import type { Engines } from '@basyx/studio-sdk'
  import { computed } from 'vue'
  import { useI18n } from './i18n'
  import { useClient } from './support'

  const props = defineProps<{ engines: Engines }>()
  const { t } = useI18n()
  const client = useClient()

  /** An engine that exists but does not run. */
  const selected = computed(() => props.engines.selected ?? props.engines.candidates[0] ?? null)

  function open (url: string) {
    void client.ui.openExternal(url)
  }
</script>
