import { describe, expect, it } from 'vitest'
import { frameInset, panelRadius, windowCornerRadius } from '#shared/window-panel'

describe('window panel', () => {
  it('reads the window\'s corner radius from the platform and its version', () => {
    expect(windowCornerRadius('darwin', '26.1.0')).toBe(16)
    expect(windowCornerRadius('darwin', '27.0')).toBe(16)
    expect(windowCornerRadius('darwin', '15.6.1')).toBe(10)
    expect(windowCornerRadius('win32', '10.0.26100')).toBe(8)
    expect(windowCornerRadius('win32', '10.0.19045')).toBe(0)
    expect(windowCornerRadius('linux', '6.8.0')).toBe(12)
    expect(windowCornerRadius('darwin', '')).toBe(10)
  })

  it('rounds the panel concentric with the window, inset by the frame', () => {
    expect(panelRadius(16)).toBe(16 - frameInset)
    expect(panelRadius(8)).toBe(4)
    expect(panelRadius(12)).toBe(8)
    // Windows 10's square windows: the panel stays slightly rounded.
    expect(panelRadius(0)).toBe(4)
  })
})
