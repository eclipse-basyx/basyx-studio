import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect } from '@playwright/test'

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

/** Starts the packaged app with a throwaway data directory and waits for the start page. */
export async function launchStudio (): Promise<{ app: ElectronApplication, window: Page, directory: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'studio-e2e-'))
  const app = await electron.launch({
    executablePath: executablePath(),
    // macOS: an in-memory keychain, so test runs never prompt for Keychain access.
    // Linux: the Secret Service (CI unlocks a gnome-keyring), never plain text.
    args: process.platform === 'darwin' ? ['--use-mock-keychain'] : (process.platform === 'linux' ? ['--password-store=gnome-libsecret'] : []),
    env: { ...process.env, STUDIO_USER_DATA_DIR: join(directory, 'user-data') },
  })
  const window = await app.firstWindow()
  await expect(window.getByRole('heading', { name: 'AAS targets' })).toBeVisible({ timeout: 30_000 })
  return { app, window, directory }
}

/** Closes the app, discarding whatever a test left unsaved. */
export async function closeStudio (app: ElectronApplication): Promise<void> {
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
