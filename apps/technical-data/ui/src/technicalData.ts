import type { EditableField, ElementSpec, FileRef, LangString, Node, TextField } from '@basyx/studio-app-kit/aas'
import type { JsonObject } from '@basyx/studio-sdk'
import { childMatching, childrenMatching, childrenOf, fileRef, rangeFieldOf, semanticIdOf, textFieldOf } from '@basyx/studio-app-kit/aas'

// Reading the technical data of an asset: IDTA 02003 Technical Data 2.0
// (ECLASS semantic IDs, `TechnicalPropertyAreas` and `SpecificDescriptions`
// as lists of areas with recursive `Section`s, `ProductImages` as a list) and
// the ZVEI templates 1.2 and 1.1 (`TechnicalProperties` with `MainSection`
// and `SubSection`, numbered `ProductImage` files). Based on the BaSyx AAS
// Web UI's TechnicalData_v1_2 and _v2_0 plugins
// (https://github.com/eclipse-basyx/basyx-aas-web-ui), © the Eclipse BaSyx
// Authors, MIT License, and extended to every element of the templates.
// Elements are found by idShort (numbered too) or by their semantic ID in
// any version (`@basyx/studio-app-kit/aas`); each part is read whichever
// form it has, so a 2.0 submodel with 1.2's numbered images is read too.

export const technicalDataSemanticIds = {
  v2: '0173-1#01-AHX837#002',
  v2Url: 'https://admin-shell.io/idta/TechnicalData/Submodel/2/0',
  v12: 'https://admin-shell.io/ZVEI/TechnicalData/Submodel/1/2',
  v11: 'https://admin-shell.io/ZVEI/TechnicalData/Submodel/1/1',
}

const zvei = (name: string) => `https://admin-shell.io/ZVEI/TechnicalData/${name}/1/1`

const specs = {
  generalInformation: { names: ['GeneralInformation'], semanticIds: [zvei('GeneralInformation'), '0173-1#02-ABK161#002'] },
  manufacturerName: { names: ['ManufacturerName'], semanticIds: ['0173-1#02-AAO677#002'] },
  logo: { names: ['ManufacturerLogo', 'CompanyLogo'], semanticIds: [zvei('ManufacturerLogo'), '0173-1#02-ABI776#002'] },
  productDesignation: { names: ['ManufacturerProductDesignation'], semanticIds: ['0173-1#02-AAW338#001'] },
  articleNumber: { names: ['ManufacturerArticleNumber'], semanticIds: ['0173-1#02-AAO676#003'] },
  orderCode: { names: ['ManufacturerOrderCode'], semanticIds: ['0173-1#02-AAO227#002'] },
  productImage: { names: ['ProductImage'], semanticIds: [zvei('ProductImage')] },
  productImages: { names: ['ProductImages'], semanticIds: ['0173-1#02-ABM220#001'] },
  imageFile: { names: ['ImageFile'], semanticIds: ['0173-1#02-ABK291#002'] },
  imageNote: { names: ['ImageNote'], semanticIds: ['0173-1#02-ABL423#001'] },
  classifications: { names: ['ProductClassifications'], semanticIds: [zvei('ProductClassifications'), '0173-1#02-ABK162#002'] },
  classificationSystem: { names: ['ProductClassificationSystem', 'ClassificationSystem'], semanticIds: [zvei('ProductClassificationSystem'), '0173-1#02-ABL424#001'] },
  classificationSystemVersion: { names: ['ClassificationSystemVersion'], semanticIds: [zvei('ClassificationSystemVersion'), '0173-1#02-AAR710#003'] },
  classificationSystemUrl: { names: ['ClassificationSystemUrl'] },
  productClassId: { names: ['ProductClassId'], semanticIds: [zvei('ProductClassId'), '0173-1#02-ABG776#003'] },
  productClassCodedName: { names: ['ProductClassCodedName'], semanticIds: ['0173-1#02-ABK128#002'] },
  productClassName: { names: ['ProductClassName'], semanticIds: ['0173-1#02-ABK273#002'] },
  areaReference: { names: ['ReferenceToTechnicalPropertyArea'], semanticIds: ['0173-1#02-ABL358#002'] },
  technicalProperties: { names: ['TechnicalPropertyAreas', 'TechnicalProperties'], semanticIds: [zvei('TechnicalProperties'), '0173-1#02-ABK163#002'] },
  specificDescriptions: { names: ['SpecificDescriptions'], semanticIds: ['0173-1#02-ABM221#001'] },
  furtherInformation: { names: ['FurtherInformation'], semanticIds: [zvei('FurtherInformation'), '0173-1#02-ABK164#002'] },
  textStatement: { names: ['TextStatement'], semanticIds: [zvei('TextStatement'), '0173-1#02-ABK134#002'] },
  // By idShort first: the 1.2 template gives ValidDate ManufacturerOrderCode's semantic ID.
  validDate: { names: ['ValidDate'], semanticIds: ['0173-1#02-ABL775#001'] },
} satisfies Record<string, ElementSpec>

/** Placeholders of the templates for elements without a dictionary ID; no concept describes them. */
const placeholderIds = new Set([
  'https://admin-shell.io/semanticidnotavailable/1/1',
  'https://admin-shell.io/smt/general/arbitrary',
])

export type GeneralFieldKey = 'manufacturerName' | 'productDesignation' | 'articleNumber' | 'orderCode'

/** The fields of the general information, in the order of the template. */
export const generalFieldKeys: GeneralFieldKey[] = ['manufacturerName', 'productDesignation', 'articleNumber', 'orderCode']

export interface ProductImage {
  path: string
  file: FileRef
  note: TextField | undefined
}

export interface Classification {
  path: string
  system: TextField | undefined
  version: TextField | undefined
  url: TextField | undefined
  classId: TextField | undefined
  codedName: TextField | undefined
  className: TextField | undefined
  /** The idShortPath of the area `ReferenceToTechnicalPropertyArea` names; `null` without one. */
  areaPath: string | null
}

/** What every element of a data sheet carries: its names and the IDs its concept may have. */
interface Described {
  path: string
  idShort: string
  modelType: string
  displayName: LangString[]
  description: LangString[]
  /** The semantic ID and the supplemental ones, for `aas.describeConcepts`; no placeholders. */
  conceptIds: string[]
}

/** A Section, MainSection, SubSection or any other collection or list of a data sheet. */
export interface SheetSection extends Described {
  kind: 'section'
  children: SheetNode[]
}

/** Any other element of a data sheet, with what showing and changing it needs. */
export interface SheetValue extends Described {
  kind: 'value'
  /** A Property, MultiLanguageProperty or Range. */
  field: EditableField | undefined
  file: FileRef | null
  /** E.g. `xs:double`; empty for elements without a value type. */
  valueType: string
  /** The value of elements without a field, e.g. a ReferenceElement's last key. */
  text: string
}

export type SheetNode = SheetSection | SheetValue

/** An area of technical properties or specific descriptions: its own data sheet. */
export interface SheetArea extends Described {
  children: SheetNode[]
}

export interface FurtherInformation {
  statements: TextField[]
  validDate: TextField | undefined
}

export interface TechnicalData {
  /** The template version from the semantic ID: `2.0`, `1.2`, `1.1`; `null` for another one. */
  version: string | null
  general: Partial<Record<GeneralFieldKey, TextField>>
  logo: FileRef | null
  images: ProductImage[]
  classifications: Classification[]
  areas: SheetArea[]
  specificDescriptions: SheetArea[]
  further: FurtherInformation | null
}

function keyValues (reference: unknown): string[] {
  const keys = (reference as { keys?: Array<{ value?: unknown }> } | undefined)?.keys ?? []
  return keys.map(key => (typeof key.value === 'string' ? key.value.trim() : '')).filter(value => value !== '')
}

/**
 * What the entries of a SubmodelElementList take from it where they say
 * nothing themselves (AASd-115, AASd-109): its `semanticIdListElement` and
 * `valueTypeListElement`. `undefined` for other elements.
 */
interface ListContext {
  semanticId: string
  valueType: string
}

function listContext (element: JsonObject): ListContext | undefined {
  if (element.modelType !== 'SubmodelElementList') {
    return undefined
  }
  return {
    semanticId: keyValues(element.semanticIdListElement)[0] ?? '',
    valueType: typeof element.valueTypeListElement === 'string' ? element.valueTypeListElement : '',
  }
}

/**
 * The semantic ID and the supplemental ones, without the templates'
 * placeholders; an entry of a list without a semantic ID of its own has
 * the list's `semanticIdListElement` (`inherited`).
 */
export function conceptIdsOf (element: JsonObject, inherited = ''): string[] {
  const supplemental = Array.isArray(element.supplementalSemanticIds) ? element.supplementalSemanticIds as unknown[] : []
  const ids = [semanticIdOf(element) || inherited, ...supplemental.map(reference => keyValues(reference)[0] ?? '')]
  return [...new Set(ids.filter(id => id !== '' && !placeholderIds.has(id.replace(/\/+$/, '').toLowerCase())))]
}

function langStrings (value: unknown): LangString[] {
  return Array.isArray(value)
    ? (value as LangString[]).filter(entry => typeof entry?.text === 'string' && entry.text.trim() !== '').map(entry => ({ language: String(entry.language ?? ''), text: entry.text.trim() }))
    : []
}

function described (node: Node, list?: ListContext): Described {
  const { element } = node
  return {
    path: node.path,
    idShort: String(element.idShort ?? ''),
    modelType: String(element.modelType ?? ''),
    displayName: langStrings(element.displayName),
    description: langStrings(element.description),
    conceptIds: conceptIdsOf(element, list?.semanticId),
  }
}

/** A ReferenceElement as text: the value of its last key, e.g. the idShort it points to. */
function referenceText (element: JsonObject): string {
  return keyValues(element.value).at(-1) ?? ''
}

/** An element of a data sheet; `list`, what the list it is an entry of gives its entries. */
function sheetNode (node: Node, list?: ListContext): SheetNode {
  const { element } = node
  if (['SubmodelElementCollection', 'SubmodelElementList', 'Entity'].includes(String(element.modelType))) {
    const entries = listContext(element)
    return { ...described(node, list), kind: 'section', children: childrenOf(node).map(entry => sheetNode(entry, entries)) }
  }
  const field = textFieldOf(node) ?? rangeFieldOf(node)
  let text = ''
  if (element.modelType === 'ReferenceElement') {
    text = referenceText(element)
  } else if (element.modelType === 'Blob') {
    text = String(element.contentType ?? '')
  }
  return {
    ...described(node, list),
    kind: 'value',
    field,
    file: fileRef(node),
    valueType: typeof element.valueType === 'string' && element.valueType ? element.valueType : (list?.valueType ?? ''),
    text,
  }
}

/** The areas of `TechnicalPropertyAreas` or `SpecificDescriptions` (lists of collections), or 1.2's one `TechnicalProperties`. */
function parseAreas (node: Node | undefined): SheetArea[] {
  if (!node) {
    return []
  }
  if (node.element.modelType === 'SubmodelElementList') {
    const entries = listContext(node.element)
    return childrenOf(node)
      .filter(entry => entry.element.modelType === 'SubmodelElementCollection')
      .map(entry => ({ ...described(entry, entries), children: childrenOf(entry).map(child => sheetNode(child)) }))
  }
  return [{ ...described(node), children: childrenOf(node).map(child => sheetNode(child)) }]
}

/**
 * The idShortPath a ModelReference names within its submodel:
 * `TechnicalPropertyAreas` then `0` (a list's item) → `TechnicalPropertyAreas[0]`.
 */
export function referencedPath (reference: unknown): string | null {
  const keys = ((reference as { keys?: Array<{ type?: unknown, value?: unknown }> } | undefined)?.keys ?? [])
    .filter(key => typeof key.value === 'string' && key.value.trim() !== '')
  const start = keys.findIndex(key => key.type === 'Submodel') + 1
  let path = ''
  for (const [index, key] of keys.slice(start).entries()) {
    const parent = keys[start + index - 1]
    const value = String(key.value).trim()
    path = index > 0 && parent?.type === 'SubmodelElementList' ? `${path}[${value}]` : (path ? `${path}.${value}` : value)
  }
  return path || null
}

function parseClassification (node: Node): Classification {
  const field = (spec: ElementSpec) => textFieldOf(childMatching(node, spec))
  const reference = childMatching(node, specs.areaReference)
  return {
    path: node.path,
    system: field(specs.classificationSystem),
    version: field(specs.classificationSystemVersion),
    url: field(specs.classificationSystemUrl),
    classId: field(specs.productClassId),
    codedName: field(specs.productClassCodedName),
    className: field(specs.productClassName),
    areaPath: reference?.element.modelType === 'ReferenceElement' ? referencedPath(reference.element.value) : null,
  }
}

/** The product images: 2.0's list of `ImageFile` and `ImageNote`, or 1.2's numbered `ProductImage` files. */
function parseImages (general: Node | undefined): ProductImage[] {
  const images: ProductImage[] = []
  for (const list of childrenMatching(general, specs.productImages)) {
    for (const item of childrenOf(list)) {
      const file = item.element.modelType === 'File' ? fileRef(item) : fileRef(childMatching(item, specs.imageFile))
      if (file) {
        images.push({ path: item.path, file, note: textFieldOf(childMatching(item, specs.imageNote)) })
      }
    }
  }
  for (const entry of childrenMatching(general, specs.productImage)) {
    const file = fileRef(entry)
    if (file) {
      images.push({ path: entry.path, file, note: undefined })
    }
  }
  return images
}

/** The template version a semantic ID names. */
export function templateVersion (semanticId: string): string | null {
  const id = semanticId.trim().replace(/\/+$/, '')
  if (/^0173-1#01-AHX837#\d{3}$/.test(id) || /\/idta\/technicaldata\/submodel\/2\/0$/i.test(id)) {
    return '2.0'
  }
  const match = /\/zvei\/technicaldata\/submodel\/(\d+)\/(\d+)$/i.exec(id)
  return match ? `${match[1]}.${match[2]}` : null
}

/** A Technical Data submodel. */
export function parseTechnicalData (submodel: JsonObject): TechnicalData {
  const root: Node = { element: submodel, path: '' }
  const general = childMatching(root, specs.generalInformation)
  const fields: Partial<Record<GeneralFieldKey, TextField>> = {}
  for (const key of generalFieldKeys) {
    const field = textFieldOf(childMatching(general, specs[key]))
    if (field) {
      fields[key] = field
    }
  }
  const classifications = childMatching(root, specs.classifications)
  const items = childrenOf(classifications ?? { element: {}, path: '' }).filter(entry => entry.element.modelType === 'SubmodelElementCollection')
  const further = childMatching(root, specs.furtherInformation)
  return {
    version: templateVersion(semanticIdOf(submodel)),
    general: fields,
    logo: fileRef(childMatching(general, specs.logo)),
    images: parseImages(general),
    classifications: items.map(item => parseClassification(item)),
    areas: parseAreas(childMatching(root, specs.technicalProperties)),
    specificDescriptions: parseAreas(childMatching(root, specs.specificDescriptions)),
    further: further
      ? {
          statements: childrenMatching(further, specs.textStatement).map(entry => textFieldOf(entry)).filter((entry): entry is TextField => entry !== undefined),
          validDate: textFieldOf(childMatching(further, specs.validDate)),
        }
      : null,
  }
}

/** The semantic IDs of every element of the data sheets, for `aas.describeConcepts`. */
export function sheetConceptIds (data: TechnicalData): string[] {
  const ids = new Set<string>()
  const visit = (node: Described & { children?: SheetNode[] }) => {
    for (const id of node.conceptIds) {
      ids.add(id)
    }
    for (const child of node.children ?? []) {
      visit(child)
    }
  }
  for (const area of [...data.areas, ...data.specificDescriptions]) {
    visit(area)
  }
  return [...ids]
}
