import { copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { chooseFiles, closeStudio, fixture, launchStudio, openPackage } from './support'

test('widens search on the start page and keeps it usable beside package controls at narrow window sizes', async () => {
  const { app, window, directory } = await launchStudio()
  try {
    const bar = window.getByRole('banner')
    const search = bar.getByRole('button', { name: /^Search / })
    const view = bar.getByRole('button', { name: 'View', exact: true })
    const edit = bar.getByRole('button', { name: 'Edit', exact: true })
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
    await edit.click()
    await window.getByRole('treeitem', { name: /^SerialNumber / }).getByText('SerialNumber', { exact: true }).click()
    await window.getByRole('textbox', { name: 'Value', exact: true }).fill('Unsaved serial number')
    await expect(bar.getByText('1 draft', { exact: true })).toBeVisible()

    async function resize (width: number) {
      await app.evaluate(({ BrowserWindow }, width) => {
        const main = BrowserWindow.getAllWindows()[0]!
        main.setContentSize(width, main.getContentSize()[1])
      }, width)
      await expect.poll(() => window.evaluate(() => globalThis.innerWidth)).toBe(width)
    }

    await resize(1544)
    await view.focus()
    await window.keyboard.press('Tab')
    await expect(edit).toBeFocused()
    const narrowSearchWidth = (await search.boundingBox())!.width

    await resize(1545)
    expect.soft((await search.boundingBox())!.width).toBeGreaterThanOrEqual(narrowSearchWidth)
    await expect.soft(edit).toBeFocused({ timeout: 1000 })

    await resize(1544)
    await expect.soft(edit).toBeFocused({ timeout: 1000 })
    expect((await search.boundingBox())!.width).toBe(narrowSearchWidth)

    for (const width of [1280, 1145, 1144, 1024]) {
      await resize(width)

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
