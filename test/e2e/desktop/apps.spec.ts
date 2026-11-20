import type { ElectronApplication, FrameLocator, Page } from '@playwright/test'
import { copyFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { fixturesDirectory, zipDirectory } from '../../apps/support'
import { waitUntilSettled } from '../web/support'
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
  return window.frameLocator('iframe[sandbox^="allow-scripts"]')
}

async function install (file: string | { name: string, mimeType: string, buffer: Buffer }, title: string) {
  // The package, not its signature (ADR 0044).
  await window.locator('input[type="file"][accept^=".zip"]').setInputFiles(file)
  await window.getByRole('button', { name: 'Install app' }).click()
  // Studio checks the package first and asks to confirm what it requests (ADR 0044).
  await window.getByRole('dialog').getByRole('button', { name: 'Install', exact: true }).click()
  await expect(window.getByText(`Installed ${title}`)).toBeVisible()
}

/** App modules are entries of the navigation rail (MVP-4 layout). */
async function openModule (title: string) {
  await window.getByRole('link', { name: title }).click()
  // The overview's frames are gone once the module's route is shown.
  await expect(window).toHaveURL(/\/apps\//)
  const frame = window.locator('iframe[sandbox^="allow-scripts"]')
  await expect(frame).toHaveCount(1)
  // From a shell page the shell list closes, and the page slides over its
  // place while the app connects: a click into the frame then can miss.
  await waitUntilSettled(frame)
}

test('runs installed apps on a local package', async () => {
  test.setTimeout(120_000)
  // Match the smaller CI display: the shell header can push the overview
  // below the viewport, where app frames intentionally remain unloaded.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1280, 900))
  // Administration opens as a panel from the rail's footer, not as a page.
  await window.getByRole('listitem', { name: 'Apps', exact: true }).click()
  await install(join(root, 'examples/apps/dist/backend-demo.zip'), 'Target Summary')
  await install({ name: 'probe.zip', mimeType: 'application/zip', buffer: Buffer.from(await zipDirectory(join(fixturesDirectory, 'probe'))) }, 'Isolation probe')

  const path = join(directory, 'motor.aasx')
  await copyFile(fixture, path)
  await chooseFiles(app, path)
  await window.getByRole('link', { name: 'Studio home' }).click()
  await openPackage(window)

  // The bundled submodel view, served under studio-app:, edits the package in
  // memory in Studio's edit mode.
  await window.getByRole('tab', { name: 'Overview' }).click()
  await window.locator('[data-test="overview-widget-view"]').filter({ hasText: 'Digital Nameplate' }).scrollIntoViewIfNeeded()
  const nameplate = window.frameLocator('iframe[title="App: Digital Nameplate"]')
  await expect(nameplate.getByText('Industrial Servo Motor DM-3000')).toBeVisible()
  expect(window.frames().some(frame => frame.url().startsWith('studio-app://app-'))).toBe(true)
  await window.getByRole('banner').getByRole('button', { name: 'Edit', exact: true }).click()
  // Edit mode adds the app's edit buttons, so its frame grows and the
  // Overview places it anew: wait until it stays put, and click again should
  // the click still land while it moved.
  const frame = window.locator('iframe[title="App: Digital Nameplate"]')
  const serialNumber = nameplate.getByRole('textbox', { name: 'Serial number' })
  await expect(nameplate.getByRole('button', { name: 'Edit Serial number' })).toBeVisible()
  await expect(async () => {
    if (!await serialNumber.isVisible()) {
      await waitUntilSettled(frame)
      await nameplate.getByRole('button', { name: 'Edit Serial number' }).click({ timeout: 5000 })
    }
    await expect(serialNumber).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 45_000 })
  await serialNumber.fill('SN-DESKTOP-APP')
  await waitUntilSettled(frame)
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

  // The same isolation as hosted, on the installation's own studio-app:
  // origin, which keeps its storage to itself (ADR 0045).
  await openModule('Isolation probe')
  await expect(appFrame().locator('body[data-done="true"]')).toBeAttached({ timeout: 30_000 })
  const results = JSON.parse(await appFrame().locator('#results').textContent() ?? '{}') as Record<string, unknown>
  expect(results).toMatchObject({
    cookies: 'empty',
    localStorage: 0,
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

test('runs each installation in its own studio-app: origin, with the pages it embeds in theirs (ADR 0045)', async () => {
  // The "third party" the probe declares: embed.localhost, served here.
  const thirdParty = createServer((request, response) => {
    if (request.url === '/embed.html') {
      response.setHeader('Content-Type', 'text/html')
      response.end(`<script>
        let cookies
        try { document.cookie = 'embed=1'; cookies = 'allowed' } catch (error) { cookies = 'blocked (' + error.name + ')' }
        parent.postMessage({ type: 'embed', origin: self.origin, cookies }, '*')
      </script>`)
      return
    }
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.statusCode = request.url === '/data.json' ? 200 : 404
    response.end('{}')
  })
  await new Promise<void>(resolve => thirdParty.listen(3402, resolve))
  try {
    await window.getByRole('listitem', { name: 'Apps', exact: true }).click()
    await install({ name: 'origin-probe.zip', mimeType: 'application/zip', buffer: Buffer.from(await zipDirectory(join(fixturesDirectory, 'origin-probe'))) }, 'Origin probe')
    // Leave the Apps panel, which covers the page.
    await window.getByRole('link', { name: 'Studio home' }).click()
    await openModule('Origin probe')
    await expect(window.locator('iframe[sandbox="allow-scripts allow-same-origin"]')).toHaveCount(1)
    await expect(appFrame().locator('body[data-done="true"]')).toBeAttached({ timeout: 30_000 })
    const results = JSON.parse(await appFrame().locator('#results').textContent() ?? '{}') as Record<string, unknown>
    expect(results).toMatchObject({
      bridge: 'connected',
      origin: expect.stringMatching(/^studio-app:\/\/app-[\da-f]{16}$/),
      parentDocument: expect.stringMatching(/^blocked/),
      declaredFetch: 200,
      undeclaredFetch: expect.stringMatching(/^blocked/),
      foreignAppScript: expect.stringMatching(/^blocked/),
      embeds: 1,
      embedOrigin: 'http://embed.localhost:3402',
      embedCookies: 'allowed',
    })
  } finally {
    await new Promise(resolve => thirdParty.close(resolve))
  }
})
