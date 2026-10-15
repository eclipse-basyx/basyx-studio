// Appearance choices of Settings, chosen one by one as in Slack: the mode
// (light, dark or system), an accent colour (a preset or the user's own), a
// background and a shape. vuetify.config.ts builds Studio's light and dark
// themes from the defaults; app.vue lays the user's accent and background
// over them after hydration; the preferences schema takes its names from here.

/**
 * Preset accents, each with a light-mode and a dark-mode shade. Light shades
 * reach at least 4.5:1 with white, dark shades with every dark background
 * (WCAG AA). `basyx` is the BaSyx brand (app/assets/basyx-logo.svg) and the
 * default.
 */
export const accents = {
  basyx: { light: '#0077A6', dark: '#00ADEE' },
  blue: { light: '#1565C0', dark: '#64B5F6' },
  teal: { light: '#00796B', dark: '#4DB6AC' },
  green: { light: '#2E7D32', dark: '#81C784' },
  violet: { light: '#5E35B1', dark: '#B39DDB' },
  pink: { light: '#AD1457', dark: '#F48FB1' },
  graphite: { light: '#455A64', dark: '#B0BEC5' },
} as const
export const accentNames = ['basyx', 'blue', 'teal', 'green', 'violet', 'pink', 'graphite'] as const satisfies ReadonlyArray<keyof typeof accents>
export type AccentName = (typeof accentNames)[number]

/** A custom accent, as `#RRGGBB`. */
export const hexColorPattern = /^#[0-9A-F]{6}$/i

/** The BaSyx orange: the secondary colour with every accent. */
export const secondary = { light: '#A65400', dark: '#F69222' } as const

/** The colours a background sets: the page, cards, raised controls and dialog headers. */
interface Tone {
  'background': string
  'surface': string
  'surface-light': string
  'dialog-header': string
}

/**
 * Backgrounds, each with a light and a dark tone. `neutral` keeps Vuetify's
 * own surfaces, as Studio had them.
 */
export const backgrounds: Record<'neutral' | 'slate' | 'warm' | 'midnight' | 'contrast', { light: Tone, dark: Tone }> = {
  neutral: {
    light: { 'background': '#FFFFFF', 'surface': '#FFFFFF', 'surface-light': '#EEEEEE', 'dialog-header': '#F5F5F5' },
    dark: { 'background': '#121212', 'surface': '#212121', 'surface-light': '#424242', 'dialog-header': '#282828' },
  },
  slate: {
    light: { 'background': '#F4F6F9', 'surface': '#FFFFFF', 'surface-light': '#E6EAF0', 'dialog-header': '#EEF1F5' },
    dark: { 'background': '#16191D', 'surface': '#1F2328', 'surface-light': '#363C44', 'dialog-header': '#272C32' },
  },
  warm: {
    light: { 'background': '#FAF7F2', 'surface': '#FFFFFF', 'surface-light': '#EFE9E0', 'dialog-header': '#F5F0E8' },
    dark: { 'background': '#1A1714', 'surface': '#24201C', 'surface-light': '#3D3730', 'dialog-header': '#2D2924' },
  },
  midnight: {
    light: { 'background': '#F3F6FC', 'surface': '#FFFFFF', 'surface-light': '#E3E9F5', 'dialog-header': '#ECF0F8' },
    dark: { 'background': '#0B1220', 'surface': '#131C2E', 'surface-light': '#2A3550', 'dialog-header': '#1A2438' },
  },
  contrast: {
    light: { 'background': '#FFFFFF', 'surface': '#FFFFFF', 'surface-light': '#E0E0E0', 'dialog-header': '#F0F0F0' },
    dark: { 'background': '#000000', 'surface': '#0E0E0E', 'surface-light': '#2B2B2B', 'dialog-header': '#1A1A1A' },
  },
}
export const backgroundNames = ['neutral', 'slate', 'warm', 'midnight', 'contrast'] as const satisfies ReadonlyArray<keyof typeof backgrounds>
export type BackgroundName = (typeof backgroundNames)[number]

/** `normal`: Studio's small radii (8 px); `rounded`: large radii and pill-shaped buttons and chips. */
export const shapes = ['normal', 'rounded'] as const
export type ShapeName = (typeof shapes)[number]

function channels (hex: string): [number, number, number] {
  return [1, 3, 5].map(start => Number.parseInt(hex.slice(start, start + 2), 16) / 255) as [number, number, number]
}

function toHex (rgb: readonly number[]): string {
  return `#${rgb.map(channel => Math.round(Math.min(1, Math.max(0, channel)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

/** Relative luminance (WCAG 2). */
export function luminance (hex: string): number {
  const [r, g, b] = channels(hex).map(channel => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

/** Contrast ratio of two colours (WCAG 2), 1 to 21. */
export function contrast (a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].toSorted((x, y) => y - x)
  return (high! + 0.05) / (low! + 0.05)
}

/**
 * Text colour on a filled colour (`on-primary`, …): white where it reaches
 * 4.5:1 (WCAG AA), black otherwise. Vuetify's own choice (APCA) puts white on
 * bright colours such as the dark-theme cyan, which is hard to read.
 */
export function onColor (hex: string): string {
  return contrast(hex, '#FFFFFF') >= 4.5 ? '#FFFFFF' : '#000000'
}

/** Adds `on-` colours to filled colours. */
export function withOnColors (colors: Record<string, string>): Record<string, string> {
  return { ...colors, ...Object.fromEntries(Object.entries(colors).map(([name, hex]) => [`on-${name}`, onColor(hex)])) }
}

/** Mixes a colour towards black (`amount` < 0) or white (`amount` > 0). */
function shade (hex: string, amount: number): string {
  const target = amount < 0 ? 0 : 1
  return toHex(channels(hex).map(channel => channel + (target - channel) * Math.abs(amount)))
}

/**
 * A custom accent's shade for a mode: darkened until it reaches 4.5:1 with
 * white, or lightened until it does with the lightest dark surface, so text
 * and icons in the accent stay readable whatever colour was picked.
 */
export function readableShade (hex: string, dark: boolean): string {
  const against = dark ? backgroundNames.map(name => backgrounds[name].dark.surface).toSorted((a, b) => luminance(b) - luminance(a))[0]! : '#FFFFFF'
  for (let step = 0; step <= 20; step++) {
    const candidate = shade(hex, (dark ? 1 : -1) * step * 0.05)
    if (contrast(candidate, against) >= 4.5) {
      return candidate
    }
  }
  return dark ? '#FFFFFF' : '#000000'
}

/** The accent's shade for a mode: a preset's own, or the readable shade of a custom colour. */
export function accentShade (accent: string, dark: boolean): string {
  const preset = accents[accent as AccentName]
  if (preset) {
    return dark ? preset.dark : preset.light
  }
  return hexColorPattern.test(accent) ? readableShade(accent, dark) : (dark ? accents.basyx.dark : accents.basyx.light)
}

/** The colours an accent and a background give a light or dark theme, with their `on-` colours. */
export function themeColors (accent: string, background: BackgroundName, dark: boolean): Record<string, string> {
  const mode = dark ? 'dark' : 'light'
  const tone = backgrounds[background][mode]
  return {
    ...withOnColors({ primary: accentShade(accent, dark), secondary: secondary[mode], background: tone.background, surface: tone.surface }),
    'surface-light': tone['surface-light'],
    'dialog-header': tone['dialog-header'],
  }
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
