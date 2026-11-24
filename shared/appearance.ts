import { roundedShapeDefaults } from '@basyx/studio-app-kit/vuetify-defaults'

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

/**
 * The colours a background sets: the page, cards, raised controls, the headers
 * of dialogs and container cards, and the desktop window's frame around the
 * page (title bar, rail, edges).
 */
interface Tone {
  'background': string
  'surface': string
  'surface-light': string
  'card-header': string
  'frame': string
}

/**
 * `neutral`, the default: plain greys. Dark:
 * a #181818 page, the sidebar and cards #1E1E1E, selected and raised controls
 * #383838, and the frame (#282828) lighter than all of them. Light: a white
 * page on a light grey frame.
 */
const neutral: { light: Tone, dark: Tone } = {
  light: { 'background': '#FFFFFF', 'surface': '#FFFFFF', 'surface-light': '#F4F4F4', 'card-header': '#F9F9F9', 'frame': '#F9F9F9' },
  dark: { 'background': '#181818', 'surface': '#1E1E1E', 'surface-light': '#383838', 'card-header': '#232323', 'frame': '#282828' },
}

/**
 * A tinted background's tone: its own page colour, and every other colour
 * lighter or darker than it by the same contrast ratio (WCAG 2) as in
 * `neutral`, so all backgrounds share its structure.
 */
function tintedTone (background: string, dark: boolean): Tone {
  const reference = dark ? neutral.dark : neutral.light
  const at = (key: Exclude<keyof Tone, 'background'>) => atContrast(background, contrast(reference.background, reference[key]), luminance(reference[key]) >= luminance(reference.background))
  return { background, 'surface': at('surface'), 'surface-light': at('surface-light'), 'card-header': at('card-header'), 'frame': at('frame') }
}

/** Backgrounds, each with a light and a dark tone. */
export const backgrounds: Record<'neutral' | 'slate' | 'warm' | 'midnight' | 'contrast', { light: Tone, dark: Tone }> = {
  neutral,
  slate: { light: tintedTone('#F4F6F9', false), dark: tintedTone('#16191D', true) },
  warm: { light: tintedTone('#FAF7F2', false), dark: tintedTone('#1A1714', true) },
  midnight: { light: tintedTone('#F3F6FC', false), dark: tintedTone('#0B1220', true) },
  // High contrast keeps its own, stronger steps: that is its purpose.
  contrast: {
    light: { 'background': '#FFFFFF', 'surface': '#FFFFFF', 'surface-light': '#E0E0E0', 'card-header': '#F0F0F0', 'frame': '#F0F0F0' },
    dark: { 'background': '#000000', 'surface': '#0E0E0E', 'surface-light': '#2B2B2B', 'card-header': '#1A1A1A', 'frame': '#161616' },
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

/** The colour lighter (or darker) than `base` by the contrast ratio `ratio`, mixed towards white (or black). */
function atContrast (base: string, ratio: number, lighter: boolean): string {
  let low = 0
  let high = 1
  for (let step = 0; step < 24; step++) {
    const middle = (low + high) / 2
    if (contrast(base, shade(base, lighter ? middle : -middle)) < ratio) {
      low = middle
    } else {
      high = middle
    }
  }
  return shade(base, lighter ? high : -high)
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

/**
 * The colours an accent and a background give a light or dark theme, with
 * their `on-` colours; `secondaryColor` is a deployment's own secondary
 * colour (ADR 0055) instead of the BaSyx orange, in its readable shade.
 */
export function themeColors (accent: string, background: BackgroundName, dark: boolean, secondaryColor?: string): Record<string, string> {
  const mode = dark ? 'dark' : 'light'
  const tone = backgrounds[background][mode]
  const second = secondaryColor && hexColorPattern.test(secondaryColor) ? readableShade(secondaryColor, dark) : secondary[mode]
  return {
    ...withOnColors({ primary: accentShade(accent, dark), secondary: second, background: tone.background, surface: tone.surface, frame: tone.frame }),
    'surface-light': tone['surface-light'],
    'card-header': tone['card-header'],
  }
}

/**
 * Component defaults of the `rounded` shape, laid over vuetify.config.ts
 * with a defaults provider (app.vue): the radii apps share
 * (@basyx/studio-app-kit, ADR 0055), and Studio's own aliases. Only radii
 * change, so every other default stays where it is.
 */
export const roundedDefaults = {
  ...roundedShapeDefaults,
  VBtnWidgetIcon: { rounded: 'pill' },
  VCardPane: { rounded: 'xl' },
}
