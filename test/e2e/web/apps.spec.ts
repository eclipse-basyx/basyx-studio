import type { FrameLocator, Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { strToU8, zipSync } from 'fflate'
import pg from 'pg'
import { fixturesDirectory, zipDirectory } from '../../apps/support'
import { installApp, key, registerOpenTarget, registerSecuredServiceTarget, registerSecuredUserTarget, setAtSource, setMode, signIn, studioApi, uninstallAllApps, waitUntilSettled } from './support'

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
  return page.frameLocator(title ? `iframe[title="App: ${title}"]` : 'iframe[sandbox^="allow-scripts"]')
}

/** The bundled nameplate app's view on the shell overview, in edit mode: it edits only there. */
async function openNameplateView (page: Page, targetId: string, shell = motorShell) {
  await page.goto(overviewUrl(targetId, shell))
  await expect(page.locator('iframe[title="App: Digital Nameplate"]')).toBeVisible()
  await setMode(page, 'Edit')
}

/**
 * Clicks a button of the nameplate app once its frame stopped growing and
 * moving: a click into a frame the Overview is still placing can be lost.
 */
async function clickInNameplate (page: Page, name: string) {
  const button = appFrame(page, 'Digital Nameplate').getByRole('button', { name })
  await expect(button).toBeVisible()
  await waitUntilSettled(page.locator('iframe[title="App: Digital Nameplate"]'))
  await button.click()
}

async function editInNameplate (page: Page, label: string, value: string) {
  await clickInNameplate(page, `Edit ${label}`)
  await appFrame(page, 'Digital Nameplate').getByRole('textbox', { name: label }).fill(value)
  await clickInNameplate(page, 'Save')
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
  const alice = await (await browser.newContext()).newPage()
  // Open pages refetch the installed apps every 30 seconds; Alice's clock
  // jumps there instead of the test waiting for it.
  await alice.clock.install()
  await signIn(alice, 'alice')
  await alice.goto(overviewUrl(openTargetId, motorShell))
  // The bundled nameplate app is always there; the test view is not installed yet.
  await expect(alice.locator('iframe[title="App: Digital Nameplate"]')).toBeVisible()
  await expect(alice.locator('iframe[title="App: Test view"]')).toHaveCount(0)

  await page.goto('/?panel=apps')
  // The package, not its signature (ADR 0044).
  await page.locator('input[type="file"][accept^=".zip"]').setInputFiles({ name: 'view.zip', mimeType: 'application/zip', buffer: Buffer.from(await testView()) })
  await page.getByRole('button', { name: 'Install app' }).click()
  // Studio checks the package first and asks to confirm what it requests (ADR 0044).
  const consent = page.getByRole('dialog')
  await expect(consent.getByText('This package is not signed.')).toBeVisible()
  await expect(consent.getByText('Read AAS data you have access to')).toBeVisible()
  await consent.getByRole('button', { name: 'Install', exact: true }).click()
  await expect(page.getByText('Installed Nameplate test view 0.1.0.')).toBeVisible()
  await expect(page.getByText('org.example.nameplate-test-view')).toBeVisible()

  // A rejected package shows its findings and installs nothing.
  const broken = zipSync({
    'studio-app.json': strToU8(JSON.stringify({ manifestVersion: 0, id: 'org.example.broken', version: '1.0.0', publisher: { name: 'x' }, title: { en: 'Broken' }, studioApi: '^0.1.0', runtimes: ['hosted'], permissions: ['studio.root'], contributes: {} })),
  })
  await page.locator('input[type="file"][accept^=".zip"]').setInputFiles({ name: 'broken.zip', mimeType: 'application/zip', buffer: Buffer.from(broken) })
  await page.getByRole('button', { name: 'Install app' }).click()
  await expect(page.getByText('The app package is not valid.')).toBeVisible()
  await expect(page.getByText('studio-app.json#permissions.0', { exact: true })).toBeVisible()

  // Alice's open page picks the app up without a reload. Views span the row
  // at this width, so the new one is below the fold; frames load in sight.
  await alice.clock.fastForward('00:31')
  await alice.getByRole('button', { name: 'Actions for Test view' }).scrollIntoViewIfNeeded()
  await expect(alice.locator('iframe[title="App: Test view"]')).toBeVisible()
  await expect(appFrame(alice, 'Test view').locator('#submodel')).toHaveText(motorNameplate)

  // Bundled apps have no uninstall button; row actions show on hover.
  await page.getByRole('listitem').filter({ hasText: 'org.example.nameplate-test-view' }).hover()
  await page.getByRole('button', { name: 'Uninstall' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Uninstall' }).click()
  await expect(page.getByText('org.example.nameplate-test-view')).toHaveCount(0)
  await alice.clock.fastForward('00:31')
  await expect(alice.locator('iframe[title="App: Test view"]')).toHaveCount(0)
  await alice.context().close()
})

test('offers app views only for matching submodels and says which (DoD 2)', async ({ page }) => {
  await installApp(page, await testView())
  const securedTargetId = await registerSecuredServiceTarget(page, 'E2E apps secured (as Studio)')

  await openNameplateView(page, openTargetId)
  const frame = appFrame(page, 'Digital Nameplate')
  await expect(frame.locator('[data-test="product-title"]')).toHaveText('Industrial Servo Motor DM-3000')
  await expect(frame.locator('[data-field="SerialNumber"]')).toContainText(originalSerial)
  // One card per matching view, labeled with its submodel, and with its app
  // where the view's own title does not name the app.
  const cards = page.locator('[data-test="overview-widget-view"]')
  await expect(cards.filter({ hasText: 'Digital Nameplate' }).getByText('Nameplate', { exact: true })).toBeVisible()
  await expect(page.getByText('Nameplate test view · Nameplate')).toBeVisible()
  await expect(cards.filter({ hasText: 'Technical Data' }).getByText('TechnicalData', { exact: true })).toBeVisible()

  // EdgeCasesShell's submodels match no app.
  await page.goto(overviewUrl(openTargetId, 'urn:studio:test:aas:edge-cases'))
  await expect(page.getByText('No views for this shell')).toBeVisible()

  // The secured fixture's nameplate (its serial number is changed by the write test).
  await openNameplateView(page, securedTargetId, securedShell)
  await expect(appFrame(page, 'Digital Nameplate').locator('[data-test="manufacturer-name"]')).toHaveText('Secured Test Manufacturer')
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
  // The view spans the row here, so its Save button sits under the notice in
  // the corner until it closes; the notice stays while the pointer is over it.
  await page.mouse.move(0, 0)
  await expect(page.getByText('Digital Nameplate: Serial number saved.')).toBeHidden({ timeout: 15_000 })

  // A change by someone else between reading and saving is a conflict; the draft stays.
  const frame = appFrame(page, 'Digital Nameplate')
  await clickInNameplate(page, 'Edit Serial number')
  await frame.getByRole('textbox', { name: 'Serial number' }).fill('SN-E2E-APP-DRAFT')
  await setAtSource(request, motorNameplate, 'SerialNumber', 'SN-CHANGED-ELSEWHERE')
  await clickInNameplate(page, 'Save')
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
  const listUrl = page.url()
  await expect(frame.locator('[data-test="heading"]')).toHaveText('Shells of E2E apps open target')
  // Shell summaries carry the asset type (external apps follow-up plan R1).
  await expect(frame.locator('[data-test="shells"]')).toContainText('https://fraunhofer.de/iese/dte/products/DriveMotorDM3000')
  // The frame stays loaded while the module's sub-path changes.
  const loaded = await (await page.locator('iframe[sandbox^="allow-scripts"]').elementHandle())!.contentFrame()
  await loaded!.evaluate(() => Object.assign(globalThis, { e2eLoaded: true }))
  await frame.getByText('IESEDriveMotorDM3000', { exact: true }).click()
  await expect(page).toHaveURL(new RegExp(String.raw`/targets/${openTargetId}/apps/${installationId}/explorer/shells/[\w-]+$`))
  await expect(frame.locator('[data-test="heading"]')).toHaveText(motorShell)
  await expect(frame.locator('[data-test="submodels"]')).toContainText('Nameplate')

  // The explorer pushes its pages (N1): back returns to the list, forward to the shell.
  await page.goBack()
  await expect(page).toHaveURL(listUrl)
  await expect(frame.locator('[data-test="heading"]')).toHaveText('Shells of E2E apps open target')
  await page.goForward()
  await expect(frame.locator('[data-test="heading"]')).toHaveText(motorShell)
  expect(await loaded!.evaluate(() => 'e2eLoaded' in globalThis)).toBe(true)

  // studio.ui.openShell (external apps plan X2): Studio's shell page in the
  // same tab, with the submodel shown in its view; going back returns to the app.
  const explorerUrl = page.url()
  await frame.locator('[data-test="submodels"]').getByText('Nameplate', { exact: true }).click()
  await expect(page).toHaveURL(`/targets/${openTargetId}/shells/${key(motorShell)}?submodel=${key(motorNameplate)}&mode=visualization`)
  await expect(page.locator('iframe[title="App: Digital Nameplate"]')).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(explorerUrl)
  await expect(frame.locator('[data-test="heading"]')).toHaveText(motorShell)

  // studio.ui.openView (ADR 0051): the submodel in the bundled Digital
  // Nameplate view, in Studio's dialog over the app, as its own frame; closing
  // it returns to the same page of the app, which never left.
  await frame.getByRole('button', { name: 'Show Nameplate in its view' }).click()
  const dialog = page.locator('[data-test="app-view-dialog"]')
  await expect(dialog.getByText('Digital Nameplate', { exact: true }).first()).toBeVisible()
  await expect(dialog.locator('iframe[title="App: Digital Nameplate"]')).toBeVisible()
  await expect(dialog.frameLocator('iframe[title="App: Digital Nameplate"]').getByText('Serial number').first()).toBeVisible()
  await expect(page).toHaveURL(explorerUrl)
  await dialog.locator('[data-test="app-view-close"]').click()
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(explorerUrl)
  await expect(frame.locator('[data-test="heading"]')).toHaveText(motorShell)

  // No installed app has a view for the edge cases' submodel: the explorer
  // says so above its list and offers the shell's page instead.
  await page.goBack()
  await frame.getByText('EdgeCasesShell', { exact: true }).click()
  await expect(frame.locator('[data-test="heading"]')).toHaveText('urn:studio:test:aas:edge-cases')
  await frame.getByRole('button', { name: 'Show EdgeCases in its view' }).click()
  const notice = frame.locator('[data-test="notice"]')
  await expect(notice).toContainText('No installed app shows this submodel in a view.')
  await expect(frame.locator('[data-test="submodels"]')).toContainText('EdgeCases')
  await expect(page.locator('[data-test="app-view-dialog"]')).toHaveCount(0)
  await notice.getByRole('button', { name: 'Open in Studio' }).click()
  await expect(page).toHaveURL(`/targets/${openTargetId}/shells/${key('urn:studio:test:aas:edge-cases')}?submodel=${key('urn:studio:test:sm:edge-cases')}&mode=visualization`)

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

/** An app package from a manifest and files given as text. */
function packageOf (manifest: Record<string, unknown>, files: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries([['studio-app.json', strToU8(JSON.stringify({ manifestVersion: 0, publisher: { name: 'Studio tests' }, runtimes: ['hosted', 'desktop'], ...manifest }))], ...Object.entries(files).map(([path, text]) => [path, strToU8(text)])]))
}

/** The bare `studio-sdk/0` handshake of the packages below; `onPort` gets the port. */
const handshake = `parent.postMessage({ protocol: 'studio-sdk/0', type: 'hello' }, '*')
addEventListener('message', event => {
  if (event.source === parent && event.data?.type === 'connect' && event.ports[0]) {
    event.ports[0].start()
    onPort(event.ports[0])
  }
})`

/** A view of nameplates in a given version; "Read" reads the submodel and shows the answer. */
function updatedView (version: string): Uint8Array {
  return packageOf({
    id: 'org.example.updated-view',
    version,
    title: { en: 'Updated view' },
    studioApi: '^0.1.0',
    permissions: ['studio.aas.read'],
    contributes: { submodelViews: [{ id: 'view', title: { en: 'Updated view' }, entry: 'ui/index.html', semanticIds: ['https://admin-shell.io/idta/nameplate/3/0/Nameplate'] }] },
  }, {
    'ui/index.html': `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Updated view</title><script type="module" src="./view.js"></script></head><body><p id="version">connecting</p><button type="button">Read</button><p id="answer"></p></body></html>`,
    'ui/view.js': `function onPort (port) {
  document.querySelector('#version').textContent = 'version ${version}'
  port.addEventListener('message', event => {
    if (event.data.type !== 'context') {
      document.querySelector('#answer').textContent = event.data.type === 'error' ? event.data.problem.code : 'read'
    }
  })
  document.querySelector('button').addEventListener('click', () => port.postMessage({ type: 'request', id: 1, method: 'studio.aas.getSubmodel', params: { submodelId: ${JSON.stringify(motorNameplate)} } }))
}
${handshake}`,
  })
}

test('keeps a view opened in Studio\'s dialog in step with updates of its app (ADR 0051, ADR 0044)', async ({ page }) => {
  const api = await studioApi(page)
  const openerId = await installApp(page, packageOf({
    id: 'org.example.view-opener',
    version: '1.0.0',
    title: { en: 'View opener' },
    studioApi: '^0.1.10',
    permissions: ['studio.ui.navigation'],
    contributes: { modules: [{ id: 'opener', title: { en: 'View opener' }, entry: 'ui/index.html', route: 'opener', context: 'target' }] },
  }, {
    'ui/index.html': `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>View opener</title><script type="module" src="./opener.js"></script></head><body><button type="button">Open view</button></body></html>`,
    'ui/opener.js': `function onPort (port) {
  document.body.dataset.connected = 'true'
  document.querySelector('button').addEventListener('click', () => port.postMessage({ type: 'request', id: 1, method: 'studio.ui.openView', params: { submodelId: ${JSON.stringify(motorNameplate)}, shellId: ${JSON.stringify(motorShell)}, appId: 'org.example.updated-view' } }))
}
${handshake}`,
  }))
  await installApp(page, updatedView('1.0.0'))

  await page.goto(`/targets/${openTargetId}/apps/${openerId}/opener`)
  const opener = appFrame(page, 'View opener')
  await expect(opener.locator('body[data-connected="true"]')).toBeAttached()
  await opener.getByRole('button', { name: 'Open view' }).click()
  const dialog = page.locator('[data-test="app-view-dialog"]')
  const view = dialog.frameLocator('iframe[title="App: Updated view"]')
  await expect(view.locator('#version')).toHaveText('version 1.0.0')
  // A click while the dialog still opens would land on its scrim.
  await waitUntilSettled(dialog.locator('iframe[title="App: Updated view"]'))

  // An update in place while the dialog is open: the view's next call is
  // refused as outdated, and the dialog loads the new version.
  const updated = await api.install(updatedView('1.0.1'))
  expect(updated.status(), await updated.text()).toBe(200)
  await view.getByRole('button', { name: 'Read' }).click()
  await expect(view.locator('#version')).toHaveText('version 1.0.1', { timeout: 30_000 })
  await view.getByRole('button', { name: 'Read' }).click()
  await expect(view.locator('#answer')).toHaveText('read')
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
    webAssembly: expect.stringMatching(/^blocked/),
    blobWorker: expect.stringMatching(/^blocked/),
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

test('changes structure and uploads files through the bridge, only in edit mode (ADR 0049)', async ({ page }) => {
  const installationId = await installApp(page, await zipDirectory(join(fixturesDirectory, 'writer')))
  await page.goto(`/targets/${openTargetId}/apps/${installationId}/writer`)
  const frame = appFrame(page, 'Structure writer')
  const results = async () => JSON.parse(await frame.locator('#results').textContent() ?? '{}') as Record<string, unknown>
  const run = async () => {
    // A click into a frame that is still being placed can be lost.
    await expect(frame.getByRole('button', { name: 'Run' })).toBeEnabled()
    await waitUntilSettled(page.locator('iframe[title="App: Structure writer"]'))
    await frame.getByRole('button', { name: 'Run' }).click()
  }

  // Studio's server refuses structural writes in view mode, whatever the app does.
  await run()
  await expect(frame.locator('body[data-runs="1"]')).toBeAttached({ timeout: 30_000 })
  expect(await results()).toEqual({ error: 'app_edit_mode_required' })

  await setMode(page, 'Edit')
  await run()
  await expect(frame.locator('body[data-runs="2"]')).toBeAttached({ timeout: 30_000 })
  const outcome = await results()
  expect(outcome).toMatchObject({
    created: expect.arrayContaining(['submodel:written', 'shell:written']),
    file: 'FOLDER_1.Readme',
    uploaded: 'text/plain',
    read: 'written by an app',
    stale: 'revision_conflict',
    renamed: 'FOLDER_2',
    children: ['Readme'],
    deleted: expect.arrayContaining(['shell:removed', 'submodel:removed']),
  })

  // Writes and the refusal are audited with the app's identity, without content.
  const client = new pg.Client({ connectionString: 'postgres://studio:studio@localhost:15432/studio' })
  await client.connect()
  try {
    const { rows } = await client.query(
      `select action, outcome, details from audit_events where app_installation_id = $1 order by occurred_at`,
      [installationId],
    )
    const writes = rows.filter(row => row.action === 'target.write' && row.outcome === 'success').map(row => row.details.method)
    expect(writes).toEqual(expect.arrayContaining(['studio.aas.createShell', 'studio.aas.addElement', 'studio.aas.putAttachment', 'studio.aas.putElement', 'studio.aas.deleteShell']))
    expect(rows.find(row => row.details.method === 'studio.aas.putAttachment' && row.outcome === 'success')?.details).toMatchObject({ fileName: 'readme.txt', size: 17, path: 'FOLDER_1.Readme' })
    // Identifiers Studio generated, and an element's path after a rename.
    expect(rows.find(row => row.details.method === 'studio.aas.createShell' && row.outcome === 'success')?.details).toMatchObject({ shellId: outcome.shellId, createdSubmodelIds: [outcome.submodelId] })
    expect(rows.find(row => row.details.method === 'studio.aas.putElement' && row.outcome === 'success')?.details).toMatchObject({ path: 'FOLDER_1', resultPath: 'FOLDER_2' })
    expect(rows.some(row => row.action === 'app.call' && row.details.code === 'app_edit_mode_required')).toBe(true)
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
  await expect(frame.locator('[data-test="summary"]')).toContainText('70 shells', { timeout: 30_000 })
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
