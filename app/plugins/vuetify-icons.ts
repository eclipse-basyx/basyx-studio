import { aasIconPaths, sidebarIconPath, sidebarOpenIconPath } from '~/utils/icons'

// Studio's own icons as Vuetify aliases, e.g. `icon="$aas"` for shells, as in
// the BaSyx AAS Web UI, and `$sidebar` and `$sidebarOpen` for the side list's toggle.
// Registered before Vuetify is created.
export default defineNuxtPlugin({
  name: 'studio:vuetify-icons',
  order: 24.6,
  setup (nuxtApp) {
    nuxtApp.hook('vuetify:before-create', ({ vuetifyOptions }) => {
      vuetifyOptions.icons = {
        ...vuetifyOptions.icons,
        aliases: { ...vuetifyOptions.icons?.aliases, aas: aasIconPaths, sidebar: sidebarIconPath, sidebarOpen: sidebarOpenIconPath },
      }
    })
  },
})
