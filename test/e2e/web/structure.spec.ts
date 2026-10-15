import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { key, openTargetUrl, registerOpenTarget, setMode, signIn } from './support'

// MVP-5 definition of done in the hosted build: the creation wizard, adding,
// renaming and deleting elements, metadata forms, and JSON insert, against the
// open target. Everything the test creates is removed again.

let targetId: string
const shellId = 'urn:studio:e2e:aas:wizard'
const submodelId = 'urn:studio:e2e:sm:wizard'

async function cleanup () {
  const headers = { 'Content-Type': 'application/json' }
  // The submodels the wizard created are referenced by the shell.
  const shell = await fetch(`${openTargetUrl}/shells/${key(shellId)}`)
  const ids: string[] = [submodelId]
  if (shell.ok) {
    const body = await shell.json() as { submodels?: Array<{ keys: Array<{ value: string }> }> }
    ids.push(...(body.submodels ?? []).map(reference => reference.keys[0]!.value))
  }
  await fetch(`${openTargetUrl}/shell-descriptors`, { method: 'POST', headers, body: JSON.stringify({ id: shellId, endpoints: [{ interface: 'AAS-3.0', protocolInformation: { href: `${openTargetUrl}/shells/${key(shellId)}` } }] }) })
  await fetch(`${openTargetUrl}/shells/${key(shellId)}`, { method: 'DELETE' })
  // The repository registers every new shell, so a descriptor left behind
  // makes the next create of this identifier fail with 409.
  await fetch(`${openTargetUrl}/shell-descriptors/${key(shellId)}`, { method: 'DELETE' })
  for (const id of ids) {
    await fetch(`${openTargetUrl}/submodels/${key(id)}`, { method: 'DELETE' })
  }
}

/** The row menu of a tree row by its title. */
async function rowMenu (page: Page, title: string) {
  const row = page.locator('.v-treeview-item', { hasText: title }).first()
  await row.getByRole('button', { name: 'Element actions' }).click()
}

test.beforeEach(async ({ page }) => {
  await cleanup()
  await signIn(page, 'studio-admin')
  targetId = await registerOpenTarget(page, 'E2E structure target')
})

test.afterEach(async () => {
  await cleanup()
})

test('creates a shell with an empty submodel through the wizard', async ({ page }) => {
  await page.goto(`/targets/${targetId}/shells`)
  await setMode(page, 'Edit')
  await page.getByRole('button', { name: 'New shell' }).click()

  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox', { name: 'idShort' }).fill('E2EWizardShell')
  await dialog.getByRole('textbox', { name: 'AAS identifier' }).fill(shellId)
  await dialog.getByRole('button', { name: 'Next' }).click()

  await dialog.getByRole('button', { name: 'Add submodel' }).click()
  await dialog.getByRole('textbox', { name: 'idShort' }).last().fill('WizardNameplate')
  await dialog.getByRole('button', { name: 'Next' }).click()
  await expect(dialog.getByText('WizardNameplate').last()).toBeVisible()
  await dialog.getByRole('button', { name: 'Create' }).click()

  await expect(page).toHaveURL(new RegExp(`/shells/${key(shellId)}`))
  await expect(page.getByRole('heading', { name: 'E2EWizardShell' })).toBeVisible()
  await expect(page.getByText('WizardNameplate')).toBeVisible()

  // The same identifier is refused, and nothing is written.
  const api = await page.request.get(`${openTargetUrl}/shells/${key(shellId)}`)
  expect(api.status()).toBe(200)
})

test('adds, renames and deletes an element, and edits the shell', async ({ page }) => {
  const headers = { 'Content-Type': 'application/json' }
  await fetch(`${openTargetUrl}/submodels`, { method: 'POST', headers, body: JSON.stringify({ modelType: 'Submodel', id: submodelId, idShort: 'E2EWorkbench', submodelElements: [] }) })
  await fetch(`${openTargetUrl}/shells`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      modelType: 'AssetAdministrationShell',
      id: shellId,
      idShort: 'E2EWizardShell',
      assetInformation: { assetKind: 'Instance', globalAssetId: 'urn:studio:e2e:asset' },
      submodels: [{ type: 'ModelReference', keys: [{ type: 'Submodel', value: submodelId }] }],
    }),
  })

  await page.goto(`/targets/${targetId}/shells/${key(shellId)}`)
  // View mode offers no structure actions.
  await expect(page.getByRole('button', { name: 'Element actions' })).toHaveCount(0)
  await setMode(page, 'Edit')

  // Add a Property: the new row is a draft until it is created.
  await rowMenu(page, 'E2EWorkbench')
  await page.getByRole('listitem').filter({ hasText: 'Add element' }).click()
  // The menu closes on click, so the row detaches while the click completes.
  await page.getByRole('listitem').filter({ hasText: /^Property$/ }).dispatchEvent('click')
  await expect(page.getByText('New Property in E2EWorkbench')).toBeVisible()
  await expect(page.getByText('draft', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'idShort', exact: true }).fill('Pressure')
  await page.getByRole('textbox', { name: 'Value', exact: true }).fill('42')
  await page.getByRole('button', { name: 'Add element' }).last().click()
  await expect(page.locator('.v-treeview-item', { hasText: 'Pressure' })).toBeVisible()
  const created = await (await fetch(`${openTargetUrl}/submodels/${key(submodelId)}/submodel-elements/Pressure/$value`)).json()
  expect(created).toBe('42')

  // Rename it in the form.
  await page.getByRole('textbox', { name: 'idShort', exact: true }).fill('Temperature')
  await page.getByRole('button', { name: 'Apply' }).click()
  await expect(page.locator('.v-treeview-item', { hasText: 'Temperature' })).toBeVisible()
  await expect(page.locator('.v-treeview-item', { hasText: 'Pressure' })).toHaveCount(0)

  // Delete it after confirming.
  await rowMenu(page, 'Temperature')
  await page.getByRole('listitem').filter({ hasText: 'Delete' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
  await expect(page.locator('.v-treeview-item', { hasText: 'Temperature' })).toHaveCount(0)

  // The shell form: change the display name.
  await page.getByRole('main').getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(page.getByText('Edit shell')).toBeVisible()
  await page.getByText('Names and description', { exact: true }).click()
  await page.getByRole('button', { name: 'Add text' }).first().click()
  await page.getByRole('textbox', { name: 'Text' }).first().fill('Edited by e2e')
  await page.getByRole('button', { name: 'Apply' }).click()
  await expect(page.getByRole('heading', { name: 'Edited by e2e' })).toBeVisible()
})

test('edits the metadata of a submodel', async ({ page }) => {
  const headers = { 'Content-Type': 'application/json' }
  await fetch(`${openTargetUrl}/submodels`, { method: 'POST', headers, body: JSON.stringify({ modelType: 'Submodel', id: submodelId, idShort: 'E2EWorkbench' }) })
  await fetch(`${openTargetUrl}/shells`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      modelType: 'AssetAdministrationShell',
      id: shellId,
      idShort: 'E2EWizardShell',
      assetInformation: { assetKind: 'Instance', globalAssetId: 'urn:studio:e2e:asset' },
      submodels: [{ type: 'ModelReference', keys: [{ type: 'Submodel', value: submodelId }] }],
    }),
  })
  await page.goto(`/targets/${targetId}/shells/${key(shellId)}`)
  await setMode(page, 'Edit')
  await rowMenu(page, 'E2EWorkbench')
  await page.getByRole('listitem').filter({ hasText: 'Edit submodel' }).click()

  await page.getByRole('textbox', { name: 'idShort', exact: true }).fill('E2EBench')
  await page.getByText('Names and description', { exact: true }).click()
  await page.getByRole('combobox', { name: 'Category' }).fill('PARAMETER')
  await page.getByRole('button', { name: 'Apply' }).click()

  await expect.poll(async () => (await (await fetch(`${openTargetUrl}/submodels/${key(submodelId)}`)).json() as { idShort: string, category?: string }).idShort).toBe('E2EBench')
})

test('deletes a shell together with the submodels it lists', async ({ page }) => {
  const headers = { 'Content-Type': 'application/json' }
  await fetch(`${openTargetUrl}/submodels`, { method: 'POST', headers, body: JSON.stringify({ modelType: 'Submodel', id: submodelId, idShort: 'E2EWorkbench' }) })
  await fetch(`${openTargetUrl}/shells`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      modelType: 'AssetAdministrationShell',
      id: shellId,
      idShort: 'E2EWizardShell',
      assetInformation: { assetKind: 'Instance', globalAssetId: 'urn:studio:e2e:asset' },
      submodels: [{ type: 'ModelReference', keys: [{ type: 'Submodel', value: submodelId }] }],
    }),
  })
  await page.goto(`/targets/${targetId}/shells/${key(shellId)}`)
  await setMode(page, 'Edit')
  await page.getByRole('main').getByRole('button', { name: 'More actions' }).click()
  await page.getByText('Delete shell', { exact: true }).click()

  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Also delete its submodel').check()
  await expect(dialog.getByText('E2EWorkbench')).toBeVisible()
  await dialog.getByRole('button', { name: 'Delete shell' }).click()
  await expect(page).toHaveURL(new RegExp(`/targets/${targetId}/shells$`))

  expect((await fetch(`${openTargetUrl}/submodels/${key(submodelId)}`)).status).toBe(404)
})

test('inserts an element from JSON and refuses invalid JSON with findings', async ({ page }) => {
  const headers = { 'Content-Type': 'application/json' }
  await fetch(`${openTargetUrl}/submodels`, { method: 'POST', headers, body: JSON.stringify({ modelType: 'Submodel', id: submodelId, idShort: 'E2EWorkbench' }) })
  await fetch(`${openTargetUrl}/shells`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      modelType: 'AssetAdministrationShell',
      id: shellId,
      idShort: 'E2EWizardShell',
      assetInformation: { assetKind: 'Instance', globalAssetId: 'urn:studio:e2e:asset' },
      submodels: [{ type: 'ModelReference', keys: [{ type: 'Submodel', value: submodelId }] }],
    }),
  })
  await page.goto(`/targets/${targetId}/shells/${key(shellId)}`)
  await setMode(page, 'Edit')
  await rowMenu(page, 'E2EWorkbench')
  await page.getByRole('listitem').filter({ hasText: 'Insert from JSON' }).click()

  const dialog = page.getByRole('dialog')
  await dialog.locator('.monaco-editor').click()
  await page.keyboard.insertText('{"modelType":"Property","idShort":"Bad","valueType":"xs:int","value":"not a number"}')
  await expect(dialog.getByText('Findings from AAS Core')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Insert' })).toBeDisabled()
})
