import type { AppInstallationRecord } from '~~/server/lib/apps/store'
import type { AasTarget } from '~~/server/lib/targets/aas-target'
import { randomBytes } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { authorizeAppCall, executeAasMethod } from '~~/server/lib/apps/calls'
import { capabilityTokenKey, capabilityTokenTtlMs, issueCapabilityToken, verifyCapabilityToken } from '~~/server/lib/apps/tokens'
import { StudioProblem } from '~~/server/lib/problem'
import { manifestOf } from './support'

describe('capability tokens', () => {
  const key = capabilityTokenKey(randomBytes(32))
  const claims = { installationId: 'app-0123456789abcdef', sessionId: 'session', targetId: 'target' }

  it('round-trips the claims until the token expires', () => {
    const now = Date.now()
    const token = issueCapabilityToken(key, claims, now)
    expect(verifyCapabilityToken(key, token, now + 1000)).toEqual({ ...claims, expiresAt: now + capabilityTokenTtlMs })
    expect(verifyCapabilityToken(key, token, now + capabilityTokenTtlMs)).toBeNull()
  })

  it('rejects tokens signed with another key, altered, or malformed', () => {
    const token = issueCapabilityToken(key, claims)
    expect(verifyCapabilityToken(capabilityTokenKey(randomBytes(32)), token)).toBeNull()
    const [prefix, payload, mac] = token.split('.')
    const altered = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload!, 'base64url').toString()), t: 'other' })).toString('base64url')
    expect(verifyCapabilityToken(key, `${prefix}.${altered}.${mac}`)).toBeNull()
    expect(verifyCapabilityToken(key, 'sct.x')).toBeNull()
    expect(verifyCapabilityToken(key, `${token}.extra`)).toBeNull()
  })
})

describe('app call authorization', () => {
  const installation = { id: 'app-0123456789abcdef', appId: 'org.example.test', manifest: manifestOf({ permissions: ['studio.aas.read'] }) } as AppInstallationRecord

  function code (action: () => void): string {
    try {
      action()
    } catch (error) {
      return (error as StudioProblem).code
    }
    return 'allowed'
  }

  it('allows declared permissions and context, and refuses undeclared ones', () => {
    expect(code(() => authorizeAppCall(installation, 'studio.aas.getElement', 'host'))).toBe('allowed')
    expect(code(() => authorizeAppCall(installation, 'studio.ui.getContext', 'host'))).toBe('allowed')
    expect(code(() => authorizeAppCall(installation, 'studio.aas.setElementValue', 'host'))).toBe('app_permission_not_declared')
    expect(code(() => authorizeAppCall(installation, 'studio.ui.notify', 'host'))).toBe('app_permission_not_declared')
    expect(code(() => authorizeAppCall(installation, 'studio.backend.call', 'host'))).toBe('app_permission_not_declared')
  })

  it('limits backends to AAS methods', () => {
    expect(code(() => authorizeAppCall(installation, 'studio.aas.listShells', 'backend'))).toBe('allowed')
    expect(code(() => authorizeAppCall(installation, 'studio.ui.getContext', 'backend'))).toBe('unsupported_operation')
  })
})

describe('AAS capability methods', () => {
  function fakeTarget (): AasTarget {
    return {
      capabilities: { write: true, persistence: 'immediate' },
      listShells: vi.fn(async () => ({
        items: [{ key: 'k', id: 'urn:shell', idShort: 'Shell', displayName: [], description: [], assetKind: null, globalAssetId: null }],
        page: { nextCursor: null, hasMore: false },
      })),
      shell: vi.fn(async id => ({ id })),
      submodelIds: vi.fn(async () => ['urn:sm:1', 'urn:sm:2']),
      submodelMetadata: vi.fn(async id => {
        if (id === 'urn:sm:2') {
          throw new StudioProblem('target_forbidden')
        }
        return { id, idShort: 'Nameplate', semanticId: { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: 'urn:semantic' }] } }
      }),
      submodel: vi.fn(async id => ({ id, submodelElements: [] })),
      element: vi.fn(async () => ({ value: { modelType: 'Property', value: 'a' }, revision: 'h.abc', concurrency: 'strong' as const })),
      setElementValue: vi.fn(async () => ({ value: { modelType: 'Property', value: 'b' }, revision: 'h.def', concurrency: 'strong' as const })),
    }
  }

  it('maps target results to SDK shapes', async () => {
    const target = fakeTarget()
    expect(await executeAasMethod(target, 'studio.aas.listShells', {})).toEqual({
      items: [{ id: 'urn:shell', idShort: 'Shell', displayName: [], assetKind: null, globalAssetId: null }],
      page: { nextCursor: null, hasMore: false },
    })
    expect(await executeAasMethod(target, 'studio.aas.listSubmodels', { shellId: 'urn:shell' })).toEqual({
      items: [
        { id: 'urn:sm:1', idShort: 'Nameplate', semanticId: 'urn:semantic', status: 'available' },
        { id: 'urn:sm:2', idShort: null, semanticId: null, status: 'forbidden' },
      ],
    })
    expect(await executeAasMethod(target, 'studio.aas.getElement', { submodelId: 'urn:sm:1', idShortPath: 'Contact.Phone[0]' }))
      .toEqual({ value: { modelType: 'Property', value: 'a' }, revision: 'h.abc', concurrency: 'strong' })
    expect(target.element).toHaveBeenCalledWith('urn:sm:1', 'Contact.Phone[0]')
  })

  it('writes with the revision and refuses operation variables', async () => {
    const target = fakeTarget()
    await executeAasMethod(target, 'studio.aas.setElementValue', { submodelId: 'urn:sm:1', idShortPath: 'Serial', value: 'b', revision: 'h.abc' })
    expect(target.setElementValue).toHaveBeenCalledWith('urn:sm:1', 'Serial', 'b', 'h.abc')
    await expect(executeAasMethod(target, 'studio.aas.getElement', { submodelId: 'urn:sm:1', idShortPath: 'Calibrate@input.Offset' }))
      .rejects
      .toMatchObject({ code: 'unsupported_operation' })
    await expect(executeAasMethod(target, 'studio.aas.getElement', { submodelId: 'urn:sm:1', idShortPath: '../x' }))
      .rejects
      .toMatchObject({ code: 'invalid_request' })
  })
})
