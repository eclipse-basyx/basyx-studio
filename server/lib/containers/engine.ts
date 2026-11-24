import type { Dispatcher } from 'undici'
import { Agent } from 'undici'

// Client for the Docker Engine REST API, which Docker and Podman both serve
// on a local socket or named pipe (ADR 0033). Only the calls Studio needs.

export class EngineError extends Error {
  constructor (readonly status: number, message: string) {
    super(message)
    this.name = 'EngineError'
  }
}

/** The engine could not be reached at all (no socket, refused, timed out). */
export class EngineUnreachable extends Error {
  constructor (message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'EngineUnreachable'
  }
}

/** `unix:///path` → `/path`; `npipe:////./pipe/name` → `\\.\pipe\name`. */
export function socketPathOf (host: string): string {
  if (host.startsWith('unix://')) {
    return host.slice('unix://'.length)
  }
  if (host.startsWith('npipe://')) {
    return host.slice('npipe://'.length).replaceAll('/', '\\')
  }
  throw new Error(`Unsupported engine host: ${host}`)
}

export interface EngineVersion {
  version: string
  apiVersion: string
  os: string
  arch: string
  /** True when the engine identifies itself as Podman. */
  podman: boolean
}

export interface EngineSystemInfo {
  operatingSystem: string
  name: string
}

export interface ContainerSummary {
  Id: string
  Names: string[]
  Image: string
  State: string
  Status: string
  Labels: Record<string, string>
}

export interface ContainerDetails {
  Id: string
  Name: string
  Image?: string
  Config: { Image: string, Labels: Record<string, string> | null }
  State: { Status: string, Running: boolean, ExitCode: number, Health?: { Status: string } | null }
  RestartCount: number
}

export interface PullProgress {
  current: number
  total: number
}

export interface CreateContainerConfig {
  Image: string
  Cmd?: string[]
  Env?: string[]
  Labels: Record<string, string>
  ExposedPorts?: Record<string, Record<string, never>>
  Healthcheck?: { Test: string[], Interval: number, Timeout: number, Retries: number, StartPeriod?: number }
  HostConfig: {
    PortBindings?: Record<string, Array<{ HostIp: string, HostPort: string }>>
    RestartPolicy?: { Name: 'no' | 'unless-stopped' }
    Mounts?: Array<{ Type: 'volume', Source: string, Target: string }>
    NetworkMode?: string
  }
  NetworkingConfig?: { EndpointsConfig: Record<string, { Aliases: string[] }> }
}

interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>
  json?: unknown
  body?: Uint8Array
  contentType?: string
  /** Default 30 s; `0` for none (long waits and streams). */
  timeoutMs?: number
}

/** Strips the 8-byte frame headers of a non-TTY log stream. */
export function demultiplex (buffer: Uint8Array): string {
  const decoder = new TextDecoder()
  let offset = 0
  let text = ''
  while (offset + 8 <= buffer.length) {
    const type = buffer[offset]!
    if (type > 2 || buffer[offset + 1] !== 0 || buffer[offset + 2] !== 0 || buffer[offset + 3] !== 0) {
      // Not multiplexed (TTY containers): the bytes are the log itself.
      return decoder.decode(buffer)
    }
    const size = ((buffer[offset + 4]! << 24) >>> 0) + (buffer[offset + 5]! << 16) + (buffer[offset + 6]! << 8) + buffer[offset + 7]!
    text += decoder.decode(buffer.subarray(offset + 8, offset + 8 + size))
    offset += 8 + size
  }
  return text
}

/** Docker omits docker.io and library from official image references. */
export function canonicalRepository (reference: string): string {
  return reference.replace(/^docker.io\//, '').replace(/^library\//, '')
}

/** Decodes Docker's binary exec stream without mixing stderr into a backup. */
export function execOutput (buffer: Uint8Array): { stdout: Uint8Array, stderr: string } {
  const out: Uint8Array[] = []
  const errors: Uint8Array[] = []
  let offset = 0
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) {
      throw new Error('Incomplete engine exec frame.')
    }
    const size = new DataView(buffer.buffer, buffer.byteOffset + offset + 4, 4).getUint32(0)
    const end = offset + 8 + size
    if (end > buffer.length) {
      throw new Error('Incomplete engine exec output.')
    }
    const target = buffer[offset] === 1 ? out : errors
    target.push(buffer.subarray(offset + 8, end))
    offset = end
  }
  return { stdout: new Uint8Array(Buffer.concat(out)), stderr: Buffer.concat(errors).toString('utf8') }
}

/** Sums the layer progress of a pull, as the CLI does. */
export class PullTracker {
  readonly #layers = new Map<string, PullProgress>()

  update (event: { id?: string, status?: string, progressDetail?: { current?: number, total?: number } }): PullProgress {
    if (event.id && event.progressDetail?.total) {
      const previous = this.#layers.get(event.id)
      const downloading = event.status === 'Downloading'
      this.#layers.set(event.id, {
        total: event.progressDetail.total,
        current: downloading ? (event.progressDetail.current ?? 0) : (previous?.current ?? 0),
      })
    } else if (event.id && ['Download complete', 'Pull complete', 'Already exists'].includes(event.status ?? '')) {
      const previous = this.#layers.get(event.id)
      if (previous) {
        this.#layers.set(event.id, { total: previous.total, current: previous.total })
      }
    }
    let current = 0
    let total = 0
    for (const layer of this.#layers.values()) {
      current += Math.min(layer.current, layer.total)
      total += layer.total
    }
    return { current, total }
  }
}

export class EngineClient {
  readonly #agent: Agent
  #prefix = ''
  #connected: Promise<EngineVersion> | null = null

  constructor (readonly host: string) {
    this.#agent = new Agent({ connect: { socketPath: socketPathOf(host) }, keepAliveTimeout: 10_000 })
  }

  async close (): Promise<void> {
    await this.#agent.close().catch(() => {})
  }

  /**
   * Reads the engine's version once, so later calls use its API version. An
   * engine that stops answering is asked again on the next call.
   */
  connect (): Promise<EngineVersion> {
    this.#connected ??= this.version().catch(error => {
      this.#connected = null
      throw error
    })
    return this.#connected
  }

  /** Reads the version and uses the engine's API version for every later call. */
  async version (): Promise<EngineVersion> {
    const { data } = await this.#request<{ Version: string, ApiVersion: string, Os: string, Arch: string, Components?: Array<{ Name: string }> }>('GET', '/version', { timeoutMs: 5000 })
    this.#prefix = `/v${data.ApiVersion}`
    return {
      version: data.Version,
      apiVersion: data.ApiVersion,
      os: data.Os,
      arch: data.Arch,
      podman: (data.Components ?? []).some(component => /podman/i.test(component.Name)),
    }
  }

  async info (): Promise<EngineSystemInfo> {
    const { data } = await this.#request<{ OperatingSystem?: string, Name?: string }>('GET', '/info', { timeoutMs: 10_000 })
    return { operatingSystem: data.OperatingSystem ?? '', name: data.Name ?? '' }
  }

  async listContainers (label: string): Promise<ContainerSummary[]> {
    const { data } = await this.#request<ContainerSummary[]>('GET', '/containers/json', { query: { all: true, filters: JSON.stringify({ label: [label] }) } })
    return data
  }

  /** Published host ports of every running container, also those not from Studio. */
  async publishedPorts (): Promise<number[]> {
    const { data } = await this.#request<Array<{ Ports?: Array<{ PublicPort?: number }> }>>('GET', '/containers/json')
    return data.flatMap(container => (container.Ports ?? []).map(port => port.PublicPort).filter((port): port is number => typeof port === 'number'))
  }

  async inspectContainer (id: string): Promise<ContainerDetails | null> {
    try {
      return (await this.#request<ContainerDetails>('GET', `/containers/${encodeURIComponent(id)}/json`)).data
    } catch (error) {
      if (error instanceof EngineError && error.status === 404) {
        return null
      }
      throw error
    }
  }

  async createContainer (name: string, config: CreateContainerConfig): Promise<string> {
    const { data } = await this.#request<{ Id: string }>('POST', '/containers/create', { query: { name }, json: config })
    return data.Id
  }

  /** Extracts a tar archive into the container's file system below `path`. */
  async putArchive (id: string, path: string, archive: Uint8Array): Promise<void> {
    await this.#request('PUT', `/containers/${encodeURIComponent(id)}/archive`, { query: { path }, body: archive, contentType: 'application/x-tar' })
  }

  async startContainer (id: string): Promise<void> {
    try {
      await this.#request('POST', `/containers/${encodeURIComponent(id)}/start`)
    } catch (error) {
      // 304: already running.
      if (!(error instanceof EngineError && error.status === 304)) {
        throw error
      }
    }
  }

  async stopContainer (id: string, seconds = 10): Promise<void> {
    try {
      await this.#request('POST', `/containers/${encodeURIComponent(id)}/stop`, { query: { t: seconds }, timeoutMs: (seconds + 30) * 1000 })
    } catch (error) {
      if (!(error instanceof EngineError && (error.status === 304 || error.status === 404))) {
        throw error
      }
    }
  }

  /** Waits until the container stops and returns its exit code. */
  async waitContainer (id: string, timeoutMs: number): Promise<number> {
    const { data } = await this.#request<{ StatusCode: number }>('POST', `/containers/${encodeURIComponent(id)}/wait`, { timeoutMs })
    return data.StatusCode
  }

  async removeContainer (id: string, removeVolumes: boolean): Promise<void> {
    try {
      await this.#request('DELETE', `/containers/${encodeURIComponent(id)}`, { query: { force: true, v: removeVolumes } })
    } catch (error) {
      if (!(error instanceof EngineError && error.status === 404)) {
        throw error
      }
    }
  }

  async logs (id: string, tail: number): Promise<string> {
    const response = await this.#send('GET', `/containers/${encodeURIComponent(id)}/logs`, { query: { stdout: true, stderr: true, tail } })
    const bytes = new Uint8Array(await response.body.arrayBuffer())
    if (response.statusCode >= 400) {
      throw new EngineError(response.statusCode, new TextDecoder().decode(bytes))
    }
    return demultiplex(bytes)
  }

  /** A transactionally consistent backup, using the database image's own tool. */
  async dumpDatabase (id: string): Promise<Uint8Array> {
    return this.#exec(id, ['pg_dump', '--username=basyx', '--dbname=basyx', '--format=custom', '--no-owner', '--no-privileges'])
  }

  /** Restores only inside the labelled database container selected by the manager. */
  async restoreDatabase (id: string, archive: Uint8Array): Promise<void> {
    await this.putArchive(id, '/tmp', archive)
    await this.#exec(id, ['pg_restore', '--username=basyx', '--dbname=basyx', '--clean', '--if-exists', '--no-owner', '--no-privileges', '--exit-on-error', '/tmp/studio-database.dump'])
  }

  /** Locks a mutable tag to its registry digest for repeatable restart/export. */
  async imageDigest (reference: string, repository?: string): Promise<string> {
    const { data } = await this.#request<{ RepoDigests?: string[] }>('GET', `/images/${encodeURIComponent(reference)}/json`)
    const name = repository ?? (reference.includes('@') ? reference.split('@', 1)[0]! : reference.slice(0, reference.lastIndexOf(':')))
    const found = data.RepoDigests?.find(digest => canonicalRepository(digest.split('@', 1)[0]!) === canonicalRepository(name))
    if (!found && !reference.includes('@')) {
      throw new EngineError(409, 'The downloaded image has no registry digest. Choose the tested image channel.')
    }
    return found?.slice(found.indexOf('@') + 1) ?? reference.slice(reference.indexOf('@') + 1)
  }

  async imageExists (reference: string): Promise<boolean> {
    try {
      await this.#request('GET', `/images/${encodeURIComponent(reference)}/json`)
      return true
    } catch (error) {
      if (error instanceof EngineError && error.status === 404) {
        return false
      }
      throw error
    }
  }

  /** Pulls an image (`repo:tag` or `repo@sha256:…`), reporting summed layer progress. */
  async pullImage (reference: string, onProgress: (progress: PullProgress) => void): Promise<void> {
    const at = reference.indexOf('@')
    const colon = reference.lastIndexOf(':')
    const query = at > 0
      ? { fromImage: reference }
      : { fromImage: reference.slice(0, colon), tag: reference.slice(colon + 1) }
    const response = await this.#send('POST', '/images/create', { query, timeoutMs: 0 })
    if (response.statusCode >= 400) {
      const text = await response.body.text()
      let message = text
      try {
        message = (JSON.parse(text) as { message?: string }).message ?? text
      } catch {
        // Not JSON: the text is the message.
      }
      throw new EngineError(response.statusCode, message)
    }
    const tracker = new PullTracker()
    const decoder = new TextDecoder()
    let pending = ''
    for await (const chunk of response.body) {
      pending += decoder.decode(chunk as Uint8Array, { stream: true })
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) {
          continue
        }
        let event: { id?: string, status?: string, error?: string, errorDetail?: { message?: string }, progressDetail?: { current?: number, total?: number } }
        try {
          event = JSON.parse(line)
        } catch {
          continue
        }
        if (event.error || event.errorDetail) {
          throw new EngineError(500, event.errorDetail?.message ?? event.error ?? 'The download failed.')
        }
        onProgress(tracker.update(event))
      }
    }
  }

  async networkExists (name: string): Promise<boolean> {
    try {
      await this.#request('GET', `/networks/${encodeURIComponent(name)}`)
      return true
    } catch (error) {
      if (error instanceof EngineError && error.status === 404) {
        return false
      }
      throw error
    }
  }

  async createNetwork (name: string, labels: Record<string, string>): Promise<void> {
    await this.#request('POST', '/networks/create', { json: { Name: name, Driver: 'bridge', Labels: labels } })
  }

  async listNetworks (label: string): Promise<Array<{ Id: string, Name: string, Labels: Record<string, string> | null }>> {
    const { data } = await this.#request<Array<{ Id: string, Name: string, Labels: Record<string, string> | null }>>('GET', '/networks', { query: { filters: JSON.stringify({ label: [label] }) } })
    return data
  }

  async removeNetwork (name: string): Promise<void> {
    try {
      await this.#request('DELETE', `/networks/${encodeURIComponent(name)}`)
    } catch (error) {
      if (!(error instanceof EngineError && error.status === 404)) {
        throw error
      }
    }
  }

  async createVolume (name: string, labels: Record<string, string>): Promise<void> {
    await this.#request('POST', '/volumes/create', { json: { Name: name, Labels: labels } })
  }

  async listVolumes (label: string): Promise<Array<{ Name: string, Labels: Record<string, string> | null }>> {
    const { data } = await this.#request<{ Volumes: Array<{ Name: string, Labels: Record<string, string> | null }> | null }>('GET', '/volumes', { query: { filters: JSON.stringify({ label: [label] }) } })
    return data.Volumes ?? []
  }

  async removeVolume (name: string): Promise<void> {
    try {
      await this.#request('DELETE', `/volumes/${encodeURIComponent(name)}`, { query: { force: true } })
    } catch (error) {
      if (!(error instanceof EngineError && error.status === 404)) {
        throw error
      }
    }
  }

  async #exec (containerId: string, command: string[]): Promise<Uint8Array> {
    const { data } = await this.#request<{ Id: string }>('POST', `/containers/${encodeURIComponent(containerId)}/exec`, {
      json: { AttachStdout: true, AttachStderr: true, Tty: false, Cmd: command },
    })
    const response = await this.#send('POST', `/exec/${encodeURIComponent(data.Id)}/start`, { json: { Detach: false, Tty: false }, timeoutMs: 300_000 })
    const bytes = new Uint8Array(await response.body.arrayBuffer())
    if (response.statusCode >= 400) {
      throw new EngineError(response.statusCode, new TextDecoder().decode(bytes))
    }
    const output = execOutput(bytes)
    const result = await this.#request<{ ExitCode: number | null, Running: boolean }>('GET', `/exec/${encodeURIComponent(data.Id)}/json`)
    if (result.data.Running || result.data.ExitCode !== 0) {
      throw new EngineError(500, output.stderr || 'The database backup or restore did not complete.')
    }
    return output.stdout
  }

  async #send (method: Dispatcher.HttpMethod, path: string, options: RequestOptions = {}): Promise<Dispatcher.ResponseData> {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) {
        query.set(key, String(value))
      }
    }
    const search = query.size > 0 ? `?${query}` : ''
    const timeout = options.timeoutMs ?? 30_000
    const headers: Record<string, string> = {}
    let body: string | Uint8Array | undefined
    if (options.json !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(options.json)
    } else if (options.body) {
      headers['content-type'] = options.contentType ?? 'application/octet-stream'
      body = options.body
    }
    try {
      return await this.#agent.request({
        origin: 'http://localhost',
        path: `${this.#prefix}${path}${search}`,
        method,
        headers,
        body,
        headersTimeout: timeout,
        bodyTimeout: timeout,
      })
    } catch (error) {
      this.#connected = null
      throw new EngineUnreachable(error instanceof Error ? error.message : String(error), { cause: error })
    }
  }

  async #request<T = unknown> (method: Dispatcher.HttpMethod, path: string, options: RequestOptions = {}): Promise<{ status: number, data: T }> {
    const response = await this.#send(method, path, options)
    const bytes = new Uint8Array(await response.body.arrayBuffer())
    const text = new TextDecoder().decode(bytes)
    if (response.statusCode >= 400) {
      let message = text.trim()
      try {
        message = (JSON.parse(text) as { message?: string }).message ?? message
      } catch {
        // Not JSON: the text is the message.
      }
      throw new EngineError(response.statusCode, message || `HTTP ${response.statusCode}`)
    }
    if (!text) {
      return { status: response.statusCode, data: undefined as T }
    }
    try {
      return { status: response.statusCode, data: JSON.parse(text) as T }
    } catch {
      return { status: response.statusCode, data: text as T }
    }
  }
}
