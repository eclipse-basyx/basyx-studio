import type { Marking, Nameplate, NameplateFieldKey, PropertyNode } from './nameplate'
import type { FileRef, TextField } from '@basyx/studio-app-kit/aas'
import type { Translate } from '@basyx/studio-app-kit/i18n'
import { fieldText, humanize, langText } from '@basyx/studio-app-kit/aas'
import { contactRows, countryName, linkUrl } from '@basyx/studio-app-kit/contacts'
import { isExpired, nameplateFieldKeys } from './nameplate'

// What the view shows of a nameplate, as label and value rows, like the
// Documents app's presentation of IDTA 02004. In edit mode, every element
// is a row of its own, empty ones too, so that each can be changed.

export interface DetailRow {
  key: string
  label: string
  value: string
  icon?: string
  /** E.g. the type of a phone number: "Office". */
  type?: string
  /** E.g. when a phone number is answered. */
  note?: string
  /** Chips in place of the value, e.g. the hardware, firmware and software versions. */
  chips?: Array<{ key: string, text: string, icon: string }>
  /** An https, `mailto:` or `tel:` URL the value opens. */
  url?: string
  /** The address in Google Maps. */
  map?: string
  /** The text a copy button copies. */
  copy?: string
  /** The field the row changes in edit mode. */
  field?: TextField
  /** A file the row shows in Studio's viewer. */
  file?: FileRef
}

export interface DetailGroup {
  key: string
  title: string
  icon: string
  rows: DetailRow[]
}

const icons: Partial<Record<NameplateFieldKey, string>> = {
  uriOfTheProduct: 'mdi-web',
  manufacturerName: 'mdi-factory',
  manufacturerProductDesignation: 'mdi-tag-outline',
  manufacturerProductRoot: 'mdi-family-tree',
  manufacturerProductFamily: 'mdi-shape-outline',
  manufacturerProductType: 'mdi-shape-outline',
  orderCodeOfManufacturer: 'mdi-cart-outline',
  productArticleNumberOfManufacturer: 'mdi-pound',
  serialNumber: 'mdi-barcode',
  batchNumber: 'mdi-barcode',
  yearOfConstruction: 'mdi-calendar-outline',
  dateOfManufacture: 'mdi-calendar-outline',
  hardwareVersion: 'mdi-memory',
  firmwareVersion: 'mdi-chip',
  softwareVersion: 'mdi-application-cog-outline',
  countryOfOrigin: 'mdi-earth',
  uniqueFacilityIdentifier: 'mdi-office-building-marker-outline',
}

/** E.g. "IDTA 02006-3-0"; 1.0 was ZVEI's. */
export function templateLabel (version: string | null): string {
  if (version === null) {
    return 'IDTA 02006'
  }
  return version === '1.0' ? 'ZVEI Digital Nameplate 1.0' : `IDTA 02006-${version.replace('.', '-')}`
}

/** A date (YYYY-MM-DD) in the user's format; other values as they are. */
export function dateText (value: string, locale: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) {
    return value
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  try {
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat([locale, 'en'], { dateStyle: 'medium', timeZone: 'UTC' }).format(date)
  } catch {
    return value
  }
}

/** `DE` → "Germany (DE)"; values that are no country code as they are. */
export function countryText (code: string, locale: string): string {
  const name = countryName(code, locale)
  return name && name !== code ? `${name} (${code.toUpperCase()})` : code
}

const text = (nameplate: Nameplate, key: NameplateFieldKey, locale: string) => fieldText(nameplate.fields[key], locale)

/** The heading: the product, its manufacturer, type and serial number. */
export function headline (t: Translate, nameplate: Nameplate, locale: string) {
  const type = text(nameplate, 'manufacturerProductType', locale)
  const serial = text(nameplate, 'serialNumber', locale)
  return {
    title: text(nameplate, 'manufacturerProductDesignation', locale) || type || text(nameplate, 'manufacturerProductFamily', locale) || t('nameplate.untitled'),
    manufacturer: text(nameplate, 'manufacturerName', locale),
    details: [type && t('product.type', { value: type }), serial && t('product.serial', { value: serial })].filter(Boolean).join(' · '),
  }
}

/** The hardware, firmware and software versions, e.g. "Firmware 3.4.1". */
export function versionChips (t: Translate, nameplate: Nameplate, locale: string): Array<{ key: string, text: string, icon: string }> {
  return (['hardwareVersion', 'firmwareVersion', 'softwareVersion'] as const)
    .map(key => ({ key, version: text(nameplate, key, locale) }))
    .filter(entry => entry.version !== '')
    .map(entry => ({ key: entry.key, text: t(`product.${entry.key}`, { version: entry.version }), icon: icons[entry.key]! }))
}

function fieldRow (t: Translate, nameplate: Nameplate, key: NameplateFieldKey, locale: string): DetailRow | null {
  const field = nameplate.fields[key]
  if (!field) {
    return null
  }
  const value = fieldText(field, locale)
  const row: DetailRow = { key, label: t(`fields.${key}`), value, icon: icons[key], field }
  switch (key) {
    case 'countryOfOrigin': {
      return { ...row, value: value && countryText(value, locale) }
    }
    case 'dateOfManufacture': {
      return { ...row, value: dateText(value, locale) }
    }
    case 'uriOfTheProduct': {
      return { ...row, url: linkUrl(value) ?? undefined, copy: value }
    }
    default: {
      return row
    }
  }
}

/** The product's rows; in view mode without its designation and manufacturer, which head the view, and with the versions as chips in one row. */
export function productRows (t: Translate, nameplate: Nameplate, locale: string, edit: boolean): DetailRow[] {
  if (edit) {
    return nameplateFieldKeys
      .filter(key => key !== 'uniqueFacilityIdentifier')
      .map(key => fieldRow(t, nameplate, key, locale))
      .filter((row): row is DetailRow => row !== null)
  }
  const rows = (['manufacturerProductRoot', 'manufacturerProductFamily', 'manufacturerProductType', 'orderCodeOfManufacturer', 'productArticleNumberOfManufacturer', 'serialNumber', 'batchNumber', 'yearOfConstruction', 'dateOfManufacture', 'countryOfOrigin', 'uriOfTheProduct'] as const)
    .map(key => fieldRow(t, nameplate, key, locale))
    .filter((row): row is DetailRow => row !== null && row.value !== '')
  // The versions as chips in one row, where the template has them: after the date of manufacture.
  const chips = versionChips(t, nameplate, locale)
  if (chips.length > 0) {
    const at = rows.findIndex(row => row.key === 'countryOfOrigin' || row.key === 'uriOfTheProduct')
    rows.splice(at === -1 ? rows.length : at, 0, { key: 'versions', label: t('product.versions'), value: '', icon: 'mdi-source-branch', chips })
  }
  return rows
}

/** The manufacturer's address and contact channels (the kit's rows), and the facility. */
export function manufacturerRows (t: Translate, nameplate: Nameplate, locale: string, edit: boolean): DetailRow[] {
  const manufacturer = text(nameplate, 'manufacturerName', locale)
  const contact = nameplate.contact
    ? contactRows(nameplate.contact, locale, { edit })
        .filter(row => edit || row.key !== 'company' || row.value !== manufacturer)
        .map((row, index): DetailRow => ({ ...row, key: `${row.key}:${index}` }))
    : []
  const facility = fieldRow(t, nameplate, 'uniqueFacilityIdentifier', locale)
  return [...contact, ...(facility && (edit || facility.value) ? [facility] : [])]
}

/** A marking's name: `MarkingName`, else the suffix of 1.0's `Marking_CE`. */
export function markingName (t: Translate, marking: Marking, index: number, locale: string): string {
  return fieldText(marking.name, locale) || marking.fallbackName || t('marking.untitled', { number: index + 1 })
}

/** What a marking's card says below its name: the certificate, else its first note. */
export function markingSubtitle (t: Translate, marking: Marking, locale: string): string {
  return fieldText(marking.designation, locale) || fieldText(marking.additionalTexts[0], locale)
}

/** A marking's certificate and dates, as rows. */
export function markingRows (t: Translate, marking: Marking, locale: string, edit: boolean): DetailRow[] {
  const rows: Array<DetailRow | null> = [
    edit && marking.name ? { key: 'name', label: t('marking.name'), value: fieldText(marking.name, locale), icon: 'mdi-tag-outline', field: marking.name } : null,
    marking.designation ? { key: 'designation', label: t('marking.designation'), value: fieldText(marking.designation, locale), icon: 'mdi-certificate-outline', field: marking.designation } : null,
    marking.issueDate ? { key: 'issued', label: t('marking.issued'), value: dateText(fieldText(marking.issueDate, locale), locale), icon: 'mdi-calendar-check-outline', field: marking.issueDate } : null,
    marking.expiryDate ? { key: 'expires', label: t('marking.expires'), value: dateText(fieldText(marking.expiryDate, locale), locale), icon: 'mdi-calendar-remove-outline', field: marking.expiryDate } : null,
    ...marking.additionalTexts.map((field, index): DetailRow => ({ key: `text:${index}`, label: t('marking.additionalText'), value: fieldText(field, locale), icon: 'mdi-text', field })),
  ]
  return rows.filter((row): row is DetailRow => row !== null && (edit || row.value !== ''))
}

/** Whether a marking's expiry date has passed. */
export function markingExpired (marking: Marking, locale: string): boolean {
  return isExpired(fieldText(marking.expiryDate, locale))
}

function propertyLabel (node: PropertyNode, locale: string): string {
  return langText(node.displayName, locale) || humanize(node.idShort)
}

const isGuideline = (node: PropertyNode) => /^GuidelineForConformityDeclaration$/i.test(node.idShort)

/** The rows of a node's leaves; deeper ones labelled with their path ("Limits / Max"). */
function leafRows (node: PropertyNode, locale: string, edit: boolean, prefix = ''): DetailRow[] {
  return node.children.flatMap((child): DetailRow[] => {
    const label = prefix ? `${prefix} / ${propertyLabel(child, locale)}` : propertyLabel(child, locale)
    if (child.children.length > 0) {
      return leafRows(child, locale, edit, label)
    }
    if (!edit && isGuideline(child) && !prefix) {
      // The group's title.
      return []
    }
    const value = child.field ? fieldText(child.field, locale) : (child.file?.name ?? child.text)
    const url = child.field ? linkUrl(value) ?? undefined : undefined
    return edit || value !== '' ? [{ key: child.path, label, value, icon: child.file ? 'mdi-file-outline' : undefined, field: child.field, file: child.file ?? undefined, url: url?.startsWith('https:') ? url : undefined }] : []
  })
}

/**
 * The asset specific properties in groups: those directly in the collection,
 * then one group per guideline (IDTA 02006's `GuidelineSpecificProperties`,
 * a list or numbered collections) or other collection.
 */
export function propertyGroups (t: Translate, root: PropertyNode | null, locale: string, edit: boolean): DetailGroup[] {
  if (!root) {
    return []
  }
  const groups: DetailGroup[] = [{ key: 'general', title: t('assetSpecific.general'), icon: 'mdi-format-list-bulleted', rows: leafRows({ ...root, children: root.children.filter(child => child.children.length === 0) }, locale, edit) }]
  const containers = root.children.filter(child => child.children.length > 0)
  for (const container of containers) {
    const items = container.modelType === 'SubmodelElementList' || container.children.every(child => child.children.length > 0) ? container.children : [container]
    for (const [index, item] of items.entries()) {
      const guideline = item.children.find(child => isGuideline(child))
      const guidelineText = guideline?.field ? fieldText(guideline.field, locale) : ''
      groups.push({
        key: item.path,
        title: guidelineText
          ? t('assetSpecific.guideline', { value: guidelineText })
          : (langText(item.displayName, locale) || (item.idShort ? humanize(item.idShort) : t('assetSpecific.entry', { name: propertyLabel(container, locale), number: index + 1 }))),
        icon: guidelineText ? 'mdi-scale-balance' : 'mdi-folder-outline',
        rows: item.children.length > 0 ? leafRows(item, locale, edit) : leafRows({ ...item, children: [item] }, locale, edit),
      })
    }
  }
  return groups.filter(group => group.rows.length > 0)
}
