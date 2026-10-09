import type { DeploymentMode } from '#shared/contract'
import type { Violation } from '../problem'
import type { AppManifest } from '@basyx/studio-sdk/protocol'
import type { ErrorObject, ValidateFunction } from 'ajv/dist/2020.js'
import manifestSchema from '@basyx/studio-sdk/app-manifest.schema.json'
import { studioAppApiVersion } from '@basyx/studio-sdk/protocol'
import addFormats from 'ajv-formats'
import Ajv2020 from 'ajv/dist/2020.js'
import semver from 'semver'

export const manifestFileName = 'studio-app.json'

let validator: ValidateFunction<AppManifest> | undefined

/** The public manifest JSON Schema (ADR 0016), compiled once. */
function validateSchema (): ValidateFunction<AppManifest> {
  if (!validator) {
    const ajv = new Ajv2020({ allErrors: true, strict: true })
    addFormats(ajv, ['uri'])
    validator = ajv.compile<AppManifest>(manifestSchema)
  }
  return validator
}

function describe (error: ErrorObject): Violation {
  const path = `${manifestFileName}${error.instancePath ? error.instancePath.replaceAll('/', '.').replace(/^\./, '#') : ''}`
  let message = error.message ?? 'is invalid'
  if (error.keyword === 'additionalProperties') {
    message = `has the unknown property ${JSON.stringify(error.params.additionalProperty)}`
  } else if (error.keyword === 'enum') {
    message = `must be one of ${(error.params.allowedValues as unknown[]).map(value => JSON.stringify(value)).join(', ')}`
  }
  return { path, message }
}

/** Validates the manifest against the schema. Returns the findings, or the typed manifest. */
export function parseManifest (text: string): { manifest: AppManifest, findings: [] } | { manifest: null, findings: Violation[] } {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { manifest: null, findings: [{ path: manifestFileName, message: 'is not valid JSON' }] }
  }
  const validate = validateSchema()
  if (!validate(json)) {
    return { manifest: null, findings: (validate.errors ?? []).map(error => describe(error)) }
  }
  return { manifest: json, findings: [] }
}

/** Checks that do not fit JSON Schema: unique IDs and routes, and entries that exist. */
export function checkManifestConsistency (manifest: AppManifest, files: ReadonlySet<string>): Violation[] {
  const findings: Violation[] = []
  const ids = new Set<string>()
  const routes = new Set<string>()
  const contributions = [
    ...(manifest.contributes.submodelViews ?? []).map((item, index) => ({ item, at: `contributes.submodelViews[${index}]` })),
    ...(manifest.contributes.modules ?? []).map((item, index) => ({ item, at: `contributes.modules[${index}]` })),
  ]
  if (contributions.length === 0) {
    findings.push({ path: `${manifestFileName}#contributes`, message: 'must contribute at least one submodel view or module' })
  }
  for (const { item, at } of contributions) {
    if (ids.has(item.id)) {
      findings.push({ path: `${manifestFileName}#${at}.id`, message: `duplicates the contribution ID ${JSON.stringify(item.id)}` })
    }
    ids.add(item.id)
    if (!files.has(item.entry)) {
      findings.push({ path: `${manifestFileName}#${at}.entry`, message: `names ${JSON.stringify(item.entry)}, which is not in the package` })
    }
    if ('route' in item) {
      if (routes.has(item.route)) {
        findings.push({ path: `${manifestFileName}#${at}.route`, message: `duplicates the route ${JSON.stringify(item.route)}` })
      }
      routes.add(item.route)
    }
  }
  const hasBackendPermission = manifest.permissions.includes('studio.backend')
  if (manifest.backend) {
    if (!files.has(manifest.backend.entry)) {
      findings.push({ path: `${manifestFileName}#backend.entry`, message: `names ${JSON.stringify(manifest.backend.entry)}, which is not in the package` })
    }
    if (!hasBackendPermission) {
      findings.push({ path: `${manifestFileName}#permissions`, message: 'must include studio.backend when the app has a backend' })
    }
  } else if (hasBackendPermission) {
    findings.push({ path: `${manifestFileName}#permissions`, message: 'requests studio.backend, but the app has no backend' })
  }
  return findings
}

/** Technical compatibility with this Studio: app API range and runtime. */
export function checkCompatibility (manifest: AppManifest, deploymentMode: DeploymentMode): Violation[] {
  const findings: Violation[] = []
  const range = semver.validRange(manifest.studioApi)
  if (!range) {
    findings.push({ path: `${manifestFileName}#studioApi`, message: `is not a valid version range: ${JSON.stringify(manifest.studioApi)}` })
  } else if (!semver.satisfies(studioAppApiVersion, range)) {
    findings.push({ path: `${manifestFileName}#studioApi`, message: `requires Studio app API ${manifest.studioApi}; this Studio provides ${studioAppApiVersion}` })
  }
  if (!manifest.runtimes.includes(deploymentMode)) {
    findings.push({ path: `${manifestFileName}#runtimes`, message: `does not include ${deploymentMode}` })
  }
  return findings
}
