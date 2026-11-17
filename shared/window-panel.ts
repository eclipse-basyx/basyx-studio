/*
 * The desktop window's page panel: the page, and the side list and details
 * drawers beside it, inset in the window's frame (the title bar, the rail
 * and the frame's 4 px end and bottom edges, app/layouts/default.vue). Its
 * outer corners are concentric with the window's own: the window's radius
 * less the inset, so the frame is as wide around a corner as along an edge.
 */

/** The frame's end and bottom edges, in CSS px. */
export const frameInset = 4

/**
 * The radius of the window's corners in CSS px, from Electron's
 * `process.platform` and `process.getSystemVersion()`: macOS 26 rounds
 * windows more than earlier versions, Windows 11 (build 22000 on) rounds
 * them by 8 px and Windows 10 not at all. Linux desktops differ; 12 px keeps
 * the panel's 8 px there.
 */
export function windowCornerRadius (platform: string, systemVersion: string): number {
  const [major = 0, , build = 0] = systemVersion.split('.').map(part => Number.parseInt(part, 10) || 0)
  if (platform === 'darwin') {
    return major >= 26 ? 16 : 10
  }
  if (platform === 'win32') {
    return build >= 22_000 ? 8 : 0
  }
  return 12
}

/** The panel's corner radius in CSS px: concentric with the window's, and never square. */
export function panelRadius (windowRadius: number): number {
  return Math.max(windowRadius - frameInset, 4)
}
