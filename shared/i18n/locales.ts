/**
 * The UI locales (ADR 0026). `code` names the locale files
 * (`i18n/locales/<code>.json`), `language` is the BCP 47 tag for browser
 * language detection, `<html lang>` and `Intl`, `vuetify` the export of
 * `vuetify/locale`. Only `available` locales are offered and detected; a
 * locale becomes available once its translation has been reviewed. The
 * first six were switched on as machine drafts before review (ADR 0026).
 *
 * A locale with a `base` loads the base locale's messages first and
 * overrides only some of them. The German dialects are an easter egg:
 * `hidden` keeps them out of the Settings picker until "basyx" is typed
 * there, and their variant subtags (`saarland`, …) never come from a
 * browser, so language detection never picks them.
 *
 * Plain TypeScript without aliases: `scripts/check-i18n.mjs` imports it.
 */
export interface UiLocale {
  code: string
  language: string
  name: string
  vuetify: string
  available: boolean
  hidden?: boolean
  base?: string
}

const definitions = [
  { code: 'en', language: 'en-US', name: 'English', vuetify: 'en', available: true },
  { code: 'de', language: 'de-DE', name: 'Deutsch', vuetify: 'de', available: true },
  { code: 'fr', language: 'fr-FR', name: 'Français', vuetify: 'fr', available: true },
  { code: 'es', language: 'es-ES', name: 'Español', vuetify: 'es', available: true },
  { code: 'zh-Hans', language: 'zh-CN', name: '简体中文', vuetify: 'zhHans', available: true },
  { code: 'ja', language: 'ja-JP', name: '日本語', vuetify: 'ja', available: true },
  { code: 'nl', language: 'nl-NL', name: 'Nederlands', vuetify: 'nl', available: true },
  { code: 'de-saar', language: 'de-DE-saarland', name: 'Saarländisch', vuetify: 'de', available: true, hidden: true, base: 'de' },
  { code: 'de-pfalz', language: 'de-DE-pfalz', name: 'Pfälzisch', vuetify: 'de', available: true, hidden: true, base: 'de' },
  { code: 'de-berlin', language: 'de-DE-berlin', name: 'Berlinerisch', vuetify: 'de', available: true, hidden: true, base: 'de' },
] as const satisfies readonly UiLocale[]

export type LocaleCode = typeof definitions[number]['code']

export const locales: readonly (UiLocale & { code: LocaleCode })[] = definitions

export const localeCodes = locales.map(locale => locale.code) as [LocaleCode, ...LocaleCode[]]
