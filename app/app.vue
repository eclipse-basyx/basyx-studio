<template>
  <!-- The shape of Settings: the rounded defaults over vuetify.config.ts. -->
  <v-defaults-provider :defaults="shapeDefaults">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>

    <ClientOnly>
      <WelcomeScreen />
    </ClientOnly>
  </v-defaults-provider>
</template>

<script lang="ts" setup>
  import { useTheme } from 'vuetify'
  import { roundedDefaults, themeColors } from '#shared/appearance'
  import { locales } from '#shared/i18n/locales'

  // `<html lang>` from the locale's BCP 47 tag, so screen readers and the
  // font fallback (Chinese or Japanese Han glyphs) use the UI language. Read
  // from shared/i18n/locales.ts: the module's tag for hidden dialects is only
  // for detection (nuxt.config.ts).
  const { locale, localeCodes, setLocale } = useI18n()
  useHead(() => ({ htmlAttrs: { lang: locales.find(entry => entry.code === locale.value)?.language ?? 'en-US', dir: 'ltr' } }))

  // The user's appearance (Settings): light, dark or "system", which follows
  // the OS, and an accent and a background laid over both the light and the
  // dark theme. Like the shape, it is applied only after hydration: a theme
  // change while the page hydrates leaves server-rendered parts in the
  // server's theme, because Vue keeps mismatching attributes. Vuetify's
  // color-scheme cookie then lets the next server render start in the same
  // light or dark theme.
  const theme = useTheme()
  const preferences = usePreferences()
  const shapeDefaults = ref<typeof roundedDefaults | undefined>(undefined)
  onMounted(() => {
    // The stored UI language (Settings), applied after hydration like the
    // theme; setLocale() also rewrites the i18n_redirected cookie, so the
    // next server render starts in it (ADR 0026).
    watch(() => preferences.query.data.value?.uiLanguage, code => {
      const known = localeCodes.value.find(candidate => candidate === code)
      if (known && known !== locale.value) {
        void setLocale(known)
      }
    }, { immediate: true })

    const dark = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const stored = preferences.query.data.value
      if (stored) {
        for (const mode of ['light', 'dark'] as const) {
          Object.assign(theme.themes.value[mode]!.colors, themeColors(stored.accent, stored.background, mode === 'dark'))
        }
        theme.change((stored.theme === 'system' ? dark.matches : stored.theme === 'dark') ? 'dark' : 'light')
      }
    }
    watch(() => [preferences.query.data.value?.theme, preferences.query.data.value?.accent, preferences.query.data.value?.background], apply, { immediate: true })
    dark.addEventListener('change', apply)

    watch(() => preferences.query.data.value?.shape, shape => {
      shapeDefaults.value = shape === 'rounded' ? roundedDefaults : undefined
    }, { immediate: true })
  })
</script>
