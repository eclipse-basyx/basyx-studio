// Generates the AAS fixtures preloaded into the BaSyx test infrastructures and
// verifies every environment with AAS Core 3.1 before writing it.
//
// Run with: pnpm testenv:fixtures

import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The ESM build of aas-core3.1-typescript 1.0.1 uses extensionless imports and
// cannot be loaded by plain Node ESM; the CommonJS build works.
const require = createRequire(import.meta.url)
const { jsonization, verification } = require('@aas-core-works/aas-core3.1-typescript')

const fixturesDir = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Small builders for the AAS JSON serialization
// ---------------------------------------------------------------------------

function prop (idShort, valueType, value) {
  return {
    ...(idShort ? { idShort } : {}),
    modelType: 'Property',
    valueType,
    ...(value === undefined ? {} : { value }),
  }
}

function smc (idShort, value) {
  return {
    ...(idShort ? { idShort } : {}),
    modelType: 'SubmodelElementCollection',
    value,
  }
}

function sml (idShort, typeValueListElement, value, extra = {}) {
  return {
    ...(idShort ? { idShort } : {}),
    modelType: 'SubmodelElementList',
    orderRelevant: true,
    typeValueListElement,
    ...extra,
    value,
  }
}

function modelRef (...keys) {
  return {
    type: 'ModelReference',
    keys: keys.map(([type, value]) => ({ type, value })),
  }
}

function externalRef (value) {
  return {
    type: 'ExternalReference',
    keys: [{ type: 'GlobalReference', value }],
  }
}

function shell (id, idShort, globalAssetId, submodelIds = [], extra = {}) {
  return {
    modelType: 'AssetAdministrationShell',
    id,
    idShort,
    assetInformation: { assetKind: 'Instance', globalAssetId },
    ...(submodelIds.length > 0 ? { submodels: submodelIds.map(id => modelRef(['Submodel', id])) } : {}),
    ...extra,
  }
}

function submodel (id, idShort, submodelElements, extra = {}) {
  return {
    modelType: 'Submodel',
    id,
    idShort,
    kind: 'Instance',
    ...extra,
    submodelElements,
  }
}

// ---------------------------------------------------------------------------
// Open (unsecured) infrastructure
// ---------------------------------------------------------------------------

const edgeCasesSmId = 'urn:studio:test:sm:edge-cases'
const largeSmId = 'urn:studio:test:sm:large'
const missingSmId = 'urn:studio:test:sm:missing'

const edgeCasesSubmodel = submodel(edgeCasesSmId, 'EdgeCases', [
  prop('SimpleString', 'xs:string', 'hello studio'),
  prop('Temperature', 'xs:double', '21.5'),
  prop('Enabled', 'xs:boolean', 'true'),
  prop('Name-With-Hyphen', 'xs:string', 'idShort contains a hyphen'),
  prop('EmptyValue', 'xs:string'),
  {
    idShort: 'Title',
    modelType: 'MultiLanguageProperty',
    value: [
      { language: 'en', text: 'Edge case submodel' },
      { language: 'de', text: 'Grenzfall-Teilmodell' },
    ],
  },
  { idShort: 'OperatingRange', modelType: 'Range', valueType: 'xs:int', min: '0', max: '100' },
  { idShort: 'Manual', modelType: 'File', contentType: 'application/pdf', value: '/aasx/files/manual.pdf' },
  { idShort: 'Thumbnail', modelType: 'Blob', contentType: 'text/plain', value: 'aGVsbG8gc3R1ZGlv' },
  {
    idShort: 'RefToSimpleString',
    modelType: 'ReferenceElement',
    value: modelRef(['Submodel', edgeCasesSmId], ['Property', 'SimpleString']),
  },
  {
    idShort: 'DependsOn',
    modelType: 'RelationshipElement',
    first: modelRef(['Submodel', edgeCasesSmId], ['Property', 'Temperature']),
    second: modelRef(['Submodel', edgeCasesSmId], ['Range', 'OperatingRange']),
  },
  { idShort: 'CanMeasure', modelType: 'Capability' },
  {
    idShort: 'Motor',
    modelType: 'Entity',
    entityType: 'SelfManagedEntity',
    globalAssetId: 'urn:studio:test:asset:motor',
    statements: [prop('SerialNumber', 'xs:string', 'SN-0001')],
  },
  // Collection -> collection -> list of collections -> collection -> property
  smc('Level1', [
    prop('Level1Value', 'xs:string', 'level 1'),
    smc('Level2', [
      sml('Items', 'SubmodelElementCollection', [0, 1, 2].map(i => smc(undefined, [
        prop('Name', 'xs:string', `item ${i}`),
        prop('Index', 'xs:int', String(i)),
        smc('Details', [prop('Deepest', 'xs:string', `deepest value of item ${i}`)]),
      ]))),
    ]),
  ]),
  // List of primitive properties: Numbers[0], Numbers[1], ...
  sml('Numbers', 'Property', [10, 20, 30].map(n => prop(undefined, 'xs:int', String(n))), { valueTypeListElement: 'xs:int' }),
  // List of lists: NestedLists[1][0]
  sml('NestedLists', 'SubmodelElementList', [
    sml(undefined, 'Property', [prop(undefined, 'xs:string', 'a'), prop(undefined, 'xs:string', 'b')], { valueTypeListElement: 'xs:string' }),
    sml(undefined, 'Property', [prop(undefined, 'xs:string', 'c')], { valueTypeListElement: 'xs:string' }),
  ]),
  {
    idShort: 'Calibrate',
    modelType: 'Operation',
    inputVariables: [{ value: prop('Offset', 'xs:double', '0.0') }],
    outputVariables: [{ value: prop('Result', 'xs:string') }],
    inoutputVariables: [{ value: smc('Settings', [prop('Mode', 'xs:string', 'fast')]) }],
  },
], { semanticId: externalRef('urn:studio:test:semantic:edge-cases') })

const largeSubmodel = submodel(
  largeSmId,
  'LargeSubmodel',
  Array.from({ length: 300 }, (_, i) => prop(`Value${String(i).padStart(3, '0')}`, 'xs:int', String(i))),
)

const edgeCasesShell = shell(
  'urn:studio:test:aas:edge-cases',
  'EdgeCasesShell',
  'urn:studio:test:asset:edge-cases',
  // The missing submodel reference is intentional: the UI must handle a dangling reference.
  [edgeCasesSmId, largeSmId, missingSmId],
  { description: [{ language: 'en', text: 'Shell with nested, list, operation and dangling-reference cases' }] },
)

const pagingShellCount = 60
const pagingShells = Array.from({ length: pagingShellCount }, (_, i) => {
  const n = String(i + 1).padStart(3, '0')
  return shell(`urn:studio:test:aas:paging:${n}`, `PagingShell${n}`, `urn:studio:test:asset:paging:${n}`)
})

// ---------------------------------------------------------------------------
// Secured infrastructure
// ---------------------------------------------------------------------------

const securedIds = {
  publicAas: 'urn:studio:test:secured:aas:public',
  internalAas: 'urn:studio:test:secured:aas:internal',
  publicNameplate: 'urn:studio:test:secured:sm:public-nameplate',
  restrictedCosts: 'urn:studio:test:secured:sm:restricted-costs',
  internalData: 'urn:studio:test:secured:sm:internal-data',
}

const securedEnvironment = {
  assetAdministrationShells: [
    shell(securedIds.publicAas, 'SecuredPublicShell', 'urn:studio:test:secured:asset:public', [
      securedIds.publicNameplate,
      securedIds.restrictedCosts,
    ]),
    shell(securedIds.internalAas, 'SecuredInternalShell', 'urn:studio:test:secured:asset:internal', [
      securedIds.internalData,
    ]),
  ],
  submodels: [
    // Digital Nameplate 3.0 (IDTA 02006), so the Nameplate example app matches it.
    submodel(securedIds.publicNameplate, 'Nameplate', [
      prop('ManufacturerName', 'xs:string', 'Secured Test Manufacturer'),
      prop('ManufacturerProductType', 'xs:string', 'SEC-TYPE-1'),
      prop('SerialNumber', 'xs:string', 'SEC-0001'),
      prop('YearOfConstruction', 'xs:string', '2026'),
    ], { semanticId: externalRef('https://admin-shell.io/idta/nameplate/3/0/Nameplate') }),
    submodel(securedIds.restrictedCosts, 'Costs', [
      prop('UnitCost', 'xs:decimal', '1234.50'),
      prop('Currency', 'xs:string', 'EUR'),
    ]),
    submodel(securedIds.internalData, 'InternalData', [
      smc('Maintenance', [prop('LastService', 'xs:date', '2026-09-01')]),
    ]),
  ],
}

// ---------------------------------------------------------------------------
// Verify and write
// ---------------------------------------------------------------------------

const outputs = [
  ['open/studio-edge-cases.json', { assetAdministrationShells: [edgeCasesShell], submodels: [edgeCasesSubmodel, largeSubmodel] }],
  ['open/studio-paging.json', { assetAdministrationShells: pagingShells }],
  ['secured/studio-secured-catalog.json', securedEnvironment],
]

let failed = false
for (const [relativePath, environment] of outputs) {
  const parsed = jsonization.environmentFromJsonable(environment)
  if (parsed.error !== null) {
    console.error(`${relativePath}: deserialization failed at ${parsed.error.path}: ${parsed.error.message}`)
    failed = true
    continue
  }

  const errors = [...verification.verify(parsed.mustValue())]
  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`${relativePath}: ${error.path}: ${error.message}`)
    }
    failed = true
    continue
  }

  // Write the canonical AAS Core serialization rather than the hand-written input.
  const canonical = jsonization.toJsonable(parsed.mustValue())
  writeFileSync(join(fixturesDir, relativePath), `${JSON.stringify(canonical, null, 2)}\n`)
  console.log(`wrote ${relativePath}`)
}

if (failed) {
  process.exitCode = 1
}
