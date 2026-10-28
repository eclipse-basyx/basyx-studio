import type { JsonObject } from '@basyx/studio-sdk'

// Reading AAS JSON in the apps shipped with Studio. Without Vue or Vuetify,
// so it can be unit-tested and used outside a mounted app.

export interface Node {
  element: JsonObject
  /** idShortPath from the submodel, e.g. `Documents[0].DigitalFiles[0]`. */
  path: string
}

function objects (value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter((item): item is JsonObject => typeof item === 'object' && item !== null) : []
}

/** The children of a submodel or element, with their idShortPaths. */
export function childrenOf (node: Node | JsonObject): Node[] {
  const isNode = 'element' in node && 'path' in node
  const element = isNode ? (node as Node).element : node as JsonObject
  const base = isNode ? (node as Node).path : ''
  const join = (idShort: string) => (base ? `${base}.${idShort}` : idShort)
  if (element.modelType === 'SubmodelElementList') {
    return objects(element.value).map((child, index) => ({ element: child, path: `${base}[${index}]` }))
  }
  const items = element.modelType === 'Submodel'
    ? element.submodelElements
    : (element.modelType === 'Entity' ? element.statements : element.value)
  if (!['Submodel', 'SubmodelElementCollection', 'Entity'].includes(String(element.modelType))) {
    return []
  }
  return objects(items).map(child => ({ element: child, path: join(String(child.idShort)) }))
}

/** A child by idShort, ignoring case and a trailing number (`Document01` matches `Document`). */
export function child (node: Node | JsonObject | undefined, idShort: string): Node | undefined {
  if (!node) {
    return undefined
  }
  const wanted = idShort.toLowerCase()
  return childrenOf(node).find(entry => String(entry.element.idShort ?? '').toLowerCase().replace(/\d+$/, '') === wanted)
}

/** A localized AAS text for the locale, falling back to English and then the first entry. */
export function langText (value: unknown, locale: string): string {
  if (!Array.isArray(value)) {
    return typeof value === 'string' ? value : ''
  }
  const strings = value as Array<{ language: string, text: string }>
  const language = locale.split('-', 1)[0]!
  return (strings.find(entry => entry.language.startsWith(language)) ?? strings.find(entry => entry.language.startsWith('en')) ?? strings[0])?.text ?? ''
}

/** The display text of a Property, MultiLanguageProperty or File. */
export function textOf (node: Node | undefined, locale: string): string {
  return node ? langText(node.element.value, locale) : ''
}

/** `SerialNumber` → `Serial number`. */
export function humanize (idShort: string): string {
  const words = idShort.replaceAll(/([a-z\d])([A-Z])/g, '$1 $2').replaceAll(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
  return words.charAt(0) + words.slice(1).toLowerCase()
}

// Finding the elements of a submodel template across its versions (app API
// 0.1.14): by idShort, also numbered (`Phone01`, `Marking__00__`,
// `Language{00}`), by the last segment of a URL semantic ID, or by the
// concept of an IRDI semantic ID in any version and spelling.

export interface LangString {
  language: string
  text: string
}

/** The value of the first key of an element's semantic ID; empty without one. */
export function semanticIdOf (element: JsonObject): string {
  const keys = (element.semanticId as { keys?: Array<{ value?: unknown }> } | undefined)?.keys ?? []
  return typeof keys[0]?.value === 'string' ? keys[0].value.trim() : ''
}

/** An ECLASS IRDI in either spelling: `0173-1#02-AAO128#002` or `0173-1-02-AAO128-002` (in an `api.eclass-cdp.com` URL). */
const eclassIrdi = /(\d{4}-\d)[#-](\d{2})[#-]([A-Z]{2}[A-Z\d]\d{3})/
/** An IEC CDD IRDI: `0112/2///61987#ABA565#009`, `0112/2///61360_7#AAS011#001`. */
const iecIrdi = /(\d{4}\/\d)\/{3}([\d_]+)#([A-Z]{3}\d{3})/

/**
 * What a semantic ID means, without its version, to compare elements across
 * template versions: `0173-1#02-AAO128#002` and
 * `https://api.eclass-cdp.com/0173-1-02-AAO128-003` → `0173-1#02-AAO128`;
 * `0112/2///61987#ABA565#009` → `0112/2///61987#ABA565`; the first IRDI of a
 * composite one (`0173-1#02-ABI218#003/0173-1#01-AGZ672#004`); other IDs
 * in lower case, without a trailing slash.
 */
export function conceptOf (semanticId: string): string {
  const eclass = eclassIrdi.exec(semanticId)
  if (eclass) {
    return `${eclass[1]}#${eclass[2]}-${eclass[3]}`
  }
  const iec = iecIrdi.exec(semanticId)
  if (iec) {
    return `${iec[1]}///${iec[2]}#${iec[3]}`
  }
  return semanticId.trim().replace(/\/+$/, '').toLowerCase()
}

/** Which elements of a template are meant, whatever their version calls them. */
export interface ElementSpec {
  /** idShorts without a number: `Phone` matches `Phone`, `Phone01`, `Phone__00__` and `Phone{00}`. */
  names: string[]
  /** Semantic IDs, in any version: compared by `conceptOf`. */
  semanticIds?: string[]
}

/** An idShort without its number, in lower case: `Marking__00__` → `marking`. */
function baseName (idShort: unknown): string {
  return String(idShort ?? '').replace(/(?:__\d+__|\{\d+\}|\d+)$/, '').toLowerCase()
}

/** The name a URL semantic ID gives its element: `…/ContactInformation/Phone` → `phone`. */
function semanticName (semanticId: string): string {
  return /^https?:\/\//i.test(semanticId) ? semanticId.replace(/\/+$/, '').split('/').pop()?.trim().toLowerCase() ?? '' : ''
}

/** Whether an element has one of a spec's names: as idShort, or as the last segment of a URL semantic ID. */
export function hasSpecName (element: JsonObject, spec: ElementSpec): boolean {
  const names = new Set(spec.names.map(name => name.toLowerCase()))
  const semanticId = semanticIdOf(element)
  return names.has(baseName(element.idShort)) || (semanticId !== '' && names.has(semanticName(semanticId)))
}

/** Whether an element is one of those a spec names. */
export function matchesSpec (element: JsonObject, spec: ElementSpec): boolean {
  if (hasSpecName(element, spec)) {
    return true
  }
  const semanticId = semanticIdOf(element)
  const concept = semanticId === '' ? '' : conceptOf(semanticId)
  return concept !== '' && (spec.semanticIds ?? []).some(id => conceptOf(id) === concept)
}

/**
 * The children of a submodel or element that a spec names, by name or by
 * semantic ID, in their order: every entry of a repeated element, e.g.
 * `MarkingAdditionalText01` and a `SafetyNotice` with its semantic ID.
 */
export function childrenMatching (node: Node | JsonObject | undefined, spec: ElementSpec): Node[] {
  return (node ? childrenOf(node) : []).filter(entry => matchesSpec(entry.element, spec))
}

/**
 * The child that a spec names: the first with its name, else the first with
 * its semantic ID, so that a semantic ID given to the wrong element does not
 * hide the element of that name.
 */
export function childMatching (node: Node | JsonObject | undefined, spec: ElementSpec): Node | undefined {
  const matches = childrenMatching(node, spec)
  return matches.find(entry => hasSpecName(entry.element, spec)) ?? matches[0]
}

/** A Property or MultiLanguageProperty as text, with what changing it needs. */
export interface TextField {
  /** The idShortPath, for `aas.getElement` and `aas.setElementValue`. */
  path: string
  modelType: 'Property' | 'MultiLanguageProperty'
  /** The texts of a MultiLanguageProperty; a Property's value as one text without language. */
  values: LangString[]
  /** The first key of the element's `valueId`, e.g. a value list entry; empty without one. */
  valueId: string
}

/** A Property or MultiLanguageProperty as a `TextField`; `undefined` for other elements. */
export function textFieldOf (node: Node | undefined): TextField | undefined {
  const element = node?.element
  if (!node || !element || (element.modelType !== 'Property' && element.modelType !== 'MultiLanguageProperty')) {
    return undefined
  }
  const keys = (element.valueId as { keys?: Array<{ value?: unknown }> } | undefined)?.keys ?? []
  const valueId = typeof keys[0]?.value === 'string' ? keys[0].value : ''
  if (element.modelType === 'Property') {
    const value = element.value
    const text = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value).trim() : ''
    return { path: node.path, modelType: 'Property', values: text === '' ? [] : [{ language: '', text }], valueId }
  }
  const values = (Array.isArray(element.value) ? element.value as unknown[] : [])
    .filter((entry): entry is LangString => typeof (entry as LangString)?.text === 'string' && (entry as LangString).text.trim() !== '')
    .map(entry => ({ language: String(entry.language ?? ''), text: entry.text.trim() }))
  return { path: node.path, modelType: 'MultiLanguageProperty', values, valueId }
}

/** A field's text for the locale: its language, else English, else the first. */
export function fieldText (field: TextField | undefined, locale: string): string {
  return field ? langText(field.values, locale) : ''
}

/** A Range's bounds as text, with what changing them needs (app kit `./editing`). */
export interface RangeField {
  /** The idShortPath, for `aas.getElement` and `aas.putElement`. */
  path: string
  modelType: 'Range'
  /** The lower bound; empty when open. */
  min: string
  /** The upper bound; empty when open. */
  max: string
  /** E.g. `xs:double`. */
  valueType: string
}

/** What can be changed in place: a Property's or MultiLanguageProperty's value, or a Range's bounds. */
export type EditableField = TextField | RangeField

function boundText (value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
}

/** A Range as a `RangeField`; `undefined` for other elements. */
export function rangeFieldOf (node: Node | undefined): RangeField | undefined {
  const element = node?.element
  if (!node || element?.modelType !== 'Range') {
    return undefined
  }
  return { path: node.path, modelType: 'Range', min: boundText(element.min), max: boundText(element.max), valueType: String(element.valueType ?? '') }
}

/** A File element: its idShortPath (for `ui.readFile` and `ui.previewFile`), media type and value. */
export interface FileRef {
  path: string
  contentType: string
  value: string
  /** The file name, from the value's last segment. */
  name: string
  /** The value is an http(s) address at another host. */
  external: boolean
}

/** A File element with a value as a `FileRef`; `null` for other elements and empty Files. */
export function fileRef (node: Node | undefined): FileRef | null {
  const value = node?.element.value
  const text = typeof value === 'string' ? value.trim() : ''
  if (!node || node.element.modelType !== 'File' || text === '') {
    return null
  }
  const external = /^https?:\/\//i.test(text)
  const segment = (external ? URL.parse(text)?.pathname ?? text : text).split('/').pop() ?? ''
  let name = segment
  try {
    name = decodeURIComponent(segment)
  } catch {
    // Not percent-encoded: as it is.
  }
  return { path: node.path, contentType: String(node.element.contentType ?? '').trim(), value: text, name, external }
}
