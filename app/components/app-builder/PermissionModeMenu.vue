<template>
  <v-menu>
    <template #activator="{ props: menu }">
      <v-btn
        v-bind="menu"
        :aria-label="t('mode.label')"
        :color="mode === 'unrestricted' ? 'error' : undefined"
        data-test="app-builder-permission-mode"
        :prepend-icon="icons[mode]"
        size="small"
        :text="t(`mode.${mode}`)"
      />
    </template>

    <v-list>
      <v-list-item
        v-for="entry in permissionModes"
        :key="entry"
        :active="entry === mode"
        :base-color="entry === 'unrestricted' ? 'error' : undefined"
        :data-test="`app-builder-permission-${entry}`"
        :prepend-icon="icons[entry]"
        :subtitle="t(`mode.${entry}Hint`)"
        :title="t(`mode.${entry}`)"
        @click="choose(entry)"
      />
    </v-list>
  </v-menu>

  <v-dialog v-model="warning" max-width="520">
    <v-card data-test="app-builder-unrestricted-dialog" :title="t('mode.warningTitle')">
      <v-card-text>
        <v-alert icon="mdi-alert-octagon-outline" :text="t('mode.warningText', { agent })" type="error" />

        <ul class="text-body-medium mt-3 ps-5">
          <li>{{ t('mode.warningFiles') }}</li>
          <li>{{ t('mode.warningCommands') }}</li>
          <li>{{ t('mode.warningNetwork') }}</li>
          <li>{{ t('mode.warningScope') }}</li>
        </ul>

        <v-checkbox
          v-model="acknowledged"
          class="mt-2"
          data-test="app-builder-unrestricted-ack"
          :label="t('mode.warningConfirm', { agent })"
        />
      </v-card-text>

      <template #actions>
        <v-btn-secondary :text="t('mode.cancel')" @click="warning = false" />

        <v-btn-primary
          color="error"
          data-test="app-builder-unrestricted-confirm"
          :disabled="!acknowledged"
          :text="t('mode.enable')"
          @click="confirm"
        />
      </template>
    </v-card>
  </v-dialog>
</template>

<script lang="ts" setup>
  import type { PermissionMode } from '#shared/contract'
  import { ref } from 'vue'
  import { permissionModes } from '#shared/contract'
  import { useI18n } from './i18n'

  // How freely the agent works in this chat (ADR 0054). Unrestricted asks
  // for an explicit acknowledgement each time it is switched on.
  defineProps<{ mode: PermissionMode, agent: string }>()
  const emit = defineEmits<{ set: [mode: PermissionMode, acknowledgeRisk: boolean] }>()
  const { t } = useI18n()

  const icons: Record<PermissionMode, string> = {
    ask: 'mdi-hand-back-left-outline',
    auto: 'mdi-flash-outline',
    unrestricted: 'mdi-alert-octagon-outline',
  }

  const warning = ref(false)
  const acknowledged = ref(false)

  function choose (entry: PermissionMode) {
    if (entry === 'unrestricted') {
      acknowledged.value = false
      warning.value = true
      return
    }
    emit('set', entry, false)
  }

  function confirm () {
    warning.value = false
    emit('set', 'unrestricted', true)
  }
</script>
