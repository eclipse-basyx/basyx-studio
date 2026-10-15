import type { SubmodelTemplate } from '#shared/contract'
import type { JsonObject } from '../aas/outline'
import { StudioProblem } from '../problem'
import contactInformation from './contact-information-smc.json'
import digitalNameplate from './digital-nameplate.json'
import handoverDocumentation from './handover-documentation.json'
import technicalData from './technical-data.json'

// The IDTA submodel templates Studio bundles (MVP-5 plan, T1), versioned with
// Studio. A template registry or the IDTA repository online comes later.

interface Bundled {
  name: string
  title: string
  json: JsonObject
}

const bundled: Bundled[] = [
  { name: 'digital-nameplate', title: 'Digital Nameplate', json: digitalNameplate as JsonObject },
  { name: 'technical-data', title: 'Technical Data', json: technicalData as JsonObject },
  { name: 'handover-documentation', title: 'Handover Documentation', json: handoverDocumentation as JsonObject },
  { name: 'contact-information', title: 'Contact Information', json: contactInformation as JsonObject },
]

function semanticIdOf (json: JsonObject): string | null {
  const keys = (json.semanticId as { keys?: Array<{ value?: unknown }> } | undefined)?.keys
  return typeof keys?.[0]?.value === 'string' ? keys[0].value : null
}

export function bundledTemplates (): SubmodelTemplate[] {
  return bundled.map(entry => ({
    id: `bundled:${entry.name}`,
    title: entry.title,
    semanticId: semanticIdOf(entry.json),
    source: 'bundled',
    version: ((entry.json.administration as { version?: string } | undefined)?.version) ?? null,
  }))
}

/**
 * A bundled template as a submodel. The Contact Information template is a
 * collection in the IDTA repository; it gets a submodel around it.
 */
export function bundledTemplate (id: string): JsonObject {
  const entry = bundled.find(candidate => `bundled:${candidate.name}` === id)
  if (!entry) {
    throw new StudioProblem('template_invalid', `Unknown template ${id}.`)
  }
  const copy = structuredClone(entry.json)
  if (copy.modelType === 'SubmodelElementCollection') {
    return {
      modelType: 'Submodel',
      id: `https://admin-shell.io/idta/SubmodelTemplate/${entry.name}`,
      idShort: String(copy.idShort ?? 'ContactInformation'),
      kind: 'Template',
      submodelElements: [copy],
    }
  }
  return copy
}
