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
  import { roundedDefaults, themeColors } from '#shared/appearance'
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
  // favicon is the deployment's (ADR 0055), else the BaSyx logo, with
  // favicon.ico for browsers without SVG icons.
  const publicBase = useRuntimeConfig().app.baseURL
  const session = useSessionStore()
  const branding = useBranding()
  useHead(() => {
    const favicon = branding.url(session.context?.branding.favicon)
    return {
      link: [
        { rel: 'stylesheet' as const, href: `${publicBase}layers.css`, tagPriority: 'critical' as const },
        ...(favicon
          ? [{ rel: 'icon' as const, href: favicon }]
          : [
            { rel: 'icon' as const, type: 'image/svg+xml', href: `${publicBase}favicon.svg` },
            { rel: 'icon' as const, sizes: '48x48', href: `${publicBase}favicon.ico` },
          ]),
      ],
    }
  })

  // The deployment's font (ADR 0055), a woff2 file Studio serves: Vuetify's
  // text takes it from --v-font-body, with Roboto where it lacks a glyph.
  // Set from configuration, as the theme colours are, not written as a style sheet.
  useHead(() => {
    const font = branding.url(session.context?.branding.font)
    return font
      ? { style: [{ key: 'studio-brand-font', textContent: `@font-face{font-family:"Studio Brand";src:url(${JSON.stringify(font)}) format("woff2");font-display:swap}:root{--v-font-body:"Studio Brand","Roboto",sans-serif}` }] }
      : {}
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
  useHead({ title: () => branding.name.value })

  // The deployment's default accent (STUDIO_PRIMARY_COLOR*) replaces the BaSyx
  // one for users who keep the default. Applied here, before rendering, so the
  // server renders it too and hydration sees the same theme.
  function deploymentAccent (dark: boolean): string | null {
    const brand = session.context?.branding
    return (dark ? brand?.accentDark : brand?.accentLight) ?? null
  }
  // The secondary colour, the background and the shape are the deployment's
  // too (ADR 0055); applied before rendering as well, so most users, who
  // keep them, see no change after hydration.
  function deploymentSecondary (dark: boolean): string | undefined {
    const brand = session.context?.branding
    return (dark ? brand?.secondaryDark : brand?.secondaryLight) ?? undefined
  }
  const brand = computed(() => session.context?.branding)
  const initialTheme = brand.value?.theme
  const colorScheme = useCookie<string>('color-scheme')
  if ((initialTheme === 'light' || initialTheme === 'dark') && (brand.value?.locked.includes('theme') || !colorScheme.value)) {
    theme.change(initialTheme)
  }
  for (const mode of ['light', 'dark'] as const) {
    const initialBrand = brand.value
    const dark = mode === 'dark'
    const accent = deploymentAccent(dark)
    if (accent || initialBrand?.background || deploymentSecondary(dark)) {
      Object.assign(theme.themes.value[mode]!.colors, themeColors(accent ?? 'basyx', initialBrand?.background ?? 'neutral', dark, deploymentSecondary(dark)))
    }
  }
  const shapeDefaults = ref<typeof roundedDefaults | undefined>(session.context?.branding.shape === 'rounded' ? roundedDefaults : undefined)
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
      const current = brand.value
      for (const mode of ['light', 'dark'] as const) {
        const isDark = mode === 'dark'
        const accent = stored?.accent && stored.accent !== 'basyx' ? stored.accent : (deploymentAccent(isDark) ?? 'basyx')
        Object.assign(theme.themes.value[mode]!.colors, themeColors(accent, stored?.background ?? current?.background ?? 'neutral', isDark, deploymentSecondary(isDark)))
      }
      const mode = stored?.theme ?? current?.theme
      if (mode) {
        theme.change((mode === 'system' ? dark.matches : mode === 'dark') ? 'dark' : 'light')
      }
      shapeDefaults.value = (stored?.shape ?? current?.shape) === 'rounded' ? roundedDefaults : undefined
    }
    watch([preferences.query.data, brand], apply, { immediate: true })
    dark.addEventListener('change', apply)
    onUnmounted(() => dark.removeEventListener('change', apply))
  })
</script>
