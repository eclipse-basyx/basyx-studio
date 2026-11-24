import type { ElectronApplication, Page, TestInfo } from '@playwright/test'
import { appendFile, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { expect, test } from '@playwright/test'
import { unzipSync } from 'fflate'
import { chooseFiles, closeStudio, fixture, launchStudio, root } from './support'

async function shim (directory: string, name: string, script: string) {
  await (process.platform === 'win32' ? writeFile(join(directory, `${name}.cmd`), `@"${process.execPath}" "${script}" %*\r\n`) : writeFile(join(directory, name), `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 }))
}

async function setup (info: TestInfo, project: string) {
  const bin = info.outputPath('bin')
  const prompt = info.outputPath('prompt.json')
  // Use the same package built for the web E2E tests, as an app with its
  // existing build output. Studio still runs its own pack and preview steps.
  const files = unzipSync(await readFile(join(root, 'examples/apps/dist/inventory.zip')))
  for (const [path, content] of Object.entries(files)) {
    const file = join(project, path === 'studio-app.json' ? path : `dist/${path}`)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, content)
  }
  await writeFile(join(project, 'package.json'), JSON.stringify({ private: true, scripts: { build: 'node --version' } }))
  await mkdir(join(project, 'node_modules'), { recursive: true })
  await writeFile(join(project, 'node_modules', '.modules.yaml'), '')
  await mkdir(bin, { recursive: true })

  // ACP over stdio, with no account, network, or model dependency. Record
  // what the agent actually received, independently of the Studio transcript.
  const fakeAgent = join(bin, 'agent.mjs')
  await writeFile(fakeAgent, `
import { writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
if (process.argv.includes('--version')) {
  console.log('0.1.0')
  process.exit(0)
}
const send = data => console.log(JSON.stringify({ jsonrpc: '2.0', ...data }))
for await (const line of createInterface({ input: process.stdin })) {
  const { id, method, params } = JSON.parse(line)
  if (id === undefined) continue
  let result = {}
  if (method === 'initialize') result = { protocolVersion: 1, agentCapabilities: {} }
  if (method === 'session/new') result = { sessionId: 'annotations' }
  if (method === 'session/prompt') {
    writeFileSync(${JSON.stringify(prompt)}, JSON.stringify(params.prompt))
    send({ method: 'session/update', params: { sessionId: params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'I received the preview annotations.' } } } })
    result = { stopReason: 'end_turn' }
  }
  send({ id, result })
}
`)
  await shim(bin, 'opencode', fakeAgent)
  await shim(bin, 'studio-app', join(root, 'packages/studio-app-kit/src/cli.ts'))

  const shell = join(bin, 'login-shell')
  if (process.platform !== 'win32') {
    // Keep the test's CLI ahead of any opencode installed by the developer.
    await writeFile(shell, '#!/bin/sh\nprintf "__STUDIO_PATH_START__%s__STUDIO_PATH_END__" "$PATH"\n', { mode: 0o755 })
  }
  const env = { PATH: [bin, process.env.PATH].join(delimiter), SHELL: shell }
  return { prompt, env }
}

async function screenshot (window: Page, info: TestInfo, name: string) {
  if (process.env.STUDIO_ANNOTATION_SCREENSHOTS === '1') {
    await window.screenshot({ path: info.outputPath(`${name}.png`), animations: 'disabled', scale: 'css' })
  }
}

function contrastRatio ([foreground, background]: [string, string]): number {
  const channels = (color: string) => color.match(/\d+(?:\.\d+)?/g)!.map(Number)
  const back = channels(background)
  const ink = channels(foreground)
  const opacity = ink[3] ?? 1
  const luminance = (rgb: number[]) => rgb.slice(0, 3).reduce((sum, channel, index) => {
    const value = channel / 255
    return sum + [0.2126, 0.7152, 0.0722][index]! * (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  }, 0)
  const values = [luminance(ink.slice(0, 3).map((value, index) => value * opacity + back[index]! * (1 - opacity))), luminance(back)]
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05)
}

test.use({ actionTimeout: 15_000 })

test('picks app elements and sends the reviewed notes to the current coding agent', async () => {
  test.setTimeout(150_000)
  const info = test.info()
  const project = await mkdtemp(join(tmpdir(), 'studio-annotation-project-'))
  let app: ElectronApplication | undefined
  try {
    const { prompt, env } = await setup(info, project)
    const launched = await launchStudio(env)
    app = launched.app
    const { window, directory } = launched
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await window.emulateMedia({ colorScheme: 'light' })
    await window.getByRole('listitem', { name: 'Settings', exact: true }).click()
    await window.getByRole('button', { name: 'More rounded', exact: true }).click()
    await window.getByRole('listitem', { name: 'Close settings', exact: true }).click()
    const workspace = join(directory, 'Antrieb.aasx')
    await copyFile(fixture, workspace)
    await chooseFiles(app, workspace)
    await window.getByRole('button', { name: 'Open AASX file' }).click()
    await expect(window).toHaveURL(/\/targets\/ws-/)
    await window.locator('a[href="/app-builder"]').click()
    await window.locator('[data-test="app-builder-new"]').click()
    await window.locator('[data-test="app-builder-new-kind"]').getByRole('button', { name: 'Folder on this computer' }).click()
    await chooseFiles(app, project)
    await window.locator('[data-test="app-builder-new-folder"]').click()
    await window.locator('[data-test="app-builder-new-agent"] div[role="combobox"]').click()
    await window.getByRole('option', { name: 'opencode', exact: true }).click()
    await window.locator('[data-test="app-builder-new-create"]').click()

    await window.locator('[data-test="app-builder-rebuild"]').click()
    await window.locator('[data-test="app-builder-preview-allow"]').click({ timeout: 30_000 })
    await window.locator('[data-test="app-builder-preview-target"] div[role="combobox"]').click()
    await window.getByRole('option', { name: /Antrieb/ }).click()

    const annotate = window.getByRole('button', { name: 'Annotate element' })
    const frame = window.frameLocator('iframe[title="App: Inventory"]')
    const overview = frame.getByRole('tab', { name: 'Overview' })
    const shells = frame.getByRole('tab', { name: 'Shells' })
    const notes = window.locator('[data-test="app-builder-annotation-note"]').getByRole('textbox')
    await expect(annotate).toBeEnabled()
    await expect(overview).toHaveAttribute('aria-selected', 'true')
    await screenshot(window, info, 'preview-light')

    const originalBounds = await frame.owner().boundingBox()
    await annotate.click()
    await expect(window.locator('[data-test="app-builder-picker-surface"]')).toBeVisible()
    expect(await frame.owner().boundingBox()).toEqual(originalBounds)
    const hint = window.locator('[data-test="app-builder-picker-hint"]')
    const hintContrast = async () => contrastRatio(await hint.evaluate(element => {
      const { color, backgroundColor } = getComputedStyle(element)
      return [color, backgroundColor]
    }))
    expect(await hintContrast()).toBeGreaterThanOrEqual(4.5)
    await window.keyboard.press('Shift+Tab')
    await window.keyboard.press('Escape')
    await expect(annotate).toHaveAttribute('aria-pressed', 'false')
    await expect(annotate).toBeFocused()
    await annotate.click()

    async function pointAt (locator: typeof shells) {
      const bounds = (await locator.boundingBox())!
      const x = bounds.x + bounds.width / 2
      const y = bounds.y + bounds.height / 2
      await window.mouse.move(x, y)
      await expect(window.locator('[data-test="app-builder-picker-highlight"]')).toBeVisible()
      return { x, y }
    }

    const tab = await pointAt(shells)
    await screenshot(window, info, 'pick-element-light')
    await window.mouse.click(tab.x, tab.y)
    await expect(overview).toHaveAttribute('aria-selected', 'true')
    await expect(notes).toHaveCount(1)
    await notes.nth(0).fill('Rename this tab to Assets so it fits our terminology.')

    const firstNote = window.locator('[data-test="app-builder-annotation"]').first()
    await expect(firstNote).toContainText('Inventory')
    await expect(window.locator('[data-test="app-builder-annotations"]')).toHaveCSS('border-top-left-radius', '24px')
    const markers = window.locator('[data-test="app-builder-annotation-marker"]')
    await expect(markers).toHaveText('1')
    const firstMarkerContrast = async () => contrastRatio(await markers.first().evaluate(element => [
      getComputedStyle(element.querySelector('text')!).fill,
      getComputedStyle(element.querySelector('circle')!).fill,
    ]))
    expect(await firstMarkerContrast()).toBeGreaterThanOrEqual(4.5)
    const field = (await firstNote.locator('[data-test="app-builder-annotation-note"]').boundingBox())!
    const remove = (await firstNote.getByRole('button', { name: 'Remove annotation' }).boundingBox())!
    expect(Math.abs(field.y + field.height / 2 - (remove.y + remove.height / 2))).toBeLessThan(3)

    // Make both the document and a nested panel scrollable in the fixture.
    await frame.locator('body').evaluate(body => {
      const scroller = document.createElement('div')
      const content = document.createElement('div')
      scroller.id = 'annotation-scroll-probe'
      scroller.style.cssText = 'height: 64px; overflow: auto'
      content.style.height = '1000px'
      scroller.append(content)
      body.querySelector('main')!.append(scroller, content.cloneNode())
    })
    await annotate.click()
    const scroller = frame.locator('#annotation-scroll-probe')
    const scrollBox = (await scroller.boundingBox())!
    await window.mouse.move(scrollBox.x + scrollBox.width / 2, scrollBox.y + scrollBox.height / 2)
    await window.mouse.wheel(0, 100)
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    const frameBox = (await frame.owner().boundingBox())!
    await window.mouse.move(frameBox.x + 20, frameBox.y + 20)
    await window.mouse.wheel(0, 100)
    await expect.poll(() => scroller.evaluate(() => window.scrollY)).toBeGreaterThan(0)
    await window.keyboard.press('ArrowDown')
    await expect(window.locator('[data-test="app-builder-picker-highlight"]')).toBeVisible()
    await window.keyboard.press('Enter')
    await expect(notes).toHaveCount(2)
    await expect(overview).toHaveAttribute('aria-selected', 'true')
    await window.locator('[data-test="app-builder-annotation"]').last().getByRole('button', { name: 'Remove annotation' }).click()
    await expect(notes).toHaveCount(1)
    await annotate.click()
    await window.keyboard.press('ArrowRight')
    await expect(window.locator('[data-test="app-builder-picker-highlight"]')).toBeVisible()
    await window.keyboard.press('Space')
    await expect(notes).toHaveCount(2)
    await window.locator('[data-test="app-builder-annotation"]').last().getByRole('button', { name: 'Remove annotation' }).click()
    await expect(notes).toHaveCount(1)
    await scroller.evaluate(element => {
      element.nextElementSibling?.remove()
      element.remove()
      window.scrollTo(0, 0)
    })

    await annotate.click()
    const counts = await pointAt(frame.locator('[data-test="counts"]').getByText('Instances', { exact: true }))
    await window.mouse.click(counts.x, counts.y)
    await expect(notes).toHaveCount(2)
    await notes.nth(1).fill('Add a short explanation of what counts as an instance.')
    await window.locator('[data-test="app-builder-prompt"]').getByRole('textbox').fill('Make these changes to the inventory preview.')
    await screenshot(window, info, 'review-annotations-light')
    await window.emulateMedia({ colorScheme: 'dark' })
    await expect(window.locator('.v-theme--claude-dark').first()).toBeVisible()
    await expect(markers).toHaveText(['1', '2'])
    expect(await firstMarkerContrast()).toBeGreaterThanOrEqual(4.5)
    await screenshot(window, info, 'review-annotations-dark')

    // A new package invalidates the selection, but retains the user's notes.
    await annotate.click()
    expect(await hintContrast()).toBeGreaterThanOrEqual(4.5)
    await appendFile(join(project, 'dist/ui/index.html'), '\n<!-- next preview build -->\n')
    await window.locator('[data-test="app-builder-rebuild"]').click()
    await expect(window.getByText('From an earlier preview')).toHaveCount(2)
    await expect(annotate).toBeEnabled()
    await expect(annotate).toHaveAttribute('aria-pressed', 'false')
    await expect(notes.nth(0)).toHaveValue(/Rename this tab/)
    await shells.click()
    await expect(shells).toHaveAttribute('aria-selected', 'true')
    await window.getByRole('button', { name: 'Hide the preview', exact: true }).click()
    await expect(window.getByText('From an earlier preview')).toHaveCount(2)

    await window.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(window.getByText('I received the preview annotations.')).toBeVisible({ timeout: 20_000 })
    await expect(notes).toHaveCount(0)
    const blocks = JSON.parse(await readFile(prompt, 'utf8'))
    expect(blocks).toEqual([{ type: 'text', text: expect.stringMatching(/Make these changes[\s\S]+Rename this tab[\s\S]+module:inventory[\s\S]+Preview route: \/\n\s+Element: [\s\S]+Add a short explanation[\s\S]+module:inventory[\s\S]+Preview route: \/\n\s+Element: /) }])
  } finally {
    await closeStudio(app)
    await rm(project, { recursive: true, force: true })
  }
})
