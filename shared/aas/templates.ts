import type { JsonRecord } from './defaults'

// Submodel templates and instances (MVP-5 plan, T2, T5), shared by the BFF
// and the Workspace Worker. Ported from the BaSyx Web UI's
// SubmodelTemplateConversion and cardinality handling.

export const cardinalities = ['One', 'ZeroToOne', 'ZeroToMany', 'OneToMany'] as const
export type Cardinality = (typeof cardinalities)[number]

const cardinalityQualifier = 'SMT/Cardinality'

function records (value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter((item): item is JsonRecord => typeof item === 'object' && item !== null && !Array.isArray(item)) : []
}

/** The template cardinality of an element, if it has one. */
export function cardinalityOf (element: JsonRecord): Cardinality | null {
  const qualifier = records(element.qualifiers).find(entry => entry.type === cardinalityQualifier)
  return (cardinalities as readonly unknown[]).includes(qualifier?.value) ? qualifier!.value as Cardinality : null
}

export function isOptional (element: JsonRecord): boolean {
  const cardinality = cardinalityOf(element)
  return cardinality === 'ZeroToOne' || cardinality === 'ZeroToMany'
}

/** Containers' children and the property that holds them. */
const childProperty: Record<string, string> = {
  Submodel: 'submodelElements',
  SubmodelElementCollection: 'value',
  SubmodelElementList: 'value',
  Entity: 'statements',
  AnnotatedRelationshipElement: 'annotations',
}

function childPath (parentPath: string, parent: JsonRecord, child: JsonRecord, index: number): string {
  if (parent.modelType === 'SubmodelElementList') {
    return `${parentPath}[${index}]`
  }
  const name = String(child.idShort ?? `#${index}`)
  return parentPath ? `${parentPath}.${name}` : name
}

/** The qualifiers without template qualifiers; the field is removed when none are left. */
function withoutTemplateQualifiers (node: JsonRecord): JsonRecord {
  if (!Array.isArray(node.qualifiers)) {
    return node
  }
  const kept = records(node.qualifiers).filter(qualifier => qualifier.kind !== 'TemplateQualifier')
  const { qualifiers: _, ...rest } = node
  return kept.length > 0 ? { ...rest, qualifiers: kept } : rest
}

function cleanTree (node: JsonRecord, path: string, include: ReadonlySet<string> | null, values: Readonly<Record<string, string>>): JsonRecord | null {
  let next: JsonRecord = withoutTemplateQualifiers(node)
  const property = childProperty[String(node.modelType)]
  if (property && Array.isArray(next[property])) {
    const children: JsonRecord[] = []
    for (const [index, child] of records(next[property]).entries()) {
      const full = childPath(path, node, child, index)
      if (include !== null && isOptional(child) && !include.has(full)) {
        continue
      }
      const cleaned = cleanTree(child, full, include, values)
      if (cleaned) {
        children.push(cleaned)
      }
    }
    next = { ...next, [property]: children }
  }
  if (path && path in values) {
    next = withValue(next, values[path]!)
  }
  return next
}

function withValue (element: JsonRecord, value: string): JsonRecord {
  switch (element.modelType) {
    case 'Property':
    case 'File': {
      return { ...element, value }
    }
    case 'MultiLanguageProperty': {
      return { ...element, value: [{ language: 'en', text: value }] }
    }
    default: {
      return element
    }
  }
}

export interface InstantiateOptions {
  id: string
  idShort?: string
  /** Paths of optional elements to keep; `null` keeps all of them (a plain conversion). */
  include?: ReadonlySet<string> | null
  /** Values by element path. */
  values?: Readonly<Record<string, string>>
}

/**
 * A template as an instance (T2): a new ID, kind `Instance`, template
 * qualifiers removed and optional elements left out unless selected.
 */
export function instantiateSubmodel (template: JsonRecord, options: InstantiateOptions): JsonRecord {
  const cleaned = cleanTree(template, '', options.include ?? new Set<string>(), options.values ?? {})!
  // The template's administration names the template, not the instance.
  const { administration, ...rest } = cleaned
  const { templateId: _, ...kept } = (administration ?? {}) as JsonRecord
  return {
    ...rest,
    id: options.id,
    ...(options.idShort ? { idShort: options.idShort } : {}),
    kind: 'Instance',
    ...(Object.keys(kept).length > 0 ? { administration: kept } : {}),
  }
}

/** *Convert to instance* (T5): kind `Instance` and no template qualifiers, optional elements kept. */
export function convertToInstance (submodel: JsonRecord): { submodel: JsonRecord, removedQualifiers: number } {
  const before = countTemplateQualifiers(submodel)
  const converted = cleanTree(submodel, '', null, {})!
  return { submodel: { ...converted, kind: 'Instance' }, removedQualifiers: before }
}

export function countTemplateQualifiers (node: JsonRecord): number {
  let count = records(node.qualifiers).filter(qualifier => qualifier.kind === 'TemplateQualifier').length
  const property = childProperty[String(node.modelType)]
  if (property) {
    for (const child of records(node[property])) {
      count += countTemplateQualifiers(child)
    }
  }
  return count
}

export interface TemplateField {
  path: string
  label: string
  modelType: string
  valueType: string | null
  /** The template requires it (cardinality `One` or `OneToMany`, or none). */
  required: boolean
  /** A Property, MultiLanguageProperty or File: takes a value in the wizard. */
  input: boolean
  depth: number
}

function labelOf (element: JsonRecord): string {
  const names = records(element.displayName)
  const name = names.find(entry => entry.language === 'en') ?? names[0]
  return String(name?.text ?? element.idShort ?? '')
}

/**
 * The elements of a template the wizard shows (T3): every element with its
 * path, whether it is required, and whether it takes a value. Optional
 * elements (cardinality `ZeroToOne`, `ZeroToMany`) are offered for selection;
 * the children of a list are not enumerated.
 */
export function templateFields (template: JsonRecord): TemplateField[] {
  const fields: TemplateField[] = []
  const visit = (parent: JsonRecord, parentPath: string, depth: number, parentRequired: boolean) => {
    const property = childProperty[String(parent.modelType)]
    if (!property || parent.modelType === 'SubmodelElementList') {
      return
    }
    for (const [index, child] of records(parent[property]).entries()) {
      const path = childPath(parentPath, parent, child, index)
      const required = parentRequired && !isOptional(child)
      const modelType = String(child.modelType)
      fields.push({
        path,
        label: labelOf(child),
        modelType,
        valueType: typeof child.valueType === 'string' ? child.valueType : null,
        required,
        input: ['Property', 'MultiLanguageProperty', 'File'].includes(modelType),
        depth,
      })
      visit(child, path, depth + 1, required)
    }
  }
  visit(template, '', 0, true)
  return fields
}
