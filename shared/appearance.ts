// Appearance choices of Settings: a colour palette and a shape, next to light,
// dark or system. vuetify.config.ts builds a light and a dark Vuetify theme
// from every palette; app.vue applies the user's choice after hydration; the
// preferences schema takes its names from here.

/**
 * Accent colours per palette. Light-theme colours reach at least 4.5:1 with
 * white, dark-theme colours at least 4.5:1 with the dark surface (WCAG AA).
 * `basyx` is the BaSyx brand (app/assets/basyx-logo.svg) and the default.
 */
export const palettes = {
  basyx: { light: { primary: '#0077A6', secondary: '#A65400' }, dark: { primary: '#00ADEE', secondary: '#F69222' } },
  ocean: { light: { primary: '#1565C0', secondary: '#00796B' }, dark: { primary: '#64B5F6', secondary: '#4DB6AC' } },
  forest: { light: { primary: '#2E7D32', secondary: '#8A5A00' }, dark: { primary: '#81C784', secondary: '#FFB74D' } },
  violet: { light: { primary: '#5E35B1', secondary: '#AD1457' }, dark: { primary: '#B39DDB', secondary: '#F48FB1' } },
  graphite: { light: { primary: '#455A64', secondary: '#00838F' }, dark: { primary: '#B0BEC5', secondary: '#80DEEA' } },
} as const
export const paletteNames = ['basyx', 'ocean', 'forest', 'violet', 'graphite'] as const satisfies ReadonlyArray<keyof typeof palettes>
export type PaletteName = (typeof paletteNames)[number]

/** `normal`: Studio's small radii (8 px); `rounded`: large radii and pill-shaped buttons and chips. */
export const shapes = ['normal', 'rounded'] as const
export type ShapeName = (typeof shapes)[number]

/**
 * The Vuetify theme of a palette and brightness. The BaSyx palette keeps the
 * plain `light` and `dark` names, which the color-scheme cookie and server
 * rendering use.
 */
export function themeName (palette: PaletteName, dark: boolean): string {
  const mode = dark ? 'dark' : 'light'
  return palette === 'basyx' ? mode : `${palette}-${mode}`
}

const roundedField = { rounded: 'xl' } as const

/**
 * Component defaults of the `rounded` shape, laid over vuetify.config.ts
 * with a defaults provider (app.vue): only radii change, so every other
 * default stays where it is.
 */
export const roundedDefaults = {
  VBtn: { rounded: 'pill' },
  VBtnPrimary: { rounded: 'pill' },
  VBtnSecondary: { rounded: 'pill' },
  VBtnToggle: { rounded: 'pill' },
  VCard: { rounded: 'xl' },
  VCardPane: { rounded: 'xl' },
  VAvatar: { rounded: 'xl' },
  VListItem: { rounded: 'xl' },
  VChip: { label: false },
  VAlert: { rounded: 'xl' },
  VTextField: roundedField,
  VSelect: roundedField,
  VAutocomplete: roundedField,
  VCombobox: roundedField,
  VFileInput: roundedField,
  VTextarea: roundedField,
  VDialog: { VCard: { rounded: 'xl' } },
  // Menu items stay a step smaller than their menu, as in the normal shape.
  VMenu: { VCard: { rounded: 'xl' }, VList: { rounded: 'xl' }, VListItem: { rounded: 'lg' } },
}
