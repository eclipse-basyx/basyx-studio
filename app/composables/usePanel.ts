import type { LocationQuery } from 'vue-router'

export type PanelName = 'settings' | 'infrastructures' | 'apps'

const adminPanels = new Set<PanelName>(['infrastructures', 'apps'])

/**
 * Settings and the administration views open in place of the current page, in the
 * `panel` query parameter: the path stays, so the rail keeps the current
 * target's items, and the browser's Back button closes the panel again.
 */
export function usePanel () {
  const route = useRoute()
  const router = useRouter()
  const session = useSessionStore()

  const current = computed<PanelName | null>(() => {
    const name = route.query.panel
    if (session.needsLogin || (name !== 'settings' && name !== 'infrastructures' && name !== 'apps')) {
      return null
    }
    return adminPanels.has(name) && !session.isAdmin ? null : name
  })

  function withPanel (name: PanelName | null): LocationQuery {
    const { panel: _, ...query } = route.query
    return name ? { ...query, panel: name } : query
  }

  function open (name: PanelName) {
    // Switching panels replaces the entry, so Back still closes in one step.
    void (current.value ? router.replace({ query: withPanel(name) }) : router.push({ query: withPanel(name) }))
  }

  function close () {
    const page = router.resolve({ query: withPanel(null) }).fullPath
    // Opened from this page: go back, so Back afterwards does not reopen it.
    void (window.history.state?.back === page ? router.back() : router.replace(page))
  }

  return { current, open, close }
}
