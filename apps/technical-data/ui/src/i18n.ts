import type { I18n } from '@basyx/studio-app-kit/i18n'
import type { StudioClient } from '@basyx/studio-sdk'
import { provideI18n as provideAppI18n } from '@basyx/studio-app-kit/i18n'
import de from './locales/de.json'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import ja from './locales/ja.json'
import nl from './locales/nl.json'
import zhHans from './locales/zh-Hans.json'

// The app's own texts in Studio's seven UI locales (ADR 0026).

export { useI18n } from '@basyx/studio-app-kit/i18n'

export function provideI18n (client: StudioClient): I18n {
  return provideAppI18n(client, en, { de, fr, es, nl, ja, 'zh-Hans': zhHans })
}
