import { createHash } from 'node:crypto'
import { StudioProblem } from '../problem'

/**
 * Studio revision tokens are opaque to the UI. `h.<hash>` is the hash of an
 * element as read: a write compares it with the element's current content
 * before changing it. Live targets add the downstream ETag check for the
 * write itself; workspaces check and write in one step.
 */
export interface RevisionToken {
  hash: string
}

const hashPattern = /^[\w-]{43}$/

/** Key-order independent JSON, so equal content always hashes equally. */
function canonical (value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(item => canonical(item)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .toSorted(([a], [b]) => (a < b ? -1 : (a > b ? 1 : 0)))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function contentHash (value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('base64url')
}

export function revisionOf (value: unknown): string {
  return `h.${contentHash(value)}`
}

/** Parses an `If-Match` value as sent by the UI (quoted or bare). */
export function parseRevision (value: string | undefined): RevisionToken {
  if (!value) {
    throw new StudioProblem('precondition_required')
  }
  const text = value.trim().replace(/^"(.*)"$/, '$1')
  const [kind, hash, ...rest] = text.split('.')
  if (kind === 'h' && hash && rest.length === 0 && hashPattern.test(hash)) {
    return { hash }
  }
  throw new StudioProblem('invalid_request', 'Malformed revision.')
}

/**
 * The structure revision of a parent (`s.<hash>`): a hash of its children's
 * idShorts, model types and order, not of their values, so a value edit
 * elsewhere never blocks adding or moving an element (MVP-5 plan, W2).
 * List items have no idShort and share one model type, so their content
 * stands in for their identity: reordering a list changes its revision.
 */
export function structureRevisionOf (children: unknown[]): string {
  const outline = children.map(child => {
    const element = (child ?? {}) as Record<string, unknown>
    return typeof element.idShort === 'string'
      ? [element.idShort, element.modelType ?? null]
      : [null, element.modelType ?? null, contentHash(element)]
  })
  return `s.${contentHash(outline)}`
}

/** Parses an `If-Match` structure revision as sent by the UI (quoted or bare). */
export function parseStructureRevision (value: string | undefined): string {
  if (!value) {
    throw new StudioProblem('precondition_required')
  }
  const text = value.trim().replace(/^"(.*)"$/, '$1')
  if (!/^s\.[\w-]{43}$/.test(text)) {
    throw new StudioProblem('invalid_request', 'Malformed structure revision.')
  }
  return text
}
