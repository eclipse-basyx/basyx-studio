import { expect, test } from '@playwright/test'
import { registerOpenTarget, registerSecuredServiceTarget, signIn } from './support'

// MVP-1 definition of done 6: switching targets while their requests are in
// flight never shows the previous target's data.

test('switching targets never shows data of the previous target', async ({ page }) => {
  await signIn(page, 'studio-admin')
  const open = await registerOpenTarget(page, 'E2E switch open')
  const secured = await registerSecuredServiceTarget(page, 'E2E switch secured')

  // Slow down the open target's shell list so the switch happens while it is in flight.
  await page.route(`**/api/studio/v1/targets/${open}/shells?**`, async route => {
    await new Promise(resolve => setTimeout(resolve, 1500))
    await route.continue()
  })

  // Switch inside the app (no page load), so the slow request is still running.
  await page.goto('/')
  await page.getByText('E2E switch open').click()
  await expect(page).toHaveURL(new RegExp(`/targets/${open}$`))
  await page.getByRole('link', { name: 'Open shells' }).click()
  await expect(page).toHaveURL(new RegExp(`/targets/${open}/shells$`))
  await page.getByRole('link', { name: 'Studio home' }).click()
  await page.getByText('E2E switch secured').click()
  await page.getByRole('link', { name: 'Open shells' }).click()
  await expect(page).toHaveURL(new RegExp(`/targets/${secured}/shells$`))

  // Give the delayed answer time to arrive; it must not replace the secured list.
  await page.waitForTimeout(2000)
  await expect(page.getByText('EdgeCasesShell')).toHaveCount(0)
  await expect(page.getByText('SecuredPublicShell').first()).toBeVisible()
})
