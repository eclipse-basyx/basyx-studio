import { defineStore } from 'pinia'

/**
 * The navigation section a path belongs to: the targets list, a target's
 * dashboard, shells or concepts, or an app module. Section keys include the
 * target, so another target never resumes this target's location (UX-001).
 */
export function sectionOf (path: string): string | null {
  if (path === '/') {
    return 'targets'
  }
  const app = /^(?:\/targets\/([^/]+))?\/apps\/([^/]+)\/([^/]+)/.exec(path)
  if (app) {
    return `app:${app[1] ?? ''}:${app[2]}:${app[3]}`
  }
  const target = /^\/targets\/([^/]+)(?:\/(shells|concepts)(?:\/|$))?/.exec(path)
  if (target && !path.startsWith(`/targets/${target[1]}/invite`)) {
    return `${target[2] ?? 'dashboard'}:${target[1]}`
  }
  return null
}

/**
 * Where the user left each navigation section, and the page state that the
 * URL does not hold (searches and filters), so returning to a section
 * continues where they left off. Kept in memory until the next reload.
 */
export const useNavigationStore = defineStore('navigation', () => {
  /** The last full path (without an open panel) per section. */
  const locations = ref<Record<string, string>>({})
  const pageState = ref<Record<string, unknown>>({})
  /**
   * The target opened last. It stays the current target on pages outside
   * any target (the targets list, global app modules) until another is opened.
   */
  const currentTarget = ref<string | null>(null)

  /** Records `fullPath` (resolved without an open panel) as the location of its path's section. */
  function remember (path: string, fullPath: string) {
    const section = sectionOf(path)
    if (section) {
      locations.value[section] = fullPath
    }
    const target = /^\/targets\/([^/]+)/.exec(path)?.[1]
    if (target) {
      currentTarget.value = target
    }
  }

  /** The location to return to in the section of `to`, or `to` itself. */
  function resume (to: string): string {
    const section = sectionOf(to)
    return (section && locations.value[section]) ?? to
  }

  return { locations, pageState, currentTarget, remember, resume }
})
