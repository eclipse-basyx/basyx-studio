import type { ElectronOptions } from 'nuxt-electron'
import { locales } from './shared/i18n/locales'

// nuxt-electron does not augment the Nuxt config type itself.
declare module '@nuxt/schema' {
  interface NuxtConfig {
    electron?: ElectronOptions
  }
}

const electronOptions: ElectronOptions = {
  disableDefaultOptions: true,
  build: [
    {
      // Main-Process entry file of the Electron App.
      entry: 'electron/main.ts',
    },
    {
      // Sandboxed preloads must be CommonJS (dist-electron/preload.cjs).
      entry: 'electron/preload.ts',
      onstart: ({ reload }) => reload(),
      vite: {
        build: {
          lib: { entry: 'electron/preload.ts', formats: ['cjs'], fileName: () => 'preload.cjs' },
        },
      },
    },
  ],
}

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-12-21',
  devtools: { enabled: true },

  modules: [
    '@nuxt/fonts',
    'vuetify-nuxt-module',
    '@nuxt/eslint',
    '@pinia/nuxt',
    '@nuxtjs/i18n',
    '@pinia/colada-nuxt',
  ],

  $env: {
    electron: {
      ssr: false,
      modules: ['nuxt-electron'],
      electron: electronOptions,
      // The Studio Service's public URL and the RFC 8252 loopback redirect use
      // 127.0.0.1; `localhost` may bind only [::1], and the IdP's redirect
      // would then miss the dev server.
      devServer: { host: '127.0.0.1' },
      runtimeConfig: {
        studio: {
          deploymentMode: 'desktop',
        },
      },
    },
  },

  app: {
    head: {
      title: 'BaSyx Studio',
      link: [
        { rel: 'stylesheet', href: '/layers.css' },
      ],
    },
  },

  runtimeConfig: {
    studio: {
      // Overridable at runtime with NUXT_STUDIO_DEPLOYMENT_MODE.
      deploymentMode: 'hosted',
      // Path of the bundled Workspace Worker; set for `nuxt dev` by
      // modules/workspace-worker.ts, next to the server entry otherwise.
      workspaceWorker: '',
    },
  },

  routeRules: {
    // Only Studio may frame Studio pages; app frames run on other origins
    // (ADR 0017). App files set their own policy.
    '/**': { headers: { 'Content-Security-Policy': 'frame-ancestors \'self\'' } },
  },

  nitro: {
    // The ESM build of aas-core3.1-typescript uses extensionless relative
    // imports that plain Node ESM cannot load, so it must be bundled.
    externals: {
      inline: ['@aas-core-works/aas-core3.1-typescript'],
    },
    serverAssets: [
      { baseName: 'migrations', dir: './database/migrations' },
      // Apps shipped with Studio (ADR 0023), packaged by `pnpm apps:bundle`.
      { baseName: 'bundled-apps', dir: './bundled-apps' },
    ],
  },

  vuetify: {
    moduleOptions: {
      prefixComposables: ['useLayout'],
      styles: { configFile: 'assets/styles/settings.scss' },

      ssrClientHints: {
        reloadOnFirstRequest: false,
        viewportSize: true,
        prefersColorScheme: true,
        prefersReducedMotion: true,

        prefersColorSchemeOptions: {
          useBrowserThemeOnly: false,
        },
      },
    },
    // Theme, aliases and component defaults live in vuetify.config.ts.
  },

  eslint: {
    config: {
      import: {
        package: 'eslint-plugin-import-lite',
      },
    },
  },

  // UI locales (ADR 0026): lazy-loaded Studio and Vuetify messages per
  // locale. The server renders in the locale from the i18n_redirected cookie
  // or Accept-Language, so the client hydrates in the same one.
  i18n: {
    defaultLocale: 'en',
    strategy: 'no_prefix',
    locales: locales.filter(locale => locale.available).map(({ code, language, name, base, hidden }) => ({
      code,
      // Detection falls back to the primary subtag (`de`), so a hidden dialect
      // gets a private-use tag no browser sends; `<html lang>` and Intl use
      // its real tag (app.vue, i18n.config.ts).
      language: hidden ? `x-${code}` : language,
      name,
      // A dialect loads its base locale first and overrides some of its messages.
      files: [...(base ? [`${base}.json`] : []), `${code}.json`, `vuetify/${base ?? code}.ts`],
    })),
    detectBrowserLanguage: { useCookie: true, cookieKey: 'i18n_redirected', fallbackLocale: 'en' },
    vueI18n: './i18n.config.ts',
  },
})
