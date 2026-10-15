import { afterAll, describe, expect, it } from 'vitest'
import { addSubmodel, createShell, removeSubmodel } from '~~/server/lib/aas/creation'
import { LiveAasTarget } from '~~/server/lib/targets/live-target'
import { defaultSyncSettings } from '#shared/contract'
import { policy, record } from '../support/live'
import { openTargetUrl, testenvAvailable } from '../support/testenv'

// The creation wizard's write order and registry sync (MVP-5 plan, W4, P5)
// against the open BaSyx Go environment with registries and discovery.

const encode = (id: string) => Buffer.from(id).toString('base64url')
const target = new LiveAasTarget({
  record: {
    ...record(openTargetUrl, { mode: 'unsecured' }),
    template: 'mono-all',
    endpoints: [{ type: 'aasEnvironment', url: openTargetUrl }],
    sync: { ...defaultSyncSettings, serverSyncsRegistry: false, serverSyncsDiscovery: false },
  },
  access: { accessToken: undefined, downstreamIdentity: null },
  policy: policy(openTargetUrl),
  requestId: 'test-request',
  onUnauthorized: async () => {},
})
const context = { target, scheme: { type: 'iri', prefix: 'https://studio.test/ids/' } as const, plan: { registry: true, discovery: true } }

describe.runIf(testenvAvailable)('creating shells with registry and discovery sync', () => {
  const shells: string[] = []
  const submodels: string[] = []
  afterAll(async () => {
    for (const id of shells) {
      // BaSyx Go deletes a shell only while its descriptor exists.
      await fetch(`${openTargetUrl}/shell-descriptors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, endpoints: [{ interface: 'AAS-3.0', protocolInformation: { href: `${openTargetUrl}/shells/${encode(id)}` } }] }),
      })
      await fetch(`${openTargetUrl}/shells/${encode(id)}`, { method: 'DELETE' })
      await fetch(`${openTargetUrl}/lookup/shells/${encode(id)}`, { method: 'DELETE' })
    }
    for (const id of submodels) {
      await fetch(`${openTargetUrl}/submodels/${encode(id)}`, { method: 'DELETE' })
    }
  })

  it('writes submodels, the shell, descriptors and asset links in that order', async () => {
    const created = await createShell(context, {
      shell: { idShort: 'StudioWizardShell', assetInformation: { assetKind: 'Instance', globalAssetId: 'urn:studio:test:asset:wizard' } },
      submodels: [
        { source: 'template', templateId: 'bundled:digital-nameplate', idShort: 'Nameplate' },
        { source: 'template', templateId: 'bundled:technical-data', idShort: 'TechnicalData' },
      ],
    })
    const shellId = String(created.shell.id)
    shells.push(shellId)
    const ids = await target.submodelIds(shellId)
    submodels.push(...ids)
    expect(created.steps.map(step => `${step.resource}:${step.outcome}`)).toEqual([
      'submodel:written', 'submodel:written', 'shell:written',
      'shellDescriptor:written', 'submodelDescriptor:written', 'submodelDescriptor:written', 'assetLinks:written',
    ])

    const descriptor = await fetch(`${openTargetUrl}/shell-descriptors/${encode(shellId)}`)
    expect(descriptor.ok).toBe(true)
    const links = await (await fetch(`${openTargetUrl}/lookup/shells/${encode(shellId)}`)).json() as Array<{ value: string }>
    expect(links.map(link => link.value)).toContain('urn:studio:test:asset:wizard')

    // A shell with a new submodel and a later removal keep the registry in step.
    const added = await addSubmodel(context, shellId, { source: 'empty', idShort: 'Late' })
    submodels.push(added.submodelId)
    expect((await fetch(`${openTargetUrl}/submodel-descriptors/${encode(added.submodelId)}`)).ok).toBe(true)
    const removed = await removeSubmodel(context, shellId, added.submodelId, true)
    expect(removed.map(step => `${step.resource}:${step.outcome}`)).toContain('submodelDescriptor:removed')
    expect((await fetch(`${openTargetUrl}/submodel-descriptors/${encode(added.submodelId)}`)).status).toBe(404)
  })
})
