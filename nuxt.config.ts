import type { ElectronOptions } from 'nuxt-electron'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { locales } from './shared/i18n/locales'

// Shown in Settings; container builds pass the snapshot or release version
// and the commit as build arguments (Dockerfile).
const packageVersion = (JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8')) as { version: string }).version

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

  // All application fonts are shipped by Studio or its dependencies. Keeping
  // resolution local makes production and desktop builds network-independent.
  fonts: {
    provider: 'local',
  },

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

  // Theme of the Overview's grid library (ADR 0032).
  css: ['~/assets/styles/grid-layout.css'],

  app: {
    // The CSS layer order (public/layers.css) and the favicons are linked in
    // app.vue, under the base path that is only known at runtime
    // (STUDIO_BASE_PATH).
    head: {
      title: 'BaSyx Studio',
      meta: [
        { name: 'description', content: 'BaSyx Studio: view, edit and extend Asset Administration Shells across infrastructures and AASX packages.' },
      ],
    },
  },

  runtimeConfig: {
    studio: {
      // Overridable at runtime with NUXT_STUDIO_DEPLOYMENT_MODE.
      deploymentMode: 'hosted',
      version: process.env.STUDIO_VERSION || packageVersion,
      commit: process.env.STUDIO_COMMIT_SHA ?? '',
      buildDate: process.env.STUDIO_BUILD_DATE ?? '',
      // Path of the bundled Workspace Worker; set for `nuxt dev` by
      // modules/workspace-worker.ts, next to the server entry otherwise.
      workspaceWorker: '',
    },
  },

  vite: {
    // The 3D viewer's parser worker (packages/file-viewer/src/model) is a module, so
    // it can load the IFC and STEP parsers on demand.
    worker: { format: 'es' },
  },

  routeRules: {
    // Only Studio may frame Studio pages; app frames run on other origins
    // (ADR 0017). App files set their own policy.
    '/**': { headers: { 'Content-Security-Policy': 'frame-ancestors \'self\'' } },
  },

  nitro: {
    // Bundles and styles are served gzip- and brotli-compressed, built once
    // (Lighthouse: about 1.3 MB less per first load without a compressing proxy).
    compressPublicAssets: true,
    // The ESM build of aas-core3.1-typescript uses extensionless relative
    // imports that plain Node ESM cannot load, so it must be bundled.
    externals: {
      inline: ['@aas-core-works/aas-core3.1-typescript'],
      // The App Builder starts the ACP adapters as scripts (ADR 0054); nothing
      // imports them, so tracing has to be told to copy them.
      traceInclude: [
        createRequire(import.meta.url).resolve('@agentclientprotocol/claude-agent-acp/dist/index.js'),
        createRequire(import.meta.url).resolve('@agentclientprotocol/codex-acp/dist/index.js'),
      ],
    },
    serverAssets: [
      { baseName: 'migrations', dir: './database/migrations' },
      // Apps shipped with Studio (ADR 0023), packaged by `pnpm apps:bundle`.
      { baseName: 'bundled-apps', dir: './bundled-apps' },
      // The App Builder's template for new projects (ADR 0054).
      { baseName: 'app-template', dir: '../examples/apps/starter', ignore: ['node_modules/**', 'dist/**', '*.zip', '*.sig'] },
    ],
  },

  vuetify: {
    moduleOptions: {
      prefixComposables: ['useLayout'],
      // Studio's Vuetify Sass settings, shared with its apps (ADR 0043).
      styles: { configFile: createRequire(import.meta.url).resolve('@basyx/studio-app-kit/settings.scss') },

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
