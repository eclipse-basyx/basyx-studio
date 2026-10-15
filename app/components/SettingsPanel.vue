<template>
  <v-container max-width="960">
    <PageHeader :subtitle="t('settings.subtitle')" :title="t('settings.title')">
      <template #actions>
        <v-btn
          v-tooltip="t('settings.close')"
          :aria-label="t('settings.close')"
          icon="mdi-close"
          @click="panel.close()"
        />
      </template>
    </PageHeader>

    <v-row>
      <v-col cols="12" md="6">
        <v-card height="100%">
          <v-card-item prepend-icon="mdi-palette-outline">
            <v-card-title>{{ t('settings.appearance') }}</v-card-title>
          </v-card-item>

          <v-card-text>
            <div class="text-label-large mb-2">{{ t('settings.theme') }}</div>

            <v-btn-toggle
              class="d-flex mb-6"
              mandatory
              :model-value="preferences.theme"
              @update:model-value="value => save({ theme: value })"
            >
              <v-btn class="flex-grow-1" prepend-icon="mdi-weather-sunny" :text="t('settings.light')" value="light" />
              <v-btn class="flex-grow-1" prepend-icon="mdi-weather-night" :text="t('settings.dark')" value="dark" />
              <v-btn class="flex-grow-1" prepend-icon="mdi-monitor" :text="t('settings.system')" value="system" />
            </v-btn-toggle>

            <!-- Accent and background are chosen apart from the mode, as in
                 Slack (shared/appearance.ts); the swatches show the mode in use. -->
            <div class="text-label-large mb-2">{{ t('settings.accent') }}</div>

            <div class="d-flex flex-wrap align-center ga-2 mb-6">
              <v-btn
                v-for="name in accentNames"
                :key="name"
                v-tooltip="t(`settings.accents.${name}`)"
                :aria-label="t(`settings.accents.${name}`)"
                :aria-pressed="preferences.accent === name"
                icon
                rounded="circle"
                @click="save({ accent: name })"
              >
                <v-avatar :color="accents[name][mode]" rounded="circle" size="32">
                  <v-icon v-if="preferences.accent === name" icon="mdi-check" size="small" />
                </v-avatar>
              </v-btn>

              <!-- Any other colour, kept readable in both modes (readableShade). -->
              <v-menu :close-on-content-click="false" location="bottom start">
                <template #activator="{ props: activator }">
                  <v-btn
                    v-tooltip="t('settings.customAccent')"
                    v-bind="activator"
                    :aria-label="t('settings.customAccent')"
                    :aria-pressed="customSelected"
                    icon
                    rounded="circle"
                  >
                    <v-avatar
                      border
                      :color="customSelected ? accentShade(preferences.accent, dark) : undefined"
                      rounded="circle"
                      size="32"
                    >
                      <v-icon :icon="customSelected ? 'mdi-check' : 'mdi-eyedropper-variant'" size="small" />
                    </v-avatar>
                  </v-btn>
                </template>

                <v-card>
                  <v-color-picker
                    mode="hex"
                    :model-value="customAccent"
                    :modes="['hex']"
                    @update:model-value="pickAccent"
                  />
                </v-card>
              </v-menu>
            </div>

            <div class="text-label-large mb-2">{{ t('settings.background') }}</div>

            <v-item-group
              class="d-flex flex-wrap ga-2 mb-6"
              mandatory
              :model-value="preferences.background"
              @update:model-value="value => save({ background: value })"
            >
              <v-item v-for="name in backgroundNames" :key="name" v-slot="{ isSelected, toggle }" :value="name">
                <!-- A small page: a card with an accent dot and a raised control on the background. -->
                <v-card
                  :aria-pressed="isSelected"
                  :border="isSelected ? 'primary md opacity-100' : true"
                  :color="backgrounds[name][mode].background"
                  width="104"
                  @click="toggle"
                >
                  <v-sheet
                    border
                    class="d-flex align-center ga-1 ma-2 mb-1 pa-2"
                    :color="backgrounds[name][mode].surface"
                    rounded
                  >
                    <v-avatar :color="accentShade(preferences.accent, dark)" size="10" />
                    <v-sheet class="flex-grow-1" :color="backgrounds[name][mode]['surface-light']" height="6" rounded />
                  </v-sheet>

                  <div class="text-body-small text-truncate px-2 pb-2">{{ t(`settings.backgrounds.${name}`) }}</div>
                </v-card>
              </v-item>
            </v-item-group>

            <div class="text-label-large mb-2">{{ t('settings.shape') }}</div>

            <v-btn-toggle
              class="d-flex mb-6"
              mandatory
              :model-value="preferences.shape"
              @update:model-value="value => save({ shape: value })"
            >
              <v-btn class="flex-grow-1" prepend-icon="mdi-square-outline" :text="t('settings.shapes.normal')" value="normal" />
              <v-btn class="flex-grow-1" prepend-icon="mdi-square-rounded-outline" :text="t('settings.shapes.rounded')" value="rounded" />
            </v-btn-toggle>

            <v-select
              class="mb-4"
              :items="uiLanguages"
              :label="t('settings.uiLanguage')"
              :model-value="preferences.uiLanguage"
              prepend-inner-icon="mdi-earth"
              @update:model-value="(value: LocaleCode | null) => saveUiLanguage(value)"
            />

            <v-select
              :items="languages"
              :label="t('settings.valueLanguage')"
              :model-value="preferences.valueLanguage"
              prepend-inner-icon="mdi-translate"
              @update:model-value="value => save({ valueLanguage: value })"
            />

            <v-switch
              v-if="session.isDesktop"
              class="mt-4"
              :label="t('settings.showWelcome')"
              :model-value="preferences.showWelcome"
              @update:model-value="value => save({ showWelcome: Boolean(value) })"
            />
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" md="6">
        <v-card height="100%">
          <v-card-item prepend-icon="mdi-refresh-auto">
            <v-card-title>{{ t('settings.refresh') }}</v-card-title>
            <v-card-subtitle>{{ t('settings.refreshSubtitle') }}</v-card-subtitle>
          </v-card-item>

          <v-list>
            <v-list-item :subtitle="t('settings.refreshHint')" :title="t('settings.refreshOpen')">
              <template #append>
                <v-switch color="success" :model-value="preferences.autoRefresh" @update:model-value="value => save({ autoRefresh: Boolean(value) })" />
              </template>
            </v-list-item>
          </v-list>

          <v-card-text>
            <v-slider
              color="primary"
              :disabled="!preferences.autoRefresh"
              hide-details
              :label="t('settings.interval')"
              :max="60"
              :min="1"
              :model-value="preferences.refreshIntervalSeconds"
              :step="1"
              thumb-label
              @end="value => save({ refreshIntervalSeconds: Number(value) })"
            >
              <template #append>
                <v-chip :text="t('settings.seconds', { count: preferences.refreshIntervalSeconds })" />
              </template>
            </v-slider>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- Registry and discovery sync, where an infrastructure lets users choose (I5). -->
      <v-col v-if="choices.length > 0" cols="12">
        <v-card>
          <v-card-item prepend-icon="mdi-sync">
            <v-card-title>{{ t('settings.sync') }}</v-card-title>
            <v-card-subtitle class="text-wrap">{{ t('settings.syncSubtitle') }}</v-card-subtitle>
          </v-card-item>

          <v-list>
            <v-list-item v-for="target in choices" :key="target.id" :title="target.name">
              <template #append>
                <v-select
                  :items="syncItems(target.registrySync!.studioDefault)"
                  :model-value="preferences.syncOverrides[target.id] ?? null"
                  width="260"
                  @update:model-value="(value: SyncMode | null) => saveSync(target.id, value)"
                />
              </template>
            </v-list-item>
          </v-list>
        </v-card>
      </v-col>

      <v-col v-if="session.isAdmin" cols="12">
        <v-card :subtitle="t('settings.infrastructuresSubtitle')" :title="t('app.infrastructures')" @click="panel.open('infrastructures')">
          <template #prepend>
            <v-icon icon="mdi-server-network" />
          </template>

          <template #append>
            <v-icon icon="mdi-chevron-right" />
          </template>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script lang="ts" setup>
  import type { Preferences, SyncMode, Target } from '#shared/contract'
  import type { LocaleCode } from '#shared/i18n/locales'
  import { useQuery } from '@pinia/colada'
  import { useTheme } from 'vuetify'
  import { accentNames, accents, accentShade, backgroundNames, backgrounds, hexColorPattern } from '#shared/appearance'
  import { locales } from '#shared/i18n/locales'

  const { t, locale, localeCodes, setLocale } = useI18n()
  const session = useSessionStore()
  const panel = usePanel()
  const notifications = useNotificationsStore()
  const store = usePreferences()
  const preferences = computed(() => store.preferences.value)
  // Swatches in the brightness shown now.
  const theme = useTheme()
  const dark = computed(() => theme.current.value.dark)
  const mode = computed(() => dark.value ? 'dark' : 'light')

  // A custom accent is saved once the picker rests, not on every move.
  const customSelected = computed(() => hexColorPattern.test(preferences.value.accent))
  const customAccent = ref(customSelected.value ? preferences.value.accent : accents.basyx.dark)
  let accentTimer: ReturnType<typeof setTimeout> | undefined
  function pickAccent (value: string) {
    customAccent.value = value
    clearTimeout(accentTimer)
    accentTimer = setTimeout(() => {
      if (hexColorPattern.test(value)) {
        void save({ accent: value.toUpperCase() })
      }
    }, 300)
  }

  // Easter egg: typing "basyx" on this page (outside a field) reveals the
  // hidden German dialects (shared/i18n/locales.ts) until the next reload.
  const dialectsRevealed = useState('settings-dialects-revealed', () => false)
  useKeySequence([...'basyx'], () => {
    if (dialectsRevealed.value) {
      dialectsRevealed.value = false
    } else {
      dialectsRevealed.value = true
      notifications.notify({ text: t('settings.dialectsUnlocked'), color: 'success' })
    }
  })

  // A hidden locale stays listed while it is chosen, so the select can show it.
  const uiLanguages = computed(() => [
    { title: t('settings.browserLanguage'), value: null },
    ...locales
      .filter(entry => entry.available && (!entry.hidden || dialectsRevealed.value || entry.code === locale.value || entry.code === preferences.value.uiLanguage))
      .map(entry => ({ title: entry.name, value: entry.code })),
  ])
  const browserLocale = useBrowserLocale()

  async function saveUiLanguage (code: LocaleCode | null) {
    // "Browser default" switches to the locale detection would pick.
    await setLocale(localeCodes.value.find(candidate => candidate === (code ?? browserLocale)) ?? 'en')
    return save({ uiLanguage: code })
  }

  const languages = [
    { title: 'English', value: 'en' },
    { title: 'Deutsch', value: 'de' },
    { title: 'Français', value: 'fr' },
    { title: 'Español', value: 'es' },
    { title: 'Italiano', value: 'it' },
  ]

  function save (change: Partial<Preferences>) {
    return store.update(current => ({ ...current, ...change }))
  }

  const api = useStudioApi()
  const targets = useQuery({
    key: ['targets'],
    query: ({ signal }) => api<{ items: Target[] }>('/targets', { signal }),
  })
  const choices = computed(() => (targets.data.value?.items ?? []).filter(target => target.registrySync?.userOverride))

  function syncItems (studioDefault: SyncMode) {
    return [
      { title: t('settings.syncDefault', { mode: t(`settings.syncModes.${studioDefault}`) }), value: null },
      { title: t('settings.syncModes.autoCreate'), value: 'autoCreate' },
      { title: t('settings.syncModes.dontCreate'), value: 'dontCreate' },
    ]
  }

  function saveSync (targetId: string, mode: SyncMode | null) {
    return store.update(current => ({
      ...current,
      syncOverrides: Object.fromEntries([
        ...Object.entries(current.syncOverrides).filter(([id]) => id !== targetId),
        ...(mode ? [[targetId, mode]] : []),
      ]),
    }))
  }
</script>
