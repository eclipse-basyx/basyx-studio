import type { ConceptInfo, JsonObject } from '@basyx/studio-sdk'
import { readFileSync } from 'node:fs'
import { fieldText } from '@basyx/studio-app-kit/aas'
import { createTestStudio, memoryAas } from '@basyx/studio-sdk/testing'
import { describe, expect, it } from 'vitest'
import { appMethodParamsSchemas } from '#shared/contract'
import { areaTitles, classificationChip, classificationRows, conceptMap, conceptQuery, conceptSpellings, csvFileName, dateText, descriptionOf, filterRows, furtherRows, generalRows, headline, numberText, rangeText, sheetCsv, sheetRows, templateLabel, typedText, valueWithUnit, visibleRows } from '../../apps/technical-data/ui/src/presentation'
import { parseTechnicalData, referencedPath, sheetConceptIds, templateVersion } from '../../apps/technical-data/ui/src/technicalData'

// The Technical Data app's reading of IDTA 02003 2.0 and ZVEI 1.2, and what
// its data sheets show, on the technical data demo of the open
// infrastructure (test-setup/fixtures/generate-technical-data.mjs), with the
// demo's concept descriptions through the test Studio (app API 0.1.15).

const environment = JSON.parse(readFileSync(new URL('../../test-setup/fixtures/technical-data/studio-technical-data.json', import.meta.url), 'utf8')) as { submodels: JsonObject[], conceptDescriptions: JsonObject[] }
const submodel = (id: string) => environment.submodels.find(entry => entry.id === id)!
const v2 = parseTechnicalData(submodel('urn:studio:test:sm:technical-data:2-0'))
const v12 = parseTechnicalData(submodel('urn:studio:test:sm:technical-data:1-2'))
const t = (key: string, params?: Record<string, string | number>) => `${key}${params ? JSON.stringify(params) : ''}`

/** The demo's concept descriptions, as the app asks Studio for them. */
async function conceptsOf (data: ReturnType<typeof parseTechnicalData>) {
  const aas = memoryAas({ conceptDescriptions: environment.conceptDescriptions })
  const { client } = createTestStudio({ handlers: aas.handlers })
  const { concepts } = await client.aas.describeConcepts(conceptQuery(sheetConceptIds(data)))
  return conceptMap(concepts as Array<ConceptInfo | null>)
}

describe('reading technical data', () => {
  it('names the template version', () => {
    expect(templateVersion('0173-1#01-AHX837#002')).toBe('2.0')
    expect(templateVersion('https://admin-shell.io/idta/TechnicalData/Submodel/2/0')).toBe('2.0')
    expect(templateVersion('https://admin-shell.io/ZVEI/TechnicalData/Submodel/1/2')).toBe('1.2')
    expect(templateVersion('https://admin-shell.io/ZVEI/TechnicalData/Submodel/1/1/')).toBe('1.1')
    expect(templateVersion('https://example.com/other')).toBeNull()
    expect([v2.version, v12.version]).toEqual(['2.0', '1.2'])
    expect([templateLabel('2.0'), templateLabel('1.2'), templateLabel(null)]).toEqual(['IDTA 02003-2-0', 'ZVEI Technical Data 1.2', 'IDTA 02003'])
  })

  it('reads the general information, logo and images of 2.0 and of 1.2', () => {
    expect(headline(t, v2, 'de')).toEqual({ title: 'Servoantrieb SD-200', manufacturer: 'Example Drives GmbH', details: 'general.articleShort{"value":"SD-200-400-3"} · general.orderShort{"value":"SD200-4-3-B"}' })
    expect(v2.logo).toMatchObject({ path: 'GeneralInformation.CompanyLogo', name: 'example-drives-logo.svg' })
    expect(v12.logo).toMatchObject({ path: 'GeneralInformation.ManufacturerLogo' })
    // 2.0: a list of ImageFile and ImageNote, each image its own (the Web UI showed the first one three times).
    expect(v2.images.map(image => [image.path, image.file.name, fieldText(image.note, 'en')])).toEqual([
      ['GeneralInformation.ProductImages[0]', 'sd-200-front.png', 'Front view'],
      ['GeneralInformation.ProductImages[1]', 'sd-200-side.png', 'Connectors at the bottom'],
      ['GeneralInformation.ProductImages[2]', 'sd-200-mounting.png', ''],
    ])
    // 1.2: numbered ProductImage files.
    expect(v12.images.map(image => image.file.path)).toEqual(['GeneralInformation.ProductImage01', 'GeneralInformation.ProductImage02'])
    expect(generalRows(t, v2, 'en', false).map(row => [row.key, row.value, row.copy])).toEqual([
      ['manufacturerName', 'Example Drives GmbH', undefined],
      ['productDesignation', 'Servo drive SD-200', undefined],
      ['articleNumber', 'SD-200-400-3', 'SD-200-400-3'],
      ['orderCode', 'SD200-4-3-B', 'SD200-4-3-B'],
    ])
  })

  it('reads classifications in the template\'s fields, whichever are there, and the area one refers to', () => {
    expect(v2.classifications.map(entry => [classificationChip(entry, 'en'), fieldText(entry.url, 'en'), entry.areaPath])).toEqual([
      ['ECLASS 14.0 · 27-02-31-90', 'https://eclass.eu', 'TechnicalPropertyAreas[0]'],
      ['IEC CDD 2.0 · ZZB001', '', null],
    ])
    // 1.2 calls the system ProductClassificationSystem.
    expect(v12.classifications.map(entry => classificationChip(entry, 'en'))).toEqual(['ECLASS 11.1 · 27-02-31-90'])
    expect(v2.areas[0]!.path).toBe('TechnicalPropertyAreas[0]')
    expect(classificationRows(t, v2.classifications[1]!, 'en').map(row => row.label)).toEqual(['classification.fields.system', 'classification.fields.version', 'classification.fields.classId', 'classification.fields.codedName'])
  })

  it('turns model references into idShortPaths, list items with their index', () => {
    expect(referencedPath({ keys: [{ type: 'Submodel', value: 'urn:x' }, { type: 'SubmodelElementList', value: 'Areas' }, { type: 'SubmodelElementCollection', value: '1' }, { type: 'Property', value: 'P' }] })).toBe('Areas[1].P')
    expect(referencedPath({ keys: [{ type: 'Submodel', value: 'urn:x' }, { type: 'SubmodelElementCollection', value: 'A' }, { type: 'SubmodelElementCollection', value: 'B' }] })).toBe('A.B')
    expect(referencedPath({ keys: [{ type: 'Submodel', value: 'urn:x' }] })).toBeNull()
    expect(referencedPath(undefined)).toBeNull()
  })

  it('reads ValidDate by its idShort although 1.2 gives it ManufacturerOrderCode\'s semantic ID', () => {
    expect(fieldText(v12.further?.validDate, 'en')).toBe('2023-06-01')
    expect(furtherRows(t, v2, 'de', false).map(row => [row.label, row.value])).toEqual([
      ['further.validDate', '15.01.2026'],
      ['further.statement', 'Werte bei 40 °C Umgebungstemperatur und 8 kHz Schaltfrequenz.'],
      ['further.statement', 'Technische Änderungen vorbehalten.'],
    ])
  })
})

describe('the data sheets', () => {
  it('asks for every element\'s semantic and supplemental IDs, ECLASS IRDIs in both spellings, without placeholders', () => {
    const ids = sheetConceptIds(v2)
    expect(ids).toContain('https://example.com/ids/cd/technical-data/SafetyIntegrityLevel')
    expect(ids).not.toContain('https://admin-shell.io/SMT/General/Arbitrary')
    expect(sheetConceptIds(v12)).not.toContain('https://admin-shell.io/SemanticIdNotAvailable/1/1')
    expect(conceptSpellings('0173-1#02-ZZA001#001')).toEqual(['0173-1#02-ZZA001#001', 'https://api.eclass-cdp.com/0173-1-02-ZZA001-001'])
    expect(conceptSpellings('https://api.eclass-cdp.com/0173-1-02-zza001-001')).toEqual(['https://api.eclass-cdp.com/0173-1-02-zza001-001', '0173-1#02-ZZA001#001'])
    expect(conceptSpellings('https://example.com/a')).toEqual(['https://example.com/a'])
    expect(conceptQuery(['0173-1#02-ZZA001#001', '0173-1#02-ZZA001#001'])).toHaveLength(2)
  })

  it('shows an area as property, value and unit rows, sections above their elements, with names and units of the concepts', async () => {
    const concepts = await conceptsOf(v2)
    const rows = sheetRows(t, v2.areas[0]!, concepts, 'en', false)
    expect(rows.map(row => [row.kind, row.depth, row.label, row.value, row.unit])).toEqual([
      ['value', 0, 'Rated power', '3.0', 'kW'],
      ['value', 0, 'Rated voltage', '400', 'V'],
      // Its concept description is under the api.eclass-cdp.com spelling.
      ['value', 0, 'Rated current', '7.25', 'A'],
      ['section', 0, 'Power supply', '', ''],
      ['value', 1, 'Supply frequency', '50 – 60', 'Hz'],
      ['value', 1, 'Number of phases', '3', ''],
      ['section', 1, 'Protection', '', ''],
      ['value', 2, 'Overvoltage protection', 'value.yes', ''],
      ['value', 2, 'Short-circuit current rating', '65', 'kA'],
      ['value', 0, 'Ambient temperature in operation', '-20 – 40', '°C'],
      ['value', 0, 'Installation altitude', '≤ 1000', 'm'],
      ['value', 0, 'Integrated brake chopper', 'value.no', ''],
      ['value', 0, 'Firmware release date', 'Mar 1, 2026', ''],
      ['value', 0, 'Dimension drawing', 'sd-200-dimensions.svg', ''],
      ['value', 0, 'Application note', 'For synchronous servo motors up to 3 kW.', ''],
    ])
    // The concept's definition and the element's own description, each in its column.
    expect(rows[0]).toMatchObject({ definition: 'Mechanical power at the shaft in continuous operation at rated values.', description: 'At 400 V and 8 kHz switching frequency.' })
    expect(rows.find(row => row.label === 'Number of phases')).toMatchObject({ description: '', definition: 'Phases of the supply.' })
    expect(valueWithUnit(rows[0]!)).toBe('3.0\u00A0kW')
    expect(valueWithUnit({ value: 'Yes', unit: '' })).toBe('Yes')
    expect(rows.find(row => row.label === 'Dimension drawing')).toMatchObject({ file: { path: 'TechnicalPropertyAreas[0].DimensionDrawing' } })
    expect(rows.find(row => row.label === 'Supply frequency')!.field).toMatchObject({ modelType: 'Range', min: '50', max: '60' })
    // German names and numbers from the same concepts.
    expect(sheetRows(t, v2.areas[0]!, concepts, 'de', false).slice(0, 3).map(row => [row.label, row.value])).toEqual([['Bemessungsleistung', '3,0'], ['Bemessungsspannung', '400'], ['Bemessungsstrom', '7,25']])
    // Without concept descriptions: idShorts and no units.
    expect(sheetRows(t, v2.areas[0]!, new Map(), 'en', false)[0]).toMatchObject({ label: 'Rated power', unit: '' })
    expect(sheetRows(t, v2.areas[1]!, new Map(), 'en', false)[0]).toMatchObject({ label: 'Weight', value: '4.85', unit: '' })
  })

  it('names areas by their display name and specific descriptions by a supplemental semantic ID\'s concept', async () => {
    const concepts = await conceptsOf(v2)
    const fallback = (number: number) => `Area ${number}`
    expect(areaTitles(v2.areas, concepts, 'de', fallback)).toEqual(['Elektrisch', 'Mechanisch'])
    expect(sheetRows(t, v2.specificDescriptions[0]!, concepts, 'en', false).map(row => [row.label, row.value])).toEqual([
      ['Safety function', 'STO (Safe torque off)'],
      ['Safety integrity level', 'SIL 3'],
      ['Performance level', 'PL e'],
    ])
    const unnamed = v2.areas.map(area => ({ ...area, displayName: [] }))
    expect(areaTitles(unnamed, concepts, 'en', fallback)).toEqual(['Area 1', 'Area 2'])
    // A name several areas share, e.g. their concept's, is numbered.
    const shared = new Map([['urn:area', { id: 'urn:area', preferredName: [{ language: 'en', text: 'Technical property area' }], shortName: [], definition: [], unit: null, dataType: null }]])
    expect(areaTitles(unnamed.map(area => ({ ...area, conceptIds: ['urn:area'] })), shared, 'en', fallback)).toEqual(['Technical property area 1', 'Technical property area 2'])
  })

  it('reads 1.2\'s main and sub sections, and elements without a dictionary ID', async () => {
    const concepts = await conceptsOf(v12)
    expect(v12.areas).toHaveLength(1)
    expect(sheetRows(t, v12.areas[0]!, concepts, 'en', false).map(row => [row.depth, row.label, row.value, row.unit])).toEqual([
      [0, 'Electrical', '', ''],
      [1, 'Rated power', '3.0', 'kW'],
      [1, 'Rated voltage', '400', 'V'],
      [1, 'Supply', '', ''],
      [2, 'Supply frequency', '50 – 60', 'Hz'],
      [0, 'Mechanical', '', ''],
      [1, 'Weight', '4.9', 'kg'],
      [0, 'Colour of housing', 'Anthracite', ''],
    ])
  })

  it('finds rows by every word, in their label, value, unit, description, definition or section, keeping the sections above them', async () => {
    const rows = sheetRows(t, v2.areas[0]!, await conceptsOf(v2), 'en', false)
    expect(filterRows(rows, '')).toBe(rows)
    expect(filterRows(rows, 'kA').map(row => row.label)).toEqual(['Power supply', 'Protection', 'Short-circuit current rating'])
    // Descriptions and definitions too: Rated voltage is the "supply voltage between phases".
    expect(filterRows(rows, 'supply phases').map(row => row.label)).toEqual(['Rated voltage', 'Power supply', 'Number of phases'])
    expect(filterRows(rows, 'POWER rated').map(row => row.label)).toEqual(['Rated power'])
    expect(filterRows(rows, 'nothing like this')).toEqual([])
  })

  it('leaves out a description that only repeats the label', () => {
    const node = { idShort: 'Width', displayName: [], description: [{ language: 'en', text: 'width' }], conceptIds: [] }
    expect(descriptionOf(node, 'Width', 'en')).toBe('')
    expect(descriptionOf({ ...node, description: [{ language: 'en', text: 'Without the cable gland.' }] }, 'Width', 'en')).toBe('Without the cable gland.')
  })

  it('hides the rows below a collapsed section, and all of a collapsed area', async () => {
    const rows = sheetRows(t, v2.areas[0]!, await conceptsOf(v2), 'en', false)
    const supply = rows.find(row => row.label === 'Power supply')!
    const labels = (shown: typeof rows) => shown.map(row => row.label)
    expect(visibleRows(rows, new Set())).toBe(rows)
    // The section's own row stays, so that it opens again; its nested section goes with it.
    expect(labels(visibleRows(rows, new Set([supply.key])))).toEqual(['Rated power', 'Rated voltage', 'Rated current', 'Power supply', 'Ambient temperature in operation', 'Installation altitude', 'Integrated brake chopper', 'Firmware release date', 'Dimension drawing', 'Application note'])
    expect(visibleRows(rows, new Set([v2.areas[0]!.path]), v2.areas[0]!.path)).toEqual([])
  })

  it('writes every row as CSV, with values as stored and the sections they lie in', async () => {
    const concepts = await conceptsOf(v2)
    const sheets = v2.areas.map((area, index) => ({ area, title: ['Electrical', 'Mechanical'][index]! }))
    const csv = sheetCsv(t, sheets, concepts, 'de')
    expect(csv.startsWith('\uFEFF')).toBe(true)
    const lines = csv.slice(1).split('\r\n')
    expect(lines[0]).toBe('csv.area,csv.section,sheet.property,sheet.value,csv.min,csv.max,sheet.unit,sheet.description,sheet.definition,csv.semanticId')
    // German names, but values as stored: a point, not "3,0".
    expect(lines[1]).toBe('Electrical,,Bemessungsleistung,3.0,,,kW,Bei 400 V und 8 kHz Schaltfrequenz.,Mechanische Leistung an der Welle im Dauerbetrieb bei Bemessungswerten.,https://example.com/ids/cd/technical-data/RatedPower')
    expect(lines.find(line => line.includes('Bemessungskurzschlussstrom'))).toBe('Electrical,Stromversorgung / Protection,Bemessungskurzschlussstrom,65,,,kA,,"Unbeeinflusster Kurzschlussstrom, dem der Antrieb an seiner Versorgung standhält.",https://example.com/ids/cd/technical-data/ShortCircuitCurrentRating')
    // A Range's bounds in their own columns, a File as its path, a boolean as stored.
    expect(lines.find(line => line.includes('Umgebungstemperatur'))).toContain(',,-20,40,°C,')
    expect(lines.find(line => line.includes('Aufstellungshöhe'))).toContain(',,,1000,m,')
    expect(lines.find(line => line.startsWith('Electrical,,Dimension drawing'))).toContain(',/aasx/files/technical-data/sd-200-dimensions.svg,')
    expect(lines.find(line => line.includes('Überspannungsschutz'))).toContain(',true,')
    expect(lines).toHaveLength(2 + 13 + 6)
    expect(csvFileName(t, 'Servo drive SD-200 / B')).toBe('csv.fileName{"name":"Servo drive SD-200  B"}')
    expect(csvFileName(t, '')).toBe('csv.fileName{"name":"technicalData.untitled"}')
  })

  it('lists every value in edit mode, empty ones too, and hides sections without values', async () => {
    const [weight] = v2.areas[1]!.children
    const area = { ...v2.areas[1]!, children: [...v2.areas[1]!.children, { ...weight!, path: 'X.Empty', idShort: 'Empty', conceptIds: [], field: { path: 'X.Empty', modelType: 'Property' as const, values: [], valueId: '' } }] }
    const concepts = await conceptsOf(v2)
    expect(sheetRows(t, area, concepts, 'en', false).map(row => row.label)).not.toContain('Empty')
    expect(sheetRows(t, area, concepts, 'en', true).map(row => row.label)).toContain('Empty')
  })
})

describe('lists', () => {
  // AASd-115 and AASd-109: an entry without a semantic ID or value type of its own has the list's.
  const list = {
    modelType: 'Submodel',
    semanticId: { keys: [{ value: '0173-1#01-AHX837#002' }] },
    submodelElements: [{
      idShort: 'TechnicalPropertyAreas',
      modelType: 'SubmodelElementList',
      semanticIdListElement: { keys: [{ value: 'urn:area' }] },
      value: [{
        modelType: 'SubmodelElementCollection',
        value: [{
          idShort: 'Lengths',
          modelType: 'SubmodelElementList',
          semanticIdListElement: { keys: [{ value: 'urn:length' }] },
          valueTypeListElement: 'xs:decimal',
          value: [
            { modelType: 'Property', valueType: 'xs:decimal', value: '5.0' },
            { modelType: 'Property', semanticId: { keys: [{ value: 'urn:width' }] }, value: '7.5' },
          ],
        }],
      }],
    }],
  }
  const concept = (id: string, name: string, unit: string | null) => ({ id, preferredName: [{ language: 'en', text: name }], shortName: [], definition: [], unit, dataType: null })
  const concepts = new Map([
    ['urn:area', concept('urn:area', 'Dimensions', null)],
    ['urn:length', concept('urn:length', 'Length', 'mm')],
    ['urn:width', concept('urn:width', 'Width', 'cm')],
  ])

  it('gives entries the list\'s semantic ID and value type, where they have none', () => {
    const data = parseTechnicalData(list)
    expect(sheetConceptIds(data)).toEqual(['urn:area', 'urn:length', 'urn:width'])
    expect(areaTitles(data.areas, concepts, 'en', number => `Area ${number}`)).toEqual(['Dimensions'])
    const rows = sheetRows(t, data.areas[0]!, concepts, 'en', false)
    expect(rows.map(row => [row.label, row.value, row.unit])).toEqual([
      ['Lengths', '', ''],
      ['Length', '5.0', 'mm'],
      // Its own semantic ID wins.
      ['Width', '7.5', 'cm'],
    ])
    // Without a value type of its own, the list's makes it a number: "7,5" in German.
    expect(sheetRows(t, data.areas[0]!, concepts, 'de', false)[2]!.value).toBe('7,5')
  })

  it('writes the inherited unit and semantic ID to the CSV', () => {
    const data = parseTechnicalData(list)
    const lines = sheetCsv(t, [{ area: data.areas[0]!, title: 'Dimensions' }], concepts, 'en').slice(1).split('\r\n')
    expect(lines[1]).toBe('Dimensions,Lengths,Length,5.0,,,mm,,,urn:length')
  })
})

describe('values', () => {
  it('formats numbers with the decimals given, dates, and booleans by their type', () => {
    expect(numberText('3.0', 'de')).toBe('3,0')
    expect(numberText('1500', 'en')).toBe('1500')
    expect(numberText('15000.5', 'en')).toBe('15,000.5')
    expect(numberText('-20', 'en')).toBe('-20')
    expect(numberText('1e3', 'en')).toBe('1e3')
    expect(numberText('n/a', 'en')).toBe('n/a')
    // Every digit of an xs:long or xs:decimal, beyond what a Number holds.
    expect(numberText('9007199254740993', 'en')).toBe('9,007,199,254,740,993')
    expect(numberText('0.12345678901234567890', 'de')).toBe('0,12345678901234567890')
    expect(typedText(t, '18446744073709551615', 'xs:unsignedLong', 'en')).toBe('18,446,744,073,709,551,615')
    // Leading zeros stay as stored.
    expect(numberText('007', 'en')).toBe('007')
    expect(typedText(t, '1', 'xs:boolean', 'en')).toBe('value.yes')
    expect(typedText(t, 'maybe', 'xs:boolean', 'en')).toBe('maybe')
    expect(typedText(t, 'IP65', 'xs:string', 'en')).toBe('IP65')
    expect(dateText('2026-01-15', 'en')).toBe('Jan 15, 2026')
    expect(dateText('2026-13-45', 'en')).toBe('2026-13-45')
    expect(dateText('soon', 'en')).toBe('soon')
    expect([rangeText('1', '2'), rangeText('1', ''), rangeText('', '2'), rangeText('', '')]).toEqual(['1 – 2', '≥ 1', '≤ 2', ''])
  })
})

describe('describing concepts (app API 0.1.15)', () => {
  it('answers in the order asked, null for IDs without a concept description', async () => {
    const aas = memoryAas({ conceptDescriptions: environment.conceptDescriptions })
    const { client } = createTestStudio({ handlers: aas.handlers })
    const { concepts } = await client.aas.describeConcepts(['urn:unknown', 'https://example.com/ids/cd/technical-data/RatedPower', 'urn:unknown'])
    expect(concepts[0]).toBeNull()
    expect(concepts[1]).toMatchObject({ id: 'https://example.com/ids/cd/technical-data/RatedPower', unit: 'kW', shortName: [{ language: 'en', text: 'P' }], dataType: 'REAL_MEASURE' })
    expect(concepts[2]).toBeNull()
  })

  it('takes up to 500 IDs', () => {
    const schema = appMethodParamsSchemas['studio.aas.describeConcepts']
    expect(schema.safeParse({ ids: Array.from({ length: 500 }, (_, index) => `urn:x:${index}`) }).success).toBe(true)
    expect(schema.safeParse({ ids: Array.from({ length: 501 }, (_, index) => `urn:x:${index}`) }).success).toBe(false)
    expect(schema.safeParse({ ids: [''] }).success).toBe(false)
  })
})
