import type { EditableModelType, LangString, SubmodelSource, Target, TargetCapabilities } from '#shared/contract'
import { editableModelTypes } from '#shared/contract'

const modelTypeIcons: Record<string, string> = {
  Submodel: 'mdi-file-tree-outline',
  SubmodelElementCollection: 'mdi-folder-outline',
  SubmodelElementList: 'mdi-format-list-numbered',
  Property: 'mdi-tag-outline',
  MultiLanguageProperty: 'mdi-translate',
  Range: 'mdi-arrow-expand-horizontal',
  File: 'mdi-file-outline',
  Blob: 'mdi-file-code-outline',
  ReferenceElement: 'mdi-link-variant',
  RelationshipElement: 'mdi-relation-many-to-many',
  AnnotatedRelationshipElement: 'mdi-relation-many-to-many',
  Entity: 'mdi-cube-outline',
  Operation: 'mdi-cog-outline',
  OperationVariables: 'mdi-variable',
  Capability: 'mdi-lightning-bolt-outline',
  BasicEventElement: 'mdi-bell-outline',
}

export function modelTypeIcon (modelType: string): string {
  return modelTypeIcons[modelType] ?? 'mdi-shape-outline'
}

/** Picks the text for the UI language, falling back to English and then the first entry. */
export function langText (strings: LangString[], language = 'en'): string | null {
  const match = strings.find(entry => entry.language.toLowerCase().startsWith(language))
    ?? strings.find(entry => entry.language.toLowerCase().startsWith('en'))
    ?? strings[0]
  return match?.text ?? null
}

export const securityModeIcons: Record<string, string> = {
  unsecured: 'mdi-lock-open-variant-outline',
  deployment_client_credentials: 'mdi-shield-key-outline',
  delegated_user: 'mdi-account-key-outline',
}

/** Icon of a target: its security mode, or a package for local workspaces. */
export function targetIcon (target: Target): string {
  return target.securityMode ? securityModeIcons[target.securityMode]! : 'mdi-package-variant-closed'
}

/** The line under a target's name: its description, the package file, or `fallback`. */
export function targetSubtitle (target: Target, fallback: string): string {
  return target.description ?? target.workspace?.fileName ?? fallback
}

/** The optional features users notice, in display order; basic browsing is always there. */
export function targetFeatures (c: TargetCapabilities): Array<{ key: string, icon: string, on: boolean }> {
  return [
    { key: 'export', icon: 'mdi-download', on: c.export },
    { key: 'upload', icon: 'mdi-upload', on: c.upload },
    { key: 'search', icon: 'mdi-database-search-outline', on: c.search !== 'filter' },
    { key: 'elementSearch', icon: 'mdi-text-search', on: c.elementSearch },
    { key: 'discovery', icon: 'mdi-barcode-scan', on: c.discovery },
    { key: 'history', icon: 'mdi-history', on: c.history },
    { key: 'changeFeed', icon: 'mdi-timeline-clock-outline', on: c.changeFeed },
    { key: 'sharing', icon: 'mdi-account-multiple-plus-outline', on: c.sharing },
  ]
}

export function isEditableModelType (modelType: unknown): modelType is EditableModelType {
  return (editableModelTypes as readonly unknown[]).includes(modelType)
}

/** The resource key (base64url) of an AAS identifier or element path, as the Studio API uses it. */
export function resourceKey (value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte)
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

/** The AAS identifier behind a resource key (base64url), or `null` if malformed. */
export function decodeResourceKey (key: string): string | null {
  try {
    const base64 = key.replaceAll('-', '+').replaceAll('_', '/')
    const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, character => character.codePointAt(0)!))
  } catch {
    return null
  }
}

/**
 * Where a selected element is after the element at `changed` was moved to
 * index `to` of its list, or deleted (`to` is `null`). Both are idShort
 * paths; list items are addressed by index, so a selection behind them
 * shifts. Returns `null` if the selection was deleted with `changed`.
 */
export function followListChange (selected: string, changed: string, to: number | null): string | null {
  const item = /^(.+)\[(\d+)\]$/.exec(changed)
  if (!item) {
    const inside = selected === changed || selected.startsWith(`${changed}.`) || selected.startsWith(`${changed}[`)
    return to === null && inside ? null : selected
  }
  const list = item[1]!
  const from = Number(item[2])
  const sibling = selected.startsWith(`${list}[`) ? /^(\d+)\](.*)$/.exec(selected.slice(list.length + 1)) : null
  if (!sibling) {
    return selected
  }
  const current = Number(sibling[1])
  const rest = sibling[2]!
  if (current === from) {
    return to === null ? null : `${list}[${to}]${rest}`
  }
  const removed = current > from ? current - 1 : current
  const next = to !== null && removed >= to ? removed + 1 : removed
  return `${list}[${next}]${rest}`
}

/**
 * The submodel additions an attempt still has to make. `written` holds what
 * earlier attempts achieved, by key: `null` when done, or an `existing`
 * source for a submodel that was written but not referenced. A key is the
 * source as sent and its occurrence, so it survives changes to other entries.
 */
export function pendingAdditions (sources: SubmodelSource[], written: ReadonlyMap<string, SubmodelSource | null>): Array<{ key: string, source: SubmodelSource }> {
  const seen = new Map<string, number>()
  const pending: Array<{ key: string, source: SubmodelSource }> = []
  for (const source of sources) {
    const content = JSON.stringify(source)
    const occurrence = (seen.get(content) ?? 0) + 1
    seen.set(content, occurrence)
    const key = `${occurrence}:${content}`
    const done = written.get(key)
    if (done !== null) {
      pending.push({ key, source: done ?? source })
    }
  }
  return pending
}

/** Color and icon of a change event's action. */
export const changeMeta = {
  created: { color: 'success', icon: 'mdi-plus-circle-outline' },
  updated: { color: 'info', icon: 'mdi-pencil-circle-outline' },
  deleted: { color: 'error', icon: 'mdi-minus-circle-outline' },
} as const

/** Modes of the details drawer (MVP-4 plan, T2), as `mode` in the URL. */
export const detailsModes = ['details', 'visualization', 'json', 'xml', 'uml'] as const
export type DetailsMode = (typeof detailsModes)[number]
