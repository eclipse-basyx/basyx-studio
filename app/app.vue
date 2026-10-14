<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>

<script lang="ts" setup>
  import { useTheme } from 'vuetify'
  import { locales } from '#shared/i18n/locales'

  // `<html lang>` from the locale's BCP 47 tag, so screen readers and the
  // font fallback (Chinese or Japanese Han glyphs) use the UI language. Read
  // from shared/i18n/locales.ts: the module's tag for hidden dialects is only
  // for detection (nuxt.config.ts).
  const { locale, localeCodes, setLocale } = useI18n()
  useHead(() => ({ htmlAttrs: { lang: locales.find(entry => entry.code === locale.value)?.language ?? 'en-US', dir: 'ltr' } }))

  // The user's theme preference (Settings); "system" follows the OS. It is
  // applied only after hydration: a theme change while the page hydrates
  // leaves server-rendered parts in the server's theme, because Vue keeps
  // mismatching attributes. Vuetify's color-scheme cookie then lets the next
  // server render start in the same theme.
  const theme = useTheme()
  const preferences = usePreferences()
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
      const value = preferences.query.data.value?.theme
      if (value) {
        theme.change(value === 'system' ? (dark.matches ? 'dark' : 'light') : value)
      }
    }
    watch(() => preferences.query.data.value?.theme, apply, { immediate: true })
    dark.addEventListener('change', apply)
  })
</script>
