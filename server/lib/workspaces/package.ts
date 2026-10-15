import type { JsonObject } from '../aas/outline'
import type { ArchiveLimits } from './archive'
import type { PackageReadWrite, Part } from 'aas-package3-typescript'
import { jsonization, types, verification, xmlization } from '@aas-core-works/aas-core3.1-typescript'
import { NewPackaging } from 'aas-package3-typescript'
import { StudioProblem } from '../problem'
import { defaultArchiveLimits, inspectArchive } from './archive'

export type SpecFormat = 'xml' | 'json'

/** An opened AASX package: its single AAS spec as JSON and the package to write it back into. */
export interface OpenedPackage {
  pkg: PackageReadWrite
  spec: Part
  format: SpecFormat
  environment: JsonObject
  /** AAS Core verification findings of the package as opened (first 50). */
  diagnostics: string[]
}

const maxDiagnostics = 50

function specFormat (spec: Part): SpecFormat | null {
  const type = spec.ContentType.toLowerCase()
  const path = spec.URI.pathname.toLowerCase()
  if (type.includes('xml') || path.endsWith('.xml')) {
    return 'xml'
  }
  if (type.includes('json') || path.endsWith('.json')) {
    return 'json'
  }
  return null
}

export function parseEnvironment (format: SpecFormat, content: Uint8Array): types.Environment {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(content).replace(/^\uFEFF/, '')
  if (format === 'xml') {
    if (text.includes('https://admin-shell.io/aas/3/0') && !text.includes('https://admin-shell.io/aas/3/1')) {
      throw new StudioProblem('package_rejected', 'Packages of AAS version 3.0 are not supported yet; Studio edits AAS 3.1.')
    }
    if (text.includes('https://admin-shell.io/aas/3/2') && !text.includes('https://admin-shell.io/aas/3/1')) {
      throw new StudioProblem('package_rejected', 'AAS 3.2 XML is not supported yet; Studio validates AAS 3.1. Use the JSON format instead.')
    }
    // AAS Core expects the root element first, without the XML declaration.
    const parsed = xmlization.fromXmlString(text.replace(/^\s*<\?xml[^>]*\?>\s*/, ''))
    if (parsed.error) {
      throw new StudioProblem('package_rejected', `The AAS XML is invalid: ${parsed.error.message} (${parsed.error.path.toString()})`)
    }
    const value = parsed.mustValue()
    if (!(value instanceof types.Environment)) {
      throw new StudioProblem('package_rejected', 'The AAS XML does not contain an environment.')
    }
    return value
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new StudioProblem('package_rejected', 'The AAS JSON is not valid JSON.')
  }
  const parsed = jsonization.environmentFromJsonable(json as jsonization.JsonValue)
  if (parsed.error) {
    throw new StudioProblem('package_rejected', `The AAS JSON is invalid: ${parsed.error.message} (${parsed.error.path.toString()})`)
  }
  return parsed.mustValue()
}

/** Opens a package after checking it (DATA-006) and parses its AAS spec with AAS Core. */
export async function readPackage (bytes: Uint8Array, limits: ArchiveLimits = defaultArchiveLimits): Promise<OpenedPackage> {
  inspectArchive(bytes, limits)
  let pkg: PackageReadWrite
  try {
    pkg = await NewPackaging().OpenReadWriteFromBytes(bytes)
  } catch (error) {
    throw new StudioProblem('package_rejected', `The file is not a valid AASX package (${error instanceof Error ? error.message : 'unknown error'}).`)
  }
  const specs = await pkg.Specs()
  if (specs.length !== 1) {
    throw new StudioProblem('package_rejected', specs.length === 0
      ? 'The package contains no AAS.'
      : 'Packages with more than one AAS spec part are not supported yet.')
  }
  const spec = specs[0]!
  const format = specFormat(spec)
  if (!format) {
    throw new StudioProblem('package_rejected', `The AAS spec has an unsupported content type (${spec.ContentType}).`)
  }
  const environment = parseEnvironment(format, spec.ReadAllBytes())
  return { pkg, spec, format, environment: jsonization.toJsonable(environment) as JsonObject, diagnostics: diagnosticsOf(environment) }
}

function diagnosticsOf (environment: types.Environment): string[] {
  const diagnostics: string[] = []
  for (const error of verification.verify(environment)) {
    diagnostics.push(`${error.path.toString()}: ${error.message}`)
    if (diagnostics.length >= maxDiagnostics) {
      break
    }
  }
  return diagnostics
}

export type UploadFormat = 'aasx' | SpecFormat

export interface InspectedEnvironment {
  shellIds: string[]
  diagnostics: string[]
}

/**
 * Checks an AASX, JSON or XML file before Studio forwards it to a target
 * (D16): archive limits and AAS Core parsing as for opened packages.
 */
export async function inspectEnvironment (bytes: Uint8Array, format: UploadFormat, limits: ArchiveLimits = defaultArchiveLimits): Promise<InspectedEnvironment> {
  let environment: JsonObject
  let diagnostics: string[]
  if (format === 'aasx') {
    const opened = await readPackage(bytes, limits)
    opened.pkg.Close()
    environment = opened.environment
    diagnostics = opened.diagnostics
  } else {
    const parsed = parseEnvironment(format, bytes)
    environment = jsonization.toJsonable(parsed) as JsonObject
    diagnostics = diagnosticsOf(parsed)
  }
  const shells = Array.isArray(environment.assetAdministrationShells) ? environment.assetAdministrationShells as JsonObject[] : []
  return { shellIds: shells.map(shell => String(shell.id)), diagnostics }
}

/** The bytes of a new package: an empty environment as the JSON spec part, ready to open. */
export async function newPackageBytes (): Promise<Uint8Array> {
  let stored: Uint8Array = new Uint8Array(0)
  const stream = {
    readAll: () => stored,
    writeAll: (data: Uint8Array) => {
      stored = data
    },
  }
  const pkg = await NewPackaging().CreateInStream(stream)
  const spec = await pkg.PutPart(
    new URL('file:///aasx/data.json'),
    'application/json',
    new TextEncoder().encode(JSON.stringify({ assetAdministrationShells: [], submodels: [], conceptDescriptions: [] })),
  )
  await pkg.MakeSpec(spec)
  return pkg.Flush()
}

/** Serializes the environment in the package's original format and returns the new package bytes. */
export async function writePackage (opened: OpenedPackage, environment: JsonObject): Promise<Uint8Array> {
  const parsed = jsonization.environmentFromJsonable(environment as jsonization.JsonValue)
  if (parsed.error) {
    throw new StudioProblem('internal_error', `The workspace model cannot be serialized: ${parsed.error.message}`)
  }
  const instance = parsed.mustValue()
  const content = opened.format === 'xml'
    ? `<?xml version="1.0" encoding="UTF-8"?>\n${xmlization.toXmlString(instance)}`
    : JSON.stringify(jsonization.toJsonable(instance), null, 2)
  await opened.pkg.PutPart(opened.spec.URI, opened.spec.ContentType, new TextEncoder().encode(content))
  return opened.pkg.Flush()
}
