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

    async function expectSearchOpened () {
      const dialog = window.getByRole('dialog')
      const input = dialog.getByRole('textbox')
      await expect(input).toBeFocused()
      // The textbox can autofocus before the opening dialog is ready for Escape.
      await input.click({ trial: true })
      await window.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
    }

    await expect(search).toBeVisible()
    expect((await search.boundingBox())!.width).toBeGreaterThan(560)
    await test.step('exposes a readable search shortcut in the accessible name', async () => {
      const modifier = process.platform === 'darwin' ? 'Command' : 'Ctrl'
      await expect.soft(search).toHaveAccessibleName(`Search targets and actions… Keyboard shortcut: ${modifier} plus K`, { timeout: 1000 })
    })
    await window.keyboard.press('ControlOrMeta+k')
    await expectSearchOpened()

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

    const listToggle = bar.getByRole('button', { name: 'Show or hide the shell list' })
    const targetMenu = bar.getByRole('button', { name: /^Target: Motor diagnostic package/ })
    const titleBarControls = listToggle.or(search).or(targetMenu)

    for (const width of [1280, 1145, 1144, 1024]) {
      await resize(width)
      const iconClasses = width === 1024 ? ['mdi-package-variant-closed', 'mdi-chevron-down'] : []

      await test.step(`keeps the title-bar controls within bounds at ${width} px`, async () => {
        // The title bar can still move after innerWidth changes. Read all
        // related bounds in one renderer call and retry the layout assertion.
        await expect(async () => {
          const { buttons, icons } = await titleBarControls.evaluateAll((elements, expectedIcons) => {
            function bounds (element: Element) {
              const { left, right, width } = element.getBoundingClientRect()
              return { left, right, width }
            }

            // The matched controls are in DOM order: list, search, target.
            const target = elements[2]
            return {
              buttons: elements.map(element => bounds(element)),
              icons: expectedIcons.map(name => {
                const icon = target?.querySelector(`.${name}`)
                return { name, box: icon ? bounds(icon) : null }
              }),
            }
          }, iconClasses)

          expect(buttons).toHaveLength(3)
          const [list, field, target] = buttons
          expect(field!.width).toBeGreaterThan(120)
          expect(field!.left).toBeGreaterThanOrEqual(list!.right)
          expect(field!.right).toBeLessThanOrEqual(target!.left)
          for (const { name, box } of icons) {
            expect(box?.width ?? 0, `${name} width`).toBeGreaterThan(0)
            expect(box!.left, `${name} left edge`).toBeGreaterThanOrEqual(target!.left)
            expect(box!.right, `${name} right edge`).toBeLessThanOrEqual(target!.right)
          }
        }).toPass({ timeout: 5000 })
      })
      await bar.getByRole('button', { name: 'Package actions' }).click({ trial: true })
      await search.click()
      await expectSearchOpened()
    }
  } finally {
    await closeStudio(app)
  }
})
