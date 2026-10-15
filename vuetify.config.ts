import { defineVuetifyConfiguration } from 'vuetify-nuxt-module/custom-configuration'
import { themeColors, withOnColors } from './shared/appearance.ts'

// The single place for Studio's look and feel. Components rely on these
// defaults instead of repeating props, and on Vuetify utility classes instead
// of custom CSS (see AGENTS.md and the Vue rules in eslint.config.js).
//
// A calm, bordered look (MVP-4 plan, L2): Vuetify's own palette with the BaSyx
// brand colours, small radii, outlined fields, borders instead of shadows.

// Vuetify's status colours, listed so they get on-colours below.
const status = {
  light: { error: '#B00020', info: '#2196F3', success: '#4CAF50', warning: '#FB8C00' },
  dark: { error: '#CF6679', info: '#2196F3', success: '#4CAF50', warning: '#FB8C00' },
}

const field = { variant: 'outlined', density: 'comfortable', hideDetails: 'auto' } as const

// Studio's light and dark themes: the BaSyx accent on Vuetify's own
// surfaces, with the status colours. The accent and background chosen in
// Settings (shared/appearance.ts) are laid over them in app.vue.
const modeThemes = Object.fromEntries([false, true].map(dark => [dark ? 'dark' : 'light', {
  dark,
  colors: { ...themeColors('basyx', 'neutral', dark), ...withOnColors(status[dark ? 'dark' : 'light']) },
}]))

export default defineVuetifyConfiguration({
  theme: {
    // An explicit theme, so server rendering and hydration agree: the module
    // picks light or dark from the color-scheme cookie or the
    // Sec-CH-Prefers-Color-Scheme client hint (nuxt.config.ts:
    // vuetify.moduleOptions.ssrClientHints). The user's choice in Settings
    // (including "system") is applied in app.vue after hydration.
    defaultTheme: 'light',
    themes: {
      ...modeThemes,
      // Easter egg: the Konami code (default layout) applies it to the app for
      // the session, scoped through <v-app :theme>, so the color-scheme cookie
      // and the stored theme stay as they are.
      arcade: {
        dark: true,
        colors: {
          ...withOnColors({
            background: '#0B0B1A',
            surface: '#14142B',
            primary: '#39FF14',
            secondary: '#FF2BD6',
            error: '#FF3B3B',
            info: '#00E5FF',
            success: '#39FF14',
            warning: '#FFE600',
          }),
          'dialog-header': '#1E1E3A',
        },
      },
    },
  },

  // Below 960 px (md) drawers become temporary and the layout switches to the
  // phone navigation; Vuetify's default would do this up to 1280 px.
  display: { mobileBreakpoint: 'md' },

  // Virtual components for recurring roles; use them instead of restating props.
  aliases: {
    // The main action of a view or dialog (save, sign in, add, delete).
    VBtnPrimary: 'VBtn',
    // A further action beside the main one, e.g. on the left of a dialog's
    // actions: bordered and filled, as in the BaSyx AAS Web UI and shadcn.
    VBtnSecondary: 'VBtn',
    // An icon-only button in a v-btn-toggle. The toggle hands its compact
    // density to every v-btn, which squeezes an icon button to 28 px around a
    // 24 px icon; an alias only reads its own defaults, so this one keeps room
    // around a smaller icon.
    VBtnToggleIcon: 'VBtn',
    // Pane container of a full-height page area: fixed height, scrolling body.
    VCardPane: 'VCard',
    // Records in a bordered card (infrastructures, targets, apps), divided by
    // v-divider: slim, square rows, and the row icon (RecordListItem) as far
    // from the left edge as from the top and bottom.
    VListRecords: 'VList',
    // The fields of a resource form (shell, submodel, element): the same
    // comfortable inputs in the drawer and in dialogs, which default to compact.
    VFormFields: 'VSheet',
  },

  defaults: {
    VAppBar: { flat: true, border: 'b', density: 'comfortable' },
    VNavigationDrawer: { border: 'e' },
    VAvatar: { rounded: 'lg' },
    VBtn: { variant: 'text', rounded: 'lg', class: 'text-none' },
    VBtnPrimary: { color: 'primary', variant: 'flat', rounded: 'lg', class: 'text-none' },
    VBtnSecondary: { color: 'surface-light', variant: 'flat', border: true, rounded: 'lg', class: 'text-none' },
    // One bordered group, divided between its buttons. Only the group is
    // rounded: the buttons' own rounding (VBtn above) would show at the dividers.
    VBtnToggle: { density: 'compact', rounded: 'lg', color: 'primary', border: true, divided: true, variant: 'text', VBtn: { rounded: false } },
    // As the toggle's own buttons (VBtnGroup sets height, flat and the rest).
    VBtnToggleIcon: { color: 'primary', variant: 'text', flat: true, height: 'auto', rounded: false, density: 'comfortable', VIcon: { size: 'small' } },
    VCard: { flat: true, border: true, rounded: 'lg' },
    VCardPane: {
      flat: true,
      border: true,
      rounded: 'lg',
      height: 'calc(100vh - 190px)',
      minHeight: 320,
      class: 'd-flex flex-column',
    },
    // Overlays keep a shadow so they stand out from the page.
    // Dialogs use compact fields: forms in dialogs stay short.
    VDialog: {
      VCard: { flat: false },
      VTextField: { density: 'compact' },
      VSelect: { density: 'compact' },
      VAutocomplete: { density: 'compact' },
      VFileInput: { density: 'compact' },
      VTextarea: { density: 'compact' },
    },
    // Menus are dense, as in shadcn: compact rows, slim icons, body-sized text.
    // Items are inset evenly (pa-1) with a smaller radius (4 px) than the
    // menu card (8 px), so their highlight follows the card's corners. Lists
    // are transparent elsewhere (below); the menus of selects, comboboxes and
    // autocompletes have no card around their list, so it brings the surface.
    VMenu: {
      VCard: { flat: false },
      VList: { density: 'compact', slim: true, bgColor: 'surface', class: 'pa-1 text-body-medium' },
      VListItem: { minHeight: 36, rounded: true },
    },
    // Compact lists throughout: more rows on screen, as in the BaSyx Web UI and shadcn.
    VList: { color: 'primary', density: 'compact', bgColor: 'transparent' },
    VListItem: { rounded: 'lg', VBtn: { size: 'small' } },
    VFormFields: {
      color: 'transparent',
      VTextField: { density: 'comfortable' },
      VSelect: { density: 'comfortable' },
      VCombobox: { density: 'comfortable' },
      VAutocomplete: { density: 'comfortable' },
      VTextarea: { density: 'comfortable' },
      VFileInput: { density: 'comfortable' },
    },
    VListRecords: { slim: true, lines: 'two', class: 'py-0', VListItem: { rounded: false, class: 'ps-3' } },
    VChip: { label: true, size: 'small', variant: 'tonal' },
    VAlert: { border: 'start', variant: 'tonal', VBtn: { size: 'small' } },
    VTextField: field,
    VSelect: field,
    VAutocomplete: field,
    VCombobox: field,
    VFileInput: field,
    VTextarea: field,
    VCheckbox: { density: 'compact', color: 'primary', hideDetails: 'auto' },
    VSwitch: { color: 'primary', inset: true, hideDetails: true, density: 'compact' },
    VProgressLinear: { indeterminate: true, color: 'primary' },
    VBreadcrumbs: { class: 'pa-0' },
    // Items register from props, so closed groups are not rendered: large lists stay fast (MVP-4 plan, T1).
    VTreeview: { density: 'compact', activatable: true, color: 'primary', itemsRegistration: 'props' },
    VTooltip: { location: 'bottom', openDelay: 400 },
    VExpansionPanels: { variant: 'accordion', flat: true },
    VDataTable: { hover: true, density: 'comfortable' },
    VTabs: { color: 'primary', density: 'comfortable' },
    VContainer: { fluid: true, maxWidth: 1280, class: 'pa-2 pa-sm-3 pa-md-4' },
  },
})
