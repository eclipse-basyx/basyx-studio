import type { FrameLocator, Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { strToU8, zipSync } from 'fflate'
import pg from 'pg'
import { fixturesDirectory, zipDirectory } from '../../apps/support'
import { installApp, key, registerOpenTarget, registerSecuredServiceTarget, registerSecuredUserTarget, setAtSource, setMode, signIn, studioApi, uninstallAllApps } from './support'

// MVP-3 definition of done in the hosted build: runtime install, submodel
// views, modules, writes through apps, refused permissions, isolation,
// rejected packages and a backend app. Writes go through the bundled Digital
// Nameplate, which replaced the example app in MVP-4 (T4). Run
// `pnpm apps:build` first.

test.describe.configure({ mode: 'serial' })

const root = fileURLToPath(new URL('../../..', import.meta.url))
const examples = join(root, 'examples/apps/dist')
const motorShell = 'urn:fraunhofer:iese:dte:aas:drivemotor-dm3000:001'
const motorNameplate = 'urn:fraunhofer:iese:dte:sm:nameplate:drivemotor-dm3000:001'
const securedShell = 'urn:studio:test:secured:aas:public'
const originalSerial = 'SN-2024-DM3000-0042'

/** A minimal installable view for nameplate submodels (test/apps/fixtures/view). */
function testView (): Promise<Uint8Array> {
  return zipDirectory(join(fixturesDirectory, 'view'))
}

function example (name: string): Promise<Uint8Array> {
  return readFile(join(examples, `${name}.zip`)).then(buffer => new Uint8Array(buffer))
}

function overviewUrl (targetId: string, shell: string) {
  return `/targets/${targetId}/shells/${key(shell)}?tab=overview`
}

/** The frame of an app view or module, by its contribution title (bundled nameplate view: "Digital Nameplate"). */
function appFrame (page: Page, title?: string): FrameLocator {
  return page.frameLocator(title ? `iframe[title="App: ${title}"]` : 'iframe[sandbox="allow-scripts"]')
}

/** The bundled nameplate app's view on the shell overview, in edit mode: it edits only there. */
async function openNameplateView (page: Page, targetId: string, shell = motorShell) {
  await page.goto(overviewUrl(targetId, shell))
  await expect(page.locator('iframe[title="App: Digital Nameplate"]')).toBeVisible()
  await setMode(page, 'Edit')
}

async function editInNameplate (page: Page, label: string, value: string) {
  const frame = appFrame(page, 'Digital Nameplate')
  await frame.getByRole('button', { name: `Edit ${label}` }).click()
  await frame.getByRole('textbox', { name: label }).fill(value)
  await frame.getByRole('button', { name: 'Save' }).click()
}

let openTargetId: string

test.beforeEach(async ({ page }) => {
  await signIn(page, 'studio-admin')
  await uninstallAllApps(page)
  openTargetId = await registerOpenTarget(page, 'E2E apps open target')
})

test.afterAll(async ({ request }) => {
  await setAtSource(request, motorNameplate, 'SerialNumber', originalSerial)
})

test('installs and uninstalls an app while another user has Studio open (DoD 1, 7)', async ({ page, browser }) => {
  test.setTimeout(150_000)
  const alice = await (await browser.newContext()).newPage()
  await signIn(alice, 'alice')
  await alice.goto(overviewUrl(openTargetId, motorShell))
  // The bundled nameplate app is always there; the test view is not installed yet.
  await expect(alice.locator('iframe[title="App: Digital Nameplate"]')).toBeVisible()
  await expect(alice.locator('iframe[title="App: Test view"]')).toHaveCount(0)

  await page.goto('/?panel=apps')
  await page.locator('input[type="file"]').setInputFiles({ name: 'view.zip', mimeType: 'application/zip', buffer: Buffer.from(await testView()) })
  await page.getByRole('button', { name: 'Install app' }).click()
  await expect(page.getByText('Installed Nameplate test view 0.1.0.')).toBeVisible()
  await expect(page.getByText('org.example.nameplate-test-view')).toBeVisible()

  // A rejected package shows its findings and installs nothing.
  const broken = zipSync({
    'studio-app.json': strToU8(JSON.stringify({ manifestVersion: 0, id: 'org.example.broken', version: '1.0.0', publisher: { name: 'x' }, title: { en: 'Broken' }, studioApi: '^0.1.0', runtimes: ['hosted'], permissions: ['studio.root'], contributes: {} })),
  })
  await page.locator('input[type="file"]').setInputFiles({ name: 'broken.zip', mimeType: 'application/zip', buffer: Buffer.from(broken) })
  await page.getByRole('button', { name: 'Install app' }).click()
  await expect(page.getByText('The app package is not valid.')).toBeVisible()
  await expect(page.getByText('studio-app.json#permissions.0', { exact: true })).toBeVisible()

  // Alice's open page picks the app up without a reload.
  await expect(alice.locator('iframe[title="App: Test view"]')).toBeVisible({ timeout: 45_000 })
  await expect(appFrame(alice, 'Test view').locator('#submodel')).toHaveText(motorNameplate)

  // Bundled apps have no uninstall button; row actions show on hover.
  await page.getByRole('listitem').filter({ hasText: 'org.example.nameplate-test-view' }).hover()
  await page.getByRole('button', { name: 'Uninstall' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Uninstall' }).click()
  await expect(page.getByText('org.example.nameplate-test-view')).toHaveCount(0)
  await expect(alice.locator('iframe[title="App: Test view"]')).toHaveCount(0, { timeout: 45_000 })
  await alice.context().close()
})

test('offers app views only for matching submodels and says which (DoD 2)', async ({ page }) => {
  await installApp(page, await testView())
  const securedTargetId = await registerSecuredServiceTarget(page, 'E2E apps secured (as Studio)')

  await openNameplateView(page, openTargetId)
  const frame = appFrame(page, 'Digital Nameplate')
  await expect(frame.getByText('Industrial Servo Motor DM-3000')).toBeVisible()
  await expect(frame.locator('[data-field="SerialNumber"]')).toContainText(originalSerial)
  // One card per matching view, labeled with its app and submodel.
  await expect(page.getByText('Digital Nameplate · Nameplate')).toBeVisible()
  await expect(page.getByText('Nameplate test view · Nameplate')).toBeVisible()
  await expect(page.getByText('Technical Data · TechnicalData')).toBeVisible()

  // EdgeCasesShell's submodels match no app.
  await page.goto(overviewUrl(openTargetId, 'urn:studio:test:aas:edge-cases'))
  await expect(page.getByText('No views for this shell')).toBeVisible()

  // The secured fixture's nameplate (its serial number is changed by the write test).
  await openNameplateView(page, securedTargetId, securedShell)
  await expect(appFrame(page, 'Digital Nameplate').getByText('Secured Test Manufacturer')).toBeVisible()
})

test('writes through the app with the core UI\'s conflict handling (DoD 4)', async ({ page, request }) => {
  // The bundled app edits only in Studio's edit mode.
  await page.goto(overviewUrl(openTargetId, motorShell))
  await expect(appFrame(page, 'Digital Nameplate').locator('[data-field="SerialNumber"]')).toBeVisible()
  await expect(appFrame(page, 'Digital Nameplate').getByRole('button', { name: 'Edit Serial number' })).toHaveCount(0)
  await openNameplateView(page, openTargetId)

  await editInNameplate(page, 'Serial number', 'SN-E2E-APP-0001')
  await expect(appFrame(page, 'Digital Nameplate').getByText('Serial number saved.')).toBeVisible()
  await expect(page.getByText('Digital Nameplate: Serial number saved.')).toBeVisible()
  await expect(appFrame(page, 'Digital Nameplate').locator('[data-field="SerialNumber"]')).toContainText('SN-E2E-APP-0001')

  // A change by someone else between reading and saving is a conflict; the draft stays.
  const frame = appFrame(page, 'Digital Nameplate')
  await frame.getByRole('button', { name: 'Edit Serial number' }).click()
  await frame.getByRole('textbox', { name: 'Serial number' }).fill('SN-E2E-APP-DRAFT')
  await setAtSource(request, motorNameplate, 'SerialNumber', 'SN-CHANGED-ELSEWHERE')
  await frame.getByRole('button', { name: 'Save' }).click()
  await expect(frame.locator('[data-test="edit-error"]')).toContainText('Someone else changed this value')
  await expect(frame.getByRole('textbox', { name: 'Serial number' })).toHaveValue('SN-E2E-APP-DRAFT')
})

test('limits app writes to the user\'s own rights on the target (DoD 4)', async ({ page, browser }) => {
  test.setTimeout(120_000)
  const delegatedTargetId = await registerSecuredUserTarget(page, 'E2E apps secured (as user)')

  for (const [username, expected] of [['alice', 'You are not permitted to change this value.'], ['dave', 'Serial number saved.']] as const) {
    const user = await (await browser.newContext()).newPage()
    await signIn(user, username)
    // Opening the target starts its authorization; the IdP session signs in right away.
    await user.goto(`/targets/${delegatedTargetId}/shells`)
    await expect(user.getByText('SecuredPublicShell').first()).toBeVisible()
    await openNameplateView(user, delegatedTargetId, securedShell)
    await editInNameplate(user, 'Serial number', `SEC-E2E-${username}-${Date.now()}`)
    const frame = appFrame(user, 'Digital Nameplate')
    await expect(username === 'alice' ? frame.locator('[data-test="edit-error"]') : frame.locator('[data-test="notice"]')).toContainText(expected)
    await user.context().close()
  }
})

test('adds module routes, nested routes and shell modules that follow the active target (DoD 3)', async ({ page }) => {
  const installationId = await installApp(page, await example('shell-explorer'))
  const securedTargetId = await registerSecuredServiceTarget(page, 'E2E apps secured (as Studio)')

  await page.goto(`/targets/${openTargetId}`)
  // Modules appear in the navigation rail for their context.
  await expect(page.getByRole('link', { name: 'Shell Explorer' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Shell summary' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Shell Explorer' }).click()
  await expect(page).toHaveURL(`/targets/${openTargetId}/apps/${installationId}/explorer`)

  const frame = appFrame(page)
  await expect(frame.locator('[data-test="heading"]')).toHaveText('Shells of E2E apps open target')
  await frame.getByText('IESEDriveMotorDM3000', { exact: true }).click()
  await expect(page).toHaveURL(new RegExp(String.raw`/targets/${openTargetId}/apps/${installationId}/explorer/shells/[\w-]+$`))
  await expect(frame.locator('[data-test="heading"]')).toHaveText(motorShell)
  await expect(frame.locator('[data-test="submodels"]')).toContainText('Nameplate')

  // A new target gets a new frame that sees only that target.
  await page.goto(`/targets/${securedTargetId}/apps/${installationId}/explorer`)
  await expect(frame.locator('[data-test="heading"]')).toHaveText('Shells of E2E apps secured (as Studio)')
  await expect(frame.locator('[data-test="shells"]')).toContainText('SecuredPublicShell')
  await expect(frame.locator('[data-test="shells"]')).not.toContainText('IESEDriveMotorDM3000')

  // The shell module is offered while a shell is open.
  await page.goto(`/targets/${securedTargetId}/shells/${key(securedShell)}`)
  await page.getByRole('link', { name: 'Shell summary' }).click()
  await expect(frame.locator('[data-test="heading"]')).toHaveText(`Submodels of ${securedShell}`)
  await expect(frame.locator('[data-test="submodels"]')).toContainText('Nameplate')
})

test('contains a hostile app and refuses what it did not declare (DoD 5, 6)', async ({ page }) => {
  const installationId = await installApp(page, await zipDirectory(join(fixturesDirectory, 'probe')))
  await page.goto(`/targets/${openTargetId}/apps/${installationId}/probe`)
  const frame = appFrame(page)
  await expect(frame.locator('body[data-done="true"]')).toBeAttached({ timeout: 30_000 })
  const results = JSON.parse(await frame.locator('#results').textContent() ?? '{}') as Record<string, unknown>

  expect(results).toMatchObject({
    cookies: expect.stringMatching(/^blocked/),
    localStorage: expect.stringMatching(/^blocked/),
    indexedDB: expect.stringMatching(/^blocked/),
    parentDocument: expect.stringMatching(/^blocked/),
    topNavigation: expect.stringMatching(/^blocked/),
    popup: expect.stringMatching(/^blocked/),
    studioApi: expect.stringMatching(/^blocked/),
    foreignAppScript: expect.stringMatching(/^blocked/),
    externalScript: expect.stringMatching(/^blocked/),
    embedStudio: 'blocked (frame-src)',
    secondConnect: 'refused',
    ownFile: 200,
    declaredRead: 'allowed',
    undeclaredWrite: 'app_permission_not_declared',
    undeclaredNotify: 'app_permission_not_declared',
    unknownMethod: 'invalid_request',
  })
  expect(results.violations).toEqual(expect.arrayContaining(['connect-src', 'frame-src', 'script-src-elem']))
  await expect(page).toHaveURL(`/targets/${openTargetId}/apps/${installationId}/probe`)

  // Refusals are audited with the app's identity.
  const client = new pg.Client({ connectionString: 'postgres://studio:studio@localhost:15432/studio' })
  await client.connect()
  try {
    const { rows } = await client.query(
      `select details->>'method' as method from audit_events
       where app_installation_id = $1 and action = 'app.call' and outcome = 'failure' and details->>'code' = 'app_permission_not_declared'`,
      [installationId],
    )
    expect(rows.map(row => row.method).toSorted()).toEqual(['studio.aas.setElementValue', 'studio.ui.notify'])
  } finally {
    await client.end()
  }
})

test('rejects invalid packages through the API and leaves nothing installed (DoD 7)', async ({ page }) => {
  const api = await studioApi(page)
  const manifest = { manifestVersion: 0, id: 'org.example.invalid', version: '1.0.0', publisher: { name: 'x' }, title: { en: 'Invalid' }, studioApi: '^0.1.0', runtimes: ['hosted'], permissions: [], contributes: { modules: [{ id: 'm', title: { en: 'M' }, entry: 'ui/index.html', route: 'm', context: 'global' }] } }
  const cases: Array<[string, Uint8Array, string]> = [
    ['schema', zipSync({ 'studio-app.json': strToU8(JSON.stringify({ ...manifest, id: 'Invalid' })), 'ui/index.html': strToU8('x') }), 'app_package_rejected'],
    ['range', zipSync({ 'studio-app.json': strToU8(JSON.stringify({ ...manifest, studioApi: '^3.0.0' })), 'ui/index.html': strToU8('x') }), 'app_incompatible'],
    ['traversal', zipSync({ 'studio-app.json': strToU8(JSON.stringify(manifest)), 'ui/index.html': strToU8('x'), '../evil.js': strToU8('x') }), 'app_package_rejected'],
    ['type', zipSync({ 'studio-app.json': strToU8(JSON.stringify(manifest)), 'ui/index.html': strToU8('x'), 'tool.exe': strToU8('MZ') }), 'app_package_rejected'],
    ['size', new Uint8Array(21 * 1024 * 1024), 'app_package_rejected'],
  ]
  for (const [name, bytes, code] of cases) {
    const response = await api.install(bytes)
    const problem = await response.json() as { code: string, violations?: unknown[] }
    expect(problem.code, name).toBe(code)
    expect(problem.violations?.length, name).toBeGreaterThan(0)
  }
  // Only the apps shipped with Studio remain.
  const list = await (await api.get('/app-installations')).json() as { items: Array<{ bundled: boolean }> }
  expect(list.items.filter(item => !item.bundled)).toEqual([])
})

test('runs a backend app in Deno with the user\'s rights (DoD 8)', async ({ page }) => {
  const installationId = await installApp(page, await example('backend-demo'))
  await page.goto(`/targets/${openTargetId}/apps/${installationId}/summary`)
  const frame = appFrame(page)

  await frame.getByRole('button', { name: 'Summarize target' }).click()
  await expect(frame.locator('[data-test="summary"]')).toContainText('62 shells', { timeout: 30_000 })
  await expect(frame.locator('[data-test="summary"]')).toContainText('Deno 2.')

  await frame.getByRole('button', { name: 'Check isolation' }).click()
  for (const capability of ['readFiles', 'environment', 'internet', 'subprocesses']) {
    await expect(frame.locator('[data-test="isolation"]')).toContainText(`${capability}: denied`)
  }

  // Capability tokens are the only way in, and a forged one is refused.
  const response = await page.request.post('/api/studio/v1/app-calls', {
    headers: { Authorization: 'Bearer sct.e30.forged' },
    data: { method: 'studio.aas.listShells', params: {} },
  })
  expect(response.status()).toBe(401)
})
