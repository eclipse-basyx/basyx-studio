import type { ChildProcess } from 'node:child_process'
import type { AddressInfo } from 'node:net'

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'

import { app, BrowserWindow, dialog, ipcMain, protocol, safeStorage, session, shell } from 'electron'

const launchSecretHeader = 'X-Studio-Launch-Secret'
const brokerSecretHeader = 'X-Studio-Broker-Secret'
const loopbackHost = '127.0.0.1'
const serviceStartupTimeoutMs = 15_000
const aasxFilters = [{ name: 'AASX package', extensions: ['aasx'] }]

// Installed apps run in sandboxed frames on their own origin (ADR 0017):
// studio-app://<installation>/<path>. The scheme is standard and secure so
// that module scripts, CORS and CSP work as on the hosted apps origin.
const appScheme = 'studio-app'
const installationIdPattern = /^app-[0-9a-f]{16}$/
protocol.registerSchemesAsPrivileged([
  { scheme: appScheme, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
])

// Authenticates this process to the Studio Service when it turns a path the
// user chose into a file grant. Unlike the launch secret, the renderer never
// receives it. `nuxt dev` shares it through the environment (modules/desktop-dev.ts).
const brokerSecret = process.env.STUDIO_BROKER_SECRET ?? randomBytes(32).toString('base64url')

let rendererUrl: string | undefined
let rendererLaunchSecret: string | undefined
let studioService: ChildProcess | undefined
let isQuitting = false

function validateDevServerUrl (value: string): string {
  const url = new URL(value)
  const allowedHosts = new Set(['127.0.0.1', '::1', 'localhost'])

  if (url.protocol !== 'http:' || !allowedHosts.has(url.hostname)) {
    throw new Error('The Electron development server URL must use HTTP on loopback.')
  }

  return url.href
}

async function findAvailablePort (): Promise<number> {
  const server = createServer()

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, loopbackHost, resolve)
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Could not allocate a loopback port for the Studio Service.')
  }

  const port = (address as AddressInfo).port
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
  })

  return port
}

async function waitForStudioService (
  url: string,
  launchSecret: string,
  child: ChildProcess,
): Promise<void> {
  const deadline = Date.now() + serviceStartupTimeoutMs
  let spawnError: Error | undefined
  const captureSpawnError = (error: Error) => {
    spawnError = error
  }

  child.once('error', captureSpawnError)

  try {
    while (Date.now() < deadline) {
      if (spawnError) {
        throw spawnError
      }
      if (child.exitCode !== null) {
        throw new Error(`The Studio Service exited during startup with code ${child.exitCode}.`)
      }

      try {
        const response = await fetch(url, {
          headers: { [launchSecretHeader]: launchSecret },
          signal: AbortSignal.timeout(1000),
        })

        if (response.ok) {
          return
        }
      } catch {
        // The service has not started listening yet.
      }

      await new Promise(resolve => setTimeout(resolve, 100))
    }
  } finally {
    child.off('error', captureSpawnError)
  }

  throw new Error('Timed out while starting the local Studio Service.')
}

/**
 * The key that encrypts tokens and stored secrets in the local database. It is
 * generated once and kept only encrypted by the OS credential store
 * (Keychain, DPAPI, libsecret/kwallet) through Electron safeStorage.
 */
async function loadDataKey (): Promise<string> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('The operating system credential store is not available.')
  }
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
    throw new Error('No supported credential store (libsecret or kwallet) was found. BaSyx Studio does not store keys in plain text.')
  }
  const keyFile = join(app.getPath('userData'), 'data-key.bin')
  if (existsSync(keyFile)) {
    return safeStorage.decryptString(await readFile(keyFile))
  }
  const key = randomBytes(32).toString('base64url')
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(keyFile, safeStorage.encryptString(key), { mode: 0o600 })
  return key
}

async function startStudioService (): Promise<{ launchSecret: string, url: string }> {
  const serverEntry = join(app.getAppPath(), '.output', 'server', 'index.mjs')
  if (!existsSync(serverEntry)) {
    throw new Error('The packaged Studio Service entry point is missing.')
  }

  const port = await findAvailablePort()
  const launchSecret = randomBytes(32).toString('base64url')
  const url = `http://${loopbackHost}:${port}/`

  const dataKey = await loadDataKey()

  studioService = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NITRO_HOST: loopbackHost,
      NITRO_PORT: String(port),
      NUXT_STUDIO_DEPLOYMENT_MODE: 'desktop',
      STUDIO_DATA_DIR: join(app.getPath('userData'), 'studio-data'),
      STUDIO_DATA_KEY: dataKey,
      STUDIO_LAUNCH_SECRET: launchSecret,
      STUDIO_BROKER_SECRET: brokerSecret,
      // Backend apps run in the bundled Deno (electron-builder extraResources).
      STUDIO_DENO_PATH: join(process.resourcesPath, 'deno', process.platform === 'win32' ? 'deno.exe' : 'deno'),
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  })

  await waitForStudioService(url, launchSecret, studioService)
  studioService.once('exit', (code, signal) => {
    if (isQuitting) {
      return
    }

    dialog.showErrorBox(
      'BaSyx Studio Service stopped',
      `The local Studio Service exited unexpectedly (${signal ?? code ?? 'unknown reason'}).`,
    )
    app.quit()
  })
  return { launchSecret, url }
}

const isolatedSessions = new WeakSet<Electron.Session>()

/**
 * Serves app files under `studio-app:` from the Studio Service, which hands
 * them only to this process (broker secret), and keeps apps contained:
 * frames may only navigate within their own installation, and nothing but
 * the Studio page may request device permissions.
 */
function isolateApps (rendererSession: Electron.Session, url: string, launchSecret?: string): void {
  if (isolatedSessions.has(rendererSession)) {
    return
  }
  isolatedSessions.add(rendererSession)
  const rendererOrigin = new URL(url).origin

  rendererSession.protocol.handle(appScheme, async request => {
    const target = new URL(request.url)
    if (request.method !== 'GET' || !installationIdPattern.test(target.hostname)) {
      return new Response(null, { status: 404 })
    }
    const response = await fetch(new URL(`app/${target.hostname}${target.pathname}`, url), {
      headers: {
        [brokerSecretHeader]: brokerSecret,
        ...(launchSecret ? { [launchSecretHeader]: launchSecret } : {}),
      },
    })
    // fetch has already decoded the body.
    const headers = new Headers(response.headers)
    headers.delete('content-encoding')
    headers.delete('content-length')
    return new Response(response.body, { status: response.status, headers })
  })

  rendererSession.setPermissionRequestHandler((_contents, _permission, callback, details) => {
    callback(new URL(details.requestingUrl).origin === rendererOrigin)
  })
  rendererSession.setPermissionCheckHandler((_contents, _permission, requestingOrigin) => requestingOrigin === rendererOrigin)
}

/** Subframes may load app entries and stay within their installation; nothing else. */
function guardFrameNavigation (win: BrowserWindow, url: string): void {
  const rendererOrigin = new URL(url).origin
  win.webContents.on('will-frame-navigate', event => {
    if (event.isMainFrame) {
      return
    }
    const next = new URL(event.url)
    const current = event.frame?.url ? new URL(event.frame.url) : null
    const allowed = next.origin === rendererOrigin
      || (next.protocol === `${appScheme}:` && (current?.protocol !== `${appScheme}:` || current.hostname === next.hostname))
    if (!allowed) {
      event.preventDefault()
    }
  })
}

async function createWindow (url: string, launchSecret?: string): Promise<void> {
  const rendererSession = session.fromPartition('studio')
  isolateApps(rendererSession, url, launchSecret)

  if (launchSecret) {
    rendererSession.webRequest.onBeforeSendHeaders(
      { urls: [`${url}*`] },
      (details, callback) => {
        callback({
          requestHeaders: {
            ...details.requestHeaders,
            [launchSecretHeader]: launchSecret,
          },
        })
      },
    )
  }

  const win = new BrowserWindow({
    show: false,
    title: 'BaSyx Studio',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      session: rendererSession,
      preload: join(import.meta.dirname, 'preload.cjs'),
    },
  })
  guardUnsavedWorkspaces(win)
  guardFrameNavigation(win, url)

  const allowedOrigin = new URL(url).origin
  win.webContents.on('will-navigate', (event, targetUrl) => {
    if (new URL(targetUrl).origin !== allowedOrigin) {
      event.preventDefault()
    }
  })
  // IdP sign-in for targets runs in the system browser (RFC 8252); the
  // renderer never opens other windows.
  win.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    const protocol = new URL(targetUrl).protocol
    if (protocol === 'https:' || protocol === 'http:') {
      void shell.openExternal(targetUrl)
    }
    return { action: 'deny' }
  })
  win.once('ready-to-show', () => win.show())

  await win.loadURL(url)
  if (!app.isPackaged) {
    win.webContents.openDevTools()
  }
}

/** Calls a Studio Service endpoint reserved for this process. */
async function callService<T> (path: string, init: { method?: string, body?: unknown } = {}): Promise<T> {
  if (!rendererUrl) {
    throw new Error('The Studio Service is not running.')
  }
  const response = await fetch(new URL(`api/studio/v1/${path}`, rendererUrl), {
    method: init.method ?? 'GET',
    headers: {
      [brokerSecretHeader]: brokerSecret,
      ...(rendererLaunchSecret ? { [launchSecretHeader]: rendererLaunchSecret } : {}),
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) {
    throw new Error(`The Studio Service answered with HTTP ${response.status}.`)
  }
  return await response.json() as T
}

/** Only the Studio page in a Studio window may use the native bridge. */
function isTrustedSender (event: Electron.IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame
  return Boolean(rendererUrl && frame && frame === event.sender.mainFrame
    && new URL(frame.url).origin === new URL(rendererUrl).origin)
}

function registerDesktopBridge (): void {
  ipcMain.handle('studio:choose-aasx-file', async event => {
    if (!isTrustedSender(event)) {
      throw new Error('Untrusted sender.')
    }
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = { properties: ['openFile' as const], filters: aasxFilters }
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) {
      return null
    }
    return callService('desktop/file-grants', { method: 'POST', body: { path: result.filePaths[0], purpose: 'open' } })
  })

  ipcMain.handle('studio:choose-save-location', async (event, suggestedName: unknown) => {
    if (!isTrustedSender(event)) {
      throw new Error('Untrusted sender.')
    }
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = { defaultPath: typeof suggestedName === 'string' ? suggestedName.replaceAll(/[/\\]/g, '_') : undefined, filters: aasxFilters }
    const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) {
      return null
    }
    const path = result.filePath.toLowerCase().endsWith('.aasx') ? result.filePath : `${result.filePath}.aasx`
    return callService('desktop/file-grants', { method: 'POST', body: { path, purpose: 'save' } })
  })
}

/** Asks before a window with unsaved workspace changes closes. */
function guardUnsavedWorkspaces (win: BrowserWindow): void {
  let confirmed = false
  win.on('close', event => {
    if (confirmed) {
      return
    }
    event.preventDefault()
    // Preventing a close also cancels a running quit, so resume it afterwards.
    const quitting = isQuitting
    void callService<{ unsavedWorkspaces: string[] }>('desktop/state')
      .then(state => state.unsavedWorkspaces)
      .catch(() => [])
      .then(async unsaved => {
        if (unsaved.length > 0) {
          const { response } = await dialog.showMessageBox(win, {
            type: 'warning',
            buttons: ['Cancel', 'Close without saving'],
            defaultId: 0,
            cancelId: 0,
            message: 'Some packages have unsaved changes.',
            detail: unsaved.join('\n'),
          })
          if (response !== 1) {
            isQuitting = false
            return
          }
        }
        confirmed = true
        if (quitting) {
          app.quit()
        } else {
          win.close()
        }
      })
  })
}

async function start (): Promise<void> {
  registerDesktopBridge()

  const devServerUrl = process.env.VITE_DEV_SERVER_URL

  if (!app.isPackaged) {
    if (!devServerUrl) {
      throw new Error('The Electron development server URL is missing.')
    }

    rendererUrl = validateDevServerUrl(devServerUrl)
    await createWindow(rendererUrl)
    return
  }

  const production = await startStudioService()
  rendererUrl = production.url
  rendererLaunchSecret = production.launchSecret
  await createWindow(rendererUrl, rendererLaunchSecret)
}

function handleStartupError (error: unknown): void {
  const message = error instanceof Error ? error.message : 'Unknown startup error.'
  dialog.showErrorBox('BaSyx Studio could not start', message)
  app.quit()
}

// End-to-end tests run the packaged app against a throwaway data directory.
if (process.env.STUDIO_USER_DATA_DIR) {
  app.setPath('userData', process.env.STUDIO_USER_DATA_DIR)
}

// Only one instance may own the local database and its data directory.
if (app.requestSingleInstanceLock()) {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows()
    if (window) {
      if (window.isMinimized()) {
        window.restore()
      }
      window.focus()
    }
  })
  app.whenReady().then(start).catch(handleStartupError)
} else {
  app.quit()
}

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && rendererUrl) {
    void createWindow(rendererUrl, rendererLaunchSecret).catch(handleStartupError)
  }
})

app.on('before-quit', () => {
  isQuitting = true
})

// Windows close first (and may ask about unsaved workspaces), then the service stops.
app.on('will-quit', () => {
  studioService?.kill()
  studioService = undefined
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
