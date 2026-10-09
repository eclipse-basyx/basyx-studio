import type { StudioClient, ThemeTokens } from '@basyx/studio-sdk'
import type { Component } from 'vue'
import { createVuetify } from 'vuetify'
import { VBtn } from 'vuetify/components/VBtn'
import { aliases, mdi } from 'vuetify/iconsets/mdi'
import '@mdi/font/css/materialdesignicons.css'
import 'vuetify/styles'

/** Vuetify with the same defaults and aliases as Studio, so apps look native. */
export function createAppVuetify (components: Record<string, Component>) {
  return createVuetify({
    components,
    aliases: { VBtnPrimary: VBtn },
    defaults: {
      VBtn: { variant: 'text' },
      VBtnPrimary: { color: 'primary', variant: 'flat' },
      VCard: { variant: 'outlined' },
      VList: { color: 'primary' },
      VChip: { label: true, size: 'small', variant: 'tonal' },
      VAlert: { border: 'start', variant: 'tonal' },
      VTextField: { variant: 'outlined', density: 'comfortable' },
      VProgressLinear: { indeterminate: true, color: 'primary' },
    },
    icons: { defaultSet: 'mdi', aliases, sets: { mdi } },
  })
}

/** Follows Studio's light or dark theme and its colors. */
export function followStudioTheme (vuetify: ReturnType<typeof createVuetify>, client: StudioClient): void {
  const apply = (theme: ThemeTokens) => {
    const name = theme.dark ? 'dark' : 'light'
    Object.assign(vuetify.theme.themes.value[name]!.colors, theme.colors)
    vuetify.theme.change(name)
  }
  apply(client.context.theme)
  client.onContext(context => apply(context.theme))
}

/** `SerialNumber` → `Serial number`. */
export function humanize (idShort: string): string {
  const words = idShort.replaceAll(/([a-z\d])([A-Z])/g, '$1 $2').replaceAll(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
  return words.charAt(0) + words.slice(1).toLowerCase()
}

/** A localized AAS text for the locale, falling back to English and then the first entry. */
export function langText (value: unknown, locale: string): string {
  if (!Array.isArray(value)) {
    return typeof value === 'string' ? value : ''
  }
  const strings = value as Array<{ language: string, text: string }>
  const language = locale.split('-', 1)[0]!
  return (strings.find(entry => entry.language.startsWith(language)) ?? strings.find(entry => entry.language.startsWith('en')) ?? strings[0])?.text ?? ''
}
