<template>
  <v-menu>
    <template #activator="{ props: menu }">
      <v-btn-chat-setting
        v-bind="menu"
        :aria-label="t('chat.modelMenu')"
        class="text-medium-emphasis"
        data-test="app-builder-model"
        :disabled="disabled"
      >
        <span class="text-high-emphasis">{{ nameOf(model) }}</span>
        <span v-if="effort" class="ms-1">{{ nameOf(effort) }}</span>

        <v-icon
          v-if="speed?.current === 'on'"
          class="ms-1"
          color="primary"
          icon="mdi-lightning-bolt"
          size="x-small"
        />
      </v-btn-chat-setting>
    </template>

    <v-list>
      <v-list-item
        v-for="option in shown"
        :key="option.value"
        :active="option.value === model.current"
        :append-icon="option.value === model.current ? 'mdi-check' : undefined"
        :data-test="`app-builder-model-${option.value}`"
        :title="option.name"
        @click="emit('set', 'model', option.value)"
      />

      <template v-if="more.length > 0">
        <v-divider />

        <v-menu location="end" open-on-hover submenu>
          <template #activator="{ props: submenu }">
            <v-list-item
              v-bind="submenu"
              append-icon="mdi-chevron-right"
              data-test="app-builder-more-models"
              :title="t('chat.moreModels')"
              @click.stop
            />
          </template>

          <v-list>
            <v-list-item
              v-for="option in more"
              :key="option.value"
              :data-test="`app-builder-model-${option.value}`"
              :title="option.name"
              @click="emit('set', 'model', option.value)"
            />
          </v-list>
        </v-menu>
      </template>

      <template v-if="effort">
        <v-divider />

        <v-menu location="end" open-on-hover submenu>
          <template #activator="{ props: submenu }">
            <!-- A click opens the submenu, not closes the menu as a choice would. -->
            <v-list-item v-bind="submenu" data-test="app-builder-effort" :title="t('chat.effort')" @click.stop>
              <template #append>
                <span class="text-body-small text-medium-emphasis me-1">{{ nameOf(effort) }}</span>
                <v-icon icon="mdi-chevron-right" />
              </template>
            </v-list-item>
          </template>

          <v-list>
            <v-list-item
              v-for="option in effort.options"
              :key="option.value"
              :active="option.value === effort.current"
              :append-icon="option.value === effort.current ? 'mdi-check' : undefined"
              :data-test="`app-builder-effort-${option.value}`"
              :subtitle="option.description ?? undefined"
              :title="option.name"
              @click="emit('set', 'effort', option.value)"
            />
          </v-list>
        </v-menu>
      </template>

      <template v-if="speed">
        <v-divider />

        <v-list-item
          v-tooltip="t('chat.fastModeHint')"
          data-test="app-builder-speed"
          prepend-icon="mdi-lightning-bolt-outline"
          :title="t('chat.fastMode')"
          @click="emit('set', 'speed', speed.current === 'on' ? 'off' : 'on')"
        >
          <!-- The narrow switch, not Studio's inset one: it fits a menu row. -->
          <template #append>
            <v-switch
              :aria-label="t('chat.fastMode')"
              class="ms-4"
              :inset="false"
              :model-value="speed.current === 'on'"
              readonly
            />
          </template>
        </v-list-item>
      </template>
    </v-list>
  </v-menu>
</template>

<script lang="ts" setup>
  import type { AgentSetting, AgentSettingKind } from '#shared/contract'
  import { computed } from 'vue'
  import { useI18n } from './i18n'

  // The chat's model, as in the coding agents' own apps: one compact button
  // under the prompt box with the model and its effort, and a menu to choose
  // the model, the effort and fast mode where the agent offers them.
  const props = defineProps<{ model: AgentSetting, effort: AgentSetting | null, speed: AgentSetting | null, disabled: boolean }>()
  const emit = defineEmits<{ set: [setting: AgentSettingKind, value: string] }>()
  const { t } = useI18n()

  /** The agent's first models, as it orders them (newest and recommended first), and the chosen one; the rest under "More models". */
  const firstModels = 5
  const shown = computed(() => props.model.options.filter((option, index) => index < firstModels || option.value === props.model.current))
  const more = computed(() => props.model.options.filter((option, index) => index >= firstModels && option.value !== props.model.current))

  function nameOf (setting: AgentSetting): string {
    return setting.options.find(option => option.value === setting.current)?.name ?? setting.current
  }
</script>
