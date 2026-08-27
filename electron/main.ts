import type { ChildProcess } from 'node:child_process'
import type { AddressInfo } from 'node:net'

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'

import { app, BrowserWindow, dialog, session } from 'electron'

const launchSecretHeader = 'X-Studio-Launch-Secret'
const loopbackHost = '127.0.0.1'
const serviceStartupTimeoutMs = 15_000

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
    server.close((error) => error ? reject(error) : resolve())
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

async function startStudioService (): Promise<{ launchSecret: string, url: string }> {
  const serverEntry = join(app.getAppPath(), '.output', 'server', 'index.mjs')
  if (!existsSync(serverEntry)) {
    throw new Error('The packaged Studio Service entry point is missing.')
  }

  const port = await findAvailablePort()
  const launchSecret = randomBytes(32).toString('base64url')
  const url = `http://${loopbackHost}:${port}/`

  studioService = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NITRO_HOST: loopbackHost,
      NITRO_PORT: String(port),
      STUDIO_LAUNCH_SECRET: launchSecret,
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

async function createWindow (url: string, launchSecret?: string): Promise<void> {
  const rendererSession = session.fromPartition('studio')

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
    },
  })

  const allowedOrigin = new URL(url).origin
  win.webContents.on('will-navigate', (event, targetUrl) => {
    if (new URL(targetUrl).origin !== allowedOrigin) {
      event.preventDefault()
    }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.once('ready-to-show', () => win.show())

  await win.loadURL(url)
  if (!app.isPackaged) {
    win.webContents.openDevTools()
  }
}

async function start (): Promise<void> {
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

app.whenReady().then(start).catch(handleStartupError)

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && rendererUrl) {
    void createWindow(rendererUrl, rendererLaunchSecret).catch(handleStartupError)
  }
})

app.on('before-quit', () => {
  isQuitting = true
  studioService?.kill()
  studioService = undefined
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
