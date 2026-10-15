import type { SubmodelSource } from '#shared/contract'
import { describe, expect, it } from 'vitest'
import { pendingAdditions } from '~~/app/utils/aas'

const empty = (idShort: string): SubmodelSource => ({ source: 'empty', idShort })

describe('retrying submodel additions', () => {
  it('adds only what earlier attempts did not', () => {
    const sources = [empty('A'), empty('B'), empty('C')]
    const first = pendingAdditions(sources, new Map())
    expect(first.map(entry => entry.source)).toEqual(sources)

    const written = new Map<string, SubmodelSource | null>([[first[0]!.key, null]])
    expect(pendingAdditions(sources, written).map(entry => entry.source)).toEqual([empty('B'), empty('C')])
    // Removing another entry keeps what was done.
    expect(pendingAdditions([empty('A'), empty('C')], written).map(entry => entry.source)).toEqual([empty('C')])
  })

  it('tells identical sources apart and only references a written submodel', () => {
    const sources = [empty('Same'), empty('Same')]
    const [one, two] = pendingAdditions(sources, new Map())
    expect(one!.key).not.toBe(two!.key)
    const written = new Map<string, SubmodelSource | null>([[one!.key, null], [two!.key, { source: 'existing', id: 'urn:sm:2' }]])
    expect(pendingAdditions(sources, written)).toEqual([{ key: two!.key, source: { source: 'existing', id: 'urn:sm:2' } }])
  })
})
