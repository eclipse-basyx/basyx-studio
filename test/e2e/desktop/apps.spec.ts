import type { ElectronApplication, FrameLocator, Page } from '@playwright/test'
import { copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { fixturesDirectory, zipDirectory } from '../../apps/support'
import { chooseFiles, closeStudio, fixture, launchStudio, openPackage, root } from './support'

// MVP-3 in the packaged desktop app: apps run in sandboxed frames on the
// studio-app: protocol and work on a local AASX package (the bundled Digital
// Nameplate since MVP-4), and a backend app installed by the local user runs
// in the bundled Deno. Run `pnpm apps:build` first.

let app: ElectronApplication
let window: Page
let directory: string

test.beforeEach(async () => {
  ({ app, window, directory } = await launchStudio())
})

test.afterEach(async () => {
  await closeStudio(app)
})

function appFrame (): FrameLocator {
  return window.frameLocator('iframe[sandbox="allow-scripts"]')
}

async function install (file: string | { name: string, mimeType: string, buffer: Buffer }, title: string) {
  await window.locator('input[type="file"]').setInputFiles(file)
  await window.getByRole('button', { name: 'Install app' }).click()
  await expect(window.getByText(`Installed ${title}`)).toBeVisible()
}

/** App modules are entries of the navigation rail (MVP-4 layout). */
async function openModule (title: string) {
  await window.getByRole('link', { name: title }).click()
  // The overview's frames are gone once the module's route is shown.
  await expect(window).toHaveURL(/\/apps\//)
  await expect(window.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(1)
}

test('runs installed apps on a local package', async () => {
  test.setTimeout(120_000)
  // Administration opens as a panel from the rail's footer, not as a page.
  await window.getByRole('listitem', { name: 'Apps', exact: true }).click()
  await install(join(root, 'examples/apps/dist/backend-demo.zip'), 'Target Summary')
  await install({ name: 'probe.zip', mimeType: 'application/zip', buffer: Buffer.from(await zipDirectory(join(fixturesDirectory, 'probe'))) }, 'Isolation probe')

  const path = join(directory, 'motor.aasx')
  await copyFile(fixture, path)
  await chooseFiles(app, path)
  await window.getByRole('link', { name: 'AAS targets' }).click()
  await openPackage(window)

  // The bundled submodel view, served under studio-app:, edits the package in
  // memory in Studio's edit mode.
  await window.getByRole('tab', { name: 'Overview' }).click()
  const nameplate = window.frameLocator('iframe[title="App: Digital Nameplate"]')
  await expect(nameplate.getByText('Industrial Servo Motor DM-3000')).toBeVisible()
  expect(window.frames().some(frame => frame.url().startsWith('studio-app://app-'))).toBe(true)
  await window.getByRole('banner').getByRole('button', { name: 'Edit', exact: true }).click()
  await nameplate.getByRole('button', { name: 'Edit Serial number' }).click()
  await nameplate.getByRole('textbox', { name: 'Serial number' }).fill('SN-DESKTOP-APP')
  await nameplate.getByRole('button', { name: 'Save' }).click()
  await expect(nameplate.locator('[data-test="notice"]')).toContainText('Serial number saved.')
  await expect(window.getByText('Unsaved changes', { exact: true })).toBeVisible()

  // The backend runs in the Deno bundled with the app.
  await openModule('Target Summary')
  await appFrame().getByRole('button', { name: 'Summarize target' }).click()
  await expect(appFrame().locator('[data-test="summary"]')).toContainText('1 shells', { timeout: 30_000 })
  await appFrame().getByRole('button', { name: 'Check isolation' }).click()
  for (const capability of ['readFiles', 'environment', 'internet', 'subprocesses']) {
    await expect(appFrame().locator('[data-test="isolation"]')).toContainText(`${capability}: denied`)
  }

  // The same isolation as hosted, on the studio-app: origin.
  await openModule('Isolation probe')
  await expect(appFrame().locator('body[data-done="true"]')).toBeAttached({ timeout: 30_000 })
  const results = JSON.parse(await appFrame().locator('#results').textContent() ?? '{}') as Record<string, unknown>
  expect(results).toMatchObject({
    cookies: expect.stringMatching(/^blocked/),
    localStorage: expect.stringMatching(/^blocked/),
    parentDocument: expect.stringMatching(/^blocked/),
    topNavigation: expect.stringMatching(/^blocked/),
    popup: expect.stringMatching(/^blocked/),
    studioApi: expect.stringMatching(/^blocked/),
    foreignAppScript: expect.stringMatching(/^blocked/),
    externalScript: expect.stringMatching(/^blocked/),
    secondConnect: 'refused',
    ownFile: 200,
    declaredRead: 'allowed',
    undeclaredWrite: 'app_permission_not_declared',
  })
})
