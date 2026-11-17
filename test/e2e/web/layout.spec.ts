import { expect, test } from '@playwright/test'
import { key, registerOpenEnvironment, setMode, signIn } from './support'

// The server-rendered page reserves the app bar, the rail and the shell list,
// so it does not move when it hydrates (patches/README.md). Requested without
// client hints, as on a first visit or in browsers that send none.

const motorShell = 'urn:fraunhofer:iese:dte:aas:drivemotor-dm3000:001'

/** The layout offsets the server rendered on `v-main`, in pixels. */
function mainOffsets (html: string) {
  const style = /class="v-main"[^>]*style="([^"]*)"/.exec(html)?.[1] ?? ''
  const offset = (name: string) => Number(new RegExp(String.raw`--v-layout-${name}:(\d+)px`).exec(style)?.[1] ?? Number.NaN)
  return { top: offset('top'), left: offset('left') }
}

test('reserves the app bar and the drawers in server-rendered pages', async ({ page }) => {
  await signIn(page, 'studio-admin')
  const targetId = await registerOpenEnvironment(page, 'E2E layout environment')

  const targets = await (await page.request.get('/')).text()
  expect(mainOffsets(targets)).toEqual({ top: 56, left: 56 })

  // The rail (56 px) and the shell list (340 px) on the left.
  const shell = await (await page.request.get(`/targets/${targetId}/shells/${key(motorShell)}`)).text()
  expect(mainOffsets(shell)).toEqual({ top: 56, left: 396 })

  // And the page does not move once it is interactive.
  await page.addInitScript(() => {
    const shifts: number[] = []
    Object.assign(window, { layoutShifts: shifts })
    new PerformanceObserver(list => {
      for (const entry of list.getEntries() as (PerformanceEntry & { value: number })[]) {
        shifts.push(entry.value)
      }
    }).observe({ type: 'layout-shift', buffered: true })
  })
  await page.goto(`/targets/${targetId}/shells/${key(motorShell)}`)
  await expect(page.getByRole('heading', { name: 'Servo Motor DM-3000 (Fraunhofer IESE)' })).toBeVisible()
  const shift = await page.evaluate(() => (window as unknown as { layoutShifts: number[] }).layoutShifts.reduce((sum, value) => sum + value, 0))
  expect(shift).toBeLessThan(0.1)
})

test('opens the details pane only with something to show, and only on the tree\'s tab (D1, D2)', async ({ page }) => {
  await signIn(page, 'studio-admin')
  const targetId = await registerOpenEnvironment(page, 'E2E layout environment')
  const details = page.locator('nav.v-navigation-drawer--right.v-navigation-drawer--active')

  // Growing past the breakpoint where the pane stops floating does not open it.
  await page.setViewportSize({ width: 1000, height: 800 })
  await page.goto(`/targets/${targetId}/shells/${key(motorShell)}`)
  await expect(page.getByRole('heading', { name: 'Servo Motor DM-3000 (Fraunhofer IESE)' })).toBeVisible()
  await page.setViewportSize({ width: 1600, height: 900 })
  await expect(details).toHaveCount(0)

  await page.getByRole('tree').locator('.v-list-item-title').getByText('Nameplate', { exact: true }).click()
  await expect(details).toHaveCount(1)
  await page.getByRole('tab', { name: 'Overview' }).click()
  await expect(details).toHaveCount(0)
  await page.getByRole('tab', { name: 'Submodels' }).click()
  await expect(details).toHaveCount(1)
})

test('lays out the shell header by the width the content area has (H2 to H4)', async ({ page }) => {
  await signIn(page, 'studio-admin')
  const targetId = await registerOpenEnvironment(page, 'E2E layout environment')
  const header = page.getByRole('main').locator('.v-card').first()
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.goto(`/targets/${targetId}/shells/${key(motorShell)}`)
  await setMode(page, 'Edit')

  // Wide: the actions beside the title.
  await expect(header.getByRole('button', { name: 'Export' })).toBeVisible()
  await expect(header.getByRole('button', { name: 'Edit' })).toBeVisible()

  // The details pane takes 440 px: medium, the actions below the title.
  await page.getByRole('tree').locator('.v-list-item-title').getByText('Nameplate', { exact: true }).click()
  await expect(page.locator('nav.v-navigation-drawer--right.v-navigation-drawer--active')).toHaveCount(1)
  await expect(header.locator('.v-card-item').getByRole('button', { name: 'Export' })).toHaveCount(0)
  await expect(header.getByRole('button', { name: 'Export' })).toBeVisible()
  const title = await header.getByRole('heading').boundingBox()
  const exportButton = await header.getByRole('button', { name: 'Export' }).boundingBox()
  expect(exportButton!.y).toBeGreaterThan(title!.y + title!.height)

  // Narrow: everything in the menu, the title with the card's width beside the menu button.
  await page.setViewportSize({ width: 1300, height: 900 })
  await expect(header.getByRole('button', { name: 'Export' })).toHaveCount(0)
  await header.getByRole('button', { name: 'More actions' }).click()
  await expect(page.getByText('AASX package', { exact: true })).toBeVisible()
  const card = (await header.boundingBox())!
  expect((await header.getByRole('heading').boundingBox())!.width).toBeGreaterThan(card.width - 150)
})

test('hides rail items behind More, and moves there the ones that do not fit', async ({ page }) => {
  await signIn(page, 'studio-admin')
  const targetId = await registerOpenEnvironment(page, 'E2E rail environment')
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(`/targets/${targetId}`)
  const submodels = page.getByRole('link', { name: 'Submodels' })
  await expect(submodels).toBeVisible()

  // Hidden from the rail, the item is in More, from where it comes back.
  await submodels.click({ button: 'right' })
  await page.getByText('Hide from rail').click()
  await expect(submodels).toHaveCount(0)
  await page.getByLabel('More infrastructure apps').click()
  await page.getByLabel('Show in rail').click()
  await expect(submodels).toBeVisible()
  await page.keyboard.press('Escape')

  // Home and Shells can not be hidden: they keep the browser's menu.
  expect(await page.getByRole('link', { name: 'Home', exact: true }).evaluate(element => {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    element.dispatchEvent(event)
    return event.defaultPrevented
  })).toBe(false)

  // In a low window, the rail never scrolls: what does not fit is behind
  // its group's More. Hosted Studio has no Studio group without installed
  // global pages (Local Servers and App Builder are desktop only), so here
  // it is the infrastructure's.
  await page.setViewportSize({ width: 1280, height: 360 })
  await expect(page.getByLabel('More Studio apps')).toHaveCount(0)
  // The rail lays itself out again as the window shrinks, its items sliding
  // in and out, so a More that slides out may still be there for a moment.
  const more = page.getByLabel('More infrastructure apps').and(page.locator(':not(.slide-y-transition-leave-active)'))
  await expect(more).toBeVisible()
  await expect.poll(async () => more.evaluate(element => {
    const content = element.closest('.v-list')?.parentElement
    return content ? content.scrollHeight - content.clientHeight : Number.POSITIVE_INFINITY
  }), { timeout: 10_000 }).toBeLessThanOrEqual(0)
})
