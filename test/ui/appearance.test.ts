import { describe, expect, it } from 'vitest'
import { paletteNames, palettes, themeName } from '#shared/appearance'
import { preferencesSchema } from '#shared/contract'
import config from '../../vuetify.config'

function luminance (hex: string): number {
  const [r, g, b] = [1, 3, 5].map(start => Number.parseInt(hex.slice(start, start + 2), 16) / 255).map(channel => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function contrast (a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].toSorted((x, y) => y - x)
  return (high! + 0.05) / (low! + 0.05)
}

describe('appearance', () => {
  it('builds a light and a dark theme for every palette, BaSyx under the plain names', () => {
    const themes = (config as { theme: { themes: Record<string, { dark?: boolean, colors: Record<string, string> }> } }).theme.themes
    expect(themeName('basyx', false)).toBe('light')
    expect(themeName('ocean', true)).toBe('ocean-dark')
    for (const name of paletteNames) {
      expect(themes[themeName(name, false)]?.colors.primary).toBe(palettes[name].light.primary)
      expect(themes[themeName(name, true)]?.dark).toBe(true)
    }
  })

  it('keeps accents readable (WCAG AA): light on white, dark on the dark surface', () => {
    for (const name of paletteNames) {
      for (const color of Object.values(palettes[name].light)) {
        expect(contrast(color, '#FFFFFF')).toBeGreaterThanOrEqual(4.5)
      }
      for (const color of Object.values(palettes[name].dark)) {
        expect(contrast(color, '#212121')).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('falls back to BaSyx and the normal shape for unknown stored values', () => {
    expect(preferencesSchema.parse({})).toMatchObject({ palette: 'basyx', shape: 'normal' })
    expect(preferencesSchema.parse({ palette: 'sunset', shape: 'square' })).toMatchObject({ palette: 'basyx', shape: 'normal' })
  })
})
