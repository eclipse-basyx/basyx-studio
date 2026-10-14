import type { LocaleCode } from '#shared/i18n/locales'
import { locales } from '#shared/i18n/locales'
import { pluralRule } from '#shared/i18n/plural'

// Named formats for d() and n(), the same options in every locale; Intl
// adapts them to the language.
const datetimeFormats = {
  date: { day: 'numeric', month: 'short', year: 'numeric' },
  dateTime: { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' },
} as const
const numberFormats = {
  integer: { maximumFractionDigits: 0 },
} as const

function perLocale<T> (value: (locale: typeof locales[number]) => T) {
  return Object.fromEntries(locales.map(locale => [locale.code, value(locale)])) as Record<LocaleCode, T>
}

// Messages, including Vuetify's own `$vuetify.*` texts, are lazy-loaded per
// locale (nuxt.config.ts, i18n/locales/vuetify). Missing keys fall back to
// English (ADR 0026).
export default defineI18nConfig(() => ({
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en',
  missingWarn: import.meta.dev,
  fallbackWarn: import.meta.dev,
  pluralRules: perLocale(locale => pluralRule(locale.language)),
  datetimeFormats: perLocale(() => datetimeFormats),
  numberFormats: perLocale(() => numberFormats),
}))
