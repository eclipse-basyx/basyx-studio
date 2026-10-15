// The shell search of the BaSyx AAS Web UI (MVP-4 plan, S2): free text plus
// `field:value` (contains), `field=value` (equals), `field!=value` and
// `-field:value` (not), with quoted values. Shared by the UI, which shows the
// filters as chips, and the server, which turns them into AAS Query Language
// queries or, for AASX workspaces, evaluates them itself.

/** Where a shell query runs: the AAS repository (`/query/shells`) or the AAS registry (`/query/shell-descriptors`). */
export type ShellQueryTarget = 'repository' | 'registry'

/** Where a query runs: a shell target, or the concept description repository (`/query/concept-descriptions`). */
export type QueryTarget = ShellQueryTarget | 'conceptDescriptions'

export const searchFields = ['id', 'idShort', 'assetKind', 'assetType', 'globalAssetId', 'specificAssetId'] as const
export type SearchField = (typeof searchFields)[number]

/**
 * The fields of the concept description search (MVP-6 plan, S1): the AAS
 * Query Language knows only `$cd#id` and `$cd#idShort`.
 */
export const conceptDescriptionSearchFields: readonly SearchField[] = ['id', 'idShort']

export type SearchOperator = 'contains' | 'equals' | 'not-equals'

export interface SearchFilter {
  field: SearchField
  operator: SearchOperator
  value: string
}

export interface ParsedSearch {
  /** The free text, with filters removed and whitespace collapsed. */
  text: string
  filters: SearchFilter[]
  /** A field typed without a value yet, e.g. `idShort:`; it is not part of `filters`. */
  incompleteField?: SearchField
}

/** Fields with a fixed set of values; their filters compare for equality. */
export const searchFieldValues: Partial<Record<SearchField, readonly string[]>> = {
  assetKind: ['Instance', 'Type', 'Role', 'NotApplicable'],
}

/** The Query Language field of each search field, per target. */
const fieldPaths: Record<QueryTarget, Partial<Record<SearchField, string>>> = {
  repository: {
    id: '$aas#id',
    idShort: '$aas#idShort',
    assetKind: '$aas#assetInformation.assetKind',
    assetType: '$aas#assetInformation.assetType',
    globalAssetId: '$aas#assetInformation.globalAssetId',
    specificAssetId: '$aas#assetInformation.specificAssetIds[].value',
  },
  registry: {
    id: '$aasdesc#id',
    idShort: '$aasdesc#idShort',
    assetKind: '$aasdesc#assetKind',
    assetType: '$aasdesc#assetType',
    globalAssetId: '$aasdesc#globalAssetId',
    specificAssetId: '$aasdesc#specificAssetIds[].value',
  },
  conceptDescriptions: {
    id: '$cd#id',
    idShort: '$cd#idShort',
  },
}

/** Free text matches these fields, as in the Web UI (not the display name). */
const textFields: readonly SearchField[] = ['id', 'idShort', 'globalAssetId', 'specificAssetId']

/** The roots a raw query may use on each target. */
export const queryRoots: Record<QueryTarget, readonly string[]> = {
  repository: ['$aas'],
  registry: ['$aasdesc', '$smdesc'],
  conceptDescriptions: ['$cd'],
}

const tokenPattern = /(?:^|\s)(-?)([a-z][a-z0-9]*)(:|!=|=)(?:"((?:\\.|[^"])*)"|(\S*))/gi

/** Splits a search into free text and field filters; unknown field names stay text. */
export function parseSearch (expression: string, fields: readonly SearchField[] = searchFields): ParsedSearch {
  const filters: SearchFilter[] = []
  const text: string[] = []
  let incompleteField: SearchField | undefined
  let lastIndex = 0
  for (const match of expression.matchAll(tokenPattern)) {
    const field = fields.find(candidate => candidate.toLowerCase() === match[2]!.toLowerCase())
    if (!field) {
      continue
    }
    text.push(expression.slice(lastIndex, match.index))
    lastIndex = match.index + match[0].length
    const quoted = match[4]
    const value = quoted === undefined ? (match[5] ?? '') : quoted.replaceAll(/\\([\\"])/g, '$1')
    if (value.trim() === '' || (quoted === undefined && value.startsWith('"'))) {
      incompleteField = field
      continue
    }
    const operator: SearchOperator = match[1] === '-' || match[3] === '!='
      ? 'not-equals'
      : (match[3] === '=' || searchFieldValues[field] ? 'equals' : 'contains')
    filters.push({ field, operator, value })
  }
  text.push(expression.slice(lastIndex))
  return { text: text.join('').trim().replaceAll(/\s+/g, ' '), filters, incompleteField }
}

function quote (value: string): string {
  return /[\s"\\]/.test(value) ? `"${value.replaceAll(/[\\"]/g, String.raw`\$&`)}"` : value
}

/** A filter as typed in the search field, e.g. `assetKind=Type` or `idShort:"Motor 1"`. */
export function formatFilter (filter: SearchFilter): string {
  const separator = { 'contains': ':', 'equals': '=', 'not-equals': '!=' }[filter.operator]
  return `${filter.field}${separator}${quote(filter.value)}`
}

/** The search without one of its filters, for removing a chip. */
export function withoutFilter (parsed: ParsedSearch, index: number): string {
  return [parsed.text, ...parsed.filters.filter((_, position) => position !== index).map(filter => formatFilter(filter))]
    .filter(Boolean)
    .join(' ')
}

export function escapeRegex (value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}

type JsonCondition = Record<string, unknown>

function filterCondition (target: QueryTarget, filter: SearchFilter): JsonCondition {
  const operands = [{ $field: fieldPaths[target][filter.field]! }, { $strVal: filter.value }]
  return filter.operator === 'contains' ? { $contains: operands } : { $eq: operands }
}

/**
 * The AAS Query Language query of a search, built like the Web UI's: the text
 * as a case-insensitive regular expression over the text fields, positive
 * filters together in one `$match`, exclusions as `$not`. `undefined` for an
 * empty search.
 */
export function buildShellQuery (target: QueryTarget, parsed: ParsedSearch): { $condition: JsonCondition } | undefined {
  const conditions: JsonCondition[] = []
  if (parsed.text) {
    const pattern = `(?i)${escapeRegex(parsed.text)}`
    const paths = textFields.map(field => fieldPaths[target][field]).filter((path): path is string => path !== undefined)
    conditions.push({ $or: paths.map(path => ({ $regex: [{ $field: path }, { $strVal: pattern }] })) })
  }
  // Fields the target has no path for (a shell field on concept descriptions) are left out.
  const usable = parsed.filters.filter(filter => fieldPaths[target][filter.field] !== undefined)
  const positive = usable.filter(filter => filter.operator !== 'not-equals')
  if (positive.length > 0) {
    conditions.push({ $match: positive.map(filter => filterCondition(target, filter)) })
  }
  for (const filter of usable.filter(filter => filter.operator === 'not-equals')) {
    conditions.push({ $not: { $match: [filterCondition(target, filter)] } })
  }
  if (conditions.length === 0) {
    return undefined
  }
  return { $condition: conditions.length === 1 ? conditions[0]! : { $and: conditions } }
}

type Json = Record<string, unknown>
const strings = (value: unknown): string[] => (typeof value === 'string' ? [value] : [])
const assetOf = (shell: Json) => (shell.assetInformation ?? {}) as Json

/** The values of each search field on a shell (AAS JSON), for searching without a query endpoint. */
const shellValues: Record<SearchField, (shell: Json) => string[]> = {
  id: shell => strings(shell.id),
  idShort: shell => strings(shell.idShort),
  assetKind: shell => strings(assetOf(shell).assetKind),
  assetType: shell => strings(assetOf(shell).assetType),
  globalAssetId: shell => strings(assetOf(shell).globalAssetId),
  specificAssetId: shell => {
    const ids = assetOf(shell).specificAssetIds
    return Array.isArray(ids) ? ids.flatMap(entry => strings((entry as Json | null)?.value)) : []
  },
}

/** Whether a shell (AAS JSON) matches a search with the semantics of the query built for it. */
export function matchesShell (shell: Json, parsed: ParsedSearch): boolean {
  const needle = parsed.text.toLowerCase()
  if (needle && !textFields.some(field => shellValues[field](shell).some(value => value.toLowerCase().includes(needle)))) {
    return false
  }
  return parsed.filters.every(filter => {
    const values = shellValues[filter.field](shell)
    const found = filter.operator === 'contains'
      ? values.some(value => value.includes(filter.value))
      : values.includes(filter.value)
    return filter.operator === 'not-equals' ? !found : found
  })
}

/**
 * Whether a concept description (AAS JSON) matches a search, as the query
 * built for it would: free text over the ID and idShort, filters on them.
 * For AASX workspaces, which have no query endpoint.
 */
export function matchesConceptDescription (cd: Json, parsed: ParsedSearch): boolean {
  const values = (field: SearchField) => (field === 'id' ? strings(cd.id) : (field === 'idShort' ? strings(cd.idShort) : []))
  const needle = parsed.text.toLowerCase()
  if (needle && !conceptDescriptionSearchFields.some(field => values(field).some(value => value.toLowerCase().includes(needle)))) {
    return false
  }
  return parsed.filters.every(filter => {
    const found = filter.operator === 'contains'
      ? values(filter.field).some(value => value.includes(filter.value))
      : values(filter.field).includes(filter.value)
    return filter.operator === 'not-equals' ? !found : found
  })
}

/** Where a concept description comes from, by its ID (MVP-6 plan, S1): the filter of the Concepts page. */
export const conceptDescriptionSources = ['ECLASS', 'IEC CDD', 'IDTA', 'Other'] as const
export type ConceptDescriptionSource = (typeof conceptDescriptionSources)[number]

/** ECLASS IRDIs start with 0173-, the IEC Common Data Dictionary's with 0112/; IDTA templates live under admin-shell.io. */
export function conceptDescriptionSource (id: string): ConceptDescriptionSource {
  if (id.startsWith('0173-')) {
    return 'ECLASS'
  }
  if (id.startsWith('0112/')) {
    return 'IEC CDD'
  }
  return id.includes('admin-shell.io') ? 'IDTA' : 'Other'
}

const sourceConditions: Record<Exclude<ConceptDescriptionSource, 'Other'>, JsonCondition> = {
  'ECLASS': { '$starts-with': [{ $field: '$cd#id' }, { $strVal: '0173-' }] },
  'IEC CDD': { '$starts-with': [{ $field: '$cd#id' }, { $strVal: '0112/' }] },
  'IDTA': { $contains: [{ $field: '$cd#id' }, { $strVal: 'admin-shell.io' }] },
}

/** The condition that a concept description comes from one of `sources`, as `conceptDescriptionSource` decides. */
function sourceCondition (sources: readonly ConceptDescriptionSource[]): JsonCondition {
  const known = Object.values(sourceConditions)
  const conditions = sources.map(source => source === 'Other' ? { $not: { $or: known } } : sourceConditions[source])
  return conditions.length === 1 ? conditions[0]! : { $or: conditions }
}

/**
 * The query of a concept description search: the search field's expression
 * or a raw query, narrowed to the chosen sources. `undefined` matches all.
 */
export function buildConceptDescriptionQuery (search: { expression: string } | { query: Record<string, unknown> }, sources: readonly ConceptDescriptionSource[] = []): { $condition: JsonCondition } | undefined {
  const base = 'query' in search
    ? (search.query.$condition as JsonCondition | undefined)
    : buildShellQuery('conceptDescriptions', parseSearch(search.expression, conceptDescriptionSearchFields))?.$condition
  const conditions = [...(base ? [base] : []), ...(sources.length > 0 ? [sourceCondition(sources)] : [])]
  if (conditions.length === 0) {
    return undefined
  }
  return { $condition: conditions.length === 1 ? conditions[0]! : { $and: conditions } }
}
