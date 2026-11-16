interface ContainerPolling {
  isVisible: () => boolean
  isEngineRunning: () => boolean
  hasRunningJobs: () => boolean
  checkEngines: () => Promise<void>
  refresh: () => Promise<void>
  followJobs: () => Promise<void>
  onError: (error: unknown) => void
}

/** Discovery can update the backend cache, so it must finish before selection. */
export function createEngineRequestQueue () {
  let pending = Promise.resolve()
  return <T>(request: () => Promise<T>): Promise<T> => {
    const result = pending.then(request)
    pending = result.then(() => {}, () => {})
    return result
  }
}

/** Follows jobs quickly and refreshes engine discovery with the ordinary list. */
export function startContainerPolling (options: ContainerPolling): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  let initialized = false
  let ticks = 0

  async function poll () {
    try {
      if (!options.isVisible()) {
        return
      }
      const recheck = !initialized || !options.isEngineRunning() || ++ticks >= 4
      if (recheck) {
        await options.checkEngines()
        ticks = 0
        initialized = true
      }
      if (stopped || !options.isEngineRunning()) {
        return
      }
      const running = options.hasRunningJobs()
      if (running) {
        await options.followJobs()
      }
      if (!stopped && (recheck || running)) {
        await options.refresh()
      }
    } catch (error) {
      if (!stopped) {
        options.onError(error)
      }
    } finally {
      // Schedule only after the request finishes, including initial discovery.
      if (!stopped) {
        timer = setTimeout(() => void poll(), options.isEngineRunning() ? 1500 : 3000)
      }
    }
  }

  void poll()
  return () => {
    stopped = true
    clearTimeout(timer)
  }
}
