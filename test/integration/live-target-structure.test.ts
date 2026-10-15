import { afterAll, describe, expect, it } from 'vitest'
import { addSubmodel, convertSubmodelToInstance, createInstance, createShell, removeSubmodel } from '~~/server/lib/aas/creation'
import { shellMetadata } from '~~/server/lib/aas/edits'
import { LiveAasTarget } from '~~/server/lib/targets/live-target'
import { revisionOf, structureRevisionOf } from '~~/server/lib/targets/revision'
import { newElement } from '#shared/aas/defaults'
import { policy, record } from '../support/live'
import { openTargetUrl, testenvAvailable } from '../support/testenv'

const scheme = { type: 'iri', prefix: 'https://studio.test/ids/' } as const
const noSync = { registry: false, discovery: false }

function open () {
  return new LiveAasTarget({
    record: record(openTargetUrl, { mode: 'unsecured' }),
    access: { accessToken: undefined, downstreamIdentity: null },
    policy: policy(openTargetUrl),
    requestId: 'test-request',
    onUnauthorized: async () => {},
  })
}

describe.runIf(testenvAvailable)('LiveAasTarget structural writes against the test environment', () => {
  const target = open()
  const context = { target, scheme, plan: noSync }
  // The test environment is shared: whatever a test creates is removed again.
  const shells: string[] = []
  const submodels: string[] = []
  afterAll(async () => {
    for (const id of shells) {
      await target.deleteShell(id).catch(() => {})
    }
    for (const id of submodels) {
      await target.deleteSubmodel(id).catch(() => {})
    }
  })

  const topRevision = async (submodelId: string) => structureRevisionOf(((await target.submodel(submodelId)).submodelElements ?? []) as unknown[])

  it('creates a shell with submodels, submodels first', async () => {
    const created = await createShell(context, {
      shell: { idShort: 'StudioStructureShell' },
      submodels: [
        { source: 'template', templateId: 'bundled:digital-nameplate', idShort: 'Nameplate' },
        { source: 'empty', idShort: 'Workbench' },
      ],
    })
    shells.push(String(created.shell.id))
    const ids = await target.submodelIds(String(created.shell.id))
    submodels.push(...ids)
    expect(ids).toHaveLength(2)
    expect(created.steps.map(step => step.resource)).toEqual(['submodel', 'submodel', 'shell'])
    await expect(createShell(context, { shell: { id: created.shell.id as string, idShort: 'Again' }, submodels: [] }))
      .rejects
      .toMatchObject({ code: 'identifier_conflict' })
    // A submodel with that ID exists, so nothing of the new shell is written.
    await expect(createShell(context, { shell: { idShort: 'Other' }, submodels: [{ source: 'empty', idShort: 'Workbench', id: ids[1]! }] }))
      .rejects
      .toMatchObject({ code: 'identifier_conflict' })
  })

  it('adds, renames, moves, inserts into lists and deletes elements', async () => {
    const [, workbench] = await target.submodelIds(shells[0]!)
    const id = workbench!

    const first = await target.addElement(id, null, newElement('Property', 'First'), null, await topRevision(id))
    expect(first.path).toBe('First')
    await target.addElement(id, null, newElement('SubmodelElementCollection', 'Group'), null, await topRevision(id))
    await target.addElement(id, null, newElement('Property', 'Second'), null, await topRevision(id))

    // Two writers read the same children: the second one conflicts.
    const stale = await topRevision(id)
    await target.addElement(id, null, newElement('Property', 'Third'), null, stale)
    await expect(target.addElement(id, null, newElement('Property', 'Fourth'), null, stale)).rejects.toMatchObject({ code: 'structure_conflict' })
    await expect(target.addElement(id, null, newElement('Property', 'First'), null, await topRevision(id))).rejects.toMatchObject({ code: 'idshort_conflict' })

    // Children of a collection survive a rename of the collection (W1, W3).
    const group = await target.element(id, 'Group')
    const groupChildren = revisionOf(group.value)
    void groupChildren
    const inner = await target.addElement(id, 'Group', newElement('Property', 'Inner'), null, structureRevisionOf([]))
    expect(inner.path).toBe('Group.Inner')
    const renamed = await target.replaceElement(id, 'Group', { modelType: 'SubmodelElementCollection', idShort: 'Renamed' }, (await target.element(id, 'Group')).revision)
    expect(renamed.path).toBe('Renamed')
    expect((await target.element(id, 'Renamed.Inner')).value).toMatchObject({ idShort: 'Inner' })
    await expect(target.element(id, 'Group')).rejects.toMatchObject({ code: 'target_resource_not_found' })

    // Lists: insert at an index, move, typed children.
    await target.addElement(id, null, { ...newElement('SubmodelElementList', 'Numbers'), typeValueListElement: 'Property', valueTypeListElement: 'xs:int' }, null, await topRevision(id))
    const list = await target.element(id, 'Numbers')
    await target.addElement(id, 'Numbers', { ...newElement('Property', null, list.value), value: '2' }, null, structureRevisionOf([]))
    const listRevision = async () => structureRevisionOf(((await target.element(id, 'Numbers')).value.value ?? []) as unknown[])
    await target.addElement(id, 'Numbers', { ...newElement('Property', null, list.value), value: '1' }, 0, await listRevision())
    expect((await target.element(id, 'Numbers[0]')).value).toMatchObject({ value: '1' })
    await expect(target.addElement(id, 'Numbers', newElement('Capability', null), null, await listRevision()))
      .rejects
      .toMatchObject({ code: 'validation_failed' })
    const moved = await target.moveElement(id, 'Numbers[0]', 1, await listRevision())
    expect(moved.path).toBe('Numbers[1]')
    expect((await target.element(id, 'Numbers[0]')).value).toMatchObject({ value: '2' })

    // BaSyx Go orders named children by name, so only list items move.
    await expect(target.moveElement(id, 'Third', 0, await topRevision(id))).rejects.toMatchObject({ code: 'unsupported_operation' })
    // Delete based on the element revision.
    const doomed = await target.element(id, 'Second')
    await target.setElementValue(id, 'Second', 'edited', doomed.revision)
    await expect(target.deleteElement(id, 'Second', doomed.revision)).rejects.toMatchObject({ code: 'revision_conflict' })
    await target.deleteElement(id, 'Second', (await target.element(id, 'Second')).revision)
    await expect(target.element(id, 'Second')).rejects.toMatchObject({ code: 'target_resource_not_found' })
  })

  it('edits submodel and shell metadata and keeps what it must keep', async () => {
    const shellId = shells[0]!
    const [, workbench] = await target.submodelIds(shellId)
    const metadata = await target.submodelMetadata(workbench!)
    const changed = await target.replaceSubmodelMetadata(workbench!, { ...metadata, category: 'PARAMETER' }, revisionOf(metadata))
    expect(changed).toMatchObject({ category: 'PARAMETER' })
    expect(((await target.submodel(workbench!)).submodelElements as unknown[]).length).toBeGreaterThan(0)
    await expect(target.replaceSubmodelMetadata(workbench!, { ...metadata, category: 'X' }, revisionOf(metadata))).rejects.toMatchObject({ code: 'revision_conflict' })

    const shell = await target.shell(shellId)
    const saved = await target.replaceShell(shellId, { ...shell, displayName: [{ language: 'en', text: 'Studio shell' }] }, revisionOf(shellMetadata(shell)))
    expect(saved).toMatchObject({ displayName: [{ text: 'Studio shell' }] })
    expect(await target.submodelIds(shellId)).toHaveLength(2)
  })

  it('adds and removes submodels and creates instances from a type', async () => {
    const shellId = shells[0]!
    const added = await addSubmodel(context, shellId, { source: 'empty', idShort: 'Extra' })
    submodels.push(added.submodelId)
    expect(await target.submodelIds(shellId)).toContain(added.submodelId)
    await removeSubmodel(context, shellId, added.submodelId, true)
    expect(await target.submodelIds(shellId)).not.toContain(added.submodelId)
    await expect(target.submodelMetadata(added.submodelId)).rejects.toMatchObject({ code: 'target_resource_not_found' })

    const type = await createShell(context, {
      shell: { idShort: 'StudioTypeShell', assetInformation: { assetKind: 'Type' } },
      submodels: [{ source: 'template', templateId: 'bundled:handover-documentation', idShort: 'Documents' }],
    })
    shells.push(String(type.shell.id))
    const [templateCopy] = await target.submodelIds(String(type.shell.id))
    submodels.push(templateCopy!)
    const instance = await createInstance(context, String(type.shell.id), { shell: { idShort: 'StudioInstanceShell' } })
    shells.push(String(instance.shell.id))
    const [instanceSubmodel] = await target.submodelIds(String(instance.shell.id))
    submodels.push(instanceSubmodel!)
    expect(instanceSubmodel).not.toBe(templateCopy)
    expect(await target.shell(String(instance.shell.id))).toMatchObject({ assetInformation: { assetKind: 'Instance' } })

    // An instantiated template is an instance already; a Template-kind submodel converts in place.
    await target.replaceSubmodelMetadata(templateCopy!, { ...await target.submodelMetadata(templateCopy!), kind: 'Template' }, revisionOf(await target.submodelMetadata(templateCopy!)))
    const converted = await convertSubmodelToInstance(target, templateCopy!)
    expect(converted.submodel).toMatchObject({ kind: 'Instance' })
  })
})
