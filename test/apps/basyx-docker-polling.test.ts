import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEngineRequestQueue, startContainerPolling } from '../../app/components/basyx-docker/polling'

describe('BaSyx Docker engine request ordering', () => {
  it('finishes discovery before changing the engine, then probes the new selection', async () => {
    const request = createEngineRequestQueue()
    const events: string[] = []
    let configured = 'engine-a'
    let finishDiscovery!: () => void
    const discoveryPending = new Promise<void>(resolve => {
      finishDiscovery = resolve
    })
    const oldDiscovery = request(async () => {
      events.push('discovery started')
      const snapshot = configured
      await discoveryPending
      events.push('discovery finished')
      return snapshot
    })
    const selection = request(async () => {
      events.push('selection')
      configured = 'engine-b'
      return configured
    })
    const nextDiscovery = request(async () => {
      events.push('next discovery')
      return configured
    })

    await Promise.resolve()
    expect(events).toEqual(['discovery started'])
    expect(configured).toBe('engine-a')
    finishDiscovery()
    expect(await oldDiscovery).toBe('engine-a')
    expect(await selection).toBe('engine-b')
    expect(await nextDiscovery).toBe('engine-b')
    expect(events).toEqual(['discovery started', 'discovery finished', 'selection', 'next discovery'])
  })

  it('returns a failed discovery to its caller without blocking the queued selection', async () => {
    const request = createEngineRequestQueue()
    const error = new Error('Engine probe failed')
    const discovery = request(async () => {
      throw error
    })
    const selection = request(async () => 'engine-b')
    await expect(discovery).rejects.toBe(error)
    expect(await selection).toBe('engine-b')
    expect(await request(async () => 'engine-b refreshed')).toBe('engine-b refreshed')
  })
})

describe('BaSyx Docker automatic engine polling', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function setup () {
    const state = { visible: true, engineRunning: true, jobsRunning: false }
    const options = {
      isVisible: () => state.visible,
      isEngineRunning: () => state.engineRunning,
      hasRunningJobs: () => state.jobsRunning,
      checkEngines: vi.fn(async () => {}),
      refresh: vi.fn(async () => {}),
      followJobs: vi.fn(async () => {}),
      onError: vi.fn(),
    }
    return { state, options }
  }

  it('discovers the engine and instances immediately, then rechecks both every six seconds', async () => {
    const { options } = setup()
    const stop = startContainerPolling(options)
    await vi.advanceTimersByTimeAsync(0)
    expect(options.checkEngines).toHaveBeenCalledTimes(1)
    expect(options.refresh).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5999)
    expect(options.checkEngines).toHaveBeenCalledTimes(1)
    expect(options.refresh).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(options.checkEngines).toHaveBeenCalledTimes(2)
    expect(options.refresh).toHaveBeenCalledTimes(2)
    stop()
  })

  it('follows running jobs every 1.5 seconds without increasing the engine polling rate', async () => {
    const { state, options } = setup()
    state.jobsRunning = true
    const stop = startContainerPolling(options)
    await vi.advanceTimersByTimeAsync(0)
    options.followJobs.mockClear()
    await vi.advanceTimersByTimeAsync(6000)
    expect(options.followJobs).toHaveBeenCalledTimes(4)
    expect(options.refresh).toHaveBeenCalledTimes(5)
    expect(options.checkEngines).toHaveBeenCalledTimes(2)
    stop()
  })

  it('detects an engine stopping, then checks every three seconds until it recovers', async () => {
    const { state, options } = setup()
    let available = true
    options.checkEngines.mockImplementation(async () => {
      state.engineRunning = available
    })
    const stop = startContainerPolling(options)
    await vi.advanceTimersByTimeAsync(0)
    available = false
    await vi.advanceTimersByTimeAsync(6000)
    expect(state.engineRunning).toBe(false)
    expect(options.refresh).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(3000)
    expect(options.checkEngines).toHaveBeenCalledTimes(3)
    available = true
    await vi.advanceTimersByTimeAsync(2999)
    expect(state.engineRunning).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(state.engineRunning).toBe(true)
    expect(options.refresh).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(6000)
    expect(options.checkEngines).toHaveBeenCalledTimes(5)
    stop()
  })

  it('does no work while hidden and performs discovery when first made visible', async () => {
    const { state, options } = setup()
    state.visible = false
    state.jobsRunning = true
    const stop = startContainerPolling(options)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(options.checkEngines).not.toHaveBeenCalled()
    expect(options.refresh).not.toHaveBeenCalled()
    expect(options.followJobs).not.toHaveBeenCalled()
    state.visible = true
    await vi.advanceTimersByTimeAsync(1500)
    expect(options.checkEngines).toHaveBeenCalledTimes(1)
    expect(options.refresh).toHaveBeenCalledTimes(1)
    stop()
  })

  it('does not overlap an in-flight poll or restart after it is stopped', async () => {
    const { options } = setup()
    let finish!: () => void
    options.checkEngines.mockImplementation(() => new Promise<void>(resolve => {
      finish = resolve
    }))
    const stop = startContainerPolling(options)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(options.checkEngines).toHaveBeenCalledTimes(1)
    stop()
    finish()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(options.refresh).not.toHaveBeenCalled()
    expect(options.checkEngines).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not reschedule when stopped during an instance refresh', async () => {
    const { options } = setup()
    let finish!: () => void
    options.refresh.mockImplementation(() => new Promise<void>(resolve => {
      finish = resolve
    }))
    const stop = startContainerPolling(options)
    await vi.advanceTimersByTimeAsync(0)
    stop()
    finish()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(options.refresh).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports an unexpected refresh error and keeps checking automatically', async () => {
    const { options } = setup()
    const error = new Error('Connection interrupted')
    options.refresh.mockRejectedValueOnce(error)
    const stop = startContainerPolling(options)
    await vi.advanceTimersByTimeAsync(0)
    expect(options.onError).toHaveBeenCalledWith(error)
    await vi.advanceTimersByTimeAsync(6000)
    expect(options.checkEngines).toHaveBeenCalledTimes(2)
    expect(options.refresh).toHaveBeenCalledTimes(2)
    stop()
  })
})
