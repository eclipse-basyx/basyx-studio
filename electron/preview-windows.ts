import type { PreviewWindowRequest } from '../shared/app-preview-window'
import { previewWindowRequestSchema } from '../shared/app-preview-window'

interface PreviewWindow {
  isDestroyed: () => boolean
  isMinimized: () => boolean
  restore: () => void
  focus: () => void
  once: (event: 'closed', listener: () => void) => unknown
}

/** One independent window per app, including while the first window is loading. */
export class PreviewWindows<T extends PreviewWindow> {
  readonly #windows = new Map<string, Promise<T>>()

  constructor (readonly create: (request: PreviewWindowRequest) => Promise<T>) {}

  async open (input: unknown): Promise<void> {
    const request = previewWindowRequestSchema.parse(input)
    let opening = this.#windows.get(request.projectId)
    if (!opening) {
      opening = this.create(request)
      this.#windows.set(request.projectId, opening)
      opening.then(window => {
        window.once('closed', () => {
          if (this.#windows.get(request.projectId) === opening) {
            this.#windows.delete(request.projectId)
          }
        })
      }).catch(() => {
        if (this.#windows.get(request.projectId) === opening) {
          this.#windows.delete(request.projectId)
        }
      })
    }
    const window = await opening
    if (window.isDestroyed()) {
      this.#windows.delete(request.projectId)
      return this.open(request)
    }
    if (window.isMinimized()) {
      window.restore()
    }
    window.focus()
  }
}
