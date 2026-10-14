<template>
  <v-container max-width="960">
    <PageHeader :subtitle="t('settings.subtitle')" :title="t('settings.title')" />

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
        <v-card :subtitle="t('settings.infrastructuresSubtitle')" :title="t('app.infrastructures')" to="/admin/infrastructures">
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
  import { locales } from '#shared/i18n/locales'

  const { t, locale, localeCodes, setLocale } = useI18n()
  const session = useSessionStore()
  const notifications = useNotificationsStore()
  const store = usePreferences()
  const preferences = computed(() => store.preferences.value)

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
