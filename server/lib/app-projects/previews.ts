import type { AppContributions, AppPreview, ConversationEvent, PreviewConsent } from '#shared/contract'
import type { BuildResult } from './build'
import type { AppManifest } from '@basyx/studio-sdk/protocol'
import { sandboxOrigins } from '@basyx/studio-app-kit/manifest'
import { StudioProblem } from '../problem'

// A project's preview (ADR 0054, plan B1–B4): Studio builds the folder,
// and installs the package as a preview of its own, which only the App
// Builder's preview pane shows. What the package asks for beyond the last
// preview waits for the user's OK.

/** The preview's app ID: the app's own ID with `.preview`, so it never replaces the app. */
export function previewAppId (appId: string): string {
  return `${appId}.preview`
}

/** What `next` asks for beyond `previous` (plan B4); `null` when nothing new. */
export function consentFor (previous: AppManifest | null, next: AppManifest): PreviewConsent | null {
  const before = new Set<string>()
  const after: string[] = []
  const describe = (manifest: AppManifest) => [
    ...manifest.permissions.map(permission => `permission ${permission}`),
    ...Object.entries(sandboxOrigins(manifest)).flatMap(([kind, origins]) => origins.map(origin => `${kind} ${origin}`)),
    ...(manifest.sandbox?.webAssembly ? ['WebAssembly'] : []),
    ...(manifest.sandbox?.workers ? ['workers'] : []),
    ...(manifest.connections ?? []).map(connection => `connection ${connection.id}`),
    ...(manifest.backend ? ['backend'] : []),
  ]
  for (const entry of previous ? describe(previous) : []) {
    before.add(entry)
  }
  for (const entry of describe(next)) {
    if (!before.has(entry)) {
      after.push(entry)
    }
  }
  if (previous && after.length === 0) {
    return null
  }
  return { first: previous === null, permissions: [...next.permissions], added: after }
}

/** Installs previews; Studio's app store behind it (server/utils/app-builder.ts). */
export interface PreviewInstaller {
  /** Checks a package as an upload is checked, and returns its manifest. */
  read: (bytes: Uint8Array) => AppManifest
  current: (previewAppId: string) => Promise<{ installationId: string, manifest: AppManifest } | null>
  install: (bytes: Uint8Array, previewAppId: string) => Promise<string>
  contributions: (previewAppId: string) => Promise<AppContributions | null>
  remove: (previewAppId: string) => Promise<void>
}

interface PreviewState {
  build: AppPreview['build']
  /** A built package waiting for the user's OK. */
  pending: { bytes: Uint8Array, previewAppId: string, consent: PreviewConsent } | null
  /** The preview's app ID, from the last built manifest. */
  previewAppId: string | null
  running: Promise<void> | null
  /** Another build was asked for while one ran. */
  again: boolean
}

export interface PreviewProject {
  id: string
  appId: string
  folder: string
}

export class ProjectPreviews {
  readonly #installer: PreviewInstaller
  readonly #build: (folder: string) => Promise<BuildResult>
  readonly #now: () => Date
  readonly #states = new Map<string, PreviewState>()

  constructor (options: { installer: PreviewInstaller, build: (folder: string) => Promise<BuildResult>, now?: () => Date }) {
    this.#installer = options.installer
    this.#build = options.build
    this.#now = options.now ?? (() => new Date())
  }

  async describe (project: PreviewProject): Promise<AppPreview> {
    const state = this.#state(project)
    const id = state.previewAppId ?? previewAppId(project.appId)
    const current = await this.#installer.current(id)
    return {
      projectId: project.id,
      build: state.build,
      consent: state.pending?.consent ?? null,
      installationId: current?.installationId ?? null,
      contributions: current ? await this.#installer.contributions(id) : null,
    }
  }

  /**
   * Builds the project and updates its preview; `report` gets the build's
   * events for the chat that caused it. A build asked for while one runs
   * follows it once.
   */
  build (project: PreviewProject, report: (event: ConversationEvent) => void = () => {}): Promise<void> {
    const state = this.#state(project)
    if (state.running) {
      state.again = true
      return state.running
    }
    state.running = (async () => {
      do {
        state.again = false
        await this.#buildOnce(project, state, report)
      } while (state.again)
    })().finally(() => {
      state.running = null
    })
    return state.running
  }

  /** Installs the package that waited for the user's OK. */
  async approve (project: PreviewProject): Promise<void> {
    const state = this.#state(project)
    const pending = state.pending
    if (!pending) {
      throw new StudioProblem('not_found', 'No preview waits for your OK.')
    }
    state.pending = null
    await this.#installer.install(pending.bytes, pending.previewAppId)
  }

  async remove (project: PreviewProject): Promise<void> {
    const state = this.#state(project)
    this.#states.delete(project.id)
    for (const id of new Set([state.previewAppId, previewAppId(project.appId)])) {
      if (id) {
        await this.#installer.remove(id)
      }
    }
  }

  #state (project: PreviewProject): PreviewState {
    let state = this.#states.get(project.id)
    if (!state) {
      state = { build: { state: 'none', log: null, at: null }, pending: null, previewAppId: null, running: null, again: false }
      this.#states.set(project.id, state)
    }
    return state
  }

  async #buildOnce (project: PreviewProject, state: PreviewState, report: (event: ConversationEvent) => void): Promise<void> {
    state.build = { state: 'running', log: null, at: this.#now().toISOString() }
    report({ type: 'build', state: 'running', log: null, consentNeeded: false })
    const fail = (log: string) => {
      state.build = { state: 'failed', log, at: this.#now().toISOString() }
      report({ type: 'build', state: 'failed', log, consentNeeded: false })
    }
    let result: BuildResult
    try {
      result = await this.#build(project.folder)
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error))
      return
    }
    if (!result.ok || !result.packageBytes) {
      fail(result.log)
      return
    }
    try {
      const manifest = this.#installer.read(result.packageBytes)
      const id = previewAppId(manifest.id)
      if (state.previewAppId && state.previewAppId !== id) {
        // The agent changed the app ID: the old preview goes.
        await this.#installer.remove(state.previewAppId)
      }
      state.previewAppId = id
      const current = await this.#installer.current(id)
      const consent = consentFor(current?.manifest ?? null, manifest)
      if (consent) {
        state.pending = { bytes: result.packageBytes, previewAppId: id, consent }
      } else {
        state.pending = null
        await this.#installer.install(result.packageBytes, id)
      }
      state.build = { state: 'succeeded', log: result.log, at: this.#now().toISOString() }
      report({ type: 'build', state: 'succeeded', log: null, consentNeeded: consent !== null })
    } catch (error) {
      fail(`${result.log}\n${problemText(error)}`)
    }
  }
}

/** A package check's findings, one per line, as an agent can act on them. */
function problemText (error: unknown): string {
  if (error instanceof StudioProblem) {
    return [error.detail ?? error.title, ...(error.violations ?? []).map(violation => `${violation.path}: ${violation.message}`)].join('\n')
  }
  return error instanceof Error ? error.message : String(error)
}
