/** Slots of the phones' bottom bar (Material: three to five). */
export const phoneNavSlots = 5

/**
 * The phones' bottom bar on a grid of `slots` equal slots. The centre item
 * (Shells) is raised in the middle slot, with the same number of slots on
 * either side; slots without an item stay empty (`null`), so no item grows
 * and the centre stays centred. When more items exist than fit, the last
 * slot becomes *More* (`more` lists its items, in their order), as it does
 * for items the user hid (`hidden`, listed last).
 */
export function phoneNavLayout<T> (items: readonly T[], isCentre: (item: T) => boolean, slots = phoneNavSlots, hidden: readonly T[] = []) {
  const centre = items.find(item => isCentre(item)) ?? null
  const others = items.filter(item => item !== centre)
  const room = slots - (centre ? 1 : 0)
  // Items the user hid from the rail are only behind More.
  const shown = others.length > room || hidden.length > 0 ? others.slice(0, room - 1) : others
  const more = [...others.slice(shown.length), ...hidden]
  if (!centre) {
    return { start: shown, centre, end: [] as Array<T | null>, more }
  }
  const side = Math.floor(room / 2)
  const pad = (list: T[], length: number) => [...list, ...Array.from({ length: length - list.length }, () => null)]
  const start = pad(shown.slice(0, side), side)
  // The right side ends with More when it is needed.
  const end = pad(shown.slice(side), side - (more.length > 0 ? 1 : 0))
  return { start, centre, end, more }
}

/**
 * `items` in the user's `order` of keys; items the order does not list
 * (new pages or apps) follow in their own order.
 */
export function orderByKeys<T extends { key: string }> (items: readonly T[], order: readonly string[]): T[] {
  const rank = new Map(order.map((key, index) => [key, index]))
  const at = (key: string) => rank.get(key) ?? order.length
  return items
    .map((item, index) => ({ item, index }))
    .toSorted((a, b) => at(a.item.key) - at(b.item.key) || a.index - b.index)
    .map(entry => entry.item)
}

/** `keys` with `key` moved to the place of `target`; unchanged if either is missing. */
export function moveKey (keys: readonly string[], key: string, target: string): string[] {
  const from = keys.indexOf(key)
  const to = keys.indexOf(target)
  if (from === -1 || to === -1) {
    return [...keys]
  }
  const result = keys.filter(entry => entry !== key)
  result.splice(to, 0, key)
  return result
}

/** `keys` with the keys of `shown` in that order, in the places they had; the other keys stay. */
export function reorderShown (keys: readonly string[], shown: readonly string[]): string[] {
  const listed = new Set(shown)
  const next = shown.values()
  return keys.map(key => listed.has(key) ? next.next().value ?? key : key)
}

/** The heights the rail lays its items out with, in pixels. */
export interface RailMetrics {
  /** The height the rail's upper list has for its items. */
  room: number
  /** An item, with its spacing; a group's *More* is one too. */
  item: number
  /** The divider between two groups, with its spacing. */
  divider: number
}

/**
 * The rail's groups: the items each shows, and the ones behind its own
 * *More*. Hidden items are behind More; of the others, the rail shows as
 * many as fit, in their order (so the last group gives way first), and the
 * item of the current page always. A group needs its More whenever an item
 * is behind it, and stays in the rail as long as it has items or a More.
 * Without `metrics` (on the server, before the rail was measured) all items
 * that are not hidden fit. The rail never scrolls.
 */
export function railLayout<N extends string, T extends { key: string }> (
  groups: ReadonlyArray<{ name: N, items: readonly T[] }>,
  hidden: ReadonlySet<string>,
  metrics: RailMetrics | null,
  activeKey: string | null = null,
) {
  const build = (shown: ReadonlySet<T>) => groups
    .map(group => ({
      name: group.name,
      items: group.items.filter(item => shown.has(item)),
      more: group.items.filter(item => !shown.has(item)).map(item => ({ item, hidden: hidden.has(item.key) })),
    }))
    .filter(group => group.items.length > 0 || group.more.length > 0)
  const candidates = groups.flatMap(group => group.items.filter(item => !hidden.has(item.key)))
  if (!metrics) {
    return build(new Set(candidates))
  }
  const height = (layout: ReturnType<typeof build>) => layout.reduce(
    (sum, group) => sum + (group.items.length + (group.more.length > 0 ? 1 : 0)) * metrics.item,
    Math.max(0, layout.length - 1) * metrics.divider,
  )
  const active = candidates.find(item => item.key === activeKey)
  let layout = build(new Set(candidates))
  for (let count = candidates.length; count >= 0; count--) {
    const shown = new Set(candidates.slice(0, count))
    if (active) {
      shown.add(active)
    }
    layout = build(shown)
    if (height(layout) <= metrics.room) {
      break
    }
  }
  return layout
}
