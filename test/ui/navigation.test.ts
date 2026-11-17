import { describe, expect, it } from 'vitest'
import { sectionOf } from '~~/app/stores/navigation'
import { moveKey, orderByKeys, phoneNavLayout, railLayout, reorderShown } from '~~/app/utils/navigation'

describe('navigation sections', () => {
  it('resumes the submodel view as a section of its own', () => {
    expect(sectionOf('/targets/t1/submodels')).toBe('submodels:t1')
    expect(sectionOf('/targets/t1/shells/abc')).toBe('shells:t1')
    expect(sectionOf('/targets/t1/concepts')).toBe('concepts:t1')
    expect(sectionOf('/targets/t1')).toBe('dashboard:t1')
  })
})

describe('the phones\' bottom bar', () => {
  const layout = (keys: string[], slots?: number, hidden?: string[]) => {
    const result = phoneNavLayout(keys, key => key === 'shells', slots, hidden)
    return { start: result.start, centre: result.centre, end: result.end, more: result.more }
  }

  it('raises Shells in the middle of five equal slots', () => {
    expect(layout(['targets', 'dashboard', 'shells', 'submodels', 'concepts'])).toEqual({
      start: ['targets', 'dashboard'],
      centre: 'shells',
      end: ['submodels', 'concepts'],
      more: [],
    })
    // A missing item leaves its slot empty instead of widening another.
    expect(layout(['targets', 'dashboard', 'shells', 'submodels'])).toEqual({ start: ['targets', 'dashboard'], centre: 'shells', end: ['submodels', null], more: [] })
  })

  it('opens the items that do not fit from the last slot, which is one slot wide', () => {
    expect(layout(['targets', 'dashboard', 'shells', 'submodels', 'concepts', 'app'])).toEqual({
      start: ['targets', 'dashboard'],
      centre: 'shells',
      end: ['submodels'],
      more: ['concepts', 'app'],
    })
    expect(layout(['targets', 'dashboard', 'shells', 'submodels', 'concepts'], 3)).toEqual({ start: ['targets'], centre: 'shells', end: [], more: ['dashboard', 'submodels', 'concepts'] })
  })

  it('opens hidden items from the last slot too, after the ones that do not fit', () => {
    expect(layout(['dashboard', 'shells', 'submodels'], 5, ['concepts'])).toEqual({ start: ['dashboard', 'submodels'], centre: 'shells', end: [null], more: ['concepts'] })
    expect(layout(['dashboard', 'shells', 'a', 'b', 'c'], 5, ['h'])).toEqual({ start: ['dashboard', 'a'], centre: 'shells', end: ['b'], more: ['c', 'h'] })
  })

  it('has no raised item outside a target', () => {
    expect(layout(['targets', 'global-app'])).toEqual({ start: ['targets', 'global-app'], centre: null, end: [], more: [] })
    expect(layout(['targets', 'a', 'b', 'c', 'd', 'e'])).toEqual({ start: ['targets', 'a', 'b', 'c'], centre: null, end: [], more: ['d', 'e'] })
  })
})

describe('the rail\'s order', () => {
  const items = (...keys: string[]) => keys.map(key => ({ key }))
  const keys = (list: Array<{ key: string }>) => list.map(item => item.key)

  it('follows the user\'s order and keeps unlisted items after it, in their own order', () => {
    expect(keys(orderByKeys(items('dashboard', 'shells', 'submodels', 'app:a'), ['submodels', 'dashboard']))).toEqual(['submodels', 'dashboard', 'shells', 'app:a'])
    // A stored key whose item is gone changes nothing.
    expect(keys(orderByKeys(items('docker', 'app-builder'), ['gone', 'app-builder']))).toEqual(['app-builder', 'docker'])
  })

  it('moves a key to the place of another, either way', () => {
    expect(moveKey(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd'])
    expect(moveKey(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c'])
    expect(moveKey(['a', 'b'], 'a', 'x')).toEqual(['a', 'b'])
  })
})

describe('the rail\'s room', () => {
  const metrics = (items: number) => ({ room: items * 44, item: 44, divider: 9 })
  const groups = [
    { name: 'infrastructure', items: ['dashboard', 'shells', 'submodels', 'app:a'].map(key => ({ key })) },
    { name: 'global', items: ['docker', 'app-builder'].map(key => ({ key })) },
  ]
  /** Each group as its shown keys, then `|` and the keys behind its More. */
  const summary = (layout: ReturnType<typeof railLayout<string, { key: string }>>) => layout.map(group => [
    `${group.name}:`,
    ...group.items.map(item => item.key),
    ...(group.more.length > 0 ? ['|', ...group.more.map(({ item, hidden }) => hidden ? `${item.key}(hidden)` : item.key)] : []),
  ].join(' '))

  it('shows every item while it is not measured, or when all fit', () => {
    const all = ['infrastructure: dashboard shells submodels app:a', 'global: docker app-builder']
    expect(summary(railLayout(groups, new Set(), null))).toEqual(all)
    // Six items and the divider.
    expect(summary(railLayout(groups, new Set(), { room: 6 * 44 + 9, item: 44, divider: 9 }))).toEqual(all)
  })

  it('puts the items that do not fit behind their group\'s More, the last group first', () => {
    // Room for six items, not six and the divider: the Studio group keeps
    // only its More (More never stands in for a single item, which would fit).
    expect(summary(railLayout(groups, new Set(), metrics(6)))).toEqual([
      'infrastructure: dashboard shells submodels app:a',
      'global: | docker app-builder',
    ])
    expect(summary(railLayout(groups, new Set(), metrics(5)))).toEqual([
      'infrastructure: dashboard shells | submodels app:a',
      'global: | docker app-builder',
    ])
  })

  it('keeps the current page\'s item in the rail, in place of the last one that fits', () => {
    expect(summary(railLayout(groups, new Set(), metrics(5), 'app-builder'))).toEqual([
      'infrastructure: dashboard | shells submodels app:a',
      'global: app-builder | docker',
    ])
  })

  it('puts hidden items behind their group\'s More, even when the others fit', () => {
    expect(summary(railLayout(groups, new Set(['app:a']), metrics(20)))).toEqual([
      'infrastructure: dashboard shells submodels | app:a(hidden)',
      'global: docker app-builder',
    ])
    // A group whose items are all hidden keeps only its More.
    expect(summary(railLayout(groups, new Set(['docker', 'app-builder']), metrics(20)))).toEqual([
      'infrastructure: dashboard shells submodels app:a',
      'global: | docker(hidden) app-builder(hidden)',
    ])
  })

  it('reorders the shown keys in their places, around the ones it does not show', () => {
    expect(reorderShown(['a', 'hidden', 'b', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'hidden', 'a', 'b'])
    expect(reorderShown(['a', 'b'], ['b', 'a'])).toEqual(['b', 'a'])
  })
})
