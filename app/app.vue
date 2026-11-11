<template>
  <!-- The shape of Settings (the rounded defaults over vuetify.config.ts),
       and full-screen dialogs on phones. -->
  <v-defaults-provider :defaults="defaults">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>

    <ClientOnly>
      <WelcomeScreen v-if="!route.meta.previewWindow" />
    </ClientOnly>
  </v-defaults-provider>
</template>

<script lang="ts" setup>
  import { provideFileViewer } from '@basyx/file-viewer/vue'
  import { useDisplay, useTheme } from 'vuetify'
  import { accentShade, roundedDefaults, themeColors, withOnColors } from '#shared/appearance'
  import { locales } from '#shared/i18n/locales'

  // `<html lang>` from the locale's BCP 47 tag, so screen readers and the
  // font fallback (Chinese or Japanese Han glyphs) use the UI language. Read
  // from shared/i18n/locales.ts: the module's tag for hidden dialects is only
  // for detection (nuxt.config.ts).
  const { locale, localeCodes, setLocale } = useI18n()
  const route = useRoute()
  // The file viewer (ADR 0052) in the UI locale, with Studio's Monaco.
  provideFileViewer({ locale: () => locale.value, monaco: async () => (await import('~/utils/monaco')).monaco })
  useHead(() => ({ htmlAttrs: { lang: locales.find(entry => entry.code === locale.value)?.language ?? 'en-US', dir: 'ltr' } }))

  // Public files under the deployment's base path. The layer order must come
  // before every other stylesheet, so Vuetify's layers stack as declared. The
  // BaSyx logo is the favicon; favicon.ico for browsers without SVG icons.
  const publicBase = useRuntimeConfig().app.baseURL
  useHead({
    link: [
      { rel: 'stylesheet', href: `${publicBase}layers.css`, tagPriority: 'critical' },
      { rel: 'icon', type: 'image/svg+xml', href: `${publicBase}favicon.svg` },
      { rel: 'icon', sizes: '48x48', href: `${publicBase}favicon.ico` },
    ],
  })

  // The user's appearance (Settings): light, dark or "system", which follows
  // the OS, and an accent and a background laid over both the light and the
  // dark theme. Like the shape, it is applied only after hydration: a theme
  // change while the page hydrates leaves server-rendered parts in the
  // server's theme, because Vue keeps mismatching attributes. Vuetify's
  // color-scheme cookie then lets the next server render start in the same
  // light or dark theme.
  const theme = useTheme()
  const preferences = usePreferences()
  const session = useSessionStore()
  const branding = useBranding()
  useHead({ title: () => branding.name.value })

  // The deployment's default accent (STUDIO_PRIMARY_COLOR*) replaces the BaSyx
  // one for users who keep the default. Applied here, before rendering, so the
  // server renders it too and hydration sees the same theme.
  function deploymentAccent (dark: boolean): string | null {
    const brand = session.context?.branding
    return (dark ? brand?.accentDark : brand?.accentLight) ?? null
  }
  for (const mode of ['light', 'dark'] as const) {
    const accent = deploymentAccent(mode === 'dark')
    if (accent) {
      Object.assign(theme.themes.value[mode]!.colors, withOnColors({ primary: accentShade(accent, mode === 'dark') }))
    }
  }
  const shapeDefaults = ref<typeof roundedDefaults | undefined>(undefined)
  // On phones every dialog fills the screen; DialogCard then drops its radius and border.
  const { xs } = useDisplay()
  const defaults = computed(() => ({ ...shapeDefaults.value, ...(xs.value ? { VDialog: { fullscreen: true } } : {}) }))
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
          const accent = stored.accent === 'basyx' ? (deploymentAccent(mode === 'dark') ?? stored.accent) : stored.accent
          Object.assign(theme.themes.value[mode]!.colors, themeColors(accent, stored.background, mode === 'dark'))
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
