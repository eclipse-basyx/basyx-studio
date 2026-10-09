import type { AppContributions } from '#shared/contract'
import type { MaybeRefOrGetter } from 'vue'
import { useQuery } from '@pinia/colada'

/** Installs and uninstalls reach open sessions within this interval (MVP-3). */
const refreshIntervalMs = 30_000

/**
 * Contributions of the installed apps: modules always, and submodel views for
 * a submodel's semantic ID. Apps are installed at runtime, so the list is
 * refetched on window focus and periodically while the page is visible.
 */
export function useAppContributions (semanticId: MaybeRefOrGetter<string | null | undefined> = null) {
  const api = useStudioApi()
  const session = useSessionStore()
  const query = useQuery({
    key: () => ['app-contributions', toValue(semanticId) ?? ''],
    query: ({ signal }) => api<AppContributions>('/app-contributions', {
      query: { semanticId: toValue(semanticId) ?? undefined },
      signal,
    }),
    enabled: () => session.session !== null,
    refetchOnWindowFocus: 'always',
  })
  if (import.meta.client) {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && session.session) {
        void query.refetch()
      }
    }, refreshIntervalMs)
    onScopeDispose(() => clearInterval(timer))
  }
  return query
}

/** Text of a localized app label for the UI language. */
export function useLocalizedLabel () {
  const { locale } = useI18n()
  return (text: Record<string, string>) => text[locale.value] ?? text[locale.value.split('-', 1)[0]!] ?? text.en ?? Object.values(text)[0] ?? ''
}
