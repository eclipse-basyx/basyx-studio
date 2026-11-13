<template>
  <!-- The engine at the bottom of the sidebar, as the App Builder lists its agents. -->
  <v-sheet class="d-flex flex-column flex-shrink-0 pa-3" data-test="engine-footer" height="72">
    <div class="text-label-medium text-medium-emphasis mb-1">{{ t('engine.choose') }}</div>

    <div class="d-flex align-center ga-2">
      <v-icon :color="engines.selected?.running ? 'success' : 'warning'" icon="mdi-circle" :size="10" />

      <div class="text-body-medium">{{ name }}</div>

      <v-menu :close-on-content-click="false">
        <template #activator="{ props: activator }">
          <v-btn
            v-tooltip="t('engine.choose')"
            v-bind="activator"
            append-icon="mdi-chevron-down"
            :aria-label="t('engine.choose')"
            class="text-body-small text-medium-emphasis ms-auto"
            data-test="engine"
            size="small"
            :text="detail"
          />
        </template>

        <v-list :lines="false" min-width="320">
          <v-list-subheader>{{ t('engine.choose') }}</v-list-subheader>

          <v-list-item
            :active="engines.configured === null"
            prepend-icon="mdi-auto-fix"
            :title="t('engine.automatic')"
            @click="emit('select', null)"
          />

          <v-list-item
            v-for="engine in engines.candidates"
            :key="engine.host"
            :active="engines.configured === engine.host"
            :disabled="!engine.running"
            :prepend-icon="engine.kind === 'podman' ? 'mdi-seal' : 'mdi-docker'"
            :subtitle="engine.running ? `${engine.version} · ${engine.host}` : `${t('engine.notRunning')} · ${engine.host}`"
            :title="engine.name"
            @click="emit('select', engine.host)"
          />

          <v-divider />

          <div class="pa-3">
            <v-text-field
              v-model="customHost"
              data-test="engine-host"
              :hint="t('engine.socketHint')"
              :label="t('engine.socket')"
              persistent-hint
            />

            <v-btn-primary :disabled="!validHost" :text="t('engine.useSocket')" @click="emit('select', customHost.trim())" />
          </div>
        </v-list>
      </v-menu>
    </div>
  </v-sheet>
</template>

<script lang="ts" setup>
  import type { Engines } from '@basyx/studio-sdk'
  import { computed, ref } from 'vue'
  import { useI18n } from './i18n'

  const props = defineProps<{ engines: Engines }>()
  const emit = defineEmits<{ select: [host: string | null] }>()
  const { t } = useI18n()
  const customHost = ref(props.engines.configured ?? '')
  const validHost = computed(() => /^(?:unix:\/\/\/\S+|npipe:\/\/\/\/\.\/pipe\/[\w.-]+)$/.test(customHost.value.trim()))

  const name = computed(() => props.engines.selected?.name ?? t('engine.none'))

  const detail = computed(() => {
    const selected = props.engines.selected
    if (!selected) {
      return t('engine.setSocket')
    }
    return selected.running ? `${selected.version ?? ''} · ${t('engine.runningShort')}` : t('engine.notRunning')
  })
</script>
