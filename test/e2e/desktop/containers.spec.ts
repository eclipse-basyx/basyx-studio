import type { ElectronApplication, Page } from '@playwright/test'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { engineCandidates, probeEngine, systemDiscoveryEnvironment } from '../../../server/lib/containers/discovery'
import { EngineClient } from '../../../server/lib/containers/engine'
import { chooseFiles, closeStudio, fixture, launchStudio } from './support'

// Opt-in locally; CI enables it on the packaged Linux app. Only resources
// created through this test's own frame are ever removed in cleanup.
test.skip(process.env.STUDIO_CONTAINER_E2E !== '1', 'Set STUDIO_CONTAINER_E2E=1 to run the real-engine desktop flow.')

let app: ElectronApplication | undefined
let window: Page
let directory: string
let engine: EngineClient
const owned = new Set<string>()
const stackLabel = 'org.eclipse.basyx.studio.stack'

test.beforeAll(async () => {
  const candidates = await engineCandidates(systemDiscoveryEnvironment(), null)
  const available = await Promise.all(candidates.map(candidate => probeEngine(candidate)))
  const selected = available.find(candidate => candidate.running)
  test.skip(!selected, 'No local Docker or Podman engine is running.')
  engine = new EngineClient(selected!.host)
  await engine.version()
})

test.afterEach(async () => {
  if (app) {
    await closeStudio(app)
    app = undefined
  }
})

test.afterAll(async () => {
  if (engine) {
    for (const id of owned) {
      for (const container of await engine.listContainers(`${stackLabel}=${id}`)) {
        await engine.removeContainer(container.Id, true)
      }
      for (const network of await engine.listNetworks(`${stackLabel}=${id}`)) {
        await engine.removeNetwork(network.Name)
      }
      for (const volume of await engine.listVolumes(`${stackLabel}=${id}`)) {
        await engine.removeVolume(volume.Name)
      }
    }
    await engine.close()
  }
})

test('creates, changes, exports, imports, retains and opens an instance through the native Studio page', async () => {
  test.setTimeout(900_000)
  const launched = await launchStudio()
  app = launched.app
  window = launched.window
  directory = launched.directory
  window.on('pageerror', error => console.error('Desktop page error:', error.message))
  window.on('console', message => {
    if (message.type() === 'error') {
      console.error('Desktop console error:', message.text())
    }
  })
  window.on('response', response => {
    if (response.url().endsWith('/containers/createStack')) {
      void response.json().then(body => {
        if (body.stack?.id) {
          owned.add(body.stack.id)
        }
      }).catch(() => {})
    }
  })
  await window.getByRole('link', { name: 'Local Servers', exact: true }).click()
  await window.locator('[data-test="new"]').click()
  await window.locator('[data-test="next"]').click()
  await window.locator('[data-test="name"] input').fill('Desktop container regression')
  await window.locator('[data-test="persistence-keep"] input').check()
  // Use a different block from the manager integration suite if both run locally.
  await window.locator('[data-test="advanced"]').getByRole('button').click()
  await window.getByLabel('Ports', { exact: true }).press('ArrowDown')
  await window.getByRole('option').filter({ hasText: 'Fixed ports from' }).click()
  await window.getByLabel('First port', { exact: true }).fill('19100')
  await chooseFiles(app, fixture)
  await window.locator('[data-test="add-aasx"]').click()
  await window.locator('[data-test="next"]').click()
  await expect(window.locator('[data-test="summary"]')).toContainText('Desktop container regression')
  await window.locator('[data-test="submit"]').click()
  await expect(window.locator('[data-test="wizard"]')).toHaveCount(0, { timeout: 15_000 })
  const card = window.locator('[data-test^="stack-"]').filter({ hasText: 'Desktop container regression' })
  await expect(card.locator('[data-test="status"]')).toHaveText('Running', { timeout: 300_000 })

  await card.locator('[data-test="menu"]').click()
  await window.getByText('Change settings', { exact: true }).click()
  await window.locator('[data-test="next"]').click()
  await window.locator('[data-test="name"] input').fill('Desktop container regression renamed')
  await window.locator('[data-test="next"]').click()
  await expect(window.locator('[data-test="summary"]')).toContainText('renamed')
  await window.locator('[data-test="submit"]').click()
  await expect(window.locator('[data-test="wizard"]')).toHaveCount(0, { timeout: 15_000 })
  await expect(card.locator('[data-test="status"]')).toHaveText('Running', { timeout: 300_000 })

  const exported = join(directory, 'basyx-export.zip')
  await chooseFiles(app, fixture, exported)
  await card.locator('[data-test="menu"]').click()
  await window.getByText('Export', { exact: true }).click()
  await expect(card.getByText(/contains passwords and all instance data/)).toBeVisible()
  await card.getByRole('button', { name: 'Export', exact: true }).click()
  await expect.poll(async () => access(exported).then(() => true, () => false), { timeout: 30_000 }).toBe(true)

  await card.locator('[data-test="stop"]').click()
  await expect(card.locator('[data-test="status"]')).toHaveText('Stopped', { timeout: 30_000 })
  await card.locator('[data-test="start"]').click()
  await expect(card.locator('[data-test="status"]')).toHaveText('Running', { timeout: 300_000 })
  await card.locator('[data-test="menu"]').click()
  await window.getByText('Delete', { exact: true }).click()
  // Keep the data: the entry must remain recoverable.
  await window.getByRole('dialog').locator('[data-test="remove-confirm-button"]').click()
  await expect(card.locator('[data-test="status"]')).toHaveText('Removed outside Studio', { timeout: 30_000 })
  await card.getByRole('button', { name: 'Create again', exact: true }).click()
  await expect(card.locator('[data-test="status"]')).toHaveText('Running', { timeout: 300_000 })

  await chooseFiles(app, exported)
  await window.locator('[data-test="import"]').click()
  await expect(window.locator('[data-test="summary"]')).toContainText('renamed')
  await window.getByRole('button', { name: 'Cancel', exact: true }).click()

  // Keep screenshot evidence with the test report at the planned widths.
  for (const width of [1440, 768, 375]) {
    await window.setViewportSize({ width, height: 900 })
    await window.screenshot({ path: test.info().outputPath(`containers-${width}.png`), fullPage: true })
  }
  await window.setViewportSize({ width: 1440, height: 900 })
  await expect(window.locator('[data-test="new"]')).toBeVisible({ timeout: 20_000 })
  await window.getByRole('button', { name: 'Toggle theme', exact: true }).click()
  await expect(window.locator('[data-test="new"]')).toBeVisible({ timeout: 20_000 })
  await expect(card.locator('.v-card').first()).toHaveCSS('background-color', 'rgb(33, 33, 33)')
  await window.screenshot({ path: test.info().outputPath('containers-dark.png'), fullPage: true })
  await card.locator('[data-test="open"]').click()
  await expect(window).toHaveURL(/\/targets\//)
})

test('keeps the native page visible when Studio changes theme and viewport', async () => {
  const launched = await launchStudio()
  app = launched.app
  window = launched.window
  window.on('pageerror', error => console.error('Desktop page error:', error.message))
  window.on('console', message => {
    if (message.type() === 'error') {
      console.error('Desktop console error:', message.text())
    }
  })
  await window.getByRole('link', { name: 'Local Servers', exact: true }).click()
  await expect(window.locator('[data-test="new"]')).toBeVisible()

  const engineFooter = window.locator('[data-test="engine-footer"]')
  const engineSelector = engineFooter.locator('[data-test="engine"]')
  const engineHost = window.locator('[data-test="engine-host"] input')
  await expect(engineSelector).toHaveText(/^\S+ · running$/)
  await engineFooter.locator('.text-body-medium').click()
  await expect(engineHost).toBeHidden()
  await engineSelector.locator('.v-btn__content').click()
  await expect(engineHost).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(engineHost).toBeHidden()

  for (const width of [768, 375, 1440]) {
    await window.setViewportSize({ width, height: 900 })
    await expect(window.locator('[data-test="new"]')).toBeVisible({ timeout: 20_000 })
  }
  await window.getByRole('button', { name: 'Toggle theme', exact: true }).click()
  await window.screenshot({ path: test.info().outputPath('theme-change.png'), fullPage: true })
  await expect(window.locator('[data-test="new"]')).toBeVisible({ timeout: 20_000 })
})
