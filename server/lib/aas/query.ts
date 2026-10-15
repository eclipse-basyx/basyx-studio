import type { QueryTarget } from '#shared/search/expression'
import type { JsonObject } from './outline'
import type { ErrorObject } from 'ajv'
import type { Query } from 'basyx-typescript-sdk'
import Ajv from 'ajv'
import { Lib } from 'basyx-typescript-sdk'
import { queryRoots } from '#shared/search/expression'
// The JSON Schema of the AAS Query Language from IDTA-01002-3 ("Specification
// of the Asset Administration Shell, Part 2: API"),
// documentation/IDTA-01002-3/modules/ROOT/partials/query-json-schema.json in
// https://github.com/admin-shell-io/aas-specs-api at f136ba1, © IDTA, licensed
// under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Unchanged.
import querySchema from '#shared/search/query-schema.json'
import { StudioProblem } from '../problem'

/** Raw queries larger than this are refused before they are parsed further. */
export const maxQueryBytes = 64 * 1024

const ajv = new Ajv({ allErrors: true, strict: false })
ajv.addSchema(querySchema, 'aas-query')
const validateQuery = ajv.compile({ $ref: 'aas-query#/definitions/Query' })

interface Finding {
  path: string
  message: string
}

/** The `$field` and `$fragment` strings anywhere in a query. */
function fieldsOf (value: unknown, path = ''): Array<{ path: string, field: string }> {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => fieldsOf(item, `${path}/${index}`))
  }
  if (!value || typeof value !== 'object') {
    return []
  }
  return Object.entries(value).flatMap(([key, item]) => (key === '$field' || key === '$fragment') && typeof item === 'string'
    ? [{ path: `${path}/${key}`, field: item }]
    : fieldsOf(item, `${path}/${key}`))
}

function isUnderRoot (field: string, roots: readonly string[]): boolean {
  return roots.some(root => field === root || ['#', '.', '('].some(separator => field.startsWith(`${root}${separator}`)))
}

function schemaFinding (error: ErrorObject): Finding {
  return { path: error.instancePath || '/', message: error.message ?? 'invalid' }
}

/**
 * Checks a query from the advanced search dialog (MVP-4 plan, S2): its size,
 * the IDTA query schema, no `$select` (Studio needs complete objects for its
 * rows) and only the roots of the endpoint it runs on. Fails with
 * `query_invalid` and readable findings.
 */
export function checkRawQuery (raw: unknown, target: QueryTarget): JsonObject {
  if (JSON.stringify(raw ?? null).length > maxQueryBytes) {
    throw new StudioProblem('query_invalid', `The query is larger than ${maxQueryBytes / 1024} KiB.`)
  }
  const findings: Finding[] = []
  if (!validateQuery(raw)) {
    // Schema errors of `oneOf` branches repeat; one per path is enough.
    const seen = new Set<string>()
    for (const finding of (validateQuery.errors ?? []).map(error => schemaFinding(error))) {
      if (!seen.has(finding.path)) {
        seen.add(finding.path)
        findings.push(finding)
      }
    }
  }
  const query = (raw ?? {}) as JsonObject
  if (typeof query === 'object' && '$select' in query) {
    findings.push({ path: '/$select', message: 'is not supported here: the list needs complete objects' })
  }
  for (const { path, field } of fieldsOf(raw)) {
    if (!isUnderRoot(field, queryRoots[target])) {
      findings.push({ path, message: `${field} is not available here; use ${queryRoots[target].join(' or ')}` })
    }
  }
  if (findings.length > 0) {
    throw new StudioProblem('query_invalid', 'The query is not valid for this target.', { violations: findings.slice(0, 20) })
  }
  return query
}

/** The SDK's model of a query that passed `checkRawQuery` or was built by Studio. */
export function toSdkQuery (json: JsonObject): Query {
  const result = Lib.queryFromJsonable(json as Parameters<typeof Lib.queryFromJsonable>[0])
  if (result.error !== null) {
    throw new StudioProblem('query_invalid', `The query could not be read: ${result.error.message}`)
  }
  return result.mustValue()
}
