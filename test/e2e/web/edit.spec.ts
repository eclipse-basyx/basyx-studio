import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { edgeCasesShell, edgeCasesSubmodel, key, registerOpenTarget, setAtSource, setMode, signIn } from './support'

// MVP-2 definition of done 2 and 4 in the hosted build: edit a property of
// the open target, see it after a reload, and handle a conflicting change.

const original = 'hello studio'
let targetId: string

function elementUrl (element: string) {
  return `/targets/${targetId}/shells/${key(edgeCasesShell)}?submodel=${key(edgeCasesSubmodel)}&element=${key(element)}`
}

/** The value editor of the selected element in the details drawer (edit mode). */
async function valueField (page: Page) {
  const field = page.getByRole('textbox', { name: 'Value', exact: true })
  await expect(field).toBeVisible()
  return field
}

async function openInEditMode (page: Page, element: string) {
  await page.goto(elementUrl(element))
  await setMode(page, 'Edit')
  return valueField(page)
}

test.beforeEach(async ({ page }) => {
  await signIn(page, 'studio-admin')
  targetId = await registerOpenTarget(page, 'E2E open target')
})

test.afterEach(async ({ request }) => {
  await setAtSource(request, edgeCasesSubmodel, 'SimpleString', original)
})

test('shows values read-only in view mode', async ({ page }) => {
  await page.goto(elementUrl('SimpleString'))
  await expect(page.locator('[data-test="property-value"]')).toHaveText(original)
  await expect(page.getByRole('button', { name: 'Apply' })).toHaveCount(0)
})

test('edits a property value and shows it after a reload', async ({ page }) => {
  const field = await openInEditMode(page, 'SimpleString')
  await expect(field).toHaveValue(original)

  await field.fill('edited end to end')
  await page.getByRole('button', { name: 'Apply' }).click()
  await expect(page.getByText('Applied.')).toBeVisible()
  // The tree preview shows the new value as well.
  await expect(page.getByText('edited end to end', { exact: true })).toBeVisible()

  await page.reload()
  await setMode(page, 'Edit')
  await expect(await valueField(page)).toHaveValue('edited end to end')
})

test('keeps the draft on a conflict and applies it only when asked', async ({ page, request }) => {
  const field = await openInEditMode(page, 'SimpleString')
  await field.fill('my draft')

  await setAtSource(request, edgeCasesSubmodel, 'SimpleString', 'changed by someone else')
  await page.getByRole('button', { name: 'Apply' }).click()

  await expect(page.getByText('Someone else changed this value')).toBeVisible()
  await expect(page.getByText('changed by someone else').first()).toBeVisible()
  await expect(field).toHaveValue('my draft')

  await page.getByRole('button', { name: 'Apply mine anyway' }).click()
  await expect(page.getByText('Applied.')).toBeVisible()
  await page.reload()
  await setMode(page, 'Edit')
  await expect(await valueField(page)).toHaveValue('my draft')
})

test('explains values that do not match the value type', async ({ page }) => {
  const field = await openInEditMode(page, 'Temperature')
  await field.fill('warm')
  await page.getByRole('button', { name: 'Apply' }).click()
  await expect(page.getByText('Value must be consistent with the value type.')).toBeVisible()
  await page.getByRole('button', { name: 'Discard' }).click()
  await expect(field).toHaveValue('21.5')
})
