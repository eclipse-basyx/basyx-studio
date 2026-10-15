import { describe, expect, it } from 'vitest'
import { searchRequestSchema } from '#shared/contract'
import { buildConceptDescriptionQuery, buildShellQuery, conceptDescriptionSearchFields, conceptDescriptionSource, formatFilter, matchesConceptDescription, matchesShell, parseSearch, withoutFilter } from '#shared/search/expression'

describe('search expressions', () => {
  it('splits text and filters as the Web UI does', () => {
    expect(parseSearch('motor idShort:Drive assetKind:Type -globalAssetId:urn:x specificAssetId="SN 1"')).toEqual({
      text: 'motor',
      filters: [
        { field: 'idShort', operator: 'contains', value: 'Drive' },
        // Fields with fixed values compare for equality.
        { field: 'assetKind', operator: 'equals', value: 'Type' },
        { field: 'globalAssetId', operator: 'not-equals', value: 'urn:x' },
        { field: 'specificAssetId', operator: 'equals', value: 'SN 1' },
      ],
      incompleteField: undefined,
    })
    expect(parseSearch('id!=a "quoted text"')).toMatchObject({ text: '"quoted text"', filters: [{ field: 'id', operator: 'not-equals', value: 'a' }] })
    expect(parseSearch('serial:42 idShort:')).toEqual({ text: 'serial:42', filters: [], incompleteField: 'idShort' })
    expect(parseSearch(String.raw`IDSHORT:"a \"b\""`).filters).toEqual([{ field: 'idShort', operator: 'contains', value: 'a "b"' }])
  })

  it('formats filters back and removes one', () => {
    const parsed = parseSearch('motor idShort:"Drive 1" assetKind=Type')
    expect(parsed.filters.map(filter => formatFilter(filter))).toEqual(['idShort:"Drive 1"', 'assetKind=Type'])
    expect(withoutFilter(parsed, 0)).toBe('motor assetKind=Type')
  })

  it('builds Query Language queries for the repository and the registry', () => {
    expect(buildShellQuery('repository', parseSearch(''))).toBeUndefined()
    expect(buildShellQuery('registry', parseSearch('a.b'))).toEqual({
      $condition: {
        $or: ['$aasdesc#id', '$aasdesc#idShort', '$aasdesc#globalAssetId', '$aasdesc#specificAssetIds[].value']
          .map(field => ({ $regex: [{ $field: field }, { $strVal: String.raw`(?i)a\.b` }] })),
      },
    })
    expect(buildShellQuery('repository', parseSearch('idShort:Drive -assetKind:Type'))).toEqual({
      $condition: {
        $and: [
          { $match: [{ $contains: [{ $field: '$aas#idShort' }, { $strVal: 'Drive' }] }] },
          { $not: { $match: [{ $eq: [{ $field: '$aas#assetInformation.assetKind' }, { $strVal: 'Type' }] }] } },
        ],
      },
    })
  })

  it('evaluates a search on shells without a query endpoint', () => {
    const shell = { id: 'urn:motor', idShort: 'Drive', assetInformation: { assetKind: 'Instance', specificAssetIds: [{ name: 'serial', value: 'SN-42' }] } }
    expect(matchesShell(shell, parseSearch('sn-42'))).toBe(true)
    expect(matchesShell(shell, parseSearch('drive assetKind=Instance'))).toBe(true)
    expect(matchesShell(shell, parseSearch('-assetKind:Instance'))).toBe(false)
    expect(matchesShell(shell, parseSearch('idShort:drive'))).toBe(false)
  })
})

describe('concept description search', () => {
  it('knows only the ID and idShort as fields', () => {
    expect(parseSearch('torque idShort:Max assetKind=Type', conceptDescriptionSearchFields)).toEqual({
      text: 'torque assetKind=Type',
      filters: [{ field: 'idShort', operator: 'contains', value: 'Max' }],
      incompleteField: undefined,
    })
  })

  it('builds a query on $cd#id and $cd#idShort', () => {
    const parsed = parseSearch('torque -id:urn:x', conceptDescriptionSearchFields)
    expect(buildShellQuery('conceptDescriptions', parsed)).toEqual({ $condition: { $and: [
      { $or: [
        { $regex: [{ $field: '$cd#id' }, { $strVal: '(?i)torque' }] },
        { $regex: [{ $field: '$cd#idShort' }, { $strVal: '(?i)torque' }] },
      ] },
      { $not: { $match: [{ $eq: [{ $field: '$cd#id' }, { $strVal: 'urn:x' }] }] } },
    ] } })
  })

  it('accepts raw queries for concept descriptions, but only text for elements', () => {
    const query = { $condition: { $eq: [{ $field: '$cd#idShort' }, { $strVal: 'Torque' }] } }
    expect(searchRequestSchema.safeParse({ scope: 'conceptDescriptions', query }).success).toBe(true)
    expect(searchRequestSchema.safeParse({ scope: 'elements', query }).success).toBe(false)
  })

  it('narrows to sources by the ID', () => {
    expect(conceptDescriptionSource('0173-1#02-AAB713#005')).toBe('ECLASS')
    expect(conceptDescriptionSource('0112/2///61987#ABA565#009')).toBe('IEC CDD')
    expect(conceptDescriptionSource('https://admin-shell.io/zvei/nameplate/2/0/Nameplate')).toBe('IDTA')
    expect(conceptDescriptionSource('urn:example:cd')).toBe('Other')
    expect(buildConceptDescriptionQuery({ expression: '' })).toBeUndefined()
    expect(buildConceptDescriptionQuery({ expression: 'torque' }, ['ECLASS'])).toEqual({ $condition: { $and: [
      { $or: [
        { $regex: [{ $field: '$cd#id' }, { $strVal: '(?i)torque' }] },
        { $regex: [{ $field: '$cd#idShort' }, { $strVal: '(?i)torque' }] },
      ] },
      { '$starts-with': [{ $field: '$cd#id' }, { $strVal: '0173-' }] },
    ] } })
    const other = buildConceptDescriptionQuery({ query: { $condition: { $boolean: true } } }, ['Other'])
    expect(other?.$condition).toMatchObject({ $and: [{ $boolean: true }, { $not: { $or: [{}, {}, {}] } }] })
  })

  it('matches concept descriptions as the query would', () => {
    const cd = { id: '0173-1#02-AAB713#005', idShort: 'MaxTorque' }
    expect(matchesConceptDescription(cd, parseSearch('maxtorque', conceptDescriptionSearchFields))).toBe(true)
    expect(matchesConceptDescription(cd, parseSearch('id:AAB713', conceptDescriptionSearchFields))).toBe(true)
    expect(matchesConceptDescription(cd, parseSearch('-idShort:Max', conceptDescriptionSearchFields))).toBe(true)
    expect(matchesConceptDescription(cd, parseSearch('idShort=Max', conceptDescriptionSearchFields))).toBe(false)
  })
})
