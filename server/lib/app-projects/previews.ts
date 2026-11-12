import type { AppConnectionSummary, AppContributions, AppPreview, ConversationEvent, PreviewConsent } from '#shared/contract'
import type { BuildResult } from './build'
import type { AppManifest } from '@basyx/studio-sdk/protocol'
import { sandboxOrigins } from '@basyx/studio-app-kit/manifest'
import { StudioProblem } from '../problem'

// A project's preview (ADR 0054, plan B1–B4): Studio builds the folder,
// and installs the package as a preview of its own, which only the App
// Builder's preview pane shows. What the package asks for beyond the last
// preview waits for the user's OK.

/** A stable, bounded app ID owned by the project, independent of its editable manifest ID. */
export function previewAppId (projectId: string): string {
  return `local.preview.p${projectId.replaceAll('-', '')}`
}

/** The package authority the user consents to, including its parsed OpenAPI documents. */
export interface PreviewPackage {
  manifest: AppManifest
  connections: AppConnectionSummary[]
}

/** What `next` asks for beyond `previous` (plan B4); `null` when nothing new. */
export function consentFor (previous: PreviewPackage | null, next: PreviewPackage): PreviewConsent | null {
  const before = new Set<string>()
  const after: string[] = []
  const describe = ({ manifest, connections }: PreviewPackage) => [
    ...manifest.permissions.map(permission => ['permission', permission]),
    ...Object.entries(sandboxOrigins(manifest)).flatMap(([kind, origins]) => origins.map(origin => [kind, origin])),
    ...(manifest.sandbox?.webAssembly ? [['WebAssembly']] : []),
    ...(manifest.sandbox?.workers ? [['workers']] : []),
    ...(manifest.connections ?? []).map(connection => ['connection', connection.id]),
    ...connections.flatMap(connection => connection.operations.map(operation => ['operation', connection.id, operation.operationId, operation.method, operation.path])),
    ...(manifest.backend ? [['backend']] : []),
  ]
  for (const entry of previous ? describe(previous) : []) {
    before.add(JSON.stringify(entry))
  }
  for (const entry of describe(next)) {
    // IDs and paths may contain spaces: compare tuples, not their readable labels.
    if (!before.has(JSON.stringify(entry))) {
      after.push(entry.join(' '))
    }
  }
  if (previous && after.length === 0) {
    return null
  }
  return { first: previous === null, permissions: [...next.manifest.permissions], added: after }
}

/** Installs previews; Studio's app store behind it (server/utils/app-builder.ts). */
export interface PreviewInstaller {
  /** Checks a package as an upload is checked, including its OpenAPI operations. */
  read: (bytes: Uint8Array) => PreviewPackage
  current: (previewAppId: string) => Promise<(PreviewPackage & { installationId: string }) | null>
  install: (bytes: Uint8Array, previewAppId: string) => Promise<string>
  contributions: (previewAppId: string) => Promise<AppContributions | null>
  remove: (previewAppId: string) => Promise<void>
}

interface PreviewState {
  build: AppPreview['build']
  /** A built package waiting for the user's OK. */
  pending: { bytes: Uint8Array, consent: PreviewConsent } | null
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
    const id = previewAppId(project.id)
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
    await this.#installer.install(pending.bytes, previewAppId(project.id))
  }

  async remove (project: PreviewProject): Promise<void> {
    this.#states.delete(project.id)
    await this.#installer.remove(previewAppId(project.id))
  }

  #state (project: PreviewProject): PreviewState {
    let state = this.#states.get(project.id)
    if (!state) {
      state = { build: { state: 'none', log: null, at: null }, pending: null, running: null, again: false }
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
      const pkg = this.#installer.read(result.packageBytes)
      const id = previewAppId(project.id)
      const current = await this.#installer.current(id)
      const consent = consentFor(current, pkg)
      if (consent) {
        state.pending = { bytes: result.packageBytes, consent }
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
