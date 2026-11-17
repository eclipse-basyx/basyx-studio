import type { PreviewSelection, PreviewWindowRequest } from '../shared/app-preview-window'
// The renderer's only native bridge (SEC-009). Its calls let the user pick
// files in a native dialog and return opaque, single-use handles; the
// renderer never sees a native path.
import type { FileGrantKind } from '../shared/file-grant-kinds'
import { contextBridge, ipcRenderer } from 'electron'
import { windowCornerRadius } from '../shared/window-panel'

export interface StudioFileGrant {
  handle: string
  fileName: string
}

export interface StudioDesktopBridge {
  /** AASX packages to open; empty when cancelled. */
  chooseAasxFiles: () => Promise<StudioFileGrant[]>
  chooseSaveLocation: (suggestedName: string) => Promise<StudioFileGrant | null>
  /** Files for local BaSyx instances (ADR 0033); empty when cancelled. */
  chooseStackFiles: (kind: FileGrantKind, suggestedName?: string) => Promise<StudioFileGrant[]>
  /** Opens or focuses the separate preview window of this app. */
  openAppPreview: (request: PreviewWindowRequest) => Promise<void>
  /** Initial selection of this preview window; null in the main window. */
  getAppPreviewSelection: () => Promise<PreviewSelection | null>
  /** Colours of the window controls in the title bar (Windows, Linux), as `#RRGGBB`. */
  setTitleBarColors: (colors: { color: string, symbolColor: string }) => Promise<void>
  /** Radius of the window's corners in CSS px, for the page's panel inset in it (shared/window-panel.ts). */
  windowCornerRadius: number
}

const bridge: StudioDesktopBridge = {
  chooseAasxFiles: () => ipcRenderer.invoke('studio:choose-aasx-files'),
  chooseSaveLocation: suggestedName => ipcRenderer.invoke('studio:choose-save-location', String(suggestedName).slice(0, 255)),
  chooseStackFiles: (kind, suggestedName) => ipcRenderer.invoke('studio:choose-stack-files', kind, String(suggestedName ?? '').slice(0, 255)),
  openAppPreview: request => ipcRenderer.invoke('studio:open-app-preview', request),
  getAppPreviewSelection: () => ipcRenderer.invoke('studio:get-app-preview-selection'),
  setTitleBarColors: colors => ipcRenderer.invoke('studio:set-title-bar-colors', { color: String(colors.color), symbolColor: String(colors.symbolColor) }),
  windowCornerRadius: windowCornerRadius(process.platform, process.getSystemVersion()),
}

contextBridge.exposeInMainWorld('studioDesktop', bridge)
