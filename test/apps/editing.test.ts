import type { JsonObject } from '@basyx/studio-sdk'
import { rangeFieldOf, textFieldOf } from '@basyx/studio-app-kit/aas'
import { draftRange, draftValue, editLanguage, useFieldEditor } from '@basyx/studio-app-kit/editing'
import { createTestStudio, memoryAas } from '@basyx/studio-sdk/testing'
import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'

// Changing values in place with the app kit's `./editing`, as the Digital
// Nameplate, Contacts and Technical Data apps do: drafts of Properties,
// MultiLanguageProperties and Ranges, and saves through the test Studio
// with revisions and conflicts.

describe('changing values in place', () => {
  const property = { path: 'SerialNumber', modelType: 'Property' as const, values: [], valueId: '' }
  const mlp = { path: 'ManufacturerProductDesignation', modelType: 'MultiLanguageProperty' as const, values: [], valueId: '' }
  const texts = [{ language: 'en', text: 'Gear motor' }, { language: 'de', text: 'Getriebemotor' }]

  it('changes a MultiLanguageProperty in the language the view shows, keeping the others', () => {
    expect(editLanguage(texts, 'de-saar')).toBe('de')
    expect(editLanguage(texts, 'fr')).toBe('en')
    expect(editLanguage([], 'fr')).toBe('fr')
    expect(draftValue({ field: mlp, value: 'Getriebemotor GM-40', language: 'de', values: texts })).toEqual([{ language: 'en', text: 'Gear motor' }, { language: 'de', text: 'Getriebemotor GM-40' }])
    expect(draftValue({ field: mlp, value: 'Motoréducteur', language: 'fr', values: texts })).toEqual([...texts, { language: 'fr', text: 'Motoréducteur' }])
    expect(draftValue({ field: mlp, value: ' ', language: 'de', values: texts })).toEqual([{ language: 'en', text: 'Gear motor' }])
  })

  it('writes plain texts, which postMessage can clone, from the draft\'s reactive ones', () => {
    const draft = reactive({ field: mlp, value: 'Getriebemotor GM-40', language: 'de', values: texts.map(entry => ({ ...entry })) })
    expect(() => structuredClone(draftValue(draft))).not.toThrow()
    expect(() => structuredClone(draftValue({ ...draft, value: '' }))).not.toThrow()
  })

  it('writes a Property\'s text, and no value for an empty one', () => {
    expect(draftValue({ field: property, value: ' SN-1 ', language: '', values: [] })).toBe('SN-1')
    expect(draftValue({ field: property, value: '', language: '', values: [] })).toBeNull()
  })

  it('writes a Range with its new bounds, an empty one left out, as a plain object', () => {
    const element = reactive({ idShort: 'Temperature', modelType: 'Range', valueType: 'xs:double', min: '-20', max: '40' }) as JsonObject
    expect(draftRange({ element, value: ' -25 ', max: '45' })).toEqual({ idShort: 'Temperature', modelType: 'Range', valueType: 'xs:double', min: '-25', max: '45' })
    expect(draftRange({ element, value: '', max: '45' })).toEqual({ idShort: 'Temperature', modelType: 'Range', valueType: 'xs:double', max: '45' })
    expect(() => structuredClone(draftRange({ element, value: '1', max: '2' }))).not.toThrow()
  })

  it('reads a Range as a field with its bounds', () => {
    expect(rangeFieldOf({ path: 'A.T', element: { modelType: 'Range', valueType: 'xs:int', min: 5 } })).toEqual({ path: 'A.T', modelType: 'Range', min: '5', max: '', valueType: 'xs:int' })
    expect(rangeFieldOf({ path: 'A.P', element: { modelType: 'Property' } })).toBeUndefined()
  })
})

describe('the field editor', () => {
  const submodelId = 'urn:example:sm:technical-data'
  function setup () {
    const aas = memoryAas({
      submodels: [{
        modelType: 'Submodel',
        id: submodelId,
        idShort: 'TechnicalData',
        submodelElements: [
          { modelType: 'Property', idShort: 'RatedPower', valueType: 'xs:double', value: '3.0' },
          { modelType: 'Range', idShort: 'AmbientTemperature', valueType: 'xs:double', min: '-20', max: '40' },
        ],
      }],
    })
    const studio = createTestStudio({ handlers: aas.handlers, context: { mode: 'edit' } })
    const saved: string[] = []
    const editor = useFieldEditor({ client: studio.client, t: key => key, locale: () => 'en', submodelId: () => submodelId, onSaved: async label => void saved.push(label) })
    const element = (idShort: string) => (aas.submodels[0]!.submodelElements as JsonObject[]).find(entry => entry.idShort === idShort)!
    return { aas, editor, saved, element }
  }

  it('saves a Property with its revision', async () => {
    const { editor, saved, element } = setup()
    await editor.start(textFieldOf({ path: 'RatedPower', element: element('RatedPower') })!, 'Rated power')
    expect(editor.draft.value).toMatchObject({ value: '3.0', max: '' })
    editor.draft.value!.value = '3.2'
    await editor.save()
    expect(element('RatedPower').value).toBe('3.2')
    expect(saved).toEqual(['Rated power'])
    expect(editor.draft.value).toBeNull()
  })

  it('saves a Range\'s bounds with putElement', async () => {
    const { editor, element } = setup()
    await editor.start(rangeFieldOf({ path: 'AmbientTemperature', element: element('AmbientTemperature') })!, 'Ambient temperature')
    expect(editor.draft.value).toMatchObject({ value: '-20', max: '40' })
    editor.draft.value!.value = ''
    editor.draft.value!.max = '45'
    await editor.save()
    expect(element('AmbientTemperature')).toEqual({ modelType: 'Range', idShort: 'AmbientTemperature', valueType: 'xs:double', max: '45' })
  })

  it('keeps the draft with the conflict when the value changed in the meantime', async () => {
    const { editor, element } = setup()
    await editor.start(textFieldOf({ path: 'RatedPower', element: element('RatedPower') })!, 'Rated power')
    element('RatedPower').value = '2.9'
    editor.draft.value!.value = '3.2'
    await editor.save()
    expect(editor.draft.value?.error).toBe('edit.conflict')
    expect(element('RatedPower').value).toBe('2.9')
  })
})
