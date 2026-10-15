// Identifier generation (MVP-5 plan, W5). The scheme is set per
// infrastructure; users may replace a generated ID per resource.

export type IdKind = 'aas' | 'sm' | 'asset' | 'cd'

export interface IdScheme {
  /** `iri`: `<prefix><kind>/<uuid>`; `uuid`: `urn:uuid:<uuid>`. */
  type: 'iri' | 'uuid'
  prefix: string
}

export const defaultIdScheme: IdScheme = { type: 'iri', prefix: 'https://example.com/ids/' }

/** Workspaces have no infrastructure to name a scheme. */
export const workspaceIdScheme: IdScheme = { type: 'uuid', prefix: '' }

export function generateId (kind: IdKind, scheme: IdScheme = defaultIdScheme): string {
  const uuid = globalThis.crypto.randomUUID()
  if (scheme.type === 'uuid') {
    return `urn:uuid:${uuid}`
  }
  const prefix = scheme.prefix.endsWith('/') || scheme.prefix.endsWith('#') || scheme.prefix.endsWith(':') ? scheme.prefix : `${scheme.prefix}/`
  return `${prefix}${kind}/${uuid}`
}
