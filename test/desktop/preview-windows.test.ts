import { describe, expect, it, vi } from 'vitest'
import { PreviewWindows } from '../../electron/preview-windows'
import { previewWindowRequestSchema, previewWindowUrl } from '../../shared/app-preview-window'

const request = {
  projectId: '564ea626-d0ab-48f8-922d-8655f15b2f92',
  selection: {
    entryKey: 'view:nameplate', targetId: 'target-a',
    shell: { id: 'urn:example:Motor/1', idShort: 'Motor', displayName: [{ language: 'en', text: 'Motor 1' }] },
    submodelId: 'urn:example:Nameplate/1', subPath: '/details?tab=serial',
  },
}

function fakeWindow () {
  let closed: (() => void) | undefined
  return {
    isDestroyed: vi.fn(() => false), isMinimized: vi.fn(() => false),
    restore: vi.fn(), focus: vi.fn(),
    once: vi.fn((_event: 'closed', listener: () => void) => {
      closed = listener
    }),
    close: () => closed?.(),
  }
}

describe('preview windows', () => {
  it('opens only a fixed Studio route and keeps the selection out of its URL', () => {
    const url = new URL(previewWindowUrl('http://127.0.0.1:3001/', request))
    expect(url.origin).toBe('http://127.0.0.1:3001')
    expect(url.pathname).toBe(`/app-builder-preview/${request.projectId}`)
    expect(url.search).toBe('')
    expect(url.hash).toBe('')
  })

  it('rejects invalid or oversized native requests before creating a window', async () => {
    const create = vi.fn(async () => fakeWindow())
    const windows = new PreviewWindows(create)
    for (const invalid of [
      { ...request, projectId: '../settings' },
      { ...request, url: 'https://example.com' },
      { ...request, selection: { ...request.selection, subPath: 'x'.repeat(4001) } },
    ]) {
      await expect(windows.open(invalid)).rejects.toThrow()
    }
    expect(create).not.toHaveBeenCalled()
    expect(previewWindowRequestSchema.safeParse(request).success).toBe(true)
  })

  it('deduplicates simultaneous opens, restores an existing window, and reopens after closing', async () => {
    let resolve!: (window: ReturnType<typeof fakeWindow>) => void
    const create = vi.fn(() => new Promise<ReturnType<typeof fakeWindow>>(done => {
      resolve = done
    }))
    const windows = new PreviewWindows(create)
    const first = windows.open(request)
    const second = windows.open(request)
    const window = fakeWindow()
    resolve(window)
    await Promise.all([first, second])
    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith(request)
    window.isMinimized.mockReturnValue(true)
    await windows.open(request)
    expect(window.restore).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalled()
    window.close()
    create.mockResolvedValue(fakeWindow())
    await windows.open(request)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('retries after a failed open and gives different projects their own windows', async () => {
    const create = vi.fn(async () => fakeWindow()).mockRejectedValueOnce(new Error('load failed'))
    const windows = new PreviewWindows(create)
    await expect(windows.open(request)).rejects.toThrow('load failed')
    await windows.open(request)
    await windows.open({ ...request, projectId: '81c3ec50-62a7-4467-9c93-0446bbc0509a' })
    expect(create).toHaveBeenCalledTimes(3)
  })
})
