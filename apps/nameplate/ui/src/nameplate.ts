import type { ElementSpec, FileRef, LangString, Node, TextField } from '@basyx/studio-app-kit/aas'
import type { ContactInformation } from '@basyx/studio-app-kit/contacts'
import type { JsonObject } from '@basyx/studio-sdk'
import { childMatching, childrenMatching, childrenOf, fileRef, hasSpecName, matchesSpec, semanticIdOf, textFieldOf } from '@basyx/studio-app-kit/aas'
import { parseContactInformation } from '@basyx/studio-app-kit/contacts'

// Reading the Digital Nameplate of an asset: IDTA 02006 3.0 (IEC CDD semantic
// IDs, `AddressInformation`, `Markings` as a list), 2.0 (ECLASS semantic IDs,
// `ContactInformation`, numbered markings) and the ZVEI nameplate 1.0
// (`Address`). Based on the BaSyx AAS Web UI's Nameplate_v2_0 and _v3_0
// plugins (https://github.com/eclipse-basyx/basyx-aas-web-ui), © the Eclipse
// BaSyx Authors, MIT License, and extended to every element of the
// templates. Elements are found by idShort (numbered too), by the last
// segment of a URL semantic ID, or by their IRDI in any version
// (`@basyx/studio-app-kit/aas`); the address goes through the kit's contact
// information, as in the Contacts app.

export const nameplateSemanticIds = {
  v3: 'https://admin-shell.io/idta/nameplate/3/0/Nameplate',
  v2: 'https://admin-shell.io/zvei/nameplate/2/0/Nameplate',
  v1: 'https://admin-shell.io/zvei/nameplate/1/0/Nameplate',
}

const fieldSpecs = {
  uriOfTheProduct: { names: ['URIOfTheProduct'], semanticIds: ['0112/2///61987#ABN590#002'] },
  manufacturerName: { names: ['ManufacturerName'], semanticIds: ['0112/2///61987#ABA565#009', '0173-1#02-AAO677#002'] },
  manufacturerProductDesignation: { names: ['ManufacturerProductDesignation'], semanticIds: ['0112/2///61987#ABA567#009', '0173-1#02-AAW338#001'] },
  manufacturerProductRoot: { names: ['ManufacturerProductRoot'], semanticIds: ['0112/2///61360_7#AAS011#001', '0173-1#02-AAU732#001'] },
  manufacturerProductFamily: { names: ['ManufacturerProductFamily'], semanticIds: ['0112/2///61987#ABP464#002', '0173-1#02-AAU731#001'] },
  manufacturerProductType: { names: ['ManufacturerProductType'], semanticIds: ['0112/2///61987#ABA300#008', '0173-1#02-AAO057#002'] },
  orderCodeOfManufacturer: { names: ['OrderCodeOfManufacturer'], semanticIds: ['0112/2///61987#ABA950#008', '0173-1#02-AAO227#002'] },
  productArticleNumberOfManufacturer: { names: ['ProductArticleNumberOfManufacturer'], semanticIds: ['0112/2///61987#ABA581#007', '0173-1#02-AAO676#003'] },
  serialNumber: { names: ['SerialNumber'], semanticIds: ['0112/2///61987#ABA951#009', '0173-1#02-AAM556#002'] },
  batchNumber: { names: ['BatchNumber'], semanticIds: ['0173-1#02-AAQ196#001'] },
  yearOfConstruction: { names: ['YearOfConstruction'], semanticIds: ['0112/2///61987#ABP000#002', '0173-1#02-AAP906#001'] },
  dateOfManufacture: { names: ['DateOfManufacture'], semanticIds: ['0112/2///61987#ABB757#007', '0173-1#02-AAR972#002'] },
  hardwareVersion: { names: ['HardwareVersion'], semanticIds: ['0112/2///61987#ABA926#008', '0173-1#02-AAN270#002'] },
  firmwareVersion: { names: ['FirmwareVersion'], semanticIds: ['0112/2///61987#ABA302#006', '0173-1#02-AAM985#002'] },
  softwareVersion: { names: ['SoftwareVersion'], semanticIds: ['0112/2///61987#ABA601#008', '0173-1#02-AAM737#002'] },
  countryOfOrigin: { names: ['CountryOfOrigin', 'ProductCountryOfOrigin'], semanticIds: ['0112/2///61987#ABP462#001', '0173-1#02-AAO259#004'] },
  uniqueFacilityIdentifier: { names: ['UniqueFacilityIdentifier'], semanticIds: ['https://admin-shell.io/idta/nameplate/3/0/UniqueFacilityIdentifier'] },
} satisfies Record<string, ElementSpec>

export type NameplateFieldKey = keyof typeof fieldSpecs

/** The fields in the order of the template. */
export const nameplateFieldKeys = Object.keys(fieldSpecs) as NameplateFieldKey[]

const specs = {
  companyLogo: { names: ['CompanyLogo'], semanticIds: ['0112/2///61987#ABP463#001'] },
  address: {
    names: ['AddressInformation', 'ContactInformation', 'Address', 'PhysicalAddress'],
    semanticIds: ['https://admin-shell.io/zvei/nameplate/1/0/ContactInformations/AddressInformation', 'https://admin-shell.io/zvei/nameplate/1/0/ContactInformations/ContactInformation', '0173-1#02-AAQ832#005'],
  },
  markings: { names: ['Markings'], semanticIds: ['0112/2///61360_7#AAS006#001'] },
  marking: { names: ['Marking'], semanticIds: ['0112/2///61360_7#AAS009#001'] },
  markingName: { names: ['MarkingName'], semanticIds: ['0112/2///61987#ABA231#009'] },
  designation: { names: ['DesignationOfCertificateOrApproval'], semanticIds: ['0112/2///61987#ABH783#003'] },
  issueDate: { names: ['IssueDate'], semanticIds: ['0112/2///61987#ABO097#001'] },
  expiryDate: { names: ['ExpiryDate'], semanticIds: ['0112/2///61987#ABH830#002'] },
  markingFile: { names: ['MarkingFile'], semanticIds: ['0112/2///61987#ABO100#002'] },
  additionalText: { names: ['MarkingAdditionalText'], semanticIds: ['0112/2///61987#ABB146#007'] },
  assetSpecificProperties: { names: ['AssetSpecificProperties'], semanticIds: ['0173-1#02-ABI218#003'] },
} satisfies Record<string, ElementSpec>

export interface Marking {
  path: string
  /** `MarkingName`; for 1.0's `Marking_CE` collections, their suffix. */
  name: TextField | undefined
  fallbackName: string
  designation: TextField | undefined
  issueDate: TextField | undefined
  expiryDate: TextField | undefined
  file: FileRef | null
  additionalTexts: TextField[]
}

/** An element of the asset specific properties, with its own below it. */
export interface PropertyNode {
  path: string
  idShort: string
  displayName: LangString[]
  modelType: string
  field: TextField | undefined
  file: FileRef | null
  /** Other values as text, e.g. of a Range. */
  text: string
  children: PropertyNode[]
}

export interface Nameplate {
  /** The template version from the semantic ID, e.g. `3.0`; `null` for another one. */
  version: string | null
  fields: Partial<Record<NameplateFieldKey, TextField>>
  logo: FileRef | null
  /** The manufacturer's address and contact channels. */
  contact: ContactInformation | null
  markings: Marking[]
  /** `AssetSpecificProperties`, as a tree; `null` without it. */
  assetSpecificProperties: PropertyNode | null
}

function scalar (element: JsonObject | undefined): string {
  const value = element?.value
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value).trim() : ''
}

/** The elements of a list, or numbered collections next to each other. */
function entries (node: Node | undefined, spec: ElementSpec): Node[] {
  return childrenMatching(node, spec).flatMap(item => (item.element.modelType === 'SubmodelElementList' ? childrenOf(item) : [item]))
}

function parseMarking (node: Node): Marking {
  const suffix = /^Marking_(.+)$/i.exec(String(node.element.idShort ?? ''))?.[1] ?? ''
  return {
    path: node.path,
    name: textFieldOf(childMatching(node, specs.markingName)),
    fallbackName: suffix.replaceAll('_', ' '),
    designation: textFieldOf(childMatching(node, specs.designation)),
    issueDate: textFieldOf(childMatching(node, specs.issueDate)),
    expiryDate: textFieldOf(childMatching(node, specs.expiryDate)),
    file: entries(node, specs.markingFile).map(entry => fileRef(entry)).find(entry => entry !== null) ?? null,
    additionalTexts: entries(node, specs.additionalText).map(entry => textFieldOf(entry)).filter((entry): entry is TextField => entry !== undefined),
  }
}

/** The markings: list items, numbered `Marking` collections, or 1.0's `Marking_CE` and the like. */
function parseMarkings (root: Node): Marking[] {
  const markings = childMatching(root, specs.markings)
  if (!markings) {
    return []
  }
  const items = markings.element.modelType === 'SubmodelElementList'
    ? childrenOf(markings)
    : childrenOf(markings).filter(entry => matchesSpec(entry.element, specs.marking) || /^Marking_/i.test(String(entry.element.idShort ?? '')))
  return items.filter(entry => entry.element.modelType === 'SubmodelElementCollection').map(entry => parseMarking(entry))
}

function rangeText (element: JsonObject): string {
  const [min, max] = [scalar({ value: element.min } as JsonObject), scalar({ value: element.max } as JsonObject)]
  return min || max ? `${min || '…'} – ${max || '…'}` : ''
}

function parseProperty (node: Node): PropertyNode {
  const { element } = node
  return {
    path: node.path,
    idShort: String(element.idShort ?? ''),
    displayName: Array.isArray(element.displayName) ? element.displayName as LangString[] : [],
    modelType: String(element.modelType ?? ''),
    field: textFieldOf(node),
    file: fileRef(node),
    text: element.modelType === 'Range' ? rangeText(element) : '',
    children: childrenOf(node).map(entry => parseProperty(entry)),
  }
}

/** The template version a semantic ID names: `…/nameplate/3/0/Nameplate` → `3.0`. */
export function templateVersion (semanticId: string): string | null {
  const match = /\/nameplate\/(\d+)\/(\d+)\/nameplate\/?$/i.exec(semanticId.trim())
  return match ? `${match[1]}.${match[2]}` : null
}

/** A Digital Nameplate submodel. */
export function parseNameplate (submodel: JsonObject): Nameplate {
  const root: Node = { element: submodel, path: '' }
  const children = childrenOf(root)
  // An element is taken by its idShort first; by its semantic ID only where
  // no field claims it by name, as published nameplates mix up some IRDIs.
  const allSpecs: ElementSpec[] = [...Object.values(fieldSpecs), ...Object.values(specs)]
  const unclaimed = children.filter(entry => !allSpecs.some(spec => hasSpecName(entry.element, spec)))
  const find = (spec: ElementSpec) => children.find(entry => hasSpecName(entry.element, spec)) ?? unclaimed.find(entry => matchesSpec(entry.element, spec))
  const fields: Partial<Record<NameplateFieldKey, TextField>> = {}
  for (const key of nameplateFieldKeys) {
    const field = textFieldOf(find(fieldSpecs[key]))
    if (field) {
      fields[key] = field
    }
  }
  const address = childrenMatching(root, specs.address).find(entry => entry.element.modelType === 'SubmodelElementCollection')
  const assetSpecific = childMatching(root, specs.assetSpecificProperties)
  return {
    version: templateVersion(semanticIdOf(submodel)),
    fields,
    logo: fileRef(find(specs.companyLogo)),
    contact: address ? parseContactInformation(address) : null,
    markings: parseMarkings(root),
    assetSpecificProperties: assetSpecific ? parseProperty(assetSpecific) : null,
  }
}

/** Whether a date (YYYY-MM-DD) lies before today's. */
export function isExpired (date: string, today = new Date()): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date < today.toISOString().slice(0, 10)
}
