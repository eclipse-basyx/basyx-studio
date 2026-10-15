import type { AasTarget } from '~~/server/lib/targets/aas-target'
import type { WorkspaceInfo } from '~~/server/lib/workspaces/protocol'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { addSubmodel, convertSubmodelToInstance, createInstance, createShell, removeSubmodel } from '~~/server/lib/aas/creation'
import { findings } from '~~/server/lib/aas/edits'
import { bundledTemplate, bundledTemplates } from '~~/server/lib/templates'
import { WorkspaceModel } from '~~/server/lib/workspaces/model'
import { newPackageBytes, readPackage } from '~~/server/lib/workspaces/package'
import { WorkspaceWorker } from '~~/server/lib/workspaces/worker'
import { generateId } from '#shared/aas/identifiers'
import { convertToInstance, instantiateSubmodel, templateFields } from '#shared/aas/templates'

const scheme = { type: 'iri', prefix: 'https://example.com/ids/' } as const

/** The model as an async target, so the creation logic runs as it does in the worker. */
function targetOf (model: WorkspaceModel): AasTarget {
  const noSync = async () => []
  return new Proxy({}, {
    get: (_, name: string) => {
      if (['registerShells', 'unregisterSubmodels', 'unregisterShell'].includes(name)) {
        return noSync
      }
      return async (...args: unknown[]) => (model as unknown as Record<string, (...a: unknown[]) => unknown>)[name]!(...args)
    },
  }) as AasTarget
}

const emptyModel = () => new WorkspaceModel({ assetAdministrationShells: [], submodels: [] })
const context = (model: WorkspaceModel) => ({ target: targetOf(model), scheme, plan: { registry: false, discovery: false } })

describe('identifiers', () => {
  it('generates IRIs or URNs per scheme', () => {
    expect(generateId('aas', scheme)).toMatch(/^https:\/\/example\.com\/ids\/aas\/[\da-f-]{36}$/)
    expect(generateId('sm', { type: 'iri', prefix: 'https://x.org/base' })).toMatch(/^https:\/\/x\.org\/base\/sm\//)
    expect(generateId('asset', { type: 'uuid', prefix: '' })).toMatch(/^urn:uuid:[\da-f-]{36}$/)
  })
})

describe('templates', () => {
  it('bundles the four IDTA templates and verifies as submodels', () => {
    const templates = bundledTemplates()
    expect(templates.map(template => template.title)).toEqual(['Digital Nameplate', 'Technical Data', 'Handover Documentation', 'Contact Information'])
    for (const template of templates) {
      const submodel = bundledTemplate(template.id)
      expect(submodel.modelType).toBe('Submodel')
      expect(templateFields(submodel).length).toBeGreaterThan(0)
    }
  })

  it('instantiates without optional elements and template qualifiers', () => {
    const template = bundledTemplate('bundled:digital-nameplate')
    const fields = templateFields(template)
    expect(fields.some(field => !field.required)).toBe(true)
    const instance = instantiateSubmodel(template, { id: 'urn:test:sm', include: new Set() })
    expect(instance).toMatchObject({ id: 'urn:test:sm', kind: 'Instance' })
    expect(JSON.stringify(instance)).not.toContain('TemplateQualifier')
    expect(JSON.stringify(instance).length).toBeLessThan(JSON.stringify(template).length)
    expect(findings('submodel', instance)).toEqual([])
  })

  it('keeps selected optional elements and applies values', () => {
    const template = bundledTemplate('bundled:digital-nameplate')
    const optional = templateFields(template).find(field => !field.required && field.input)!
    const required = templateFields(template).find(field => field.required && field.modelType === 'Property' && field.depth === 0)!
    const instance = instantiateSubmodel(template, { id: 'urn:test:sm', include: new Set([optional.path]), values: { [required.path]: 'filled' } })
    expect(JSON.stringify(instance)).toContain('filled')
    expect(templateFields(instance).some(field => field.path === optional.path)).toBe(true)
  })

  it('converts a template in place and counts what it removed', () => {
    const template = bundledTemplate('bundled:technical-data')
    const { submodel, removedQualifiers } = convertToInstance(template)
    expect(removedQualifiers).toBeGreaterThan(0)
    expect(submodel.kind).toBe('Instance')
    expect(JSON.stringify(submodel)).not.toContain('"TemplateQualifier"')
  })
})

describe('creating resources in a workspace', () => {
  it('creates a shell with submodels from templates, JSON and empty', async () => {
    const model = emptyModel()
    const { shell, steps } = await createShell(context(model), {
      shell: { idShort: 'Pump', assetInformation: { assetKind: 'Instance', globalAssetId: 'urn:asset:pump' } },
      submodels: [
        { source: 'template', templateId: 'bundled:digital-nameplate' },
        { source: 'empty', idShort: 'Notes' },
        { source: 'json', submodel: { modelType: 'Submodel', id: 'urn:test:sm:json', idShort: 'FromJson' } },
      ],
    })
    expect(steps.filter(step => step.resource === 'submodel')).toHaveLength(3)
    expect(model.submodelIds(String(shell.id))).toHaveLength(3)
    expect(String(shell.id)).toMatch(/^https:\/\/example\.com\/ids\/aas\//)
    expect(model.submodelMetadata('urn:test:sm:json')).toMatchObject({ idShort: 'FromJson' })
  })

  it('applies the form fields of new submodels, as an edit would', async () => {
    const model = emptyModel()
    const names = [{ language: 'en', text: 'Workbench' }]
    const { shell } = await createShell(context(model), {
      shell: { idShort: 'Shell1' },
      submodels: [
        { source: 'empty', idShort: 'Bench', id: 'urn:test:sm:bench', metadata: { displayName: names, category: 'PARAMETER', kind: 'Template' } },
        { source: 'template', templateId: 'bundled:digital-nameplate', id: 'urn:test:sm:plate', metadata: { displayName: names, kind: 'Template', id: 'urn:ignored' } },
      ],
    })
    expect(model.submodelMetadata('urn:test:sm:bench')).toMatchObject({ displayName: names, category: 'PARAMETER', kind: 'Template' })
    // A copy of a template is an instance whatever the form says.
    expect(model.submodelMetadata('urn:test:sm:plate')).toMatchObject({ displayName: names, kind: 'Instance', id: 'urn:test:sm:plate' })
    expect(model.submodelIds(String(shell.id))).toHaveLength(2)
  })

  it('refuses an identifier that exists, before writing anything', async () => {
    const model = emptyModel()
    await createShell(context(model), { shell: { id: 'urn:test:aas:1', idShort: 'One' }, submodels: [{ source: 'empty', idShort: 'Alpha', id: 'urn:test:sm:a' }] })
    await expect(createShell(context(model), { shell: { id: 'urn:test:aas:2', idShort: 'Two' }, submodels: [{ source: 'empty', idShort: 'Alpha', id: 'urn:test:sm:a' }] }))
      .rejects
      .toMatchObject({ code: 'identifier_conflict' })
    expect(() => model.shell('urn:test:aas:2')).toThrow()
  })

  it('reports a partial write with its steps', async () => {
    const model = emptyModel()
    const target = targetOf(model)
    const failing = new Proxy(target, {
      get: (base, name: string) => name === 'createShell'
        ? async () => {
          throw new Error('boom')
        }
        : (base as unknown as Record<string, unknown>)[name],
    })
    await expect(createShell({ target: failing, scheme, plan: { registry: false, discovery: false } }, {
      shell: { id: 'urn:test:aas:partial', idShort: 'Partial' },
      submodels: [{ source: 'empty', idShort: 'Alpha', id: 'urn:test:sm:partial' }],
    })).rejects.toMatchObject({
      code: 'partial_write',
      steps: [{ resource: 'submodel', outcome: 'written' }, { resource: 'shell', outcome: 'failed' }],
    })
    // The submodel stays; the user can delete leftovers (known risk of W4).
    expect(model.submodelMetadata('urn:test:sm:partial')).toBeDefined()
  })

  it('adds and removes submodels, with and without deleting them', async () => {
    const model = emptyModel()
    const { shell } = await createShell(context(model), { shell: { idShort: 'Shell1' }, submodels: [] })
    const shellId = String(shell.id)
    const added = await addSubmodel(context(model), shellId, { source: 'empty', idShort: 'Extra', id: 'urn:test:sm:extra' })
    expect(model.submodelIds(shellId)).toEqual([added.submodelId])
    await removeSubmodel(context(model), shellId, added.submodelId, false)
    expect(model.submodelIds(shellId)).toEqual([])
    expect(model.submodelMetadata(added.submodelId)).toBeDefined()
    await addSubmodel(context(model), shellId, { source: 'existing', id: added.submodelId })
    await removeSubmodel(context(model), shellId, added.submodelId, true)
    expect(() => model.submodel(added.submodelId)).toThrow()
  })

  it('creates an instance from a type shell and converts a template in place', async () => {
    const model = emptyModel()
    const { shell } = await createShell(context(model), {
      shell: { idShort: 'PumpType', assetInformation: { assetKind: 'Type' } },
      submodels: [{ source: 'json', submodel: { ...bundledTemplate('bundled:digital-nameplate'), id: 'urn:test:sm:template' } }],
    })
    const typeId = String(shell.id)
    const created = await createInstance(context(model), typeId, { shell: { idShort: 'Pump1' } })
    const instance = created.shell
    expect(instance).toMatchObject({ idShort: 'Pump1', assetInformation: { assetKind: 'Instance' } })
    expect(JSON.stringify(instance.derivedFrom)).toContain(typeId)
    const [copiedId] = model.submodelIds(String(instance.id))
    expect(copiedId).not.toBe('urn:test:sm:template')
    expect(model.submodelMetadata(copiedId!)).toMatchObject({ kind: 'Instance' })
    await expect(createInstance(context(model), String(instance.id), { shell: {} })).rejects.toMatchObject({ code: 'unsupported_operation' })

    const converted = await convertSubmodelToInstance(targetOf(model), 'urn:test:sm:template')
    expect(converted.removedQualifiers).toBeGreaterThan(0)
    expect(model.submodelMetadata('urn:test:sm:template')).toMatchObject({ kind: 'Instance' })
    await expect(convertSubmodelToInstance(targetOf(model), 'urn:test:sm:template')).rejects.toMatchObject({ code: 'unsupported_operation' })
  })

  it('replaces shell metadata and keeps its submodel references', async () => {
    const model = emptyModel()
    const { shell } = await createShell(context(model), { shell: { idShort: 'Shell1' }, submodels: [{ source: 'empty', idShort: 'Alpha' }] })
    const id = String(shell.id)
    const { contentHash } = await import('~~/server/lib/targets/revision')
    const { shellMetadata } = await import('~~/server/lib/aas/edits')
    const revision = `h.${contentHash(shellMetadata(model.shell(id)))}`
    const changed = model.replaceShell(id, { ...shell, idShort: 'Renamed', submodels: [] }, revision)
    expect(changed).toMatchObject({ idShort: 'Renamed' })
    expect(model.submodelIds(id)).toHaveLength(1)
    expect(() => model.replaceShell(id, { ...shell, idShort: 'Late' }, revision)).toThrowError(expect.objectContaining({ code: 'revision_conflict' }))
  })
})

describe('undo, redo and new packages', () => {
  it('undoes and redoes applied changes, back to the saved state', () => {
    const model = emptyModel()
    const record = <T>(work: () => T) => {
      const before = model.snapshot()
      const result = work()
      model.recordChange(before)
      return result
    }
    record(() => model.createShell({ modelType: 'AssetAdministrationShell', id: 'urn:s:1', assetInformation: { assetKind: 'Instance' } }))
    model.savedRevision = model.revision
    record(() => model.createShell({ modelType: 'AssetAdministrationShell', id: 'urn:s:2', assetInformation: { assetKind: 'Instance' } }))
    expect(model.unsavedChanges).toBe(true)
    expect(model.canUndo).toBe(true)

    model.undo()
    expect(() => model.shell('urn:s:2')).toThrow()
    expect(model.unsavedChanges).toBe(false)
    expect(model.canRedo).toBe(true)

    model.redo()
    expect(model.shell('urn:s:2')).toBeDefined()
    expect(model.unsavedChanges).toBe(true)

    model.undo()
    record(() => model.createShell({ modelType: 'AssetAdministrationShell', id: 'urn:s:3', assetInformation: { assetKind: 'Instance' } }))
    // A new change drops the redo log and is not mistaken for the saved state.
    expect(model.canRedo).toBe(false)
    expect(model.unsavedChanges).toBe(true)
    expect(() => emptyModel().undo()).toThrowError(expect.objectContaining({ code: 'unsupported_operation' }))
  })

  it('records the first change to a saved new package', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'studio-worker-'))
    try {
      const worker = new WorkspaceWorker()
      const { workspaceId } = await worker.handle({ op: 'create' }) as WorkspaceInfo
      expect((await worker.handle({ op: 'list' }) as WorkspaceInfo[])[0]!.unsavedChanges).toBe(true)
      const saved = await worker.handle({ op: 'save', workspaceId, path: join(directory, 'new.aasx') }) as WorkspaceInfo
      expect(saved.unsavedChanges).toBe(false)
      await worker.handle({ op: 'call', workspaceId, method: 'createShell', args: [{ modelType: 'AssetAdministrationShell', id: 'urn:s:new', assetInformation: { assetKind: 'Instance' } }] })
      const [info] = await worker.handle({ op: 'list' }) as WorkspaceInfo[]
      expect(info).toMatchObject({ unsavedChanges: true, canUndo: true })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('creates an empty package that opens', async () => {
    const opened = await readPackage(await newPackageBytes())
    expect(opened.environment).toMatchObject({ assetAdministrationShells: [], submodels: [] })
    opened.pkg.Close()
    void readFileSync
  })
})

describe('deleting a shell with its submodels', () => {
  it('keeps the submodels by default and deletes them on request', async () => {
    const model = emptyModel()
    const made = await createShell(context(model), { shell: { idShort: 'Shell1' }, submodels: [{ source: 'empty', idShort: 'Alpha', id: 'urn:test:sm:a' }, { source: 'empty', idShort: 'Beta', id: 'urn:test:sm:b' }] })
    const { deleteShellWithSubmodels } = await import('~~/server/lib/aas/creation')
    const kept = await deleteShellWithSubmodels(context(model), String(made.shell.id), false)
    expect(kept.map(step => step.resource)).toEqual(['shell'])
    expect(model.submodelMetadata('urn:test:sm:a')).toBeDefined()

    const again = await createShell(context(model), { shell: { idShort: 'Shell2' }, submodels: [{ source: 'existing', id: 'urn:test:sm:a' }, { source: 'existing', id: 'urn:test:sm:b' }] })
    const removed = await deleteShellWithSubmodels(context(model), String(again.shell.id), true)
    expect(removed.filter(step => step.resource === 'submodel').map(step => step.outcome)).toEqual(['removed', 'removed'])
    expect(() => model.submodel('urn:test:sm:a')).toThrow()
  })
})
