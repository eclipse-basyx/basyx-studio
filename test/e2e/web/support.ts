import type { APIRequestContext, Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

export const openTargetUrl = 'http://localhost:18081'
export const securedTargetUrl = 'http://localhost:18082'
export const edgeCasesShell = 'urn:studio:test:aas:edge-cases'
export const edgeCasesSubmodel = 'urn:studio:test:sm:edge-cases'

export function key (value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

/**
 * Waits until an element keeps its place and size for a moment. An app
 * frame grows to its content after it connects (`studio.ui.setHeight`) and
 * the Overview's grid then places it again; Playwright's stability check
 * looks only inside the frame, so a click into a moving frame can land
 * between its mousedown and mouseup and never reach the button.
 */
export async function waitUntilSettled (locator: Locator): Promise<void> {
  let previous = ''
  let unchanged = 0
  await expect.poll(async () => {
    const box = JSON.stringify(await locator.boundingBox())
    unchanged = box === previous ? unchanged + 1 : 0
    previous = box
    return unchanged
  }, { intervals: [150], timeout: 15_000 }).toBeGreaterThanOrEqual(2)
}

/**
 * Waits until Studio's page has hydrated (app/plugins/hydrated.client.ts).
 * A server-rendered page shows its controls before Vue listens to them, and
 * Playwright's `load` comes before that: a click in between is lost.
 */
export async function waitForHydration (page: Page): Promise<void> {
  await page.locator('html[data-hydrated]').waitFor({ state: 'attached' })
}

const hydrating = new WeakSet<Page>()

/**
 * Makes `page.goto` and `page.reload` wait for hydration when they load a
 * Studio page, so a test acts on a page that listens. Pages of other origins
 * (the identity provider, app origins) are left as they load.
 */
export function waitForHydrationOnLoad (page: Page): void {
  if (hydrating.has(page)) {
    return
  }
  hydrating.add(page)
  const studio = new URL(test.info().project.use.baseURL ?? 'http://localhost:3000').origin
  const settle = async () => {
    if (new URL(page.url()).origin === studio) {
      await waitForHydration(page)
    }
  }
  const goto = page.goto.bind(page)
  const reload = page.reload.bind(page)
  page.goto = async (...args) => {
    const response = await goto(...args)
    await settle()
    return response
  }
  page.reload = async (...args) => {
    const response = await reload(...args)
    await settle()
    return response
  }
}

/**
 * TEMPORARY diagnostics (PR 196): clicks into app frames in Studio's
 * full-screen dialog are sometimes lost on CI. Every frame logs where its
 * pointer events land, so a failed test's trace shows which document got
 * them, if any.
 */
const logging = new WeakSet<Page>()
async function logPointerEvents (page: Page): Promise<void> {
  if (logging.has(page)) {
    return
  }
  logging.add(page)
  await page.addInitScript(() => {
    const where = location.host + location.pathname.slice(0, 40)
    const describe = (target: EventTarget | null) => {
      if (!(target instanceof Element)) {
        return String(target)
      }
      const tagged = target.closest<HTMLElement>('[data-test]')?.dataset.test ?? ''
      return `${target.tagName.toLowerCase()}${target.getAttribute('title') ? `[title=${target.getAttribute('title')}]` : ''} ${tagged}`
    }
    for (const type of ['pointerdown', 'pointerup', 'click']) {
      addEventListener(type, event => {
        const { clientX, clientY } = event as MouseEvent
        console.log(`[diag ${where}] ${type} at ${Math.round(clientX)},${Math.round(clientY)} on ${describe(event.target)} | top: ${describe(document.elementFromPoint(clientX, clientY))}`)
      }, true)
    }
  })
}

/** Signs in through the test realm (users' passwords equal their names). */
export async function signIn (page: Page, username: string): Promise<void> {
  await logPointerEvents(page)
  waitForHydrationOnLoad(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.locator('#username').fill(username)
  await page.locator('#password').fill(username)
  await page.locator('#kc-login').click()
  await expect(page.getByRole('heading', { name: 'AAS targets' })).toBeVisible()
  // The identity provider sends the browser back to a page that loads anew.
  await waitForHydration(page)
}

/** Calls the Studio API with the page's session, as the UI does. */
export async function studioApi (page: Page) {
  const request: APIRequestContext = page.request
  const baseURL = new URL(page.url()).origin
  const session = await (await request.get('/api/studio/v1/session')).json() as { csrfToken: string }
  const headers = { 'Origin': baseURL, 'X-CSRF-Token': session.csrfToken }
  return {
    get: (path: string) => request.get(`/api/studio/v1${path}`),
    post: (path: string, data: unknown) => request.post(`/api/studio/v1${path}`, { headers, data }),
    put: (path: string, data: unknown) => request.put(`/api/studio/v1${path}`, { headers, data }),
    delete: (path: string) => request.delete(`/api/studio/v1${path}`, { headers }),
    /** Uploads an app package (developer mode). */
    install: (bytes: Uint8Array) => request.post('/api/studio/v1/app-installations', {
      headers: { ...headers, 'Content-Type': 'application/zip' },
      data: Buffer.from(bytes),
    }),
  }
}

/** Removes every installed app except those shipped with Studio, so each test starts from a known state. */
export async function uninstallAllApps (page: Page): Promise<void> {
  const api = await studioApi(page)
  const list = await (await api.get('/app-installations')).json() as { items: Array<{ id: string, bundled: boolean }> }
  for (const item of list.items.filter(item => !item.bundled)) {
    expect((await api.delete(`/app-installations/${item.id}`)).status()).toBe(204)
  }
}

/** Installs an app package and returns the installation ID. */
export async function installApp (page: Page, bytes: Uint8Array): Promise<string> {
  const response = await (await studioApi(page)).install(bytes)
  expect(response.status(), await response.text()).toBe(201)
  return (await response.json() as { id: string }).id
}

/** Registers a target, replacing one with the same name left over from an earlier run. */
async function registerTarget (page: Page, name: string, url: string, security: unknown, environment = false): Promise<string> {
  const api = await studioApi(page)
  const existing = await (await api.get('/infrastructures')).json() as { items: Array<{ id: string, name: string }> }
  for (const item of existing.items.filter(item => item.name === name)) {
    await api.delete(`/infrastructures/${item.id}`)
  }
  const response = await api.post('/infrastructures', {
    name,
    template: environment ? 'mono-all' : 'full',
    endpoints: environment ? [{ type: 'aasEnvironment', url }] : [{ type: 'aasRepository', url }, { type: 'submodelRepository', url }],
    listSource: 'repository',
    security,
    allowPrivateNetwork: true,
  })
  expect(response.status(), await response.text()).toBe(201)
  return (await response.json() as { id: string }).id
}

export function registerOpenTarget (page: Page, name: string): Promise<string> {
  return registerTarget(page, name, openTargetUrl, { mode: 'unsecured' })
}

/** The open target as an AAS environment: export, upload, element search, history and change feed. */
export function registerOpenEnvironment (page: Page, name: string): Promise<string> {
  return registerTarget(page, name, openTargetUrl, { mode: 'unsecured' }, true)
}

/** Switches the shell browser between view and edit mode. */
export async function setMode (page: Page, mode: 'View' | 'Edit'): Promise<void> {
  await page.getByRole('banner').getByRole('button', { name: mode, exact: true }).click()
}

/**
 * Runs an action of the shell or submodel header: inline where the content
 * area is wide enough, else from its menu (package editing plan, H3).
 */
export async function headerAction (page: Page, name: string): Promise<void> {
  const header = page.getByRole('main').locator('.v-card').first()
  const inline = header.getByRole('button', { name, exact: true })
  const more = header.getByRole('button', { name: 'More actions' })
  await expect(inline.or(more).first()).toBeVisible()
  // The layout follows the drawers: while one opens or closes, an inline
  // action may move into the menu, so a short try falls back to the menu.
  try {
    await inline.click({ timeout: 3000 })
    return
  } catch {
    // Not inline (any more).
  }
  await more.click()
  await page.getByRole('listitem').filter({ hasText: new RegExp(`^${name}$`) }).click()
}

/** The secured target, accessed with Studio's service account (client credentials). */
export function registerSecuredServiceTarget (page: Page, name: string): Promise<string> {
  return registerTarget(page, name, securedTargetUrl, {
    mode: 'deployment_client_credentials',
    issuer: 'http://keycloak.localhost:18080/realms/basyx-studio',
    clientId: 'studio-service',
    scopes: ['basyx-api'],
    clientSecret: { ref: 'env:STUDIO_TESTENV_SERVICE_SECRET' },
  })
}

/** The secured target, accessed with each user's own account (authorization code with PKCE). */
export function registerSecuredUserTarget (page: Page, name: string): Promise<string> {
  return registerTarget(page, name, securedTargetUrl, {
    mode: 'delegated_user',
    issuer: 'http://keycloak.localhost:18080/realms/basyx-studio',
    clientId: 'studio-web',
    scopes: ['openid', 'basyx-api'],
    clientSecret: { ref: 'env:STUDIO_OIDC_CLIENT_SECRET' },
  })
}

/** Sets a property value directly at BaSyx, as another client would. */
export async function setAtSource (request: APIRequestContext, submodelId: string, path: string, value: string): Promise<void> {
  const response = await request.patch(`${openTargetUrl}/submodels/${key(submodelId)}/submodel-elements/${path}/$value`, { data: JSON.stringify(value), headers: { 'Content-Type': 'application/json' } })
  expect(response.status()).toBe(204)
}
