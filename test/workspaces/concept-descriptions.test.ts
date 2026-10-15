import type { JsonObject } from '~~/server/lib/aas/outline'
import { describe, expect, it } from 'vitest'
import { findings } from '~~/server/lib/aas/edits'
import { StudioProblem } from '~~/server/lib/problem'
import { revisionOf } from '~~/server/lib/targets/revision'
import { WorkspaceModel } from '~~/server/lib/workspaces/model'

import { iec61360Reference, newConceptDescription } from '#shared/aas/iec61360'

const torque = '0173-1#02-AAB713#005'

function torqueDescription (): JsonObject {
  return {
    modelType: 'ConceptDescription',
    id: torque,
    idShort: 'Torque',
    embeddedDataSpecifications: [{
      dataSpecification: iec61360Reference(),
      dataSpecificationContent: {
        modelType: 'DataSpecificationIec61360',
        preferredName: [{ language: 'en', text: 'Torque' }],
        definition: [{ language: 'en', text: 'Turning force about an axis.' }],
        dataType: 'REAL_MEASURE',
        unit: 'Nm',
      },
    }],
  }
}

function model () {
  return new WorkspaceModel({
    assetAdministrationShells: [],
    submodels: [{
      modelType: 'Submodel',
      id: 'urn:studio:test:sm:cd',
      idShort: 'Drive',
      semanticId: { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: torque }] },
      submodelElements: [
        { modelType: 'Property', idShort: 'MaxTorque', valueType: 'xs:double', semanticId: { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: torque }] } },
        {
          modelType: 'SubmodelElementCollection',
          idShort: 'Group',
          value: [{ modelType: 'Property', idShort: 'Inner', valueType: 'xs:double', semanticId: { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: torque }] } }],
        },
        { modelType: 'Property', idShort: 'Other', valueType: 'xs:string' },
      ],
    }],
    conceptDescriptions: [torqueDescription()],
  })
}

describe('concept descriptions in a workspace', () => {
  it('creates, replaces and deletes based on revisions', () => {
    const target = model()
    const created = newConceptDescription('urn:studio:test:cd:voltage', 'RatedVoltage', 'en')
    target.createConceptDescription(created)
    expect(target.conceptDescriptions(10, undefined).items.map(cd => cd.id)).toContain('urn:studio:test:cd:voltage')
    expect(() => target.createConceptDescription(created)).toThrow(StudioProblem)

    const current = target.conceptDescription(torque)
    const edited = structuredClone(current)
    ;((edited.embeddedDataSpecifications as JsonObject[])[0]!.dataSpecificationContent as JsonObject).unit = 'N·m'
    const stored = target.replaceConceptDescription(torque, edited, revisionOf(current))
    expect(((stored.embeddedDataSpecifications as JsonObject[])[0]!.dataSpecificationContent as JsonObject).unit).toBe('N·m')

    // The old revision no longer matches.
    expect(() => target.replaceConceptDescription(torque, edited, revisionOf(current))).toThrow(/changed|conflict/i)
    expect(() => target.deleteConceptDescription(torque, revisionOf(current))).toThrow(StudioProblem)

    target.deleteConceptDescription(torque, revisionOf(stored))
    expect(() => target.conceptDescription(torque)).toThrow(StudioProblem)
  })

  it('refuses a changed identifier and invalid IEC 61360 content', () => {
    const target = model()
    const current = target.conceptDescription(torque)
    expect(() => target.replaceConceptDescription(torque, { ...current, id: 'urn:other' }, revisionOf(current))).toThrow(/cannot be changed/)

    const invalid = structuredClone(current)
    ;((invalid.embeddedDataSpecifications as JsonObject[])[0]!.dataSpecificationContent as JsonObject).preferredName = []
    expect(() => target.replaceConceptDescription(torque, invalid, revisionOf(current))).toThrow(StudioProblem)
    expect(findings('conceptDescription', invalid).length).toBeGreaterThan(0)
    expect(findings('conceptDescription', current)).toEqual([])
  })

  it('searches by expression', () => {
    expect(model().searchConceptDescriptions('torque', [], 10, undefined).items.map(cd => cd.id)).toEqual([torque])
    expect(model().searchConceptDescriptions('idShort=Speed', [], 10, undefined).items).toEqual([])
    // Torque is an ECLASS IRDI.
    expect(model().searchConceptDescriptions('', ['ECLASS'], 10, undefined).items.map(cd => cd.id)).toEqual([torque])
    expect(model().searchConceptDescriptions('', ['IDTA', 'Other'], 10, undefined).items).toEqual([])
  })

  it('counts the submodels and elements that reference it', () => {
    expect(model().conceptDescriptionUsages(torque)).toEqual({ checked: true, submodels: 1, elements: 2, truncated: false })
    expect(model().conceptDescriptionUsages('urn:unused')).toEqual({ checked: true, submodels: 0, elements: 0, truncated: false })
  })

  it('undoes a change to a concept description', () => {
    const target = model()
    const before = target.snapshot()
    const current = target.conceptDescription(torque)
    target.deleteConceptDescription(torque, revisionOf(current))
    target.recordChange(before)
    target.undo()
    expect(target.conceptDescription(torque).idShort).toBe('Torque')
  })
})
