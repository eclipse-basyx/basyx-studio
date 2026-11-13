import { buttonGroupDefaults, fieldDefaults, fullscreenDefaults, layoutDefaults, menuDefaults } from '@basyx/studio-app-kit/vuetify-defaults'
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

// Studio's light and dark themes: the BaSyx accent on Vuetify's own
// surfaces, with the status colours. The accent and background chosen in
// Settings (shared/appearance.ts) are laid over them in app.vue.
const modeThemes = Object.fromEntries([false, true].map(dark => [dark ? 'dark' : 'light', {
  dark,
  colors: { ...themeColors('basyx', 'neutral', dark), ...withOnColors(status[dark ? 'dark' : 'light']) },
}]))

// The App Builder's own look (ADR 0054), after the apps of the coding agents it
// drives: a warm ivory page, a darker sidebar and white raised surfaces. The
// accent is Studio's: the page wraps itself in these themes
// (<v-theme-provider>) and copies the primary colour that the user chose in
// Settings into them (app-builder/App.vue); the BaSyx accent is the fallback.
const claudeColors = {
  light: {
    'background': '#FAF9F5',
    'surface': '#FFFFFF',
    'surface-light': '#F0EEE6',
    'card-header': '#F5F4ED',
    'sidebar': '#F0EEE6',
    'secondary': '#6B6A63',
  },
  dark: {
    'background': '#262624',
    'surface': '#30302E',
    'surface-light': '#3A3A37',
    'card-header': '#30302E',
    'sidebar': '#1F1E1D',
    'secondary': '#B0AEA5',
  },
} as const
const claudeThemes = Object.fromEntries([false, true].map(dark => [dark ? 'claude-dark' : 'claude-light', {
  dark,
  colors: {
    ...modeThemes[dark ? 'dark' : 'light']!.colors,
    ...withOnColors(claudeColors[dark ? 'dark' : 'light']),
    'on-background': dark ? '#FAF9F5' : '#141413',
    'on-surface': dark ? '#FAF9F5' : '#141413',
  },
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
      ...claudeThemes,
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
    // An icon-only choice in a v-btn-toggle; its defaults are shared with
    // the apps (@basyx/studio-app-kit/vuetify-defaults).
    VBtnToggleIcon: 'VBtn',
    // A small icon action in a compact header, e.g. of an Overview widget or
    // a value tile: comfortable density keeps the header one line high.
    VBtnWidgetIcon: 'VBtn',
    // Text-sized settings under the App Builder's prompt box.
    VBtnChatSetting: 'VBtn',
    // Pane container of a full-height page area: fixed height, scrolling body.
    VCardPane: 'VCard',
    // The card of a full-screen dialog: edge to edge, without radius or border.
    VCardFullscreen: 'VCard',
    // The header of a container card (dialogs, Overview widgets, panes): a
    // tinted band that sets the title apart from the content. Value cards
    // and list rows keep their plain surface.
    VCardHeader: 'VCardItem',
    // Records in a bordered card (infrastructures, targets, apps), divided by
    // v-divider: slim, square rows, and the row icon (RecordListItem) as far
    // from the left edge as from the top and bottom.
    VListRecords: 'VList',
    // The fields of a resource form (shell, submodel, element): the same
    // comfortable inputs in the drawer and in dialogs, which default to compact.
    VFormFields: 'VSheet',
    // The whole of v-main, below the app bar and beside the rail, for a page
    // that is one frame: a full-page app module (ADR 0045).
    VSheetFullPage: 'VSheet',
    // The App Builder's prompt box: a large rounded surface that holds the
    // text, the model and the send button, with no field outline of its own.
    VSheetComposer: 'VSheet',
    // The App Builder's page (ADR 0054): a full page with dense defaults.
    VSheetAppBuilder: 'VSheet',
  },

  defaults: {
    // The app bar, drawers, toolbars and tabs, shared with the apps
    // (@basyx/studio-app-kit/vuetify-defaults).
    ...layoutDefaults,
    VAvatar: { rounded: 'lg' },
    VBtn: { variant: 'text', rounded: 'lg', class: 'text-none' },
    VBtnPrimary: { color: 'primary', variant: 'flat', rounded: 'lg', class: 'text-none' },
    VBtnSecondary: { color: 'surface-light', variant: 'flat', border: true, rounded: 'lg', class: 'text-none' },
    // One bordered group, divided between its buttons. Only the group is
    // rounded: the buttons' own rounding (VBtn above) would show at the dividers.
    // VBtnToggle, VBtnGroup and VBtnToggleIcon, shared with the bundled apps.
    ...buttonGroupDefaults,
    VBtnWidgetIcon: { variant: 'text', rounded: 'lg', density: 'comfortable', size: 'small' },
    VBtnChatSetting: { variant: 'text', rounded: 'lg', density: 'compact', size: 'small', minWidth: 0, class: 'text-none px-2' },
    VCard: { flat: true, border: true, rounded: 'lg' },
    // Full-screen surfaces, as in the apps: no border, no radius.
    ...fullscreenDefaults,
    VCardHeader: { class: 'bg-card-header' },
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
    // Menus as in the apps (@basyx/studio-app-kit/vuetify-defaults).
    ...menuDefaults,
    // Compact lists throughout: more rows on screen, as in the BaSyx Web UI and shadcn.
    VList: { color: 'primary', density: 'compact', bgColor: 'transparent' },
    VListItem: { rounded: 'lg', VBtn: { size: 'small' } },
    VSheetFullPage: {
      color: 'transparent',
      rounded: 0,
      // v-main sets the layout variables: the app bar above, the phone navigation below.
      height: 'calc(100dvh - var(--v-layout-top) - var(--v-layout-bottom))',
      class: 'd-flex flex-column',
      // A page wizard uses the stepper as a flat progress header above its form.
      VStepper: {
        flat: true,
        rounded: 0,
        VStepperHeader: { class: 'elevation-0' },
        VStepperItem: { color: 'primary' },
      },
      VCheckbox: { VLabel: { class: 'text-body-medium text-wrap' } },
      // Small actions next to table values have no surrounding frame.
      VTable: {
        VBtnGroup: { border: false, divided: false, size: 'small', density: 'comfortable', VIcon: { size: 18 } },
      },
    },
    // The App Builder's page: a full page as VSheetFullPage, dense throughout
    // like the coding agents' own apps (small buttons, 32 px rows, compact
    // cards, fields and tool-call rows).
    VSheetAppBuilder: {
      color: 'transparent',
      rounded: 0,
      height: 'calc(100dvh - var(--v-layout-top) - var(--v-layout-bottom))',
      class: 'd-flex flex-column',
      VBtn: { density: 'compact' },
      VListItem: { minHeight: 32 },
      VCardItem: { density: 'compact' },
      VCardActions: { class: 'py-1 px-3' },
      VCardText: { class: 'pt-0 pb-2 px-3' },
      VExpansionPanelTitle: { minHeight: 36, static: true, class: 'py-1 px-3' },
      // Alerts read like the chat's text: 14 px instead of the body's 16 px,
      // a 20 px icon instead of 28 px, and their own height (flex: 0 0 auto
      // instead of Vuetify's flex: 1 1, which in the preview's column
      // stretched a hint over the whole pane).
      VAlert: { density: 'compact', iconSize: 20, class: 'text-body-medium flex-0-0' },
      VChip: { size: 'x-small' },
      VTextField: { density: 'compact' },
      VSelect: { density: 'compact' },
      VAutocomplete: { density: 'compact' },
      VTextarea: { density: 'compact' },
      VRadioGroup: { density: 'compact' },
      VRadio: { density: 'compact' },
    },
    VSheetComposer: {
      color: 'surface',
      rounded: 'lg',
      border: true,
      elevation: 2,
      // One line that grows with the text, the send button beside it at the bottom.
      class: 'd-flex align-end ga-1 pe-2',
      // Solo, flat and transparent instead of plain: it pads above and below the text alike, so the text is centred.
      VTextarea: { variant: 'solo', flat: true, bgColor: 'transparent', rows: 1, autoGrow: true, maxRows: 10, density: 'compact', class: 'flex-grow-1' },
      // Send and stop: an icon in the accent colour, without a background of its own.
      VBtn: { color: 'primary', density: 'compact', class: 'mb-1' },
    },
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
    // Fields, checkboxes and switches, shared with the bundled apps.
    ...fieldDefaults,
    VProgressLinear: { indeterminate: true, color: 'primary' },
    VBreadcrumbs: { class: 'pa-0' },
    // Items register from props, so closed groups are not rendered: large lists stay fast (MVP-4 plan, T1).
    VTreeview: { density: 'compact', activatable: true, color: 'primary', itemsRegistration: 'props' },
    VTooltip: { location: 'bottom', openDelay: 400 },
    VExpansionPanels: { variant: 'accordion', flat: true },
    VDataTable: { hover: true, density: 'comfortable' },
    VContainer: { fluid: true, maxWidth: 1280, class: 'pa-2 pa-sm-3 pa-md-4' },
  },
})
