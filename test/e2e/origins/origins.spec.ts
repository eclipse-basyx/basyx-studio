import type { Page, TestInfo } from '@playwright/test'
import type { Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { strToU8, zipSync } from 'fflate'
import { fixturesDirectory, zipDirectory } from '../../apps/support'
import { waitUntilSettled } from '../web/support'

// One origin per installation, declared third-party origins and full-page
// modules (ADR 0045), and views of other apps embedded in an app's page
// (ADR 0051), against a Studio with an origin per installation and one with
// a shared apps origin (origins.config.ts).

test.describe.configure({ mode: 'serial' })

/** The "third party": embed.localhost and undeclared.localhost on one port. */
let thirdParty: Server

test.beforeAll(async () => {
  thirdParty = createServer((request, response) => {
    if (request.url === '/embed.html') {
      response.setHeader('Content-Type', 'text/html')
      // Reports its origin to the app, and whether it may use cookies.
      response.end(`<script>
        let cookies
        try { document.cookie = 'embed=1'; cookies = 'allowed' } catch (error) { cookies = 'blocked (' + error.name + ')' }
        parent.postMessage({ type: 'embed', origin: self.origin, cookies }, '*')
      </script>`)
      return
    }
    if (request.url === '/data.json') {
      response.setHeader('Content-Type', 'application/json')
      response.setHeader('Access-Control-Allow-Origin', '*')
      response.end('{"ok":true}')
      return
    }
    response.statusCode = 404
    response.end()
  })
  await new Promise<void>(resolve => thirdParty.listen(3402, resolve))
})

test.afterAll(async () => {
  await new Promise(resolve => thirdParty.close(resolve))
})

const installationOrigins = (info: TestInfo) => info.project.name === 'installation-origins'

/** Installs the probe through the Apps page, which shows the origins for consent. */
async function installProbe (page: Page, info: TestInfo) {
  await page.goto('/?panel=apps')
  await page.locator('input[type="file"][accept^=".zip"]').setInputFiles({
    name: 'origin-probe.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(await zipDirectory(join(fixturesDirectory, 'origin-probe'))),
  })
  await page.getByRole('button', { name: 'Install app' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('http://embed.localhost:3402')).toHaveCount(2)
  await expect(dialog.getByText('Embeds pages from')).toBeVisible()
  await expect(dialog.getByText('Sends requests to')).toBeVisible()
  await expect(dialog.getByText('Your browser contacts these origins directly.', { exact: false })).toBeVisible()
  await expect(dialog.getByText('This Studio serves all apps from one origin.', { exact: false })).toHaveCount(installationOrigins(info) ? 0 : 1)
  await dialog.getByRole('button', { name: 'Install', exact: true }).click()
  await expect(page.getByText('Installed Origin probe')).toBeVisible()
}

test('runs an app in its own origin or an opaque one, with its declared origins only', async ({ page }, info) => {
  await installProbe(page, info)
  // The module is an entry of the navigation rail; the Apps panel covers the page.
  const href = await page.getByRole('link', { name: 'Origin probe' }).getAttribute('href')
  const installationId = /\/apps\/(app-[\da-f]{16})\/probe$/.exec(href ?? '')![1]!
  await page.goto(href!)

  const element = page.locator('iframe[title="App: Origin probe"]')
  const frame = page.frameLocator('iframe[title="App: Origin probe"]')
  await expect(frame.locator('body[data-done="true"]')).toBeAttached({ timeout: 30_000 })
  const results = JSON.parse(await frame.locator('#results').textContent() ?? '{}') as Record<string, unknown>

  // Either way: the bridge connects, declared origins work, nothing else.
  expect(results).toMatchObject({
    bridge: 'connected',
    parentDocument: expect.stringMatching(/^blocked/),
    declaredFetch: 200,
    undeclaredFetch: expect.stringMatching(/^blocked/),
    foreignAppScript: expect.stringMatching(/^blocked/),
    serviceWorker: expect.stringMatching(/^blocked/),
    embeds: 1,
  })
  expect(results.violations).toEqual(expect.arrayContaining(['connect-src', 'frame-src', 'script-src-elem']))

  if (installationOrigins(info)) {
    // Its own origin, and the embedded page keeps its own (ADR 0045).
    await expect(element).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin')
    expect(results).toMatchObject({
      origin: `http://${installationId}.apps.localhost:3400`,
      localStorage: 'allowed',
      embedOrigin: 'http://embed.localhost:3402',
      embedCookies: 'allowed',
    })
  } else {
    // Opaque as in ADR 0017, and so is the embedded page: no cookies.
    await expect(element).toHaveAttribute('sandbox', 'allow-scripts')
    expect(results).toMatchObject({
      origin: 'null',
      localStorage: expect.stringMatching(/^blocked/),
      embedOrigin: 'null',
      embedCookies: expect.stringMatching(/^blocked \(SecurityError\)/),
    })
  }
})

test('serves an installation\'s files on its own origin only', async ({ page, request }, info) => {
  test.skip(!installationOrigins(info), 'one origin per installation only')
  await page.goto('/?panel=apps')
  const contributions = await (await request.get('/api/studio/v1/app-contributions')).json() as { modules: Array<{ installationId: string, entryUrl: string, frameOrigin: string | null, layout: string }> }
  const probe = contributions.modules.find(module => module.entryUrl.endsWith('/ui/index.html') && module.layout === 'fullPage')!
  expect(probe.frameOrigin).toBe(`http://${probe.installationId}.apps.localhost:3400`)
  const path = `/app/${probe.installationId}/ui/index.html`
  const status = async (host: string) => (await request.get(`http://127.0.0.1:3400${path}`, { headers: { Host: host } })).status()
  expect(await status(`${probe.installationId}.apps.localhost:3400`)).toBe(200)
  expect(await status('app-0000000000000000.apps.localhost:3400')).toBe(404)
  expect(await status('localhost:3400')).toBe(404)
  // No Studio pages or API on an apps origin.
  expect((await request.get('http://127.0.0.1:3400/api/studio/v1/context', { headers: { Host: `${probe.installationId}.apps.localhost:3400` } })).status()).toBe(404)
})

test('shows a full-page module filling the page\'s panel beside the rail, without header or card', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Origin probe' }).click()
  await expect(page).toHaveURL(/\/apps\/app-[\da-f]{16}\/probe$/)
  const element = page.locator('iframe[title="App: Origin probe"]')
  await expect(element).toBeVisible()
  await expect(page.locator('main .v-breadcrumbs')).toHaveCount(0)
  await expect(page.locator('main .v-card')).toHaveCount(0)
  const frame = (await element.boundingBox())!
  const rail = (await page.getByRole('navigation').first().boundingBox())!
  const bar = (await page.getByRole('banner').boundingBox())!
  // The page's panel, inset in the frame that the bar, the rail and the
  // frame's 4 px end and bottom edges form (useWindowPanel).
  const panel = (await page.getByRole('main').locator('.v-sheet').first().boundingBox())!
  // Beside the navigation rail, below the app bar, and filling the panel to
  // its other edges (within the panel's 1 px border).
  const near = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1)
  near(frame.x, rail.x + rail.width)
  near(frame.y, bar.y + bar.height)
  near(frame.x + frame.width, panel.x + panel.width)
  near(frame.y + frame.height, panel.y + panel.height)
})

/** The Studio API with the anonymous session's CSRF token. */
async function studioApi (page: Page) {
  await page.goto('/')
  const session = await (await page.request.get('/api/studio/v1/session')).json() as { csrfToken: string }
  const headers = { 'Origin': new URL(page.url()).origin, 'X-CSRF-Token': session.csrfToken }
  return {
    get: (path: string) => page.request.get(`/api/studio/v1${path}`),
    post: (path: string, data: unknown) => page.request.post(`/api/studio/v1${path}`, { headers, data }),
    delete: (path: string) => page.request.delete(`/api/studio/v1${path}`, { headers }),
    install: (bytes: Uint8Array) => page.request.post('/api/studio/v1/app-installations', { headers: { ...headers, 'Content-Type': 'application/zip' }, data: Buffer.from(bytes) }),
  }
}

const embedShell = 'urn:studio:test:e2e:embed'
const key = (value: string) => Buffer.from(value, 'utf8').toString('base64url')
const reference = (value: string) => ({ type: 'ExternalReference', keys: [{ type: 'GlobalReference', value }] })
const property = (idShort: string, value?: string, semanticId?: string) => ({ modelType: 'Property', idShort, valueType: 'xs:string', ...(value === undefined ? {} : { value }), ...(semanticId ? { semanticId: reference(semanticId) } : {}) })
const collection = (idShort: string, value: unknown[], semanticId?: string) => ({ modelType: 'SubmodelElementCollection', idShort, value, ...(semanticId ? { semanticId: reference(semanticId) } : {}) })

/** A shell with a time series of three records and a submodel for the embed probe, on the test environment's open BaSyx. */
async function createEmbedShell (page: Page): Promise<string> {
  const api = await studioApi(page)
  const infrastructures = await (await api.get('/infrastructures')).json() as { items: Array<{ id: string, name: string }> }
  let target = infrastructures.items.find(item => item.name === 'E2E embedded views')?.id
  if (!target) {
    const created = await api.post('/infrastructures', {
      name: 'E2E embedded views',
      template: 'full',
      endpoints: [{ type: 'aasRepository', url: 'http://localhost:18081' }, { type: 'submodelRepository', url: 'http://localhost:18081' }],
      listSource: 'repository',
      security: { mode: 'unsecured' },
      allowPrivateNetwork: true,
    })
    expect(created.status(), await created.text()).toBe(201)
    target = (await created.json() as { id: string }).id
  }
  await api.delete(`/targets/${target}/shells/${key(embedShell)}?deleteSubmodels=true`)
  const shell = await api.post(`/targets/${target}/shells`, {
    shell: { id: embedShell, idShort: 'EmbedShell', assetInformation: { assetKind: 'Instance', globalAssetId: `${embedShell}:asset` } },
    submodels: [
      {
        source: 'json',
        submodel: {
          modelType: 'Submodel',
          id: `${embedShell}:time-series`,
          idShort: 'TimeSeries',
          semanticId: { type: 'ModelReference', keys: [{ type: 'Submodel', value: 'https://admin-shell.io/idta/TimeSeries/1/1' }] },
          submodelElements: [
            collection('Metadata', [collection('Record', [property('Time', undefined, 'https://admin-shell.io/idta/TimeSeries/UtcTime/1/1'), property('Temperature')])]),
            collection('Segments', [
              collection('InternalSegment', [
                collection('Records', [1, 2, 3].map(index => collection(`Record0${index}`, [property('Time', `2026-10-21T10:0${index}:00Z`), property('Temperature', String(20 + index))]))),
              ], 'https://admin-shell.io/idta/TimeSeries/Segments/InternalSegment/1/1'),
            ]),
          ],
        },
      },
      {
        source: 'json',
        submodel: { modelType: 'Submodel', id: `${embedShell}:probe`, idShort: 'Probe', semanticId: reference('urn:studio:test:e2e:embed-probe'), submodelElements: [property('Value', 'original')] },
      },
    ],
  })
  expect(shell.status(), await shell.text()).toBe(201)
  embedTarget = target
  return target
}

/** The target of the shell above while it exists; the shell is removed after the test, also when it fails. */
let embedTarget: string | null = null

test.afterEach(async ({ page }) => {
  if (embedTarget) {
    await (await studioApi(page)).delete(`/targets/${embedTarget}/shells/${key(embedShell)}?deleteSubmodels=true`)
    embedTarget = null
  }
})

/** The embed probe (test/apps/fixtures/embed-probe) in another version, for an update in place. */
async function embedProbe (version: string): Promise<Uint8Array> {
  const directory = join(fixturesDirectory, 'embed-probe')
  const text = (path: string) => readFile(join(directory, path), 'utf8')
  return zipSync({
    'studio-app.json': strToU8((await text('studio-app.json')).replace('"version": "1.0.0"', `"version": "${version}"`)),
    'ui/index.html': strToU8(await text('ui/index.html')),
    'ui/probe.js': strToU8((await text('ui/probe.js')).replace(`const version = '1.0.0'`, `const version = '${version}'`)),
  })
}

test('embeds other apps\' views read-only in an app\'s page, connected to Studio only (ADR 0051)', async ({ page, request }, info) => {
  test.setTimeout(120_000)
  const targetId = await createEmbedShell(page)
  const api = await studioApi(page)
  const installed = await api.install(await zipDirectory(join(fixturesDirectory, 'view-embedder')))
  expect(installed.status(), await installed.text()).toBe(201)
  const embedderId = (await installed.json() as { id: string }).id
  expect((await api.install(await zipDirectory(join(fixturesDirectory, 'embed-probe')))).status()).toBe(201)

  await page.goto(`/targets/${targetId}/apps/${embedderId}/embedder`)
  const embedder = page.frameLocator('iframe[title="App: View embedder"]')
  await expect(embedder.locator('body[data-done="true"]')).toBeAttached({ timeout: 30_000 })
  const results = JSON.parse(await embedder.locator('#results').textContent() ?? '{}') as Record<string, unknown>

  if (!installationOrigins(info)) {
    // With one shared apps origin, only Studio's dialog shows other apps' views.
    expect(results).toEqual({ timeSeries: 'unsupported_operation', probe: 'unsupported_operation' })
    return
  }

  // The views run at their own installations' origins, out of the app's reach.
  expect(results).toMatchObject({ viewOrigins: ['other', 'other'], viewDocument: expect.stringMatching(/^blocked/), stolenHello: 'no port' })

  // The bundled Time Series view shows inside the app's page: it read the
  // submodel through its own connection and offers its segment.
  const timeSeries = embedder.frameLocator('iframe[title="timeSeries"]')
  await expect(timeSeries.getByText('InternalSegment').first()).toBeVisible({ timeout: 30_000 })
  await expect(timeSeries.getByRole('button', { name: 'Fetch data' })).toBeVisible()

  // The probe view is connected to Studio once, though it repeats its hello,
  // with its own app's settings, read-only: it reads, but cannot write, act
  // outside its frame, or write further away through a backend or a connection.
  const probe = embedder.frameLocator('iframe[title="probe"]')
  await expect(probe.locator('body[data-done="true"]')).toBeAttached({ timeout: 30_000 })
  expect(JSON.parse(await probe.locator('#results').textContent() ?? '{}')).toEqual({
    version: '1.0.0',
    embedded: true,
    mode: 'view',
    submodel: `${embedShell}:probe`,
    settings: { probeLabel: 'from the probe' },
    read: 'allowed',
    write: 'forbidden',
    openExternal: 'forbidden',
    backend: 'forbidden',
    connection: 'forbidden',
  })
  await probe.getByRole('button', { name: 'Read again' }).click()
  await expect(probe.locator('#again-result')).toHaveText('1: allowed')

  // Only the view's entry with Studio's token may be framed by the app's origin.
  const embedderOrigin = `http://${embedderId}.apps.localhost:3400`
  const src = await embedder.locator('iframe[title="probe"]').getAttribute('src')
  const url = new URL(src!)
  const ancestors = async (path: string) => {
    const response = await request.get(`http://127.0.0.1:3400${path}`, { headers: { Host: url.host } })
    return /frame-ancestors ([^;]*)/.exec(response.headers()['content-security-policy'] ?? '')?.[1] ?? ''
  }
  expect(await ancestors(`${url.pathname}${url.search}`)).toContain(embedderOrigin)
  expect(await ancestors(url.pathname)).not.toContain(embedderOrigin)
  expect(await ancestors(`${url.pathname.replace('index.html', 'probe.js')}${url.search}`)).not.toContain(embedderOrigin)
  expect(await ancestors(`${url.pathname}?studio-embed=sev.forged.mac`)).not.toContain(embedderOrigin)

  // Full screen opens the view in Studio's dialog, where it runs as usual
  // again; the embedded view sees context.fullscreenOpen until it closes.
  await expect(probe.locator('#fullscreen-open')).toHaveText('false')
  await probe.getByRole('button', { name: 'Full screen' }).click()
  const dialog = page.locator('[data-test="app-view-dialog"]')
  const inDialog = dialog.frameLocator('iframe[title="App: Embed probe"]')
  await expect(inDialog.locator('body[data-done="true"]')).toBeAttached({ timeout: 30_000 })
  expect(JSON.parse(await inDialog.locator('#results').textContent() ?? '{}')).toMatchObject({ embedded: false, write: 'allowed', settings: { probeLabel: 'from the probe' } })
  await expect(probe.locator('#fullscreen-open')).toHaveText('true')
  await waitUntilSettled(dialog.locator('iframe[title="App: Embed probe"]'))
  await dialog.locator('[data-test="app-view-close"]').click()
  await expect(dialog).toBeHidden()
  await expect(probe.locator('#fullscreen-open')).toHaveText('false')
  // A click while the dialog's scrim still fades would land on it.
  await expect(page.locator('.v-overlay__scrim:visible')).toHaveCount(0)

  // An update in place of the probe's app: its next call is refused as
  // outdated, and Studio loads the embedded view again, with the new package.
  // The view's own click event: what lies over the frame is not the point here.
  const updated = await api.install(await embedProbe('1.0.1'))
  expect(updated.status(), await updated.text()).toBe(200)
  await probe.locator('#again').dispatchEvent('click')
  await expect(probe.locator('#results')).toContainText('"version": "1.0.1"', { timeout: 30_000 })
  await expect(probe.locator('body[data-done="true"]')).toBeAttached({ timeout: 30_000 })
  expect(JSON.parse(await probe.locator('#results').textContent() ?? '{}')).toMatchObject({ version: '1.0.1', embedded: true, read: 'allowed', write: 'forbidden' })
  await probe.locator('#again').dispatchEvent('click')
  await expect(probe.locator('#again-result')).toHaveText('1: allowed')
})
