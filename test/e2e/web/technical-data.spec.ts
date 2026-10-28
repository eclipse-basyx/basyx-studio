import type { FrameLocator, Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { key, openTargetUrl, registerOpenEnvironment, setAtSource, setMode, signIn, waitUntilSettled } from './support'

// The bundled Technical Data app on `TechnicalDataDemo` (IDTA 02003 2.0) and
// `TechnicalDataDemo12` (ZVEI 1.2) of test-setup/fixtures/open/studio-technical-data.aasx:
// the product at a glance, images in Studio's viewer, classes with the area
// they refer to, one data sheet with units, names and definitions from the
// concept descriptions, search kept in full screen, and changing a Property
// and a Range in place. Run `pnpm build` first.

test.describe.configure({ mode: 'serial' })

const shell = 'urn:studio:test:aas:technical-data'
const submodel = 'urn:studio:test:sm:technical-data:2-0'
let targetId: string

const appFrame = (page: Page) => page.locator('iframe[title="App: Technical Data"]').first()

async function openSubmodel (page: Page, shellId: string, submodelId: string): Promise<FrameLocator> {
  await page.goto(`/targets/${targetId}/shells/${key(shellId)}?submodel=${key(submodelId)}&mode=visualization`)
  const frame = page.frameLocator('iframe[title="App: Technical Data"]').first()
  await expect(frame.locator('[data-test="product-title"]')).toBeVisible({ timeout: 30_000 })
  return frame
}

/** Clicks into the app once its frame stopped growing and moving. */
async function clickIn (page: Page, target: Locator) {
  await expect(target).toBeVisible({ timeout: 30_000 })
  await waitUntilSettled(appFrame(page))
  await target.click()
}

/** A data sheet's value row by its label. */
const sheetRow = (scope: Locator, label: string) => scope.locator('[data-test="sheet-row"]').filter({ has: scope.page().locator('[data-test="sheet-label"]', { hasText: label }) })

test.beforeEach(async ({ page }) => {
  await signIn(page, 'studio-admin')
  targetId = await registerOpenEnvironment(page, 'E2E technical data environment')
})

test('shows Technical Data 2.0 as a data sheet with units, classes, images and further information', async ({ page }) => {
  const frame = await openSubmodel(page, shell, submodel)
  await expect(frame.locator('[data-test="product-title"]')).toHaveText('Servo drive SD-200')
  await expect(frame.locator('[data-test="manufacturer-name"]')).toHaveText('Example Drives GmbH')
  await expect(frame.locator('[data-test="product-details"]')).toHaveText('Art. no. SD-200-400-3 · Order code SD200-4-3-B')
  await expect(frame.locator('[data-test="classification-chip"]')).toHaveText(['ECLASS 14.0 · 27-02-31-90', 'IEC CDD 2.0 · ZZB001'])
  await expect(frame.locator('[data-test="valid-date"]')).toHaveText('Valid from Jan 15, 2026')
  await expect(frame.locator('[data-test="template-version"]')).toHaveText('IDTA 02003-2-0')
  await expect(frame.locator('[data-test="company-logo"] img')).toBeVisible({ timeout: 30_000 })

  // Three images, each its own, with their notes.
  await expect(frame.locator('[data-test="product-image"]')).toHaveCount(3)
  await expect(frame.locator('[data-test="product-image-note"]')).toHaveText(['Front view', 'Connectors at the bottom'])

  // The classes as the general information's rows, the ECLASS one with its area.
  const classes = frame.locator('[data-test="classification"]')
  await expect(classes).toHaveCount(2)
  await expect(classes.locator('[data-test="classification-class"]')).toHaveText(['27-02-31-90', 'ZZB001'])
  await expect(classes.first()).toContainText('Servo drive (demo class)')
  await expect(classes.first().locator('[data-test="classification-area"]')).toHaveText('Electrical')

  // One data sheet with a row for each area, and the specific descriptions in their own.
  const electrical = frame.locator('[data-test="property-sheet"]')
  await expect(electrical.locator('[data-test="sheet-area"]')).toHaveText(['Electrical', 'Mechanical'])
  const descriptions = frame.locator('[data-test="specific-descriptions"]')
  await expect(descriptions.locator('[data-test="sheet-area"]')).toHaveCount(0)
  // The value with its unit; in the narrow details pane, the description and definition in an info icon.
  const ratedPower = sheetRow(electrical, 'Rated power')
  await expect(ratedPower.locator('[data-test="sheet-value"]')).toHaveText('3.0 kW')
  await expect(electrical.locator('[data-test="sheet-description-column"]')).toHaveCount(0)
  await expect(ratedPower.getByRole('button', { name: 'At 400 V and 8 kHz switching frequency. — Mechanical power at the shaft in continuous operation at rated values.' })).toBeVisible()
  // Its concept description is under the api.eclass-cdp.com spelling of its ID.
  await expect(sheetRow(electrical, 'Rated current').locator('[data-test="sheet-value"]')).toHaveText('7.25 A')
  await expect(electrical.locator('[data-test="sheet-section"]')).toHaveText(['Power supply', 'Protection', 'Dimensions'])
  await expect(sheetRow(electrical, 'Ambient temperature in operation').locator('[data-test="sheet-value"]')).toHaveText('-20 – 40 °C')
  await expect(sheetRow(electrical, 'Installation altitude').locator('[data-test="sheet-value"]')).toHaveText('≤ 1000 m')
  await expect(sheetRow(electrical, 'Overvoltage protection').locator('[data-test="sheet-value"]')).toHaveText('Yes')
  // Named by its supplemental semantic ID's concept.
  await expect(sheetRow(descriptions, 'Safety integrity level').locator('[data-test="sheet-value"]')).toHaveText('SIL 3')

  await expect(frame.locator('[data-test="further-information"]')).toContainText('Subject to technical changes.')

  // A section collapses to its row and opens again; an area too.
  const supply = electrical.locator('[data-test="sheet-section"]').filter({ hasText: 'Power supply' })
  await clickIn(page, supply.locator('[data-test="sheet-toggle"]'))
  await expect(sheetRow(electrical, 'Supply frequency')).toHaveCount(0)
  await expect(electrical.locator('[data-test="sheet-section"]')).toHaveText(['Power supply', 'Dimensions'])
  await supply.locator('[data-test="sheet-toggle"]').click()
  await expect(sheetRow(electrical, 'Supply frequency')).toHaveCount(1)
  const mechanical = electrical.locator('[data-test="sheet-area"]').filter({ hasText: 'Mechanical' })
  await mechanical.locator('[data-test="sheet-toggle"]').click()
  await expect(sheetRow(electrical, 'Weight')).toHaveCount(0)
  await mechanical.locator('[data-test="sheet-toggle"]').click()

  // Every row as CSV, which Studio's page saves.
  const download = page.waitForEvent('download')
  await clickIn(page, frame.locator('[data-test="sheet-csv"]'))
  const csv = await download
  expect(csv.suggestedFilename()).toBe('Servo drive SD-200 technical data.csv')
  const text = (await csv.createReadStream().then(async stream => {
    const chunks: Buffer[] = []
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer)
    }
    return Buffer.concat(chunks)
  })).toString('utf8')
  expect(text).toContain('Electrical,,Rated power,3.0,,,kW,At 400 V and 8 kHz switching frequency.,')
  expect(text).toContain('Functional safety,,Safety integrity level,SIL 3,')

  // A drawing in the data sheet opens in Studio's viewer.
  await clickIn(page, sheetRow(electrical, 'Dimension drawing').locator('[data-test="sheet-file"]'))
  await expect(page.locator('[data-test="file-viewer-dialog"] [data-test="file-viewer-name"]')).toHaveText('sd-200-dimensions.svg', { timeout: 30_000 })
  await page.locator('[data-test="file-viewer-dialog"] [data-test="file-viewer-close"]').click()
  await expect(page.locator('[data-test="file-viewer-dialog"]')).toBeHidden()
})

test('shows descriptions and definitions as columns where the frame is wide', async ({ page }) => {
  const frame = await openSubmodel(page, shell, submodel)
  await clickIn(page, frame.locator('[data-test="technical-data-fullscreen"]'))
  const dialog = page.frameLocator('.v-dialog iframe[title="App: Technical Data"]')
  const sheet = dialog.locator('[data-test="property-sheet"]')
  await expect(sheet.locator('th')).toHaveText(['Property', 'Description', 'Definition', 'Value'], { timeout: 30_000 })
  const ratedPower = sheetRow(sheet, 'Rated power')
  await expect(ratedPower.locator('[data-test="sheet-description"]')).toHaveText('At 400 V and 8 kHz switching frequency.')
  await expect(ratedPower.locator('[data-test="sheet-definition"]')).toHaveText('Mechanical power at the shaft in continuous operation at rated values.')
  await expect(ratedPower.locator('[data-test="sheet-about"]')).toHaveCount(0)
  // Collapsing a section keeps the columns where they are.
  const widths = async () => sheet.locator('th').evaluateAll(cells => cells.map(cell => Math.round(cell.getBoundingClientRect().width)))
  await waitUntilSettled(page.locator('.v-dialog iframe[title="App: Technical Data"]'))
  const before = await widths()
  await sheet.locator('[data-test="sheet-area"]').filter({ hasText: 'Electrical' }).locator('[data-test="sheet-toggle"]').click()
  await expect(sheetRow(sheet, 'Rated power')).toHaveCount(0)
  expect(await widths()).toEqual(before)
  await sheet.locator('[data-test="sheet-area"]').filter({ hasText: 'Electrical' }).locator('[data-test="sheet-toggle"]').click()

  // The specific descriptions: a description of their own, and a definition through a supplemental semantic ID.
  await expect(dialog.locator('[data-test="specific-descriptions"] th')).toHaveText(['Property', 'Description', 'Definition', 'Value'])
  await page.locator('[data-test="app-fullscreen-close"]').click()
  await expect(page.locator('.v-dialog')).toBeHidden()
})

test('searches every data sheet and keeps the search in full screen', async ({ page }) => {
  const frame = await openSubmodel(page, shell, submodel)
  const search = frame.locator('[data-test="sheet-search"] input')
  await clickIn(page, search)
  await search.fill('short-circuit')
  await expect(frame.locator('[data-test="sheet-matches"]')).toHaveText('1 of 22 properties')
  // The match with the area and the sections it lies in.
  await expect(frame.locator('[data-test="sheet-area"]')).toHaveText(['Electrical'])
  await expect(frame.locator('[data-test="sheet-section"]')).toHaveText(['Power supply', 'Protection'])
  await expect(frame.locator('[data-test="sheet-label"]')).toHaveText(['Short-circuit current rating'])
  await search.fill('nothing like this')
  await expect(frame.locator('[data-test="sheet-empty"]')).toHaveText('No property matches “nothing like this”.')
  // Only the specific descriptions match: the technical properties say so.
  await search.fill('IEC 61800')
  await expect(frame.locator('[data-test="sheet-empty"]')).toContainText('the specific descriptions below do')
  await expect(frame.locator('[data-test="specific-descriptions"] [data-test="sheet-label"]')).toHaveText(['Safety function'])
  await search.fill('SIL')

  await clickIn(page, frame.locator('[data-test="technical-data-fullscreen"]'))
  const dialog = page.frameLocator('.v-dialog iframe[title="App: Technical Data"]')
  await expect(dialog.locator('[data-test="sheet-label"]')).toHaveText(['Safety integrity level'], { timeout: 30_000 })
  await expect(dialog.locator('[data-test="technical-data-fullscreen"]')).toHaveCount(0)
  await page.locator('[data-test="app-fullscreen-close"]').click()
  await expect(page.locator('.v-dialog')).toBeHidden()
})

test('shows the area a class refers to', async ({ page }) => {
  const frame = await openSubmodel(page, shell, submodel)
  const search = frame.locator('[data-test="sheet-search"] input')
  await clickIn(page, search)
  // A search that hides the area is cleared.
  await search.fill('IP65')
  await clickIn(page, frame.locator('[data-test="classification-area"]'))
  await expect(search).toHaveValue('')
  await expect(frame.locator('[data-test="sheet-area"]').first()).toBeInViewport()
})

test('reads ZVEI Technical Data 1.2 with main and sub sections', async ({ page }) => {
  const frame = await openSubmodel(page, 'urn:studio:test:aas:technical-data-1-2', 'urn:studio:test:sm:technical-data:1-2')
  await expect(frame.locator('[data-test="template-version"]')).toHaveText('ZVEI Technical Data 1.2')
  // ValidDate has ManufacturerOrderCode's semantic ID in the 1.2 template.
  await expect(frame.locator('[data-test="valid-date"]')).toHaveText('Valid from Jun 1, 2023')
  await expect(frame.locator('[data-test="product-image"]')).toHaveCount(2)
  // One area, without a row of its own.
  await expect(frame.locator('[data-test="sheet-area"]')).toHaveCount(0)
  await expect(frame.locator('[data-test="sheet-section"]')).toHaveText(['Electrical', 'Supply', 'Mechanical'])
  await expect(sheetRow(frame.locator('[data-test="property-sheet"]'), 'Colour of housing').locator('[data-test="sheet-value"]')).toHaveText('Anthracite')
})

test('changes a Property and a Range in place in edit mode', async ({ page, request }) => {
  const frame = await openSubmodel(page, shell, submodel)
  await expect(frame.getByRole('button', { name: 'Edit Rated power' })).toHaveCount(0)
  await setMode(page, 'Edit')
  const electrical = frame.locator('[data-test="property-sheet"]')
  try {
    await clickIn(page, electrical.getByRole('button', { name: 'Edit Rated power' }))
    await frame.getByRole('textbox', { name: 'Rated power' }).fill('3.2')
    await frame.locator('[data-test="edit-save"]').click()
    await expect(frame.locator('[data-test="notice"]')).toContainText('Rated power saved.')
    await expect(sheetRow(electrical, 'Rated power').locator('[data-test="sheet-value"]')).toHaveText('3.2 kW')

    await clickIn(page, electrical.getByRole('button', { name: 'Edit Ambient temperature in operation' }))
    await frame.locator('[data-test="edit-max"] input').fill('45')
    await frame.locator('[data-test="edit-save"]').click()
    await expect(sheetRow(electrical, 'Ambient temperature in operation').locator('[data-test="sheet-value"]')).toHaveText('-20 – 45 °C')
  } finally {
    await setAtSource(request, submodel, 'TechnicalPropertyAreas[0].RatedPower', '3.0')
    // A Range's value-only form at BaSyx.
    const range = await request.patch(`${openTargetUrl}/submodels/${key(submodel)}/submodel-elements/TechnicalPropertyAreas[0].AmbientTemperature/$value`, { data: { min: -20, max: 40 } })
    expect(range.status()).toBe(204)
  }
})
