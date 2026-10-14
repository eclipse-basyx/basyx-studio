import { describe, expect, it } from 'vitest'
import { locales } from '#shared/i18n/locales'
import { pluralRule } from '#shared/i18n/plural'

/** The chosen index for each count. */
function choices (language: string, choicesLength: number, counts = [0, 1, 2, 5]) {
  const rule = pluralRule(language)
  return counts.map(count => rule(count, choicesLength))
}

describe('plural rule', () => {
  it('uses a single choice for every count', () => {
    for (const locale of locales) {
      expect(choices(locale.language, 1)).toEqual([0, 0, 0, 0])
    }
  })

  it('treats 0 as plural in English, German, Spanish and Dutch', () => {
    for (const language of ['en-US', 'de-DE', 'es-ES', 'nl-NL']) {
      expect(choices(language, 2)).toEqual([1, 0, 1, 1])
      expect(choices(language, 3)).toEqual([0, 1, 2, 2])
    }
  })

  it('treats 0 as singular in French', () => {
    expect(choices('fr-FR', 2)).toEqual([0, 0, 1, 1])
    // A message with its own zero form still uses it.
    expect(choices('fr-FR', 3)).toEqual([0, 1, 2, 2])
  })

  it('has no singular in Chinese and Japanese', () => {
    for (const language of ['zh-CN', 'ja-JP']) {
      expect(choices(language, 2)).toEqual([1, 1, 1, 1])
      expect(choices(language, 3)).toEqual([0, 2, 2, 2])
    }
  })

  it('ignores the sign', () => {
    expect(choices('en-US', 2, [-1, -2])).toEqual([0, 1])
  })
})
