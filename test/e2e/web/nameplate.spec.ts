import type { FrameLocator, Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { key, registerOpenTarget, setMode, signIn, waitUntilSettled } from './support'

// The bundled Digital Nameplate and Contacts apps on `NameplateDemo` and its
// 2.0 and 1.0 siblings (test-setup/fixtures/open/studio-nameplate.aasx):
// product, manufacturer with logo, address on the map and vCard, markings
// and contacts as cards whose details open in Studio's dialog, asset
// specific properties, search, and changing a value in place. Run
// `pnpm build` first.

test.describe.configure({ mode: 'serial' })

const shell = 'urn:studio:test:aas:nameplate'
const nameplate = 'urn:studio:test:sm:nameplate:3-0'
const contacts = 'urn:studio:test:sm:nameplate:contact-information'
let targetId: string

const nameplateFrame = (page: Page) => page.locator('iframe[title="App: Digital Nameplate"]').first()
const contactsFrame = (page: Page) => page.locator('iframe[title="App: Contacts"]').first()

async function openSubmodel (page: Page, title: string, shellId: string, submodelId: string, ready: string): Promise<FrameLocator> {
  await page.goto(`/targets/${targetId}/shells/${key(shellId)}?submodel=${key(submodelId)}&mode=visualization`)
  const frame = page.frameLocator(`iframe[title="App: ${title}"]`).first()
  await expect(frame.locator(ready).first()).toBeVisible({ timeout: 30_000 })
  return frame
}

/** The app's frame in Studio's dialog (openFullscreen without header), once it stopped moving in. */
async function dialogFrame (page: Page, title: string): Promise<FrameLocator> {
  const frame = page.locator(`.v-dialog iframe[title="App: ${title}"]`)
  await expect(frame).toBeVisible({ timeout: 30_000 })
  await waitUntilSettled(frame)
  return page.frameLocator(`.v-dialog iframe[title="App: ${title}"]`)
}

/** Clicks into an app once its frame stopped growing and moving. */
async function clickIn (frameElement: Locator, target: Locator) {
  await expect(target).toBeVisible({ timeout: 30_000 })
  await waitUntilSettled(frameElement)
  await target.click()
}

test.beforeEach(async ({ page }) => {
  await signIn(page, 'studio-admin')
  targetId = await registerOpenTarget(page, 'E2E nameplate target')
  // Map searches stay in the test: Studio opens them in a new tab.
  await page.context().route('https://www.google.com/maps/**', route => route.fulfill({ contentType: 'text/plain', body: 'map' }))
})

test('shows the Digital Nameplate 3.0 with logo, product, manufacturer, markings and asset specific properties', async ({ page }) => {
  const frame = await openSubmodel(page, 'Digital Nameplate', shell, nameplate, '[data-test="product-title"]')
  await expect(frame.locator('[data-test="product-title"]')).toHaveText('Gear motor GM-40')
  await expect(frame.locator('[data-test="manufacturer-name"]')).toHaveText('Example Drives GmbH')
  await expect(frame.locator('[data-test="product-details"]')).toHaveText('Type GM-40-230-B3 · SN GM40-2025-000123')
  await expect(frame.locator('[data-test="template-version"]')).toHaveText('IDTA 02006-3-0')
  await expect(frame.locator('[data-test="company-logo"] img')).toBeVisible({ timeout: 30_000 })
  await expect(frame.locator('[data-test="marking-chip"]')).toHaveText(['CE', 'UKCA', 'WEEE', 'Ex'])
  await expect(frame.locator('[data-test="product"] [data-test="detail-chip"]')).toHaveText(['Hardware 1.2', 'Firmware 3.4.1', 'Software 2.0.0'])

  const product = frame.locator('[data-test="product"]')
  await expect(product.locator('[data-field="CountryOfOrigin"]')).toContainText('Germany (DE)')
  await expect(product.locator('[data-field="DateOfManufacture"]')).toContainText('Mar 12, 2025')

  const manufacturer = frame.locator('[data-test="manufacturer"]')
  await expect(manufacturer).toContainText('Industriestraße 12')
  await expect(manufacturer).toContainText('67663 Kaiserslautern')
  await expect(manufacturer.locator('[data-test="detail-link"]').filter({ hasText: 'info@example.com' })).toBeVisible()
  await expect(manufacturer.locator('[data-test="detail-type"]').first()).toHaveText('Office')

  // The address opens in Google Maps, through Studio: the frame opens no windows. It has no copy button.
  await expect(manufacturer.locator('[data-test="detail-row"]').filter({ hasText: 'Industriestraße 12' }).locator('[data-test="detail-copy"]')).toHaveCount(0)
  const map = page.context().waitForEvent('request', request => request.isNavigationRequest() && request.url().startsWith('https://www.google.com/maps/search/?api=1&query=Industriestra%C3%9Fe%2012'))
  await clickIn(nameplateFrame(page), manufacturer.locator('[data-test="show-on-map"]'))
  await map

  // The manufacturer as vCard, which Studio's page saves.
  const download = page.waitForEvent('download')
  await clickIn(nameplateFrame(page), frame.locator('[data-test="save-vcard"]'))
  const vcard = await download
  expect(vcard.suggestedFilename()).toBe('Example Drives GmbH.vcf')
  const text = (await vcard.createReadStream().then(async stream => {
    const chunks: Buffer[] = []
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer)
    }
    return Buffer.concat(chunks)
  })).toString('utf8')
  expect(text).toContain('FN:Example Drives GmbH')
  expect(text).toContain('EMAIL;TYPE=INTERNET,WORK:info@example.com')

  // The markings as cards with their certificates; the Ex certificate has expired.
  await expect(frame.locator('[data-test="marking"]')).toHaveCount(4)
  await expect(frame.locator('[data-test="marking"]').filter({ hasText: 'Ex' }).locator('[data-test="marking-expired"]')).toHaveText('Expired')
  await expect(frame.locator('[data-test="marking"]').first()).toContainText('EU-DoC GM40-2025-01')

  // A card opens the marking's details in Studio's dialog: the app alone over the dimmed page.
  await clickIn(nameplateFrame(page), frame.locator('[data-test="marking"]').first())
  const dialog = (await dialogFrame(page, 'Digital Nameplate')).locator('[data-test="marking-dialog"]')
  await expect(dialog.locator('[data-test="marking-dialog-name"]')).toHaveText('CE', { timeout: 30_000 })
  await expect(dialog).toContainText('Feb 14, 2030')
  await expect(dialog).toContainText('Machinery Directive 2006/42/EC')
  await dialog.locator('[data-test="marking-dialog-close"]').click()
  await expect(page.locator('.v-dialog')).toBeHidden()

  // The asset specific properties, collapsed, by guideline.
  await clickIn(nameplateFrame(page), frame.locator('[data-test="asset-specific-toggle"]'))
  await expect(frame.locator('[data-test="property-group"]')).toHaveText(['General', 'Guideline 2006/42/EC', 'Guideline 2014/35/EU'])
})

test('reads the nameplate as 2.0 and 1.0', async ({ page }) => {
  const v2 = await openSubmodel(page, 'Digital Nameplate', 'urn:studio:test:aas:nameplate-2-0', 'urn:studio:test:sm:nameplate:2-0', '[data-test="product-title"]')
  await expect(v2.locator('[data-test="template-version"]')).toHaveText('IDTA 02006-2-0')
  await expect(v2.locator('[data-test="product-details"]')).toHaveText('Type GM-40-230-B3 · SN GM40-2023-000045')
  await expect(v2.locator('[data-test="manufacturer"]')).toContainText('67663 Kaiserslautern')
  await expect(v2.locator('[data-test="marking-chip"]')).toHaveText(['CE', 'WEEE'])

  const v1 = await openSubmodel(page, 'Digital Nameplate', 'urn:studio:test:aas:nameplate-1-0', 'urn:studio:test:sm:nameplate:1-0', '[data-test="product-title"]')
  await expect(v1.locator('[data-test="product-title"]')).toHaveText('Gear motor GM-25')
  await expect(v1.locator('[data-test="template-version"]')).toHaveText('ZVEI Digital Nameplate 1.0')
  await expect(v1.locator('[data-test="manufacturer"]')).toContainText('Customer service')
})

test('shows the contacts with roles, channels and search, and saves one as vCard', async ({ page }) => {
  const frame = await openSubmodel(page, 'Contacts', shell, contacts, '[data-test="contact"]')
  await expect(frame.locator('[data-test="contact"]')).toHaveCount(4)
  await expect(frame.locator('[data-test="contact-name"]')).toHaveText(['Ms Dr. Jane Q. Doe', 'Example Drives GmbH', 'Alex Kim', 'Example Drives Inc.'])
  await expect(frame.locator('[data-test="contact-role"]')).toHaveText(['Technical contact', 'Commercial contact', 'Hazardous goods contact', 'Other contact'])

  // A compact card: name, organization, role, and the first phone number and email address.
  const jane = frame.locator('[data-test="contact"]').first()
  await expect(jane.locator('[data-test="contact-organization"]')).toHaveText('Example Drives GmbH · Research and development')
  await expect(jane.locator('[data-test="detail-link"]')).toHaveText(['+49 (0)631 123456-21', 'jane.doe@example.com'])

  // An email address opens in the mail app, not the card's details; Studio's page stays where it is.
  const url = page.url()
  await clickIn(contactsFrame(page), jane.locator('[data-test="detail-link"]').filter({ hasText: 'jane.doe@example.com' }))
  expect(page.url()).toBe(url)
  await expect(page.locator('.v-dialog')).toHaveCount(0)

  // The search finds contacts by any text, also the translated role.
  await clickIn(contactsFrame(page), frame.locator('[data-test="contact-search"] input'))
  await frame.locator('[data-test="contact-search"] input').fill('hazardous')
  await expect(frame.locator('[data-test="contact-name"]')).toHaveText(['Alex Kim'])
  await expect(frame.locator('[data-test="contact-count"]')).toHaveText('1 of 4 contacts')
  await frame.locator('[data-test="contact-search"] input').fill('nobody')
  await expect(frame.locator('[data-test="no-match"]')).toBeVisible()
  await frame.locator('[data-test="contact-search"] input').fill('')
  await expect(frame.locator('[data-test="contact"]')).toHaveCount(4)

  // The card opens the contact's details in Studio's dialog, with the vCard.
  await clickIn(contactsFrame(page), jane.locator('[data-test="contact-name"]'))
  const dialog = (await dialogFrame(page, 'Contacts')).locator('[data-test="contact-dialog"]')
  await expect(dialog.locator('[data-test="contact-dialog-name"]')).toHaveText('Ms Dr. Jane Q. Doe', { timeout: 30_000 })
  await expect(dialog).toContainText('Mon–Thu 9:00–16:00 CET')
  await expect(dialog).toContainText('German, English')
  await expect(dialog.locator('[data-test="detail-type"]').filter({ hasText: 'Video call' })).toBeVisible()
  const download = page.waitForEvent('download')
  await dialog.locator('[data-test="save-vcard"]').click()
  const vcard = await download
  expect(vcard.suggestedFilename()).toBe('Ms Dr. Jane Q. Doe.vcf')
  await dialog.locator('[data-test="contact-dialog-close"]').click()
  await expect(page.locator('.v-dialog')).toBeHidden()
})

test('closes a contact\'s dialog whose contact cannot be read', async ({ page }) => {
  const frame = await openSubmodel(page, 'Contacts', shell, contacts, '[data-test="contact"]')

  // The dialog's frame reads the submodel again; the repository fails then.
  await page.route('**/api/studio/v1/app-calls', route => (route.request().postDataJSON()?.method === 'studio.aas.getSubmodel'
    ? route.fulfill({ status: 502, contentType: 'application/problem+json', body: JSON.stringify({ status: 502, title: 'Bad Gateway', detail: 'The repository is not available.' }) })
    : route.continue()))
  await clickIn(contactsFrame(page), frame.locator('[data-test="contact-name"]').first())

  // Studio shows no close button over the frame: the app's own dialog closes it.
  const dialog = (await dialogFrame(page, 'Contacts')).locator('[data-test="dialog-unavailable"]')
  await expect(dialog).toContainText('Contact not available', { timeout: 30_000 })
  await dialog.locator('[data-test="dialog-unavailable-close"]').click()
  await expect(page.locator('.v-dialog')).toBeHidden()
})

test('changes a contact\'s value in place in edit mode', async ({ page, request }) => {
  const frame = await openSubmodel(page, 'Contacts', shell, contacts, '[data-test="contact"]')
  await expect(frame.getByRole('button', { name: 'Edit Department' })).toHaveCount(0)
  await setMode(page, 'Edit')

  // In the details, every element is a row to change.
  await clickIn(contactsFrame(page), frame.locator('[data-test="contact-name"]').first())
  const dialog = (await dialogFrame(page, 'Contacts')).locator('[data-test="contact-dialog"]')
  try {
    await dialog.getByRole('button', { name: 'Edit Department' }).click({ timeout: 30_000 })
    await expect(dialog.locator('[data-test="edit-field"]')).toContainText('Language: en')
    await dialog.getByRole('textbox', { name: 'Department' }).fill('Drive engineering')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog.locator('[data-test="notice"]')).toContainText('Department saved.')
    await expect(dialog.locator('[data-field="ContactInformation__00__.Department"]')).toContainText('Drive engineering')
    await expect(page.getByText('Contacts: Department saved.')).toBeVisible()
    // Closing the details reads the view again.
    await dialog.locator('[data-test="contact-dialog-close"]').click()
    await expect(frame.locator('[data-test="contact-organization"]').first()).toHaveText('Example Drives GmbH · Drive engineering')
  } finally {
    // The German text stayed; the English one goes back as it was.
    const response = await request.get(`http://localhost:18081/submodels/${key(contacts)}/submodel-elements/ContactInformation__00__.Department`)
    const element = await response.json() as { value: Array<{ language: string, text: string }> }
    expect(element.value.find(entry => entry.language === 'de')?.text).toBe('Forschung und Entwicklung')
    await request.patch(`http://localhost:18081/submodels/${key(contacts)}/submodel-elements/ContactInformation__00__.Department/$value`, {
      data: JSON.stringify([{ en: 'Research and development' }, { de: 'Forschung und Entwicklung' }]),
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

test('opens full screen with the search kept, from its own button where Studio shows none', async ({ page }) => {
  const frame = await openSubmodel(page, 'Contacts', shell, contacts, '[data-test="contact"]')
  await clickIn(contactsFrame(page), frame.locator('[data-test="contact-search"] input'))
  await frame.locator('[data-test="contact-search"] input').fill('chicago')
  await expect(frame.locator('[data-test="contact"]')).toHaveCount(1)
  await clickIn(contactsFrame(page), frame.locator('[data-test="contacts-fullscreen"]'))
  const dialogFrame = page.frameLocator('.v-dialog iframe[title="App: Contacts"]')
  await expect(dialogFrame.locator('[data-test="contact-name"]')).toHaveText(['Example Drives Inc.'], { timeout: 30_000 })
  await expect(dialogFrame.locator('[data-test="contacts-fullscreen"]')).toHaveCount(0)
  await page.locator('[data-test="app-fullscreen-close"]').click()
  await expect(page.locator('.v-dialog')).toBeHidden()
})
