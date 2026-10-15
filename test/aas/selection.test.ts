import { describe, expect, it } from 'vitest'
import { followListChange } from '~~/app/utils/aas'

describe('selections after list changes', () => {
  it('shifts a selection behind a deleted list item', () => {
    expect(followListChange('List[1]', 'List[0]', null)).toBe('List[0]')
    expect(followListChange('List[2].Inner', 'List[0]', null)).toBe('List[1].Inner')
    expect(followListChange('List[0]', 'List[1]', null)).toBe('List[0]')
    expect(followListChange('List[1]', 'List[1]', null)).toBeNull()
    expect(followListChange('List[1][0]', 'List[1]', null)).toBeNull()
  })

  it('follows moved items and the siblings they pass', () => {
    expect(followListChange('List[0]', 'List[0]', 2)).toBe('List[2]')
    expect(followListChange('List[0].Inner', 'List[0]', 1)).toBe('List[1].Inner')
    expect(followListChange('List[1]', 'List[0]', 2)).toBe('List[0]')
    expect(followListChange('List[2]', 'List[0]', 2)).toBe('List[1]')
    expect(followListChange('List[0]', 'List[2]', 0)).toBe('List[1]')
    expect(followListChange('List[3]', 'List[2]', 0)).toBe('List[3]')
  })

  it('leaves other paths alone', () => {
    expect(followListChange('Other[1]', 'List[0]', null)).toBe('Other[1]')
    expect(followListChange('Lists[1]', 'List[0]', null)).toBe('Lists[1]')
    expect(followListChange('Group.B', 'Group.A', null)).toBe('Group.B')
    expect(followListChange('Group.A.Inner', 'Group.A', null)).toBeNull()
    expect(followListChange('Group.A', 'Group.A', 0)).toBe('Group.A')
  })
})
