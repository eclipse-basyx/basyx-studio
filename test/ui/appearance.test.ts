import { describe, expect, it } from 'vitest'
import { accentNames, accents, accentShade, backgroundNames, backgrounds, contrast, readableShade, themeColors } from '#shared/appearance'
import { preferencesSchema } from '#shared/contract'
import config from '../../vuetify.config'

describe('appearance', () => {
  it('builds Studio\'s light and dark themes from the BaSyx accent on the neutral background', () => {
    const themes = (config as { theme: { themes: Record<string, { dark?: boolean, colors: Record<string, string> }> } }).theme.themes
    expect(themes.light?.colors.primary).toBe(accents.basyx.light)
    expect(themes.dark?.colors.primary).toBe(accents.basyx.dark)
    expect(themes.dark?.colors.surface).toBe(backgrounds.neutral.dark.surface)
    expect(themes.dark?.dark).toBe(true)
  })

  it('keeps preset accents readable (WCAG AA) on every background of their mode', () => {
    for (const accent of accentNames) {
      for (const background of backgroundNames) {
        const { light, dark } = backgrounds[background]
        for (const surface of [light.background, light.surface]) {
          expect(contrast(accents[accent].light, surface)).toBeGreaterThanOrEqual(4.5)
        }
        for (const surface of [dark.background, dark.surface]) {
          expect(contrast(accents[accent].dark, surface)).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  })

  it('shades a custom accent until it is readable in each mode', () => {
    for (const picked of ['#FFEB3B', '#00FF00', '#1A1A1A', '#7F7F7F']) {
      expect(contrast(readableShade(picked, false), '#FFFFFF')).toBeGreaterThanOrEqual(4.5)
      for (const background of backgroundNames) {
        expect(contrast(readableShade(picked, true), backgrounds[background].dark.surface)).toBeGreaterThanOrEqual(4.5)
      }
    }
    // A readable colour stays as picked.
    expect(accentShade('#0077A6', false)).toBe('#0077A6')
  })

  it('sets accent, background and their text colours together', () => {
    const colors = themeColors('violet', 'midnight', true)
    expect(colors.primary).toBe(accents.violet.dark)
    expect(colors.background).toBe(backgrounds.midnight.dark.background)
    expect(colors['on-surface']).toBe('#FFFFFF')
  })

  it('falls back to BaSyx, the neutral background and the normal shape for unknown stored values', () => {
    expect(preferencesSchema.parse({})).toMatchObject({ accent: 'basyx', background: 'neutral', shape: 'normal' })
    expect(preferencesSchema.parse({ accent: '#12abef', background: 'warm' })).toMatchObject({ accent: '#12abef', background: 'warm' })
    expect(preferencesSchema.parse({ accent: 'sunset', background: 'plaid', shape: 'square' })).toMatchObject({ accent: 'basyx', background: 'neutral', shape: 'normal' })
  })
})
