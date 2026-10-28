// Generates the technical data demo (open/studio-technical-data.aasx, and
// its environment as JSON in technical-data/ for the unit tests) for the
// Technical Data app: a servo drive with IDTA 02003 Technical Data 2.0.2
// (logo, three product images with notes, an ECLASS and an IEC CDD class,
// the ECLASS one referring to its area, two areas of technical properties
// with nested sections, ranges, one open-ended, booleans, a date, a text in
// two languages and a drawing, some with descriptions of their own,
// specific descriptions, and further information), concept descriptions
// with units and names in English and German, and a second shell with the
// same product as ZVEI Technical Data 1.2 (`MainSection`, `SubSection`,
// `SemanticIdNotAvailable`, numbered images, and the template's ValidDate
// with ManufacturerOrderCode's semantic ID). The IDs of the properties are
// made up for the demo; the ECLASS-like ones use the made-up class `ZZ`.
// Verified with AAS Core 3.1; every file is drawn here, so the fixture
// carries no third-party content.
//
// Run with: pnpm testenv:fixtures

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'
import { unzipSync, zipSync } from 'fflate'

const require = createRequire(import.meta.url)
const { jsonization, verification } = require('@aas-core-works/aas-core3.1-typescript')
const { NewPackaging } = require('aas-package3-typescript')

const fixturesDir = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/** A PNG of rectangles on a background: product images and the shell thumbnail. */
function png (width, height, background, rects) {
  const pixels = new Uint8Array(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    pixels.set(background, i * 3)
  }
  for (const [x, y, w, h, color] of rects) {
    for (let j = y; j < y + h; j++) {
      for (let i = x; i < x + w; i++) {
        pixels.set(color, (j * width + i) * 3)
      }
    }
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  const rows = []
  for (let y = 0; y < height; y++) {
    rows.push(Buffer.from([0]), Buffer.from(pixels.subarray(y * width * 3, (y + 1) * width * 3)))
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function svg (width, height, body) {
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
${body}
</svg>
`)
}

const purple = '#5a3d99'
const ink = '#212121'
const steel = [120, 130, 140]
const dark = [55, 60, 66]
const accent = [90, 61, 153]

/** The manufacturer's logo: a gear and its name (as the nameplate demo's). */
const logoSvg = svg(240, 80, `  <rect width="240" height="80" rx="8" fill="#ffffff"/>
  <g transform="translate(40 40)" fill="${purple}">
    <circle r="22"/>
    ${Array.from({ length: 8 }, (_, index) => `<rect x="-5" y="-30" width="10" height="12" transform="rotate(${index * 45})"/>`).join('\n    ')}
    <circle r="9" fill="#ffffff"/>
  </g>
  <text x="80" y="36" font-family="Arial, sans-serif" font-size="20" font-weight="700" fill="${ink}">EXAMPLE</text>
  <text x="80" y="60" font-family="Arial, sans-serif" font-size="20" fill="${purple}">DRIVES</text>`)

/** The drive's dimension drawing: its outline with three dimensions. */
const drawingSvg = svg(320, 240, `  <rect width="320" height="240" fill="#ffffff"/>
  <rect x="100" y="30" width="90" height="180" fill="none" stroke="${ink}" stroke-width="3"/>
  <rect x="115" y="50" width="60" height="30" fill="none" stroke="${ink}" stroke-width="2"/>
  <path d="M100 222 H190 M100 216 V228 M190 216 V228" stroke="${purple}" stroke-width="2"/>
  <text x="145" y="236" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" fill="${purple}">120</text>
  <path d="M210 30 V210 M204 30 H216 M204 210 H216" stroke="${purple}" stroke-width="2"/>
  <text x="222" y="124" font-family="Arial, sans-serif" font-size="12" fill="${purple}">280</text>`)

/** Product images: the drive from the front, from the side, and on its mounting plate. */
const frontPng = png(240, 180, [236, 239, 241], [[80, 20, 80, 140, steel], [92, 36, 56, 24, dark], [92, 72, 56, 6, accent], [100, 120, 40, 24, dark]])
const sidePng = png(240, 180, [236, 239, 241], [[50, 20, 140, 140, steel], [60, 130, 20, 20, dark], [90, 130, 20, 20, dark], [120, 130, 20, 20, dark]])
const mountingPng = png(240, 180, [236, 239, 241], [[30, 10, 180, 160, [200, 204, 208]], [80, 20, 80, 140, steel], [92, 36, 56, 24, dark]])

/** Files of the demo, by name, stored under /aasx/files/technical-data/. */
const files = {
  'example-drives-logo.svg': { contentType: 'image/svg+xml', content: logoSvg },
  'sd-200-front.png': { contentType: 'image/png', content: frontPng },
  'sd-200-side.png': { contentType: 'image/png', content: sidePng },
  'sd-200-mounting.png': { contentType: 'image/png', content: mountingPng },
  'sd-200-dimensions.svg': { contentType: 'image/svg+xml', content: drawingSvg },
}
const filePath = name => `/aasx/files/technical-data/${name}`

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

const reference = value => ({ type: 'ExternalReference', keys: [{ type: 'GlobalReference', value }] })
const en = text => [{ language: 'en', text }]
const texts = value => (typeof value === 'string' ? en(value) : Object.entries(value).map(([language, text]) => ({ language, text })))

/** Optional parts of an element: a display name and a description in several languages, supplemental semantic IDs. */
function extras ({ displayName, description, supplemental } = {}) {
  return {
    ...(displayName ? { displayName: texts(displayName) } : {}),
    ...(description ? { description: texts(description) } : {}),
    ...(supplemental ? { supplementalSemanticIds: supplemental.map(id => reference(id)) } : {}),
  }
}

function prop (idShort, semanticId, value, valueType = 'xs:string', options) {
  return { ...(idShort ? { idShort } : {}), modelType: 'Property', ...extras(options), ...(semanticId ? { semanticId: reference(semanticId) } : {}), valueType, ...(value === undefined ? {} : { value: String(value) }) }
}

/** A MultiLanguageProperty from a text, or from `{ en, de, ... }`. */
function mlp (idShort, semanticId, value, options) {
  return { ...(idShort ? { idShort } : {}), modelType: 'MultiLanguageProperty', ...extras(options), ...(semanticId ? { semanticId: reference(semanticId) } : {}), value: texts(value) }
}

function range (idShort, semanticId, min, max, valueType = 'xs:double', options) {
  return { idShort, modelType: 'Range', ...extras(options), semanticId: reference(semanticId), valueType, ...(min === undefined ? {} : { min: String(min) }), ...(max === undefined ? {} : { max: String(max) }) }
}

function smc (idShort, semanticId, value, options) {
  return { ...(idShort ? { idShort } : {}), modelType: 'SubmodelElementCollection', ...extras(options), ...(semanticId ? { semanticId: reference(semanticId) } : {}), value }
}

/** A list of collections, each `{ value, displayName? }`. */
function sml (idShort, semanticId, itemSemanticId, items) {
  return {
    idShort,
    modelType: 'SubmodelElementList',
    semanticId: reference(semanticId),
    orderRelevant: true,
    semanticIdListElement: reference(itemSemanticId),
    typeValueListElement: 'SubmodelElementCollection',
    value: items.map(item => smc(undefined, itemSemanticId, item.value, item)),
  }
}

function file (idShort, semanticId, name, options) {
  return { ...(idShort ? { idShort } : {}), modelType: 'File', ...extras(options), ...(semanticId ? { semanticId: reference(semanticId) } : {}), contentType: files[name].contentType, value: filePath(name) }
}

// ---------------------------------------------------------------------------
// Concept descriptions of the demo's properties
// ---------------------------------------------------------------------------

/** A made-up dictionary ID of the demo. */
const demo = name => `https://example.com/ids/cd/technical-data/${name}`
/** A made-up ID in ECLASS's form; its concept description uses the `api.eclass-cdp.com` spelling. */
const eclassLike = code => `0173-1#02-${code}#001`
const eclassLikeUrl = code => `https://api.eclass-cdp.com/0173-1-02-${code}-001`

const iec61360 = 'https://admin-shell.io/DataSpecificationTemplates/DataSpecificationIec61360/3/0'

function concept (id, idShort, { name, short, unit, definition, dataType = 'REAL_MEASURE' }) {
  return {
    modelType: 'ConceptDescription',
    id,
    idShort,
    embeddedDataSpecifications: [{
      dataSpecification: reference(iec61360),
      dataSpecificationContent: {
        modelType: 'DataSpecificationIec61360',
        preferredName: texts(name),
        ...(short ? { shortName: texts(short) } : {}),
        ...(unit ? { unit } : {}),
        ...(definition ? { definition: texts(definition) } : {}),
        dataType,
      },
    }],
  }
}

const cds = {
  ratedPower: demo('RatedPower'),
  ratedVoltage: demo('RatedVoltage'),
  ratedCurrent: eclassLike('ZZA001'),
  frequency: demo('SupplyFrequency'),
  phases: demo('NumberOfPhases'),
  overvoltage: demo('OvervoltageProtection'),
  shortCircuit: demo('ShortCircuitCurrentRating'),
  ambient: demo('AmbientTemperature'),
  altitude: demo('InstallationAltitude'),
  brakeChopper: demo('IntegratedBrakeChopper'),
  firmwareDate: demo('FirmwareReleaseDate'),
  weight: eclassLike('ZZA002'),
  protection: demo('DegreeOfProtection'),
  width: demo('Width'),
  height: demo('Height'),
  depth: demo('Depth'),
  mounting: demo('MountingPosition'),
  // Named by a supplemental semantic ID only.
  safetyIntegrity: demo('SafetyIntegrityLevel'),
}

const conceptDescriptions = [
  concept(cds.ratedPower, 'RatedPower', { name: { en: 'Rated power', de: 'Bemessungsleistung' }, short: 'P', unit: 'kW', definition: { en: 'Mechanical power at the shaft in continuous operation at rated values.', de: 'Mechanische Leistung an der Welle im Dauerbetrieb bei Bemessungswerten.' } }),
  concept(cds.ratedVoltage, 'RatedVoltage', { name: { en: 'Rated voltage', de: 'Bemessungsspannung' }, short: 'U', unit: 'V', dataType: 'INTEGER_MEASURE', definition: { en: 'Supply voltage between phases the drive is designed for.', de: 'Versorgungsspannung zwischen den Phasen, für die der Antrieb ausgelegt ist.' } }),
  concept(eclassLikeUrl('ZZA001'), 'RatedCurrent', { name: { en: 'Rated current', de: 'Bemessungsstrom' }, short: 'I', unit: 'A', definition: { en: 'Output current in continuous operation at rated values.', de: 'Ausgangsstrom im Dauerbetrieb bei Bemessungswerten.' } }),
  concept(cds.frequency, 'SupplyFrequency', { name: { en: 'Supply frequency', de: 'Netzfrequenz' }, unit: 'Hz', definition: { en: 'Frequencies of the supply the drive runs on.', de: 'Frequenzen der Versorgung, an der der Antrieb betrieben werden kann.' } }),
  concept(cds.phases, 'NumberOfPhases', { name: { en: 'Number of phases', de: 'Anzahl der Phasen' }, dataType: 'INTEGER_COUNT', definition: { en: 'Phases of the supply.', de: 'Phasen der Versorgung.' } }),
  concept(cds.overvoltage, 'OvervoltageProtection', { name: { en: 'Overvoltage protection', de: 'Überspannungsschutz' }, dataType: 'BOOLEAN', definition: { en: 'Whether the drive protects itself against overvoltage in the supply.', de: 'Ob sich der Antrieb gegen Überspannung in der Versorgung schützt.' } }),
  concept(cds.shortCircuit, 'ShortCircuitCurrentRating', { name: { en: 'Short-circuit current rating', de: 'Bemessungskurzschlussstrom' }, short: 'SCCR', unit: 'kA', definition: { en: 'Prospective short-circuit current the drive withstands at its supply.', de: 'Unbeeinflusster Kurzschlussstrom, dem der Antrieb an seiner Versorgung standhält.' } }),
  concept(cds.ambient, 'AmbientTemperature', { name: { en: 'Ambient temperature in operation', de: 'Umgebungstemperatur im Betrieb' }, unit: '°C', definition: { en: 'Temperatures of the air around the drive it runs in.', de: 'Temperaturen der Luft um den Antrieb, bei denen er betrieben werden kann.' } }),
  concept(cds.altitude, 'InstallationAltitude', { name: { en: 'Installation altitude', de: 'Aufstellungshöhe' }, unit: 'm', definition: { en: 'Highest altitude above sea level without derating.', de: 'Größte Höhe über dem Meeresspiegel ohne Leistungsminderung.' } }),
  concept(cds.brakeChopper, 'IntegratedBrakeChopper', { name: { en: 'Integrated brake chopper', de: 'Integrierter Bremschopper' }, dataType: 'BOOLEAN', definition: { en: 'Whether the drive has a brake chopper of its own.', de: 'Ob der Antrieb einen eigenen Bremschopper hat.' } }),
  concept(cds.firmwareDate, 'FirmwareReleaseDate', { name: { en: 'Firmware release date', de: 'Freigabedatum der Firmware' }, dataType: 'DATE', definition: { en: 'Date the installed firmware was released.', de: 'Datum, an dem die installierte Firmware freigegeben wurde.' } }),
  concept(eclassLikeUrl('ZZA002'), 'Weight', { name: { en: 'Weight', de: 'Gewicht' }, short: 'm', unit: 'kg', definition: { en: 'Mass of the drive without packaging.', de: 'Masse des Antriebs ohne Verpackung.' } }),
  concept(cds.protection, 'DegreeOfProtection', { name: { en: 'Degree of protection (IP code)', de: 'Schutzart (IP-Code)' }, dataType: 'STRING', definition: { en: 'Protection of the housing against solids and water, as IP code.', de: 'Schutz des Gehäuses gegen Fremdkörper und Wasser als IP-Code.' } }),
  concept(cds.width, 'Width', { name: { en: 'Width', de: 'Breite' }, unit: 'mm', definition: { en: 'Width of the housing.', de: 'Breite des Gehäuses.' } }),
  concept(cds.height, 'Height', { name: { en: 'Height', de: 'Höhe' }, unit: 'mm', definition: { en: 'Height of the housing.', de: 'Höhe des Gehäuses.' } }),
  concept(cds.depth, 'Depth', { name: { en: 'Depth', de: 'Tiefe' }, unit: 'mm', definition: { en: 'Depth of the housing.', de: 'Tiefe des Gehäuses.' } }),
  concept(cds.mounting, 'MountingPosition', { name: { en: 'Mounting position', de: 'Einbaulage' }, dataType: 'STRING', definition: { en: 'Position the drive is mounted in.', de: 'Lage, in der der Antrieb eingebaut wird.' } }),
  concept(cds.safetyIntegrity, 'SafetyIntegrityLevel', { name: { en: 'Safety integrity level', de: 'Sicherheitsintegritätslevel' }, short: 'SIL', dataType: 'STRING', definition: { en: 'Safety integrity level of the safety functions to IEC 61508.', de: 'Sicherheitsintegritätslevel der Sicherheitsfunktionen nach IEC 61508.' } }),
]

// ---------------------------------------------------------------------------
// IDTA 02003 Technical Data 2.0.2 (as server/lib/templates/technical-data.json)
// ---------------------------------------------------------------------------

const td2 = {
  submodel: '0173-1#01-AHX837#002',
  generalInformation: '0173-1#02-ABK161#002/0173-1#01-AHX838#002',
  manufacturerName: '0173-1#02-AAO677#004',
  companyLogo: '0173-1#02-ABI776#002',
  productDesignation: '0173-1#02-AAW338#003',
  articleNumber: '0173-1#02-AAO676#005',
  orderCode: '0173-1#02-AAO227#004',
  productImages: '0173-1#02-ABM220#001',
  productImage: '0173-1#02-ABM220#001/0173-1#01-AHY911#001',
  imageFile: '0173-1#02-ABK291#002',
  imageNote: '0173-1#02-ABL423#001',
  classifications: '0173-1#02-ABK162#002',
  classification: '0173-1#02-ABK162#002/0173-1#01-AHX839#002',
  classificationSystem: '0173-1#02-ABL424#001',
  classificationSystemVersion: '0173-1#02-AAR710#003',
  classificationSystemUrl: 'https://admin-shell.io/IDTA/TechnicalData/ProductClassifications/ProduktClassification/ClassificationSystemUrl/2/0',
  productClassId: '0173-1#02-ABG776#003',
  productClassCodedName: '0173-1#02-ABK128#002',
  productClassName: '0173-1#02-ABK273#002',
  areaReference: '0173-1#02-ABL358#002',
  areas: '0173-1#02-ABK163#002',
  area: '0173-1#02-ABL358#002/0173-1#01-AHX773#002',
  arbitrary: 'https://admin-shell.io/SMT/General/Arbitrary',
  furtherInformation: '0173-1#02-ABK164#002',
  textStatement: '0173-1#02-ABK134#002',
  validDate: '0173-1#02-ABL775#001',
  specificDescriptions: '0173-1#02-ABM221#001',
  specificDescription: '0173-1#02-ABM221#001/0173-1#01-AHY912#001',
}

const ids = {
  shell: 'urn:studio:test:aas:technical-data',
  asset: 'urn:studio:test:asset:technical-data:sd-200-000314',
  technicalData: 'urn:studio:test:sm:technical-data:2-0',
  shell12: 'urn:studio:test:aas:technical-data-1-2',
  asset12: 'urn:studio:test:asset:technical-data:sd-200-000102',
  technicalData12: 'urn:studio:test:sm:technical-data:1-2',
}

/** The area the ECLASS class refers to: the first of the list. */
const electricalArea = {
  type: 'ModelReference',
  keys: [
    { type: 'Submodel', value: ids.technicalData },
    { type: 'SubmodelElementList', value: 'TechnicalPropertyAreas' },
    { type: 'SubmodelElementCollection', value: '0' },
  ],
}

const technicalData2 = {
  modelType: 'Submodel',
  id: ids.technicalData,
  idShort: 'TechnicalData',
  semanticId: { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: td2.submodel }] },
  administration: { version: '2', revision: '0' },
  submodelElements: [
    smc('GeneralInformation', td2.generalInformation, [
      prop('ManufacturerName', td2.manufacturerName, 'Example Drives GmbH'),
      file('CompanyLogo', td2.companyLogo, 'example-drives-logo.svg'),
      mlp('ManufacturerProductDesignation', td2.productDesignation, { en: 'Servo drive SD-200', de: 'Servoantrieb SD-200' }),
      prop('ManufacturerArticleNumber', td2.articleNumber, 'SD-200-400-3'),
      prop('ManufacturerOrderCode', td2.orderCode, 'SD200-4-3-B'),
      sml('ProductImages', td2.productImages, td2.productImage, [
        { value: [file('ImageFile', td2.imageFile, 'sd-200-front.png'), mlp('ImageNote', td2.imageNote, { en: 'Front view', de: 'Vorderansicht' })] },
        { value: [file('ImageFile', td2.imageFile, 'sd-200-side.png'), mlp('ImageNote', td2.imageNote, { en: 'Connectors at the bottom', de: 'Anschlüsse unten' })] },
        { value: [file('ImageFile', td2.imageFile, 'sd-200-mounting.png')] },
      ]),
    ]),
    sml('ProductClassifications', td2.classifications, td2.classification, [
      {
        value: [
          prop('ClassificationSystem', td2.classificationSystem, 'ECLASS'),
          prop('ClassificationSystemVersion', td2.classificationSystemVersion, '14.0'),
          prop('ClassificationSystemUrl', td2.classificationSystemUrl, 'https://eclass.eu'),
          prop('ProductClassId', td2.productClassId, '27-02-31-90'),
          prop('ProductClassCodedName', td2.productClassCodedName, '27023190'),
          mlp('ProductClassName', td2.productClassName, { en: 'Servo drive (demo class)', de: 'Servoantrieb (Demo-Klasse)' }),
          { idShort: 'ReferenceToTechnicalPropertyArea', modelType: 'ReferenceElement', semanticId: reference(td2.areaReference), value: electricalArea },
        ],
      },
      {
        value: [
          prop('ClassificationSystem', td2.classificationSystem, 'IEC CDD'),
          prop('ClassificationSystemVersion', td2.classificationSystemVersion, '2.0'),
          prop('ProductClassId', td2.productClassId, 'ZZB001'),
          prop('ProductClassCodedName', td2.productClassCodedName, 'Servo drive'),
        ],
      },
    ]),
    sml('TechnicalPropertyAreas', td2.areas, td2.area, [
      {
        displayName: { en: 'Electrical', de: 'Elektrisch' },
        value: [
          prop('RatedPower', cds.ratedPower, '3.0', 'xs:double', { description: { en: 'At 400 V and 8 kHz switching frequency.', de: 'Bei 400 V und 8 kHz Schaltfrequenz.' } }),
          prop('RatedVoltage', cds.ratedVoltage, '400', 'xs:integer'),
          prop('RatedCurrent', cds.ratedCurrent, '7.25', 'xs:double', { description: { en: 'Peak current for 3 s: 14.5 A.', de: 'Spitzenstrom für 3 s: 14,5 A.' } }),
          smc('Supply', td2.arbitrary, [
            range('SupplyFrequency', cds.frequency, '50', '60'),
            prop('NumberOfPhases', cds.phases, '3', 'xs:integer'),
            smc('Protection', td2.arbitrary, [
              prop('OvervoltageProtection', cds.overvoltage, 'true', 'xs:boolean'),
              prop('ShortCircuitCurrentRating', cds.shortCircuit, '65', 'xs:double'),
            ]),
          ], { displayName: { en: 'Power supply', de: 'Stromversorgung' } }),
          range('AmbientTemperature', cds.ambient, '-20', '40', 'xs:double', { description: { en: 'Above 40 °C with 2.5 % less power per kelvin, up to 55 °C.', de: 'Über 40 °C mit 2,5 % weniger Leistung je Kelvin, bis 55 °C.' } }),
          range('InstallationAltitude', cds.altitude, undefined, '1000'),
          prop('IntegratedBrakeChopper', cds.brakeChopper, 'false', 'xs:boolean'),
          prop('FirmwareReleaseDate', cds.firmwareDate, '2026-03-01', 'xs:date'),
          file('DimensionDrawing', td2.arbitrary, 'sd-200-dimensions.svg', { description: { en: 'Front and side view, in millimetres.', de: 'Vorder- und Seitenansicht, in Millimetern.' } }),
          mlp('ApplicationNote', td2.arbitrary, { en: 'For synchronous servo motors up to 3 kW.', de: 'Für Synchron-Servomotoren bis 3 kW.' }),
        ],
      },
      {
        displayName: { en: 'Mechanical', de: 'Mechanisch' },
        value: [
          prop('Weight', cds.weight, '4.85', 'xs:double'),
          prop('DegreeOfProtection', cds.protection, 'IP65'),
          smc('Dimensions', td2.arbitrary, [
            prop('Width', cds.width, '120', 'xs:integer'),
            prop('Height', cds.height, '280', 'xs:integer'),
            prop('Depth', cds.depth, '210', 'xs:integer'),
          ]),
          prop('MountingPosition', cds.mounting, 'Vertical'),
        ],
      },
    ]),
    smc('FurtherInformation', td2.furtherInformation, [
      mlp('TextStatement01', td2.textStatement, { en: 'Values at 40 °C ambient temperature and 8 kHz switching frequency.', de: 'Werte bei 40 °C Umgebungstemperatur und 8 kHz Schaltfrequenz.' }),
      mlp('TextStatement02', td2.textStatement, { en: 'Subject to technical changes.', de: 'Technische Änderungen vorbehalten.' }),
      prop('ValidDate', td2.validDate, '2026-01-15', 'xs:date'),
    ]),
    sml('SpecificDescriptions', td2.specificDescriptions, td2.specificDescription, [
      {
        displayName: { en: 'Functional safety', de: 'Funktionale Sicherheit' },
        value: [
          prop('SafetyFunction', td2.arbitrary, 'STO (Safe torque off)', 'xs:string', { description: { en: 'To IEC 61800-5-2.', de: 'Nach IEC 61800-5-2.' } }),
          prop('SafetyIntegrityLevel', td2.arbitrary, 'SIL 3', 'xs:string', { supplemental: [cds.safetyIntegrity] }),
          prop('PerformanceLevel', td2.arbitrary, 'PL e'),
        ],
      },
    ]),
  ],
}

// ---------------------------------------------------------------------------
// ZVEI Technical Data 1.2
// ---------------------------------------------------------------------------

const zvei = name => `https://admin-shell.io/ZVEI/TechnicalData/${name}/1/1`
const notAvailable = 'https://admin-shell.io/SemanticIdNotAvailable/1/1'

const technicalData12 = {
  modelType: 'Submodel',
  id: ids.technicalData12,
  idShort: 'TechnicalData',
  semanticId: { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: 'https://admin-shell.io/ZVEI/TechnicalData/Submodel/1/2' }] },
  administration: { version: '1', revision: '2' },
  submodelElements: [
    smc('GeneralInformation', zvei('GeneralInformation'), [
      prop('ManufacturerName', '0173-1#02-AAO677#002', 'Example Drives GmbH'),
      file('ManufacturerLogo', zvei('ManufacturerLogo'), 'example-drives-logo.svg'),
      mlp('ManufacturerProductDesignation', '0173-1#02-AAW338#001', { en: 'Servo drive SD-200', de: 'Servoantrieb SD-200' }),
      prop('ManufacturerArticleNumber', '0173-1#02-AAO676#003', 'SD-200-400-3'),
      prop('ManufacturerOrderCode', '0173-1#02-AAO227#002', 'SD200-4-3-A'),
      file('ProductImage01', zvei('ProductImage'), 'sd-200-front.png'),
      file('ProductImage02', zvei('ProductImage'), 'sd-200-side.png'),
    ]),
    smc('ProductClassifications', zvei('ProductClassifications'), [
      smc('ProductClassificationItem01', zvei('ProductClassificationItem'), [
        prop('ProductClassificationSystem', zvei('ProductClassificationSystem'), 'ECLASS'),
        prop('ClassificationSystemVersion', zvei('ClassificationSystemVersion'), '11.1'),
        prop('ProductClassId', zvei('ProductClassId'), '27-02-31-90'),
      ]),
    ]),
    smc('TechnicalProperties', zvei('TechnicalProperties'), [
      smc('Electrical', zvei('MainSection'), [
        prop('RatedPower', cds.ratedPower, '3.0', 'xs:double'),
        prop('RatedVoltage', cds.ratedVoltage, '400', 'xs:integer'),
        smc('Supply', zvei('SubSection'), [
          range('SupplyFrequency', cds.frequency, '50', '60'),
        ]),
      ]),
      smc('Mechanical', zvei('MainSection'), [
        prop('Weight', cds.weight, '4.9', 'xs:double'),
      ]),
      prop('ColourOfHousing', notAvailable, 'Anthracite'),
    ]),
    smc('FurtherInformation', zvei('FurtherInformation'), [
      mlp('TextStatement01', zvei('TextStatement'), { en: 'Subject to technical changes.', de: 'Technische Änderungen vorbehalten.' }),
      // As the 1.2 template has it: ValidDate with ManufacturerOrderCode's semantic ID.
      prop('ValidDate', zvei('ManufacturerOrderCode'), '2023-06-01', 'xs:date'),
    ]),
  ],
}

// ---------------------------------------------------------------------------
// Shells, verification and the package
// ---------------------------------------------------------------------------

function shell (id, idShort, name, description, assetId, submodels) {
  return {
    modelType: 'AssetAdministrationShell',
    id,
    idShort,
    displayName: en(name),
    description: en(description),
    assetInformation: { assetKind: 'Instance', globalAssetId: assetId, defaultThumbnail: { path: '/thumbnail.png', contentType: 'image/png' } },
    submodels: submodels.map(value => ({ type: 'ModelReference', keys: [{ type: 'Submodel', value }] })),
  }
}

const environment = {
  assetAdministrationShells: [
    shell(ids.shell, 'TechnicalDataDemo', 'Technical data demo', 'A servo drive with IDTA 02003 Technical Data 2.0, for the Technical Data app.', ids.asset, [ids.technicalData]),
    shell(ids.shell12, 'TechnicalDataDemo12', 'Technical data demo 1.2', 'An older servo drive with ZVEI Technical Data 1.2.', ids.asset12, [ids.technicalData12]),
  ],
  submodels: [technicalData2, technicalData12],
  conceptDescriptions,
}

/** The environment as AAS Core 3.1 writes it, after verifying it. */
function verified (environmentJson) {
  const parsed = jsonization.environmentFromJsonable(environmentJson)
  if (parsed.error !== null) {
    throw new Error(`deserialization failed at ${parsed.error.path}: ${parsed.error.message}`)
  }
  const errors = [...verification.verify(parsed.mustValue())]
  if (errors.length > 0) {
    throw new Error(errors.map(error => `${error.path}: ${error.message}`).join('\n'))
  }
  return jsonization.toJsonable(parsed.mustValue())
}

/** An AASX package of the environment, its files and a thumbnail (as generate-file-previews.mjs writes them). */
async function writeAasx (aasxPath, canonical, parts, thumbnail) {
  const pkg = await NewPackaging().Create(aasxPath)
  try {
    const spec = await pkg.PutPart(new URL('https://package.local/aasx/data.json'), 'application/json', new TextEncoder().encode(JSON.stringify(canonical)))
    await pkg.MakeSpec(spec)
    for (const [path, contentType, content] of parts) {
      const part = await pkg.PutPart(new URL(`https://package.local${path}`), contentType, new Uint8Array(content))
      await pkg.RelateSupplementaryToSpec(part, spec)
    }
    await pkg.SetThumbnail(await pkg.PutPart(new URL('https://package.local/thumbnail.png'), 'image/png', new Uint8Array(thumbnail)))
    await pkg.Flush()
  } finally {
    pkg.Close()
  }
  writeFileSync(aasxPath, zipSync(unzipSync(readFileSync(aasxPath)), { level: 9, mtime: new Date('2026-10-28T00:00:00Z') }))
}

const canonical = verified(environment)
const thumbnail = png(160, 120, [255, 255, 255], [[55, 15, 50, 90, steel], [62, 25, 36, 16, dark], [62, 48, 36, 4, accent]])
await writeAasx(join(fixturesDir, 'open', 'studio-technical-data.aasx'), canonical, Object.entries(files).map(([name, { content, contentType }]) => [filePath(name), contentType, content]), thumbnail)
mkdirSync(join(fixturesDir, 'technical-data'), { recursive: true })
writeFileSync(join(fixturesDir, 'technical-data', 'studio-technical-data.json'), `${JSON.stringify(canonical, null, 2)}\n`)
console.log(`wrote open/studio-technical-data.aasx (${Object.keys(files).length} files) and technical-data/studio-technical-data.json`)
