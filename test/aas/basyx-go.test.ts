import type { JsonObject } from '~~/server/lib/aas/outline'
import { describe, expect, it } from 'vitest'
import {
  assetIdParameter,
  invocationBody,
  invocationOutputs,
  subjectFilter,
  toAccessGrants,
  toChangeEvent,
  toConceptDescriptionSummary,
  toConceptInfo,
  toEffectiveRights,
  typedValue,
} from '~~/server/lib/aas/basyx-go'
import { decodeKey } from '~~/server/lib/aas/keys'

const operation: JsonObject = {
  modelType: 'Operation',
  idShort: 'Calibrate',
  inputVariables: [{ value: { idShort: 'Offset', modelType: 'Property', valueType: 'xs:double' } }, { value: { idShort: 'Verbose', modelType: 'Property', valueType: 'xs:boolean' } }],
  outputVariables: [{ value: { idShort: 'Result', modelType: 'Property', valueType: 'xs:string' } }],
  inoutputVariables: [{ value: { idShort: 'Mode', modelType: 'Property', valueType: 'xs:string' } }],
}

describe('BaSyx Go mappings', () => {
  it('types property values for value-only payloads', () => {
    expect(typedValue('xs:double', '1.5')).toBe(1.5)
    expect(typedValue('xs:int', 'x')).toBe('x')
    expect(typedValue('xs:boolean', 'true')).toBe(true)
    expect(typedValue('xs:string', '42')).toBe('42')
    expect(typedValue('xs:int', null)).toBeNull()
  })

  it('builds value-only invocation bodies and reads outputs in declaration order', () => {
    expect(invocationBody(operation, [{ idShort: 'Offset', value: '2' }, { idShort: 'Mode', value: 'fast' }, { idShort: 'Unknown', value: 'x' }], 'PT60S')).toEqual({
      inputArguments: { Offset: 2 },
      inoutputArguments: { Mode: 'fast' },
      clientTimeoutDuration: 'PT60S',
    })
    expect(invocationOutputs(operation, { outputArguments: { Result: 'ok' }, inoutputArguments: { Mode: 'slow' } })).toEqual([
      { idShort: 'Result', valueType: 'xs:string', value: 'ok' },
      { idShort: 'Mode', valueType: 'xs:string', value: 'slow' },
    ])
  })

  it('quotes subjects in event filters', () => {
    expect(subjectFilter(['urn:a', 'https://x/y?"z"'])).toBe(String.raw`rsql:event.subject=in=("urn:a","https://x/y?\"z\"")`)
  })

  it('maps feed records to change events and skips unknown types', () => {
    expect(toChangeEvent({ id: 'e1', time: '2026-10-14T07:53:20Z', type: 'io.admin-shell.submodel.updated.v1', subject: 'urn:sm' })).toMatchObject({
      id: 'e1',
      action: 'updated',
      entity: 'submodel',
      subject: 'urn:sm',
    })
    expect(decodeKey(toChangeEvent({ id: 'e1', type: 'io.admin-shell.aas.created.v1', subject: 'urn:aas' })!.subjectKey)).toBe('urn:aas')
    expect(toChangeEvent({ id: 'e2', type: 'io.admin-shell.view.updated.v1', subject: 'x' })).toBeNull()
    expect(toChangeEvent({ type: 'io.admin-shell.aas.created.v1', subject: 'x' })).toBeNull()
  })

  it('summarizes concept descriptions from IEC 61360 content', () => {
    expect(toConceptDescriptionSummary({
      id: '0173-1#02-AAO677#002',
      idShort: 'ManufacturerName',
      embeddedDataSpecifications: [{ dataSpecificationContent: { preferredName: [{ language: 'en', text: 'Manufacturer name' }], dataType: 'STRING', unit: 'kg' } }],
    })).toEqual({
      id: '0173-1#02-AAO677#002',
      idShort: 'ManufacturerName',
      preferredName: [{ language: 'en', text: 'Manufacturer name' }],
      definition: [],
      dataType: 'STRING',
      unit: 'kg',
    })
  })

  it('describes a concept to apps under the ID they asked for, with its short name (app API 0.1.15)', () => {
    expect(toConceptInfo('0173-1#02-AAB381#005', {
      id: 'https://api.eclass-cdp.com/0173-1-02-AAB381-005',
      embeddedDataSpecifications: [{ dataSpecificationContent: { preferredName: [{ language: 'en', text: 'Rated power' }], shortName: [{ language: 'en', text: 'P' }, { language: 'de' }], definition: [{ language: 'en', text: 'Power at rated values.' }], dataType: 'REAL_MEASURE', unit: 'kW' } }],
    })).toEqual({
      id: '0173-1#02-AAB381#005',
      preferredName: [{ language: 'en', text: 'Rated power' }],
      shortName: [{ language: 'en', text: 'P' }],
      definition: [{ language: 'en', text: 'Power at rated values.' }],
      unit: 'kW',
      dataType: 'REAL_MEASURE',
    })
    expect(toConceptInfo('urn:x', { id: 'urn:x' })).toEqual({ id: 'urn:x', preferredName: [], shortName: [], definition: [], unit: null, dataType: null })
  })

  it('reads grants and effective rights, ignoring malformed entries', () => {
    expect(toAccessGrants({ grants: [
      { relation: 'viewer', subjectType: 'user', issuer: 'https://idp', subject: 'alice' },
      { relation: 'viewer', subjectType: 'robot', issuer: 'https://idp', subject: 'r2' },
      { relation: 'editor' },
    ] })).toEqual([{ relation: 'viewer', subjectType: 'user', issuer: 'https://idp', subject: 'alice' }])
    expect(toEffectiveRights({ rights: [{ action: 'read', source: 'rebac' }, { action: 'update', source: 'none' }, { action: 'execute', source: 'abac' }] }))
      .toEqual({ read: true, update: false, delete: false, execute: true, manage: false })
  })

  it('encodes discovery asset IDs as base64url JSON', () => {
    expect(JSON.parse(decodeKey(assetIdParameter('globalAssetId', 'urn:asset')))).toEqual({ name: 'globalAssetId', value: 'urn:asset' })
  })
})
