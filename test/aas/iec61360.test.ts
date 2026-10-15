import { describe, expect, it } from 'vitest'
import { findings } from '~~/server/lib/aas/edits'

import { conceptDescriptionFromElement, dataTypeFor, iec61360Iri, newConceptDescription, newIec61360, ownUnit } from '#shared/aas/iec61360'

describe('IEC 61360 helpers', () => {
  it('suggests a data type from the element', () => {
    expect(dataTypeFor({ modelType: 'Property', valueType: 'xs:string' })).toBe('STRING')
    expect(dataTypeFor({ modelType: 'Property', valueType: 'xs:unsignedInt' })).toBe('INTEGER_COUNT')
    expect(dataTypeFor({ modelType: 'Property', valueType: 'xs:double' })).toBe('REAL_MEASURE')
    expect(dataTypeFor({ modelType: 'MultiLanguageProperty' })).toBe('STRING_TRANSLATABLE')
    expect(dataTypeFor({ modelType: 'SubmodelElementCollection' })).toBeNull()
  })

  it('prefills a concept description that AAS Core accepts', () => {
    const element = {
      modelType: 'Property',
      idShort: 'MaxTorque',
      valueType: 'xs:double',
      displayName: [{ language: 'en', text: 'Maximum torque' }],
      description: [{ language: 'en', text: 'Largest torque the drive delivers.' }],
      embeddedDataSpecifications: [{ ...newIec61360('Maximum torque'), dataSpecificationContent: { modelType: 'DataSpecificationIec61360', preferredName: [{ language: 'en', text: 'Maximum torque' }], unit: 'Nm' } }],
    }
    const cd = conceptDescriptionFromElement(element, '0173-1#02-AAB713#005')
    expect(cd).toMatchObject({
      id: '0173-1#02-AAB713#005',
      idShort: 'MaxTorque',
      embeddedDataSpecifications: [{
        dataSpecification: { keys: [{ value: iec61360Iri }] },
        dataSpecificationContent: { preferredName: [{ text: 'Maximum torque' }], dataType: 'REAL_MEASURE', unit: 'Nm' },
      }],
    })
    expect(findings('conceptDescription', cd)).toEqual([])
  })

  it('falls back to a count without a unit', () => {
    const cd = conceptDescriptionFromElement({ modelType: 'Property', idShort: 'Speed', valueType: 'xs:double', description: [{ language: 'en', text: 'Rotational speed.' }] }, 'urn:example:speed')
    expect((cd.embeddedDataSpecifications as Array<{ dataSpecificationContent: Record<string, unknown> }>)[0]!.dataSpecificationContent.dataType).toBe('REAL_COUNT')
    expect(findings('conceptDescription', cd)).toEqual([])
  })

  it('leaves the definition to the user, which AAS Core requires in English (AASc-3a-008)', () => {
    const messages = findings('conceptDescription', newConceptDescription('urn:example:cd', 'Example')).map(finding => finding.message)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatch(/AASc-3a-008/)
  })

  it('reads the unit of an element\'s own IEC 61360 entry', () => {
    const entry = newIec61360('Speed')
    ;(entry.dataSpecificationContent as Record<string, unknown>).unit = '1/min'
    expect(ownUnit({ modelType: 'Property', embeddedDataSpecifications: [entry] })).toBe('1/min')
    expect(ownUnit({ modelType: 'Property' })).toBeNull()
  })
})
