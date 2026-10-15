import type { JsonObject } from '~~/server/lib/aas/outline'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LiveAasTarget } from '~~/server/lib/targets/live-target'
import { revisionOf } from '~~/server/lib/targets/revision'
import { conceptDescriptionFromElement } from '#shared/aas/iec61360'
import { policy, record } from '../support/live'
import { openTargetUrl, testenvAvailable } from '../support/testenv'

// The open AAS environment serves the concept description repository and
// announces the query profiles, so usages can be counted.
let profiles: string[] = []

function open () {
  return new LiveAasTarget({
    record: {
      ...record(openTargetUrl, { mode: 'unsecured' }),
      template: 'mono-all',
      endpoints: [{ type: 'aasEnvironment', url: openTargetUrl }],
      serviceProfiles: { aasEnvironment: profiles },
    },
    access: { accessToken: undefined, downstreamIdentity: null },
    policy: policy(openTargetUrl),
    requestId: 'test-request',
    onUnauthorized: async () => {},
  })
}

function content (cd: JsonObject): JsonObject {
  return (cd.embeddedDataSpecifications as JsonObject[])[0]!.dataSpecificationContent as JsonObject
}

describe.runIf(testenvAvailable)('LiveAasTarget concept descriptions against the test environment', () => {
  let target: LiveAasTarget
  beforeAll(async () => {
    profiles = (await (await fetch(`${openTargetUrl}/description`)).json() as { profiles: string[] }).profiles
    target = open()
  })
  const id = `https://studio.test/ids/cd/${globalThis.crypto.randomUUID()}`
  const submodelId = `https://studio.test/ids/sm/${globalThis.crypto.randomUUID()}`
  // The test environment is shared: whatever a test creates is removed again.
  afterAll(async () => {
    await target.deleteSubmodel(submodelId).catch(() => {})
    const current = await target.conceptDescription(id).catch(() => null)
    if (current) {
      await target.deleteConceptDescription(id, revisionOf(current)).catch(() => {})
    }
  })

  const element = {
    modelType: 'Property',
    idShort: 'MaxTorque',
    valueType: 'xs:double',
    description: [{ language: 'en', text: 'Largest torque the drive delivers.' }],
    semanticId: { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: id }] },
  }

  it('creates, replaces and deletes with revisions', async () => {
    const created = conceptDescriptionFromElement(element, id)
    await target.createConceptDescription(created)
    await expect(target.createConceptDescription(created)).rejects.toMatchObject({ code: 'identifier_conflict' })

    const stored = await target.conceptDescription(id)
    expect(content(stored)).toMatchObject({ dataType: 'REAL_COUNT', definition: [{ text: 'Largest torque the drive delivers.' }] })

    const edited = structuredClone(stored)
    Object.assign(content(edited), { dataType: 'REAL_MEASURE', unit: 'Nm' })
    const replaced = await target.replaceConceptDescription(id, edited, revisionOf(stored))
    expect(content(replaced)).toMatchObject({ dataType: 'REAL_MEASURE', unit: 'Nm' })

    // The revision the first edit was based on is gone.
    await expect(target.replaceConceptDescription(id, edited, revisionOf(stored))).rejects.toMatchObject({ code: 'revision_conflict' })
    await expect(target.deleteConceptDescription(id, revisionOf(stored))).rejects.toMatchObject({ code: 'revision_conflict' })

    // AAS Core refuses a measure without a unit (AASc-3a-009) before anything is written.
    const invalid = structuredClone(replaced)
    delete content(invalid).unit
    await expect(target.replaceConceptDescription(id, invalid, revisionOf(replaced))).rejects.toMatchObject({ code: 'validation_failed' })
  })

  it('searches through the query endpoint by expression and raw query', async () => {
    expect(target.capabilities.conceptDescriptionSearch).toBe('query')
    const byText = await target.searchConceptDescriptions({ expression: 'manufacturername' }, [], 50, undefined)
    expect(byText.items.map(cd => cd.idShort)).toContain('ManufacturerName')
    const byId = await target.searchConceptDescriptions({ expression: `id=${id}` }, [], 50, undefined)
    expect(byId.items.map(cd => cd.id)).toEqual([id])
    const raw = await target.searchConceptDescriptions({ query: { $condition: { $eq: [{ $field: '$cd#idShort' }, { $strVal: 'ManufacturerName' }] } } }, [], 50, undefined)
    // The test environment has more than one version of it.
    expect(raw.items.length).toBeGreaterThan(0)
    expect(raw.items.every(cd => cd.idShort === 'ManufacturerName')).toBe(true)
    // Sources narrow on the server: ECLASS IRDIs start with 0173-.
    const eclass = await target.searchConceptDescriptions({ expression: '' }, ['ECLASS'], 200, undefined)
    expect(eclass.items.length).toBeGreaterThan(0)
    expect(eclass.items.every(cd => cd.id.startsWith('0173-'))).toBe(true)
    const studio = await target.searchConceptDescriptions({ expression: 'studio.test' }, ['Other'], 50, undefined)
    expect(studio.items.map(cd => cd.id)).toContain(id)
    await expect(target.searchConceptDescriptions({ query: { $condition: { $eq: [{ $field: '$aas#idShort' }, { $strVal: 'x' }] } } }, [], 50, undefined))
      .rejects
      .toMatchObject({ code: 'query_invalid' })
  })

  it('counts the submodels and elements that reference it, where the target can query', async () => {
    await target.createSubmodel({
      modelType: 'Submodel',
      id: submodelId,
      idShort: 'Drive',
      submodelElements: [element, { modelType: 'Property', idShort: 'Other', valueType: 'xs:string' }],
    })
    const usages = await target.conceptDescriptionUsages(id)
    if (target.capabilities.elementSearch) {
      expect(usages).toMatchObject({ checked: true, elements: 1, submodels: 0 })
    } else {
      expect(usages.checked).toBe(false)
    }
  })

  it('deletes based on the current revision', async () => {
    const current = await target.conceptDescription(id)
    await target.deleteConceptDescription(id, revisionOf(current))
    await expect(target.conceptDescription(id)).rejects.toMatchObject({ code: 'target_resource_not_found' })
  })
})
