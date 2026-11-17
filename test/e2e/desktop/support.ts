import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect, test } from '@playwright/test'

export const root = fileURLToPath(new URL('../../..', import.meta.url))
export const fixture = join(root, 'test-setup/fixtures/open/IESEDriveMotorDM3000.aasx')

function executablePath (): string {
  if (process.env.STUDIO_E2E_EXECUTABLE) {
    return process.env.STUDIO_E2E_EXECUTABLE
  }
  switch (process.platform) {
    case 'darwin': {
      return join(root, `dist/mac${process.arch === 'arm64' ? '-arm64' : ''}/BaSyx Studio.app/Contents/MacOS/BaSyx Studio`)
    }
    case 'win32': {
      return join(root, 'dist/win-unpacked/BaSyx Studio.exe')
    }
    default: {
      return join(root, 'dist/linux-unpacked/studio')
    }
  }
}

/**
 * Starts the packaged app and waits for its window. A cold start on CI (the
 * first of a job, with the display just up) can take longer than
 * Playwright's 30 seconds, and now and then the app never opens its window:
 * then what it printed is shown, its whole process group is killed (helper
 * processes left over would hold up the worker's teardown), and it is
 * started once more, with the test given the time for it.
 */
async function startWithWindow (directory: string): Promise<{ app: ElectronApplication, window: Page }> {
  const windowTimeout = 60_000
  for (let attempt = 1; ; attempt++) {
    const app = await electron.launch({
      executablePath: executablePath(),
      // macOS: an in-memory keychain, so test runs never prompt for Keychain access.
      // Linux: the Secret Service (CI unlocks a gnome-keyring), never plain text.
      args: process.platform === 'darwin' ? ['--use-mock-keychain'] : (process.platform === 'linux' ? ['--password-store=gnome-libsecret'] : []),
      env: { ...process.env, STUDIO_USER_DATA_DIR: join(directory, 'user-data') },
    })
    const output: string[] = []
    const collect = (chunk: Buffer) => output.push(chunk.toString())
    app.process().stdout?.on('data', collect)
    app.process().stderr?.on('data', collect)
    try {
      const window = await app.firstWindow({ timeout: windowTimeout })
      app.process().stdout?.off('data', collect)
      app.process().stderr?.off('data', collect)
      return { app, window }
    } catch (error) {
      console.warn(`The desktop app opened no window within ${windowTimeout / 1000} s. It printed:\n${output.join('').slice(-4000) || '(nothing)'}`)
      killProcessGroup(app)
      if (attempt >= 2) {
        throw error
      }
      console.warn('Starting it again.')
      test.info().setTimeout(test.info().timeout + windowTimeout + 30_000)
    }
  }
}

/** Kills the app with its helper processes (Playwright starts it as a process group leader, except on Windows). */
function killProcessGroup (app: ElectronApplication): void {
  const { pid } = app.process()
  if (pid === undefined) {
    return
  }
  try {
    process.kill(process.platform === 'win32' ? pid : -pid, 'SIGKILL')
  } catch {
    app.process().kill('SIGKILL')
  }
}

/** Starts the packaged app with a throwaway data directory and waits for the start page. */
export async function launchStudio (): Promise<{ app: ElectronApplication, window: Page, directory: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'studio-e2e-'))
  const { app, window } = await startWithWindow(directory)
  // A new profile starts with the welcome screen over the app; a click skips
  // its intro, and Enter Studio closes it for this start.
  const welcome = window.getByRole('dialog')
  await expect(welcome).toBeVisible({ timeout: 30_000 })
  await welcome.click()
  await welcome.getByRole('button', { name: 'Enter Studio' }).click()
  await expect(welcome).toBeHidden()
  await expect(window.getByRole('heading', { name: 'AAS targets' })).toBeVisible({ timeout: 30_000 })
  return { app, window, directory }
}

/** Closes the app, discarding whatever a test left unsaved. */
export async function closeStudio (app: ElectronApplication | undefined): Promise<void> {
  // None, or one already gone, when launchStudio threw: nothing to close.
  if (!app || app.process().exitCode !== null || app.process().signalCode !== null) {
    return
  }
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox
  })
  await app.close()
}

/** Replaces the native file dialogs in the main process. */
export async function chooseFiles (app: ElectronApplication, open: string, save?: string): Promise<void> {
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [paths.open] })) as typeof dialog.showOpenDialog
    if (paths.save) {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: paths.save })) as typeof dialog.showSaveDialog
    }
  }, { open, save })
}

/** Opens a package and selects the nameplate of its shell. */
export async function openPackage (window: Page): Promise<void> {
  await window.getByRole('button', { name: 'Open AASX file' }).click()
  await expect(window).toHaveURL(/\/targets\/ws-/)
  await window.getByText('Servo Motor DM-3000 (Fraunhofer IESE)').click()
  await window.getByText('Nameplate', { exact: true }).click()
  await expect(window.getByRole('tree').getByText('SerialNumber', { exact: true })).toBeVisible()
}
