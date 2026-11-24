import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { build } from 'esbuild'
import { appContentSecurityPolicy } from '../../../server/lib/apps/csp'
import { previewPickerProtocol } from '../../../shared/app-preview-picker'

test('picks an element inside a cross-origin sandbox without activating it', async ({ page }) => {
  const host = 'http://preview-host.test'
  const guest = 'http://preview-app.test'
  const entry = '/ui/index.html'
  const picker = await build({
    entryPoints: [fileURLToPath(new URL('../../../app/runtime/preview-element-picker.ts', import.meta.url))],
    bundle: true,
    write: false,
    format: 'iife',
  }).then(result => result.outputFiles[0]!.text)

  await page.route(`${host}/`, route => route.fulfill({ contentType: 'text/html', body: `<iframe sandbox="allow-scripts allow-same-origin" src="${guest}${entry}"></iframe>` }))
  await page.route(`${guest}${entry}`, route => route.fulfill({
    contentType: 'text/html',
    headers: { 'Content-Security-Policy': appContentSecurityPolicy(`${guest}/`, [host], {}, { sameOrigin: true }) },
    body: '<!doctype html><script src="/picker.js"></script><button id="export"><span>Export</span></button><output>0</output><script src="/app.js"></script>',
  }))
  await page.route(`${guest}/picker.js`, route => route.fulfill({ contentType: 'text/javascript', body: picker }))
  await page.route(`${guest}/app.js`, route => route.fulfill({
    contentType: 'text/javascript',
    body: 'document.querySelector("button").addEventListener("click", () => document.querySelector("output").value++)',
  }))

  await page.goto(host)
  const frame = page.frameLocator('iframe')
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
  await expect(page.locator('body')).toHaveAttribute('data-element', JSON.stringify({ tag: 'button', path: 'body > button:nth-of-type(1)' }))
  await expect(frame.locator('output')).toHaveText('0')
  await button.click()
  await expect(frame.locator('output')).toHaveText('1')
})
