import type { JsonObject } from '~~/server/lib/aas/outline'
import { describe, expect, it } from 'vitest'
import { contentHash, structureRevisionOf } from '~~/server/lib/targets/revision'
import { WorkspaceModel } from '~~/server/lib/workspaces/model'

import { newElement } from '#shared/aas/defaults'

const submodelId = 'urn:studio:test:sm:structure'

function model () {
  const environment: JsonObject = {
    assetAdministrationShells: [],
    submodels: [{
      modelType: 'Submodel',
      id: submodelId,
      idShort: 'Structure',
      submodelElements: [
        { modelType: 'Property', idShort: 'First', valueType: 'xs:string', value: 'a' },
        { modelType: 'Property', idShort: 'Second', valueType: 'xs:string', value: 'b' },
        {
          modelType: 'SubmodelElementCollection',
          idShort: 'Group',
          value: [{ modelType: 'Property', idShort: 'Inner', valueType: 'xs:string', value: 'x' }],
        },
        {
          modelType: 'SubmodelElementList',
          idShort: 'Numbers',
          typeValueListElement: 'Property',
          valueTypeListElement: 'xs:int',
          value: [{ modelType: 'Property', valueType: 'xs:int', value: '1' }],
        },
      ],
    }],
  }
  return new WorkspaceModel(environment)
}

function topRevision (target: WorkspaceModel) {
  return structureRevisionOf((target.submodel(submodelId).submodelElements as unknown[]))
}

describe('structural edits of a workspace', () => {
  it('adds, renames, moves and deletes elements', () => {
    const target = model()
    const added = target.addElement(submodelId, null, newElement('Property', 'Third'), null, topRevision(target))
    expect(added.path).toBe('Third')
    expect(added.snapshot?.value).toMatchObject({ idShort: 'Third', valueType: 'xs:string' })
    expect(target.unsavedChanges).toBe(true)

    const renamed = target.replaceElement(submodelId, 'Third', { ...newElement('Property', 'Renamed'), value: 'v' }, added.snapshot!.revision)
    expect(renamed.path).toBe('Renamed')
    expect(() => target.element(submodelId, 'Third')).toThrow()

    const moved = target.moveElement(submodelId, 'Renamed', 0, topRevision(target))
    expect(moved.path).toBe('Renamed')
    expect((target.submodel(submodelId).submodelElements as JsonObject[])[0]!.idShort).toBe('Renamed')

    target.deleteElement(submodelId, 'Renamed', target.element(submodelId, 'Renamed').revision)
    expect(() => target.element(submodelId, 'Renamed')).toThrow()
  })

  it('refuses duplicates, stale revisions and invalid elements', () => {
    const target = model()
    const revision = topRevision(target)
    expect(() => target.addElement(submodelId, null, newElement('Property', 'First'), null, revision))
      .toThrowError(expect.objectContaining({ code: 'idshort_conflict' }))

    target.addElement(submodelId, null, newElement('Property', 'Other'), null, revision)
    expect(() => target.addElement(submodelId, null, newElement('Property', 'Late'), null, revision))
      .toThrowError(expect.objectContaining({ code: 'structure_conflict' }))

    expect(() => target.addElement(submodelId, null, { ...newElement('Range', 'Bad'), min: 'x', max: '1', valueType: 'xs:int' }, null, topRevision(target)))
      .toThrowError(expect.objectContaining({ code: 'validation_failed' }))
  })

  it('keeps the children of a container when its metadata changes', () => {
    const target = model()
    const group = target.element(submodelId, 'Group')
    const renamed = target.replaceElement(submodelId, 'Group', { modelType: 'SubmodelElementCollection', idShort: 'Renamed' }, group.revision)
    expect(renamed.path).toBe('Renamed')
    expect(target.element(submodelId, 'Renamed.Inner').value).toMatchObject({ value: 'x' })
  })

  it('inserts into lists at an index and keeps lists typed', () => {
    const target = model()
    const list = target.element(submodelId, 'Numbers')
    const revision = structureRevisionOf((list.value.value as unknown[]))
    const inserted = target.addElement(submodelId, 'Numbers', { ...newElement('Property', null, list.value), value: '0' }, 0, revision)
    expect(inserted.path).toBe('Numbers[0]')
    expect(() => target.addElement(submodelId, 'Numbers', newElement('Capability', null), null, structureRevisionOf((target.element(submodelId, 'Numbers').value.value as unknown[]))))
      .toThrowError(expect.objectContaining({ code: 'validation_failed' }))
  })

  it('refuses a stale list reorder, although list items are anonymous', () => {
    const target = model()
    const listRevision = () => structureRevisionOf((target.element(submodelId, 'Numbers').value.value as unknown[]))
    target.addElement(submodelId, 'Numbers', { ...newElement('Property', null, target.element(submodelId, 'Numbers').value), value: '2' }, null, listRevision())
    const read = listRevision()
    target.moveElement(submodelId, 'Numbers[0]', 1, read)
    expect(listRevision()).not.toBe(read)
    expect(() => target.moveElement(submodelId, 'Numbers[0]', 1, read)).toThrowError(expect.objectContaining({ code: 'structure_conflict' }))
    expect((target.element(submodelId, 'Numbers').value.value as JsonObject[]).map(item => item.value)).toEqual(['2', '1'])
  })

  it('refuses children a parent of any kind does not accept', () => {
    const target = model()
    const reference = (value: string) => ({ type: 'ExternalReference', keys: [{ type: 'GlobalReference', value }] })
    target.addElement(submodelId, null, { modelType: 'AnnotatedRelationshipElement', idShort: 'Relation', first: reference('urn:a'), second: reference('urn:b') }, null, topRevision(target))
    expect(() => target.addElement(submodelId, 'Relation', { modelType: 'SubmodelElementCollection', idShort: 'Pasted' }, null, structureRevisionOf([])))
      .toThrowError(expect.objectContaining({ code: 'validation_failed' }))
    expect(target.element(submodelId, 'Relation').value.annotations).toBeUndefined()
    const added = target.addElement(submodelId, 'Relation', newElement('Property', 'Note'), null, structureRevisionOf([]))
    expect(added.path).toBe('Relation.Note')
  })

  it('refuses deleting an element that changed after it was read', () => {
    const target = model()
    const stale = target.element(submodelId, 'First').revision
    const { revision } = target.element(submodelId, 'First')
    target.setElementValue(submodelId, 'First', 'changed', revision)
    expect(() => target.deleteElement(submodelId, 'First', stale)).toThrowError(expect.objectContaining({ code: 'revision_conflict' }))
  })

  it('replaces submodel metadata and keeps the elements', () => {
    const target = model()
    const metadata = target.submodelMetadata(submodelId)
    const changed = target.replaceSubmodelMetadata(submodelId, { ...metadata, idShort: 'Renamed', category: 'PARAMETER' }, `h.${hashOf(metadata)}`)
    expect(changed).toMatchObject({ idShort: 'Renamed', category: 'PARAMETER' })
    expect((target.submodel(submodelId).submodelElements as unknown[]).length).toBe(4)
  })
})
function hashOf (value: unknown) {
  return contentHash(value)
}
