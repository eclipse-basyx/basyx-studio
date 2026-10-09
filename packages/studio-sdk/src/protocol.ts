// The `studio-sdk/0` protocol between an app frame and BaSyx Studio. Studio
// validates every message it receives against its own schemas
// (shared/contract/apps.ts in the Studio repository); these types describe
// the same contract for app authors.

export const protocolVersion = 'studio-sdk/0'

/** Version of the Studio app API that manifests name in `studioApi`. */
export const studioAppApiVersion = '0.1.0'

export const permissions = [
  'studio.aas.read',
  'studio.aas.write',
  'studio.ui.notifications',
  'studio.ui.navigation',
  'studio.backend',
] as const
export type Permission = (typeof permissions)[number]

export type LocalizedText = Record<string, string>

export interface AppManifest {
  manifestVersion: 0
  id: string
  version: string
  publisher: { name: string, url?: string }
  title: LocalizedText
  description?: LocalizedText
  studioApi: string
  runtimes: ('hosted' | 'desktop')[]
  permissions: Permission[]
  backend?: { runtime: 'deno', entry: string }
  contributes: {
    submodelViews?: SubmodelViewContribution[]
    modules?: ModuleContribution[]
  }
}

export interface SubmodelViewContribution {
  id: string
  title: LocalizedText
  entry: string
  semanticIds: string[]
}

export type ModuleContext = 'global' | 'target' | 'shell'

export interface ModuleContribution {
  id: string
  title: LocalizedText
  icon?: string
  entry: string
  route: string
  context: ModuleContext
}

export type JsonObject = Record<string, unknown>

export interface ThemeTokens {
  dark: boolean
  /** Vuetify theme colors as CSS color values, e.g. `primary`, `surface`, `on-surface`. */
  colors: Record<string, string>
}

/** Where the frame runs. Sent on connect and again with every change. */
export interface AppContext {
  protocol: typeof protocolVersion
  installationId: string
  appId: string
  contribution: { kind: 'submodelView' | 'module', id: string }
  /** The active target; every AAS call goes to it. `null` for global modules outside a target. */
  target: { id: string, name: string, write: boolean, persistence: 'immediate' | 'explicit_save' } | null
  shell: { id: string } | null
  submodel: { id: string, semanticId: string | null } | null
  /** The module's sub-path below its route (nested routes), without leading slash. */
  subPath: string
  locale: string
  theme: ThemeTokens
}

export type ConcurrencyMode = 'strong' | 'best_effort'

export interface ElementSnapshot {
  value: JsonObject
  /** Opaque revision; pass it unchanged to `setElementValue`. */
  revision: string
  concurrency: ConcurrencyMode
}

export interface ShellSummary {
  id: string
  idShort: string | null
  displayName: { language: string, text: string }[]
  assetKind: string | null
  globalAssetId: string | null
}

export interface SubmodelSummary {
  id: string
  idShort: string | null
  semanticId: string | null
  status: 'available' | 'forbidden' | 'not_found' | 'error'
}

export interface Page<T> {
  items: T[]
  page: { nextCursor: string | null, hasMore: boolean }
}

/** Value of a Property (string or `null`) or of a MultiLanguageProperty. */
export type ElementValue = string | null | { language: string, text: string }[]

/** Parameters and results of every capability method. */
export interface Methods {
  'studio.ui.getContext': { params: Record<string, never>, result: AppContext }
  'studio.ui.notify': { params: { message: string, level?: 'info' | 'success' | 'warning' | 'error' }, result: null }
  'studio.ui.navigate': { params: { subPath: string }, result: null }
  'studio.aas.listShells': { params: { limit?: number, cursor?: string }, result: Page<ShellSummary> }
  'studio.aas.getShell': { params: { shellId: string }, result: JsonObject }
  'studio.aas.listSubmodels': { params: { shellId: string }, result: { items: SubmodelSummary[] } }
  'studio.aas.getSubmodel': { params: { submodelId: string }, result: JsonObject }
  'studio.aas.getElement': { params: { submodelId: string, idShortPath: string }, result: ElementSnapshot }
  'studio.aas.setElementValue': {
    params: { submodelId: string, idShortPath: string, value: ElementValue, revision: string }
    result: ElementSnapshot
  }
  'studio.backend.call': { params: { method: string, params?: unknown }, result: unknown }
}
export type MethodName = keyof Methods

/** The permission each method needs; `null` methods are always allowed. */
export const methodPermissions: Record<MethodName, Permission | null> = {
  'studio.ui.getContext': null,
  'studio.ui.notify': 'studio.ui.notifications',
  'studio.ui.navigate': 'studio.ui.navigation',
  'studio.aas.listShells': 'studio.aas.read',
  'studio.aas.getShell': 'studio.aas.read',
  'studio.aas.listSubmodels': 'studio.aas.read',
  'studio.aas.getSubmodel': 'studio.aas.read',
  'studio.aas.getElement': 'studio.aas.read',
  'studio.aas.setElementValue': 'studio.aas.write',
  'studio.backend.call': 'studio.backend',
}

/** A failed call, in the shape of Studio's problem details. */
export interface Problem {
  code: string
  title: string
  status: number
  detail?: string
  retryable: boolean
  violations?: { path: string, message: string }[]
}

// Messages. The frame posts `hello` to its parent; Studio answers with
// `connect`, transferring a MessagePort that carries everything else.

export interface HelloMessage {
  protocol: typeof protocolVersion
  type: 'hello'
}

export interface ConnectMessage {
  protocol: typeof protocolVersion
  type: 'connect'
  context: AppContext
}

export interface RequestMessage {
  type: 'request'
  id: number
  method: string
  params: unknown
}

export type HostMessage
  = | { type: 'response', id: number, result: unknown }
    | { type: 'error', id: number, problem: Problem }
    | { type: 'context', context: AppContext }
