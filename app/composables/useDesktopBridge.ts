import type { PreviewSelection, PreviewWindowRequest } from '#shared/app-preview-window'
import type { FileGrant } from '#shared/contract'
import type { FileGrantKind } from '#shared/file-grant-kinds'

/** The native bridge exposed by the Electron preload (electron/preload.ts). */
export interface DesktopBridge {
  /** AASX packages to open; empty when cancelled. */
  chooseAasxFiles: () => Promise<FileGrant[]>
  chooseSaveLocation: (suggestedName: string) => Promise<FileGrant | null>
  /** Files for local BaSyx instances (ADR 0033); empty when cancelled. Absent in older desktop builds. */
  chooseStackFiles?: (kind: FileGrantKind, suggestedName?: string) => Promise<FileGrant[]>
  /** Opens or focuses an app's preview window. Absent in older desktop builds. */
  openAppPreview?: (request: PreviewWindowRequest) => Promise<void>
  getAppPreviewSelection?: () => Promise<PreviewSelection | null>
}

declare global {
  interface Window {
    studioDesktop?: DesktopBridge
  }
}

/** The desktop bridge, or `null` in a browser and during SSR. */
export function useDesktopBridge (): DesktopBridge | null {
  return import.meta.client ? (window.studioDesktop ?? null) : null
}
