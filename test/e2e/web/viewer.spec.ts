import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { edgeCasesShell, key, registerOpenEnvironment, setMode, signIn, studioApi } from './support'

// The AAS viewer port (docs/development/mvp-4-plan.md) in the
// hosted build, against the open test environment registered as an AAS
// environment (history and change feed enabled).

test.describe.configure({ mode: 'serial' })

const motorShell = 'urn:fraunhofer:iese:dte:aas:drivemotor-dm3000:001'
const motorAsset = 'urn:fraunhofer:iese:dte:asset:drivemotor-dm3000:serial-0042'
let targetId: string

/** A tree item by its title (previews of other items may contain the same text). */
function treeItem (page: Page, title: string) {
  return page.getByRole('tree').locator('.v-list-item-title').getByText(title, { exact: true })
}

test.beforeEach(async ({ page }) => {
  await signIn(page, 'studio-admin')
  targetId = await registerOpenEnvironment(page, 'E2E viewer environment')
})

test('shows capabilities on the landing page, opens a shell by asset ID and lists its changes (R1, R3)', async ({ page }) => {
  await page.goto(`/targets/${targetId}`)
  await expect(page.getByText('Dashboard coming soon')).toBeVisible()
  for (const capability of ['Export', 'Upload', 'Search', 'Element search', 'Discovery', 'History', 'Change feed']) {
    await expect(page.getByText(capability, { exact: true }).first()).toBeVisible()
  }

  await page.goto(`/targets/${targetId}/shells?globalAssetId=${encodeURIComponent(motorAsset)}`)
  await expect(page.getByRole('heading', { name: 'Servo Motor DM-3000 (Fraunhofer IESE)' })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/shells/${key(motorShell)}`))

  await page.getByRole('tab', { name: 'Changes' }).click()
  await expect(page.getByText(/^Submodel Nameplate (created|updated)/).first()).toBeVisible()
})

test('shows the bundled apps on the overview', async ({ page }) => {
  await page.goto(`/targets/${targetId}/shells/${key(motorShell)}?tab=overview`)
  await expect(page.frameLocator('iframe[title="App: Digital Nameplate"]').getByText('SN-2024-DM3000-0042')).toBeVisible()
  await expect(page.frameLocator('iframe[title="App: Technical Data"]').getByText('Rated power')).toBeVisible()
  await expect(page.frameLocator('iframe[title="App: Carbon Footprint"]').getByText('Life cycle phase A1')).toBeVisible()
  await expect(page.frameLocator('iframe[title="App: Documents"]').getByText('Operating Manual DriveMotor DM-3000')).toBeVisible()
})

test('filters the tree, opens details and remembers the shell for the user', async ({ page }) => {
  await page.goto(`/targets/${targetId}/shells/${key(edgeCasesShell)}`)
  await page.getByPlaceholder('Filter elements').fill('Deepest')
  await page.getByRole('button', { name: 'Expand all' }).click()
  await treeItem(page, 'Deepest').first().click()
  await expect(page.getByText('Level1.Level2.Items[0].Details.Deepest')).toBeVisible()

  // Recently opened shells are stored per user and offered on the shells page.
  await page.goto(`/targets/${targetId}/shells`)
  await expect(page.getByRole('main').getByRole('link', { name: 'EdgeCasesShell' }).first()).toBeVisible()
})

test('searches elements across shells with the command palette', async ({ page }) => {
  await page.goto(`/targets/${targetId}`)
  await page.getByRole('button', { name: /Search shells, elements, targets/ }).click()
  await page.getByPlaceholder('Search shells, elements, asset IDs, targets, actions…').fill('SerialNumber')
  await page.getByRole('option').or(page.getByRole('listitem')).filter({ hasText: 'EdgeCasesShell' }).first().click()
  await expect(page).toHaveURL(/\/shells\/.+element=/)
  await expect(page.getByText('Motor.SerialNumber')).toBeVisible()
})

test('shows a read-only past state', async ({ page }) => {
  await page.goto(`/targets/${targetId}/shells/${key(edgeCasesShell)}`)
  await setMode(page, 'Edit')
  await page.getByRole('button', { name: 'Now' }).click()
  // Today: the newest state, shown read-only.
  await page.locator('button[aria-current="date"]').click()
  await expect(page.getByText(/Read-only view of the state on/)).toBeVisible()
  await treeItem(page, 'SimpleString').click()
  await expect(page.getByRole('button', { name: 'Apply' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Back to now' }).click()
  await expect(page.getByText(/Read-only view of the state on/)).toHaveCount(0)
})

test('exports a shell and imports the export again', async ({ page }) => {
  await page.goto(`/targets/${targetId}/shells/${key(edgeCasesShell)}`)
  await page.getByRole('button', { name: 'Export' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('link').filter({ hasText: '.json' }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('EdgeCasesShell.json')
  const content = await readFile((await file.path())!)

  await page.goto(`/targets/${targetId}`)
  await page.getByRole('button', { name: 'Import' }).click()
  await page.locator('input[type="file"]').setInputFiles({ name: 'edge-cases.json', mimeType: 'application/json', buffer: content })
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click()
  // A single imported shell opens right away.
  await expect(page).toHaveURL(new RegExp(`/shells/${key(edgeCasesShell)}$`))
  await expect(page.getByText(/^Imported /)).toBeVisible()
})

test('deletes a shell only in edit mode and after confirmation', async ({ page }) => {
  const fixture = await readFile(new URL('../../../test-setup/fixtures/open/IESEDriveMotorDM3000.aasx', import.meta.url))
  await page.goto(`/targets/${targetId}/shells/${key(motorShell)}`)
  await expect(page.getByRole('button', { name: 'More actions' })).toHaveCount(0)
  await setMode(page, 'Edit')
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.getByText('Delete shell').click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete shell' }).click()
  await expect(page).toHaveURL(new RegExp(`/targets/${targetId}/shells$`))

  // Restore the fixture through the upload route.
  const api = await studioApi(page)
  const session = await (await api.get('/session')).json() as { csrfToken: string }
  const response = await page.request.post(`/api/studio/v1/targets/${targetId}/uploads?fileName=motor.aasx`, {
    headers: { 'Origin': new URL(page.url()).origin, 'X-CSRF-Token': session.csrfToken, 'Content-Type': 'application/aasx+xml' },
    data: fixture,
  })
  expect(response.status(), await response.text()).toBe(201)
})

test('lists concept descriptions and saves settings per user', async ({ page }) => {
  await page.goto(`/targets/${targetId}/concepts`)
  await expect(page.getByRole('heading', { name: 'Concept descriptions' })).toBeVisible()
  await expect(page.locator('tbody tr').first()).toBeVisible()

  await page.goto(`/targets/${targetId}/concepts?panel=settings`)
  await page.getByRole('button', { name: 'Dark' }).click()
  await page.reload()
  await expect(page.locator('.v-application')).toHaveClass(/v-theme--dark/)
  await page.getByRole('button', { name: 'System' }).click()
})

test('shows a problem, not a server error, for a target that is gone', async ({ page }) => {
  // Rendered on the server: the failed query keeps its error for the page.
  const response = await page.goto('/targets/no-such-target/shells')
  expect(response?.status()).toBe(200)
  await expect(page.getByText('This item does not exist (anymore).')).toBeVisible()
})
