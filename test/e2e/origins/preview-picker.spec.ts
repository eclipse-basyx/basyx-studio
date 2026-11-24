import type { Locator, Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { build } from 'esbuild'
import { appContentSecurityPolicy } from '../../../server/lib/apps/csp'
import { previewPickerProtocol } from '../../../shared/app-preview-picker'

const host = 'http://preview-host.test'
const guest = 'http://preview-app.test'
const entry = '/ui/index.html'

async function sandboxedPreview (page: Page, body: string, script = '', css = '') {
  const picker = await build({
    entryPoints: [fileURLToPath(new URL('../../../app/runtime/preview-element-picker.ts', import.meta.url))],
    bundle: true,
    write: false,
    format: 'iife',
  }).then(result => result.outputFiles[0]!.text)

  await page.route(`${host}/`, route => route.fulfill({ contentType: 'text/html', body: `<iframe sandbox="allow-scripts allow-same-origin" width="420" height="360" src="${guest}${entry}"></iframe>` }))
  await page.route(`${guest}${entry}`, route => route.fulfill({
    contentType: 'text/html',
    headers: { 'Content-Security-Policy': appContentSecurityPolicy(`${guest}/`, [host], {}, { sameOrigin: true }) },
    body: `<!doctype html><link rel="stylesheet" href="/app.css">${body}<script src="/picker.js"></script><script src="/app.js"></script>`,
  }))
  await page.route(`${guest}/picker.js`, route => route.fulfill({ contentType: 'text/javascript', body: picker }))
  await page.route(`${guest}/app.js`, route => route.fulfill({ contentType: 'text/javascript', body: script }))
  await page.route(`${guest}/app.css`, route => route.fulfill({ contentType: 'text/css', body: css }))

  await page.goto(host)
  return page.frameLocator('iframe')
}

test('picks an element inside a cross-origin sandbox without activating it', async ({ page }) => {
  const frame = await sandboxedPreview(page, '<button id="export"><span>Export</span></button><output>0</output>',
    'document.querySelector("button").addEventListener("click", () => document.querySelector("output").value++)')
  const button = frame.getByText('Export', { exact: true })
  await expect(button).toBeVisible()
  expect(await page.locator('iframe').evaluate(iframe => (iframe as HTMLIFrameElement).contentDocument)).toBeNull()

  await page.evaluate(({ origin, protocol }) => {
    const iframe = document.querySelector('iframe')!
    const remote = iframe.contentWindow!
    const overlay = document.createElement('div')
    const bounds = iframe.getBoundingClientRect()
    overlay.id = 'picker-overlay'
    overlay.style.cssText = `position: fixed; inset: ${bounds.top}px auto auto ${bounds.left}px; width: ${bounds.width}px; height: ${bounds.height}px;`
    document.body.append(overlay)
    window.addEventListener('message', event => {
      if (event.source === remote && event.origin === origin && event.data.session === 'test-session') {
        if (event.data.type === 'pick') {
          document.body.dataset.element = JSON.stringify(event.data.element)
          overlay.remove()
        } else if (event.data.type === 'hover') {
          document.body.dataset.highlight = String(event.data.rect?.width ?? 0)
        }
      }
    })
    let request = 0
    const inspect = (type: string, event: MouseEvent) => remote.postMessage({
      protocol, type, session: 'test-session', request: ++request,
      x: event.clientX - bounds.left - iframe.clientLeft,
      y: event.clientY - bounds.top - iframe.clientTop,
    }, origin)
    overlay.addEventListener('pointermove', event => inspect('hover', event))
    overlay.addEventListener('click', event => inspect('pick', event))
  }, { origin: guest, protocol: previewPickerProtocol })

  const bounds = (await button.boundingBox())!
  const x = bounds.x + bounds.width / 2
  const y = bounds.y + bounds.height / 2
  await page.mouse.move(x, y)
  await expect(page.locator('body')).toHaveAttribute('data-highlight', /^[1-9]/)
  await page.mouse.click(x, y)
  await expect.poll(async () => JSON.parse(await page.locator('body').getAttribute('data-element') ?? 'null')).toMatchObject({ tag: 'button', path: 'body > button:nth-of-type(1)' })
  await expect(frame.locator('output')).toHaveText('0')
  await button.click()
  await expect(frame.locator('output')).toHaveText('1')
})

async function listenForPicker (page: Page) {
  await page.evaluate(origin => {
    const remote = document.querySelector('iframe')!.contentWindow!
    window.addEventListener('message', event => {
      if (event.source === remote && event.origin === origin && event.data.session === 'test-session') {
        document.body.dataset[event.data.type] = JSON.stringify(event.data)
      }
    })
  }, guest)
}

async function pickerRequest (page: Page, message: object) {
  await page.evaluate(({ message, origin, protocol }) => {
    document.querySelector('iframe')!.contentWindow!.postMessage({ ...message, protocol, session: 'test-session' }, origin)
  }, { message, origin: guest, protocol: previewPickerProtocol })
}

async function pickerReply<T> (page: Page, type: string): Promise<T | null> {
  return JSON.parse(await page.locator('body').getAttribute(`data-${type}`) ?? 'null') as T | null
}

function center (locator: Locator) {
  return locator.evaluate(element => {
    const rect = element.getBoundingClientRect()
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  })
}

test('markers follow their original element through layout, reorder, clipping, and removal', async ({ page }) => {
  const frame = await sandboxedPreview(page, `
    <details><summary>Details</summary><div></div></details><header>Above the panel</header>
    <section><button>Alpha</button><button>Beta</button><p></p></section>`, '',
  'details div { height: 100px } header { height: 46px } section { height: 70px; overflow: auto } button { display: block; height: 30px } p { height: 140px }')
  const alpha = frame.getByRole('button', { name: 'Alpha' })
  await listenForPicker(page)
  await pickerRequest(page, { type: 'pick', request: 1, ...await center(alpha) })
  await expect.poll(() => pickerReply(page, 'pick')).not.toBeNull()
  const picked = (await pickerReply<{ element: { markerId: string } }>(page, 'pick'))!.element
  await pickerRequest(page, { type: 'markers', request: 2, markers: [{ number: 1, id: picked.markerId }] })
  const markers = async () => (await pickerReply<{ markers: { number: number, rect: { y: number, height: number } }[] }>(page, 'markers'))?.markers ?? []
  const markerY = async () => (await markers())[0]?.rect.y
  const expectedY = () => alpha.evaluate(button => button.getBoundingClientRect().top)
  await expect.poll(markerY).toBe(await expectedY())

  await frame.getByRole('button', { name: 'Beta' }).evaluate(button => {
    button.parentElement!.prepend(button)
    window.dispatchEvent(new Event('resize'))
  })
  await expect.poll(markerY, { message: 'the marker follows Alpha after the rows reorder' }).toBe(await expectedY())

  await frame.locator('details').evaluate(details => {
    details.open = true
  })
  await expect.poll(markerY, { message: 'the marker follows a layout shift without scrolling or resizing the window' }).toBe(await expectedY())

  const panel = frame.locator('section')
  await panel.evaluate(element => {
    element.scrollTop = 45
  })
  await expect.poll(markerY).toBe(await panel.evaluate(element => element.getBoundingClientRect().top))
  await expect.poll(async () => (await markers())[0]?.rect.height).toBe(15)
  await panel.evaluate(element => {
    element.scrollTop = 80
  })
  await expect.poll(markers).toHaveLength(0)

  await alpha.evaluate(button => button.replaceWith(button.cloneNode(true)))
  await panel.evaluate(element => {
    element.scrollTop = 0
  })
  await pickerRequest(page, { type: 'markers', request: 3, markers: [{ number: 1, id: picked.markerId }] })
  await expect.poll(() => pickerReply(page, 'markers')).toMatchObject({ request: 3, markers: [] })
})

test('picks deeply nested elements and only highlights locators within the length limit', async ({ page }) => {
  const wrap = (depth: number, text: string) => `${'<div>'.repeat(depth)}<button>${text}</button>${'</div>'.repeat(depth)}`
  const frame = await sandboxedPreview(page, `${wrap(40, 'Deep')}${wrap(120, 'Too deep')}`)
  await listenForPicker(page)
  await pickerRequest(page, { type: 'pick', request: 1, ...await center(frame.getByRole('button', { name: 'Deep', exact: true })) })
  await expect.poll(() => pickerReply(page, 'pick')).toMatchObject({ element: { tag: 'button', path: expect.stringContaining('button:nth-of-type(1)') } })
  await pickerRequest(page, { type: 'hover', request: 2, ...await center(frame.getByRole('button', { name: 'Too deep', exact: true })) })
  await expect.poll(() => pickerReply(page, 'hover')).toMatchObject({ request: 2, rect: null })
})
