import { copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { chooseFiles, closeStudio, fixture, launchStudio, openPackage } from './support'

test('widens search on the start page and keeps it usable beside package controls at narrow window sizes', async () => {
  const { app, window, directory } = await launchStudio()
  try {
    const bar = window.getByRole('banner')
    const search = bar.getByRole('button', { name: /^Search / })
    await expect(search).toBeVisible()
    expect((await search.boundingBox())!.width).toBeGreaterThan(560)
    await window.keyboard.press('ControlOrMeta+k')
    await expect(window.getByRole('dialog').getByRole('textbox')).toBeFocused()
    await window.keyboard.press('Escape')
    await expect(window.getByRole('dialog')).toBeHidden()

    const path = join(directory, 'Motor diagnostic package with a deliberately long file name.aasx')
    await copyFile(fixture, path)
    await chooseFiles(app, path)
    await openPackage(window)
    await bar.getByRole('button', { name: 'Edit', exact: true }).click()
    await window.getByRole('treeitem', { name: /^SerialNumber / }).getByText('SerialNumber', { exact: true }).click()
    await window.getByRole('textbox', { name: 'Value', exact: true }).fill('Unsaved serial number')
    await expect(bar.getByText('1 draft', { exact: true })).toBeVisible()

    for (const width of [1280, 1145, 1144, 1024]) {
      await app.evaluate(({ BrowserWindow }, width) => {
        const main = BrowserWindow.getAllWindows()[0]!
        main.setContentSize(width, main.getContentSize()[1])
      }, width)
      await expect.poll(() => window.evaluate(() => globalThis.innerWidth)).toBe(width)

      const before = bar.getByRole('button', { name: 'Show or hide the shell list' })
      const after = bar.getByRole('button', { name: /^Target: Motor diagnostic package/ })
      const [list, field, target] = await Promise.all([before, search, after].map(button => button.boundingBox()))
      expect(field!.width).toBeGreaterThan(120)
      expect(field!.x).toBeGreaterThanOrEqual(list!.x + list!.width)
      expect(field!.x + field!.width).toBeLessThanOrEqual(target!.x)
      await bar.getByRole('button', { name: 'Package actions' }).click({ trial: true })
      await search.click()
      await expect(window.getByRole('dialog').getByRole('textbox')).toBeFocused()
      await window.keyboard.press('Escape')
      await expect(window.getByRole('dialog')).toBeHidden()
    }
  } finally {
    await closeStudio(app)
  }
})
