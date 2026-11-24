<template>
  <v-container max-width="1100">
    <PageHeader :subtitle="t('branding.subtitle')" :title="t('branding.title')">
      <template #actions>
        <v-btn
          download
          :href="studioUrl.api('/branding/export')"
          prepend-icon="mdi-file-export-outline"
          :text="t('branding.export')"
        />

        <v-btn
          v-if="editable"
          :loading="busy === 'import'"
          prepend-icon="mdi-file-import-outline"
          :text="t('branding.import')"
          @click="importInput?.click()"
        />

        <input
          ref="importInput"
          accept=".zip,application/zip"
          :aria-label="t('branding.import')"
          hidden
          type="file"
          @change="importArchive"
        >

        <v-btn
          v-tooltip="t('branding.close')"
          :aria-label="t('branding.close')"
          icon="mdi-close"
          @click="panel.close()"
        />
      </template>
    </PageHeader>

    <ProblemAlert v-if="view.error.value" :error="view.error.value" retry @retry="view.refetch()" />

    <v-card v-else-if="!data">
      <v-skeleton-loader type="article@2" />
    </v-card>

    <template v-else>
      <v-alert
        v-if="!data.editable"
        class="mb-4"
        icon="mdi-lock-outline"
        :text="t('branding.notEditable')"
        type="info"
      />

      <v-alert
        v-for="note in data.notes"
        :key="note"
        class="mb-4"
        :text="note"
        type="warning"
      />

      <ProblemAlert v-if="error" class="mb-4" :error="error" />

      <v-row>
        <!-- How Studio looks with the settings below, before saving. -->
        <v-col cols="12">
          <v-card>
            <v-card-item prepend-icon="mdi-eye-outline">
              <v-card-title>{{ t('branding.preview') }}</v-card-title>
            </v-card-item>

            <v-card-text>
              <v-row>
                <v-col v-for="mode in previews" :key="mode.name" cols="12" md="6">
                  <v-sheet
                    border
                    class="pa-4"
                    :color="mode.colors.background"
                    rounded="lg"
                    :theme="mode.name"
                  >
                    <v-sheet
                      border
                      class="d-flex align-center ga-3 pa-3 mb-3"
                      :color="mode.colors.surface"
                      rounded
                    >
                      <v-img
                        :alt="previewName"
                        class="flex-grow-0"
                        height="32"
                        :src="mode.logo"
                        width="120"
                      />

                      <span class="text-title-medium font-weight-bold text-truncate">{{ previewName }}</span>
                    </v-sheet>

                    <div class="d-flex flex-wrap align-center ga-2">
                      <v-btn-primary
                        :color="mode.colors.primary"
                        :rounded="previewShape === 'rounded' ? 'pill' : 'lg'"
                        tabindex="-1"
                        :text="t('branding.previewButton')"
                      />

                      <v-chip :color="mode.colors.secondary" :label="previewShape !== 'rounded'" :text="t('branding.previewChip')" />
                      <span :class="`text-${mode.name === 'dark' ? 'white' : 'black'} text-body-small`">{{ t(`settings.${mode.name}`) }}</span>
                    </div>
                  </v-sheet>
                </v-col>
              </v-row>
            </v-card-text>
          </v-card>
        </v-col>

        <!-- Name and the organisation's links. -->
        <v-col cols="12" md="6">
          <v-card height="100%">
            <v-card-item prepend-icon="mdi-card-account-details-outline">
              <v-card-title>{{ t('branding.identity') }}</v-card-title>
            </v-card-item>

            <v-card-text class="d-flex flex-column ga-4">
              <v-text-field
                v-for="field in textFields"
                :key="field.key"
                :disabled="!canEdit(field.key)"
                :label="t(`branding.fields.${field.key}`)"
                :messages="fixedMessage(field.key)"
                :model-value="String(shownValue(field.key) ?? '')"
                :placeholder="field.placeholder"
                :prepend-inner-icon="field.icon"
                :rules="field.rules"
                @update:model-value="value => setText(field.key, value)"
              />
            </v-card-text>
          </v-card>
        </v-col>

        <!-- Logos, favicon and font. -->
        <v-col cols="12" md="6">
          <v-card height="100%">
            <v-card-item prepend-icon="mdi-image-multiple-outline">
              <v-card-title>{{ t('branding.files') }}</v-card-title>
              <v-card-subtitle class="text-wrap">{{ t('branding.filesSubtitle') }}</v-card-subtitle>
            </v-card-item>

            <v-list>
              <v-list-item
                v-for="slot in brandingAssetSlots"
                :key="slot"
                :subtitle="assetSubtitle(slot)"
                :title="t(`branding.assets.${slot}`)"
              >
                <template #prepend>
                  <v-avatar
                    border
                    :color="slot === 'logo-dark' ? '#1E1E1E' : '#FFFFFF'"
                    rounded
                    size="40"
                  >
                    <v-img
                      v-if="slot !== 'font' && data.assets[slot].url"
                      alt=""
                      :cover="false"
                      height="32"
                      :src="branding.url(data.assets[slot].url)!"
                      width="32"
                    />

                    <v-icon v-else :color="slot === 'logo-dark' ? 'white' : 'black'" :icon="slot === 'font' ? 'mdi-format-font' : 'mdi-image-off-outline'" />
                  </v-avatar>
                </template>

                <template #append>
                  <template v-if="canEdit(`asset.${slot}`)">
                    <v-btn
                      v-tooltip="t('branding.upload')"
                      :aria-label="`${t('branding.upload')}: ${t(`branding.assets.${slot}`)}`"
                      icon="mdi-upload-outline"
                      :loading="busy === slot"
                      @click="pick(slot)"
                    />

                    <v-btn
                      v-if="data.assets[slot].source === 'admin'"
                      v-tooltip="t('branding.remove')"
                      :aria-label="`${t('branding.remove')}: ${t(`branding.assets.${slot}`)}`"
                      icon="mdi-delete-outline"
                      @click="removeAsset(slot)"
                    />
                  </template>
                </template>
              </v-list-item>
            </v-list>

            <input
              ref="assetInput"
              :accept="pickedSlot ? Object.keys(brandingAssetTypes[pickedSlot]).join(',') : undefined"
              :aria-label="t('branding.upload')"
              hidden
              type="file"
              @change="uploadAsset"
            >
          </v-card>
        </v-col>

        <!-- Colours, the users' defaults and which of them are locked. -->
        <v-col cols="12" md="6">
          <v-card height="100%">
            <v-card-item prepend-icon="mdi-palette-outline">
              <v-card-title>{{ t('branding.colours') }}</v-card-title>
              <v-card-subtitle class="text-wrap">{{ t('branding.coloursSubtitle') }}</v-card-subtitle>
            </v-card-item>

            <v-card-text>
              <v-row density="compact">
                <template v-for="name in (['accent', 'secondary'] as const)" :key="name">
                  <v-col v-for="mode in (['light', 'dark'] as const)" :key="mode" cols="6">
                    <v-text-field
                      active
                      :disabled="!canEdit(name)"
                      :label="t(`branding.color.${name}.${mode}`)"
                      :messages="fixedMessage(name)"
                      :model-value="colorText[name][mode]"
                      placeholder="#RRGGBB"
                      :rules="[colorRule]"
                      @update:model-value="value => setColor(name, mode, value)"
                    >
                      <template #prepend-inner>
                        <v-avatar border :color="validColor(colorText[name][mode]) ?? undefined" size="20" />
                      </template>
                    </v-text-field>
                  </v-col>
                </template>
              </v-row>

              <!-- The accent's default is these colours; locked, users keep them. -->
              <v-checkbox
                :disabled="!editable || data.fixedLocks.includes('accent')"
                false-icon="mdi-lock-open-variant-outline"
                :label="t('branding.lockAccent')"
                :model-value="isLocked('accent')"
                true-icon="mdi-lock"
                @update:model-value="value => setLock('accent', Boolean(value))"
              />
            </v-card-text>
          </v-card>
        </v-col>

        <v-col cols="12" md="6">
          <v-card height="100%">
            <v-card-item prepend-icon="mdi-tune-variant">
              <v-card-title>{{ t('branding.defaults') }}</v-card-title>
              <v-card-subtitle class="text-wrap">{{ t('branding.defaultsSubtitle') }}</v-card-subtitle>
            </v-card-item>

            <v-card-text class="d-flex flex-column ga-4">
              <div v-for="field in defaultFields" :key="field.key" class="d-flex align-center ga-2">
                <v-select
                  class="flex-grow-1"
                  :disabled="!canEdit(field.key)"
                  :items="field.items"
                  :label="t(`branding.fields.${field.key}`)"
                  :messages="fixedMessage(field.key)"
                  :model-value="shownValue(field.key) ?? null"
                  @update:model-value="value => set(field.key, value ?? undefined)"
                />

                <v-checkbox
                  v-if="field.lock"
                  :aria-label="t('branding.lock', { setting: t(`branding.fields.${field.key}`) })"
                  class="flex-grow-0"
                  :disabled="!editable || data.fixedLocks.includes(field.lock)"
                  false-icon="mdi-lock-open-variant-outline"
                  :model-value="isLocked(field.lock)"
                  true-icon="mdi-lock"
                  @update:model-value="value => setLock(field.lock!, Boolean(value))"
                />
              </div>

              <v-select
                chips
                closable-chips
                :disabled="!canEdit('languages')"
                :items="uiLanguageItems"
                :label="t('branding.fields.languages')"
                :messages="fixedMessage('languages') ?? t('branding.languagesHint')"
                :model-value="shownValue('languages') ?? []"
                multiple
                @update:model-value="(value: LocaleCode[]) => set('languages', value.length > 0 ? value : undefined)"
              />
            </v-card-text>
          </v-card>
        </v-col>

        <!-- Texts per language: the sign-in message and the legal pages. -->
        <v-col cols="12">
          <v-card>
            <v-card-item prepend-icon="mdi-text-box-outline">
              <v-card-title>{{ t('branding.texts') }}</v-card-title>
              <v-card-subtitle class="text-wrap">{{ t('branding.textsSubtitle') }}</v-card-subtitle>
            </v-card-item>

            <v-tabs v-model="language" class="px-4" show-arrows>
              <v-tab v-for="entry in textLanguages" :key="entry.code" :text="entry.name" :value="entry.code" />
            </v-tabs>

            <v-divider />

            <v-card-text class="d-flex flex-column ga-4">
              <v-textarea
                auto-grow
                :disabled="!canEdit('signInMessage')"
                :label="t('branding.fields.signInMessage')"
                :messages="fixedMessage('signInMessage')"
                :model-value="shownValue('signInMessage')?.[language] ?? ''"
                rows="2"
                @update:model-value="value => setSignInMessage(value)"
              />

              <div v-for="page in legalPages" :key="page">
                <SettingLabel :text="t(`legal.pages.${page}`)" />

                <v-btn-toggle
                  class="mb-3"
                  :disabled="!canEdit(`legal.${page}`)"
                  mandatory
                  :model-value="legalKind(page)"
                  @update:model-value="(value: 'none' | 'url' | 'markdown') => setLegalKind(page, value)"
                >
                  <v-btn :text="t('branding.legal.none')" value="none" />
                  <v-btn prepend-icon="mdi-link-variant" :text="t('branding.legal.url')" value="url" />
                  <v-btn prepend-icon="mdi-language-markdown-outline" :text="t('branding.legal.markdown')" value="markdown" />
                </v-btn-toggle>

                <v-text-field
                  v-if="legalKind(page) === 'url'"
                  :disabled="!canEdit(`legal.${page}`)"
                  :label="t('branding.legal.urlLabel')"
                  :messages="fixedMessage(`legal.${page}`)"
                  :model-value="legalEntry(page)?.url ?? ''"
                  :placeholder="urlPlaceholder"
                  prepend-inner-icon="mdi-link-variant"
                  :rules="[urlRule]"
                  @update:model-value="(value: string) => setLegalEntry(page, { url: value.trim() })"
                />

                <v-textarea
                  v-if="legalKind(page) === 'markdown'"
                  auto-grow
                  :disabled="!canEdit(`legal.${page}`)"
                  :label="t('branding.legal.markdownLabel')"
                  :messages="fixedMessage(`legal.${page}`) ?? t('branding.legal.markdownHint')"
                  :model-value="legalEntry(page)?.markdown ?? ''"
                  rows="6"
                  @update:model-value="(value: string) => setLegalEntry(page, { markdown: value })"
                />
              </div>

              <v-alert density="compact" :text="t('branding.legal.notice')" type="info" />
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <FormActions
        v-if="editable"
        :apply-text="t('branding.save')"
        :blocked="!valid"
        :busy="busy === 'save'"
        :dirty="dirty"
        :message="dirty ? null : updatedText"
        @apply="save"
        @discard="discard"
      />
    </template>
  </v-container>
</template>

<script lang="ts" setup>
  import type { BrandingAdminView, BrandingAssetSlot, BrandingField, BrandingSettings, LegalEntry, LegalPage, LockableSetting } from '#shared/branding'
  import type { LocaleCode } from '#shared/i18n/locales'
  import { useQuery, useQueryCache } from '@pinia/colada'
  import { backgroundNames, hexColorPattern, shapes, themeColors } from '#shared/appearance'
  import { brandingAssetSlots, brandingAssetTypes, legalPages } from '#shared/branding'
  import { locales } from '#shared/i18n/locales'
  import basyxLogo from '~/assets/basyx-logo.svg'

  // The corporate design administrators set (ADR 0055). Values the
  // deployment sets (environment, branding file) show read-only with their
  // source; everything else is saved at once for all users. Files upload on
  // their own; Export packs the branding in effect as a branding file.
  const { t, locale } = useI18n()
  const panel = usePanel()
  const api = useStudioApi()
  const studioUrl = useStudioUrl()
  const session = useSessionStore()
  const branding = useBranding()
  const notifications = useNotificationsStore()
  const queryCache = useQueryCache()

  const key = ['branding']
  const view = useQuery({ key, query: ({ signal }) => api<BrandingAdminView>('/branding', { signal }) })
  const data = computed(() => view.data.value ?? null)
  const editable = computed(() => data.value?.editable ?? false)

  // The administrators' settings being edited.
  const draft = ref<BrandingSettings>({})
  watch(() => data.value?.admin, admin => {
    if (admin) {
      draft.value = structuredClone(toRaw(admin))
    }
  }, { immediate: true })

  /** The object without a key. */
  function without<T extends object, K extends keyof T> (value: T, key: K): Omit<T, K> {
    return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key)) as Omit<T, K>
  }

  /** JSON with sorted keys, so equal settings compare equal whatever their order. */
  function stable (value: unknown): string {
    return JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).toSorted(([a], [b]) => a.localeCompare(b)))
      : item)
  }
  const dirty = computed(() => stable(draft.value) !== stable(data.value?.admin ?? {}))

  type SettingKey = Exclude<keyof BrandingSettings, 'legal'>

  /** Whether the deployment sets a value, so administrators cannot change it. */
  function fixed (field: BrandingField): boolean {
    const source = data.value?.sources[field]
    return source === 'env' || source === 'file'
  }
  function canEdit (field: BrandingField): boolean {
    return editable.value && !fixed(field)
  }
  function fixedMessage (field: BrandingField): string | undefined {
    return fixed(field) ? t('branding.fixed', { source: t(`branding.sources.${data.value!.sources[field]}`) }) : undefined
  }
  /** The value shown: the deployment's where it sets one, else the draft's. */
  function shownValue<K extends SettingKey> (field: K): BrandingSettings[K] {
    return fixed(field) ? data.value!.effective[field] : draft.value[field]
  }
  function set<K extends SettingKey> (field: K, value: BrandingSettings[K] | undefined) {
    draft.value = [undefined, null, ''].includes(value as never) ? without(draft.value, field) : { ...draft.value, [field]: value }
  }
  function setText (field: SettingKey, value: string) {
    set(field, (value.trim() || undefined) as never)
  }

  const urlPlaceholder = 'https://'
  const urlRule = (value: string) => !value || /^https?:\/\/\S+$/.test(value) || t('branding.invalidUrl')
  const linkRule = (value: string) => !value || /^(?:https?:\/\/\S+|mailto:\S[^\s@]*@\S+)$/.test(value) || t('branding.invalidUrl')
  const textFields = [
    { key: 'productName', icon: 'mdi-format-title', placeholder: 'BaSyx Studio', rules: [] },
    { key: 'organisation', icon: 'mdi-domain', placeholder: undefined, rules: [] },
    { key: 'supportUrl', icon: 'mdi-lifebuoy', placeholder: 'https:// or mailto:', rules: [linkRule] },
    { key: 'helpUrl', icon: 'mdi-help-circle-outline', placeholder: 'https://', rules: [urlRule] },
  ] as const

  // Colours as typed, so a half-typed value stays in its field.
  const colorText = reactive({ accent: { light: '', dark: '' }, secondary: { light: '', dark: '' } })
  watch(() => [data.value, draft.value.accent, draft.value.secondary] as const, () => {
    for (const name of ['accent', 'secondary'] as const) {
      const color = shownValue(name)
      for (const mode of ['light', 'dark'] as const) {
        if (validColor(colorText[name][mode]) !== (color?.[mode] ?? null)) {
          colorText[name][mode] = color?.[mode] ?? ''
        }
      }
    }
  }, { immediate: true, deep: true })
  function validColor (value: string): string | null {
    return hexColorPattern.test(value) ? value.toUpperCase() : null
  }
  const colorRule = (value: string) => !value || hexColorPattern.test(value) || t('branding.invalidColor')
  function setColor (name: 'accent' | 'secondary', mode: 'light' | 'dark', value: string) {
    colorText[name][mode] = value
    const light = validColor(colorText[name].light)
    const dark = validColor(colorText[name].dark)
    // One colour serves both themes until the other is given.
    set(name, light || dark ? { light: light ?? dark!, dark: dark ?? light! } : undefined)
  }
  const valid = computed(() => (['accent', 'secondary'] as const).every(name => (['light', 'dark'] as const).every(mode => !colorText[name][mode] || hexColorPattern.test(colorText[name][mode]))))

  const uiLanguageItems = locales.filter(entry => entry.available && !entry.hidden).map(entry => ({ title: entry.name, value: entry.code }))
  const studioDefault = computed(() => ({ title: t('branding.studioDefault'), value: null }))
  const defaultFields = computed(() => [
    { key: 'theme' as const, lock: 'theme' as const, items: [studioDefault.value, ...(['system', 'light', 'dark'] as const).map(value => ({ title: t(`settings.${value}`), value }))] },
    { key: 'background' as const, lock: 'background' as const, items: [studioDefault.value, ...backgroundNames.map(value => ({ title: t(`settings.backgrounds.${value}`), value }))] },
    { key: 'shape' as const, lock: 'shape' as const, items: [studioDefault.value, ...shapes.map(value => ({ title: t(`settings.shapes.${value}`), value }))] },
    { key: 'uiLanguage' as const, lock: 'uiLanguage' as const, items: [{ title: t('settings.browserLanguage'), value: null }, ...uiLanguageItems] },
    { key: 'valueLanguage' as const, lock: 'valueLanguage' as const, items: [studioDefault.value, ...['en', 'de', 'fr', 'es', 'it'].map(value => ({ title: value, value }))] },
  ])
  function isLocked (setting: LockableSetting): boolean {
    return Boolean(data.value?.fixedLocks.includes(setting) || draft.value.locked?.includes(setting))
  }
  function setLock (setting: LockableSetting, on: boolean) {
    const next = new Set(draft.value.locked)
    if (on) {
      next.add(setting)
    } else {
      next.delete(setting)
    }
    set('locked', next.size > 0 ? [...next] : undefined)
  }

  // Texts per language, in the UI languages; the current one first.
  const textLanguages = computed(() => locales.filter(entry => entry.available && !entry.hidden))
  const language = ref<string>(textLanguages.value.find(entry => entry.code === locale.value)?.code ?? 'en')

  function setSignInMessage (value: string) {
    const messages = value.trim() ? { ...draft.value.signInMessage, [language.value]: value } : without(draft.value.signInMessage ?? {}, language.value)
    set('signInMessage', Object.keys(messages).length > 0 ? messages : undefined)
  }

  function legalSource (page: LegalPage) {
    return fixed(`legal.${page}`) ? data.value!.effective.legal?.[page] : draft.value.legal?.[page]
  }
  function legalEntry (page: LegalPage): Partial<{ url: string, markdown: string }> | null {
    return (legalSource(page)?.[language.value] as Partial<{ url: string, markdown: string }> | undefined) ?? null
  }
  function legalKind (page: LegalPage): 'none' | 'url' | 'markdown' {
    const entry = legalEntry(page)
    return entry ? ('url' in entry ? 'url' : 'markdown') : 'none'
  }
  function setLegalEntry (page: LegalPage, entry: LegalEntry | null) {
    const source = entry ? { ...draft.value.legal?.[page], [language.value]: entry } : without(draft.value.legal?.[page] ?? {}, language.value)
    const legal = Object.keys(source).length > 0 ? { ...draft.value.legal, [page]: source } : without(draft.value.legal ?? {}, page)
    draft.value = Object.keys(legal).length > 0 ? { ...draft.value, legal } : without(draft.value, 'legal')
  }
  function setLegalKind (page: LegalPage, kind: 'none' | 'url' | 'markdown') {
    setLegalEntry(page, kind === 'none' ? null : (kind === 'url' ? { url: '' } : { markdown: '' }))
  }

  // The preview: the draft where administrators may change it, else what is in effect.
  const previewName = computed(() => shownValue('productName') ?? t('app.name'))
  const previewShape = computed(() => shownValue('shape') ?? 'normal')
  const previews = computed(() => (['light', 'dark'] as const).map(name => {
    const dark = name === 'dark'
    const logo = data.value?.assets[dark ? 'logo-dark' : 'logo-light'].url
    return {
      name,
      logo: branding.url(logo) ?? basyxLogo,
      colors: themeColors(shownValue('accent')?.[name] ?? 'basyx', shownValue('background') ?? 'neutral', dark, shownValue('secondary')?.[name]),
    }
  }))

  function assetSubtitle (slot: BrandingAssetSlot): string {
    const asset = data.value!.assets[slot]
    if (asset.source === 'default') {
      return t('branding.assetDefault')
    }
    const size = asset.size === null ? '' : ` · ${Math.ceil(asset.size / 1024)} KB`
    return `${t(`branding.sources.${asset.source}`)}${size}`
  }

  const updatedText = computed(() => data.value?.updatedAt
    ? t('branding.updated', { date: new Date(data.value.updatedAt).toLocaleString(locale.value), name: data.value.updatedBy ?? '' })
    : null)

  // Saving, uploads and imports: each answers with the new view.
  const busy = ref<'save' | 'import' | BrandingAssetSlot | null>(null)
  const error = ref<unknown>(null)
  async function run (what: NonNullable<typeof busy.value>, request: () => Promise<BrandingAdminView>, message: string) {
    busy.value = what
    error.value = null
    try {
      queryCache.setQueryData(key, await request())
      await session.reloadContext()
      // Defaults and locks change what users' preferences are in effect.
      await queryCache.invalidateQueries({ key: ['me', 'preferences'] })
      notifications.notify({ text: message, color: 'success' })
    } catch (error_) {
      error.value = error_
    } finally {
      busy.value = null
    }
  }

  function save () {
    return run('save', () => api<BrandingAdminView>('/branding', { method: 'PUT', body: toRaw(draft.value) }), t('branding.saved'))
  }
  function discard () {
    draft.value = structuredClone(toRaw(data.value?.admin ?? {}))
  }

  const assetInput = ref<HTMLInputElement | null>(null)
  const pickedSlot = ref<BrandingAssetSlot | null>(null)
  function pick (slot: BrandingAssetSlot) {
    pickedSlot.value = slot
    void nextTick(() => assetInput.value?.click())
  }
  /** The file's type; from its extension where the browser gives none (fonts, icons). */
  function typeOf (slot: BrandingAssetSlot, file: File): string {
    const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
    return brandingAssetTypes[slot][extension] ?? file.type
  }
  async function uploadAsset (event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    const slot = pickedSlot.value
    input.value = ''
    if (file && slot) {
      await run(slot, () => api<BrandingAdminView>(`/branding/assets/${slot}`, { method: 'PUT', body: file, headers: { 'Content-Type': typeOf(slot, file) } }), t('branding.uploaded'))
    }
  }
  function removeAsset (slot: BrandingAssetSlot) {
    return run(slot, () => api<BrandingAdminView>(`/branding/assets/${slot}`, { method: 'DELETE' }), t('branding.removed'))
  }

  const importInput = ref<HTMLInputElement | null>(null)
  async function importArchive (event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (file) {
      await run('import', () => api<BrandingAdminView>('/branding/import', { method: 'POST', body: file, headers: { 'Content-Type': 'application/zip' } }), t('branding.imported'))
    }
  }
</script>
