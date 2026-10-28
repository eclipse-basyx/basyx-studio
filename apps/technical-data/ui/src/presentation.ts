import type { Classification, GeneralFieldKey, SheetArea, SheetNode, TechnicalData } from './technicalData'
import type { EditableField, FileRef, LangString } from '@basyx/studio-app-kit/aas'
import type { Translate } from '@basyx/studio-app-kit/i18n'
import type { ConceptInfo } from '@basyx/studio-sdk'
import { fieldText, humanize, langText } from '@basyx/studio-app-kit/aas'

// What the view shows of the technical data: the product at a glance, label
// and value rows for the general and further information, and the data
// sheets of the property areas as rows of a table, with units, readable
// names and definitions from the target's concept descriptions. In edit
// mode, every element with a value is a row, empty ones too, so that each
// can be changed.

export interface DetailRow {
  key: string
  label: string
  value: string
  icon?: string
  /** An https URL the value opens. */
  url?: string
  /** The text a copy button copies. */
  copy?: string
  /** The field the row changes in edit mode. */
  field?: EditableField
}

export interface SheetRow {
  key: string
  kind: 'section' | 'value'
  /** How deep the row lies in its area: 0 for the area's own elements. */
  depth: number
  label: string
  /** The element's own description; empty without one. */
  description: string
  /** What the concept description defines it as; empty without one. */
  definition: string
  value: string
  unit: string
  field?: EditableField
  file?: FileRef
  /** The keys of the sections the row lies in, outermost first. */
  sections: string[]
  /** Everything search looks at, in lower case: label, idShort, value, unit and the sections' labels. */
  haystack: string
}

/** The concept descriptions `aas.describeConcepts` found, by ID. */
export type Concepts = ReadonlyMap<string, ConceptInfo>

const eclassIrdi = /^(\d{4}-\d)#(\d{2})-([A-Z\d]{6})#(\d{3})$/
const eclassUrl = /^https:\/\/api\.eclass-cdp\.com\/(\d{4}-\d)-(\d{2})-([A-Z\d]{6})-(\d{3})$/i

/** An ID and its other spelling: ECLASS IRDIs also as `api.eclass-cdp.com` URLs, and back. */
export function conceptSpellings (id: string): string[] {
  const irdi = eclassIrdi.exec(id)
  if (irdi) {
    return [id, `https://api.eclass-cdp.com/${irdi[1]}-${irdi[2]}-${irdi[3]}-${irdi[4]}`]
  }
  const url = eclassUrl.exec(id)
  return url ? [id, `${url[1]}#${url[2]}-${url[3]!.toUpperCase()}#${url[4]}`] : [id]
}

/** The IDs to ask `aas.describeConcepts` for: each in both spellings, once. */
export function conceptQuery (ids: string[]): string[] {
  return [...new Set(ids.flatMap(id => conceptSpellings(id)))]
}

/** The answer of `aas.describeConcepts`, by ID. */
export function conceptMap (concepts: Array<ConceptInfo | null>): Concepts {
  return new Map(concepts.filter((concept): concept is ConceptInfo => concept !== null).map(concept => [concept.id, concept]))
}

/** The concept of an element: of its semantic ID first, then of the supplemental ones, in either spelling. */
export function conceptOf (node: { conceptIds: string[] }, concepts: Concepts): ConceptInfo | undefined {
  for (const id of node.conceptIds) {
    for (const spelling of conceptSpellings(id)) {
      const concept = concepts.get(spelling)
      if (concept) {
        return concept
      }
    }
  }
  return undefined
}

interface Named {
  idShort: string
  displayName: LangString[]
  description: LangString[]
  conceptIds: string[]
}

/** An element's label: its display name, else its concept's preferred name, else its idShort; `fallback` without any. */
export function labelOf (node: Named, concepts: Concepts, locale: string, fallback = ''): string {
  return langText(node.displayName, locale)
    || langText(conceptOf(node, concepts)?.preferredName ?? [], locale)
    || (node.idShort ? humanize(node.idShort) : fallback)
}

/** What an element's concept description defines it as. */
export function definitionOf (node: Named, concepts: Concepts, locale: string): string {
  return langText(conceptOf(node, concepts)?.definition ?? [], locale)
}

/** What the element's own description says, unless it only repeats the label. */
export function descriptionOf (node: Named, label: string, locale: string): string {
  const description = langText(node.description, locale)
  return description.toLowerCase() === label.toLowerCase() ? '' : description
}

const numericTypes = new Set(['xs:double', 'xs:float', 'xs:decimal', 'xs:int', 'xs:integer', 'xs:long', 'xs:short', 'xs:byte',
  'xs:unsignedInt', 'xs:unsignedLong', 'xs:unsignedShort', 'xs:unsignedByte', 'xs:positiveInteger', 'xs:negativeInteger',
  'xs:nonNegativeInteger', 'xs:nonPositiveInteger'])

/**
 * A number in the user's format, with the decimals and digits it was given:
 * `3.0` → "3,0" in German, `9007199254740993` → "9,007,199,254,740,993";
 * other values as they are.
 */
export function numberText (value: string, locale: string): string {
  const match = /^[+-]?\d+(?:\.(\d+))?$/.exec(value.trim())
  if (!match) {
    return value
  }
  const decimals = match[1]?.length ?? 0
  try {
    // The decimal string itself, not a Number: an xs:long or xs:decimal keeps every digit.
    const text = new Intl.NumberFormat([locale, 'en'], { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: 'min2' }).format(value.trim() as `${number}`)
    // Where the engine rounded, or dropped leading zeros, the value as stored.
    const digits = (number: string) => number.replaceAll(/\D/g, '')
    return digits(text) === digits(value) ? text : value
  } catch {
    return value
  }
}

/** A date (`YYYY-MM-DD`) or date and time in the user's format; other values as they are. */
export function dateText (value: string, locale: string): string {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  try {
    if (date) {
      const parsed = new Date(Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3])))
      // A day that does not exist, such as month 13, as it is: Date would roll it over.
      return parsed.toISOString().slice(0, 10) === value.trim() ? new Intl.DateTimeFormat([locale, 'en'], { dateStyle: 'medium', timeZone: 'UTC' }).format(parsed) : value
    }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value.trim())) {
      const parsed = new Date(value.trim())
      return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat([locale, 'en'], { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
    }
  } catch {
    // An unknown locale: as it is.
  }
  return value
}

/** A value by its type: numbers and dates in the user's format, booleans as yes or no. */
export function typedText (t: Translate, value: string, valueType: string, locale: string): string {
  if (value === '') {
    return ''
  }
  if (numericTypes.has(valueType)) {
    return numberText(value, locale)
  }
  if (valueType === 'xs:boolean' && ['true', 'false', '1', '0'].includes(value)) {
    return t(value === 'true' || value === '1' ? 'value.yes' : 'value.no')
  }
  if (valueType === 'xs:date' || valueType === 'xs:dateTime') {
    return dateText(value, locale)
  }
  return value
}

/** A Range: "min – max", or "≥ min" / "≤ max" when one end is open. */
export function rangeText (min: string, max: string): string {
  if (min && max) {
    return `${min} – ${max}`
  }
  if (min) {
    return `≥ ${min}`
  }
  return max ? `≤ ${max}` : ''
}

/** A field's value as the view shows it. */
export function fieldValue (t: Translate, field: EditableField | undefined, valueType: string, locale: string): string {
  if (!field) {
    return ''
  }
  if (field.modelType === 'Range') {
    return rangeText(typedText(t, field.min, field.valueType, locale), typedText(t, field.max, field.valueType, locale))
  }
  return field.modelType === 'Property' ? typedText(t, fieldText(field, locale), valueType, locale) : fieldText(field, locale)
}

function valueOf (t: Translate, node: Extract<SheetNode, { kind: 'value' }>, locale: string): string {
  if (node.field) {
    return fieldValue(t, node.field, node.valueType, locale)
  }
  return node.file?.name ?? node.text
}

/**
 * An area's data sheet as table rows, depth first: a row per section, above
 * its elements, and a row per value with its unit, description and the
 * concept's definition. Without values, a
 * section has no row, except in edit mode, where every value is a row.
 */
export function sheetRows (t: Translate, area: SheetArea, concepts: Concepts, locale: string, edit: boolean): SheetRow[] {
  const rows: SheetRow[] = []
  const visit = (nodes: SheetNode[], depth: number, sections: Array<{ key: string, label: string }>) => {
    for (const [index, node] of nodes.entries()) {
      const label = labelOf(node, concepts, locale, t('sheet.entry', { number: index + 1 }))
      const definition = definitionOf(node, concepts, locale)
      const description = descriptionOf(node, label, locale)
      if (node.kind === 'section') {
        const at = rows.length
        visit(node.children, depth + 1, [...sections, { key: node.path, label }])
        if (rows.length > at) {
          rows.splice(at, 0, {
            key: node.path,
            kind: 'section',
            depth,
            label,
            description,
            definition,
            value: '',
            unit: '',
            sections: sections.map(section => section.key),
            haystack: [label, node.idShort, description, definition, ...sections.map(section => section.label)].join(' ').toLowerCase(),
          })
        }
        continue
      }
      const value = valueOf(t, node, locale)
      if (!edit && value === '') {
        continue
      }
      const unit = value === '' ? '' : (conceptOf(node, concepts)?.unit ?? '')
      rows.push({
        key: node.path,
        kind: 'value',
        depth,
        label,
        description,
        definition,
        value,
        unit,
        field: node.field,
        file: node.file ?? undefined,
        sections: sections.map(section => section.key),
        haystack: [label, node.idShort, value, unit, description, definition, ...sections.map(section => section.label)].join(' ').toLowerCase(),
      })
    }
  }
  visit(area.children, 0, [])
  return rows
}

/** A value with its unit, kept on one line: "3.0 kW". */
export function valueWithUnit (row: Pick<SheetRow, 'value' | 'unit'>): string {
  return row.unit ? `${row.value}\u00A0${row.unit}` : row.value
}

/**
 * An area's rows without those below a collapsed section; none at all where
 * the area itself (`area`, its path) is collapsed.
 */
export function visibleRows (rows: SheetRow[], collapsed: ReadonlySet<string>, area = ''): SheetRow[] {
  if (collapsed.size === 0) {
    return rows
  }
  return collapsed.has(area) ? [] : rows.filter(row => !row.sections.some(section => collapsed.has(section)))
}

/**
 * The rows that match every word of a search, with the sections they lie in;
 * all rows for an empty search. A section's label matches its elements.
 */
export function filterRows (rows: SheetRow[], query: string): SheetRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(word => word !== '')
  if (words.length === 0) {
    return rows
  }
  const matches = rows.filter(row => row.kind === 'value' && words.every(word => row.haystack.includes(word)))
  const sections = new Set(matches.flatMap(row => row.sections))
  return rows.filter(row => (row.kind === 'section' ? sections.has(row.key) : matches.includes(row)))
}

/** An area's title: its label, else "Area n". */
/**
 * The titles of areas: each one's label, else `fallback` with its number;
 * a title several areas share, such as their concept's "Technical property
 * area", is numbered.
 */
export function areaTitles (areas: SheetArea[], concepts: Concepts, locale: string, fallback: (number: number) => string): string[] {
  const titles = areas.map((area, index) => labelOf(area, concepts, locale, fallback(index + 1)))
  const seen = new Map<string, number>()
  return titles.map(title => {
    if (titles.filter(other => other === title).length < 2) {
      return title
    }
    const number = (seen.get(title) ?? 0) + 1
    seen.set(title, number)
    return `${title} ${number}`
  })
}

/** The id of an area's row in the page, to scroll to it. */
export function areaAnchor (path: string): string {
  return `area-${path.replaceAll(/[^\w-]/g, '-')}`
}

/** E.g. "IDTA 02003-2-0"; 1.2 and 1.1 were ZVEI's. */
export function templateLabel (version: string | null): string {
  if (version === null) {
    return 'IDTA 02003'
  }
  return version.startsWith('1.') ? `ZVEI Technical Data ${version}` : `IDTA 02003-${version.replace('.', '-')}`
}

const generalIcons: Record<GeneralFieldKey, string> = {
  manufacturerName: 'mdi-factory',
  productDesignation: 'mdi-tag-outline',
  articleNumber: 'mdi-pound',
  orderCode: 'mdi-cart-outline',
}

const text = (data: TechnicalData, key: GeneralFieldKey, locale: string) => fieldText(data.general[key], locale)

/** The heading: the product, its manufacturer, article number and order code. */
export function headline (t: Translate, data: TechnicalData, locale: string) {
  const article = text(data, 'articleNumber', locale)
  const order = text(data, 'orderCode', locale)
  return {
    title: text(data, 'productDesignation', locale) || t('technicalData.untitled'),
    manufacturer: text(data, 'manufacturerName', locale),
    details: [article && t('general.articleShort', { value: article }), order && t('general.orderShort', { value: order })].filter(Boolean).join(' · '),
  }
}

/** The general information as rows; in view mode only what has a value. */
export function generalRows (t: Translate, data: TechnicalData, locale: string, edit: boolean): DetailRow[] {
  return (['manufacturerName', 'productDesignation', 'articleNumber', 'orderCode'] as const)
    .map((key): DetailRow | null => {
      const field = data.general[key]
      if (!field) {
        return null
      }
      const value = fieldText(field, locale)
      return { key, label: t(`general.${key}`), value, icon: generalIcons[key], field, copy: key === 'articleNumber' || key === 'orderCode' ? value : undefined }
    })
    .filter((row): row is DetailRow => row !== null && (edit || row.value !== ''))
}

/** A classification's short name: "ECLASS 13.0 · 27-02-24-01". */
export function classificationChip (classification: Classification, locale: string): string {
  const system = [fieldText(classification.system, locale), fieldText(classification.version, locale)].filter(Boolean).join(' ')
  return [system, fieldText(classification.classId, locale)].filter(Boolean).join(' · ')
}

/** A classification's class: its name, else its coded name. */
export function className (classification: Classification, locale: string): string {
  return fieldText(classification.className, locale) || fieldText(classification.codedName, locale)
}

/** An https URL a value names; `null` for other values. */
export function httpsUrl (value: string): string | null {
  const url = URL.parse(value.trim())
  return url?.protocol === 'https:' && url.hostname.includes('.') ? url.href : null
}

/** The further information as rows: the valid date first, then the statements. */
export function furtherRows (t: Translate, data: TechnicalData, locale: string, edit: boolean): DetailRow[] {
  const further = data.further
  if (!further) {
    return []
  }
  const rows: DetailRow[] = []
  if (further.validDate) {
    rows.push({ key: 'validDate', label: t('further.validDate'), value: dateText(fieldText(further.validDate, locale), locale), icon: 'mdi-calendar-check-outline', field: further.validDate })
  }
  for (const [index, statement] of further.statements.entries()) {
    rows.push({ key: `statement:${index}`, label: t('further.statement'), value: fieldText(statement, locale), icon: 'mdi-text', field: statement })
  }
  return rows.filter(row => edit || row.value !== '')
}

/** A classification's fields as rows, to change them in edit mode. */
export function classificationRows (t: Translate, classification: Classification, locale: string): DetailRow[] {
  const fields = [
    ['system', classification.system],
    ['version', classification.version],
    ['url', classification.url],
    ['classId', classification.classId],
    ['codedName', classification.codedName],
    ['className', classification.className],
  ] as const
  return fields
    .filter(([, field]) => field !== undefined)
    .map(([key, field]) => ({ key: `${classification.path}:${key}`, label: t(`classification.fields.${key}`), value: fieldText(field, locale), field }))
}

/** A CSV field, quoted where it holds a separator, quote or line break (RFC 4180). */
function csvField (value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

/** A value as stored, for a spreadsheet: numbers with a point, booleans as `true` and `false`. */
function rawValue (node: Extract<SheetNode, { kind: 'value' }>, locale: string): { value: string, min: string, max: string } {
  const field = node.field
  if (field?.modelType === 'Range') {
    return { value: '', min: field.min, max: field.max }
  }
  if (field) {
    return { value: field.modelType === 'Property' ? (field.values[0]?.text ?? '') : fieldText(field, locale), min: '', max: '' }
  }
  return { value: node.file?.value ?? node.text, min: '', max: '' }
}

/**
 * The data sheets as CSV (RFC 4180, with a byte order mark for spreadsheet
 * programs): a row per value, with its area, the sections it lies in, its
 * label, the value as stored (a Range's bounds in their own columns), unit,
 * description, definition and semantic ID. Column titles in the user's
 * language; every row, whatever a search shows.
 */
export function sheetCsv (t: Translate, sheets: Array<{ title: string, area: SheetArea }>, concepts: Concepts, locale: string): string {
  const header = ['csv.area', 'csv.section', 'sheet.property', 'sheet.value', 'csv.min', 'csv.max', 'sheet.unit', 'sheet.description', 'sheet.definition', 'csv.semanticId'].map(key => t(key))
  const lines: string[][] = [header]
  const visit = (title: string, nodes: SheetNode[], sections: string[]) => {
    for (const [index, node] of nodes.entries()) {
      const label = labelOf(node, concepts, locale, t('sheet.entry', { number: index + 1 }))
      if (node.kind === 'section') {
        visit(title, node.children, [...sections, label])
        continue
      }
      const { value, min, max } = rawValue(node, locale)
      lines.push([title, sections.join(' / '), label, value, min, max, conceptOf(node, concepts)?.unit ?? '', descriptionOf(node, label, locale), definitionOf(node, concepts, locale), node.conceptIds[0] ?? ''])
    }
  }
  for (const sheet of sheets) {
    visit(sheet.title, sheet.area.children, [])
  }
  return `\uFEFF${lines.map(line => line.map(field => csvField(field)).join(',')).join('\r\n')}\r\n`
}

/** The CSV's file name: the product's, without characters file systems refuse. */
export function csvFileName (t: Translate, product: string): string {
  const name = product.replaceAll(/[/\\:*?"<>|\0]/g, '').trim().slice(0, 120)
  return t('csv.fileName', { name: name || t('technicalData.untitled') })
}
