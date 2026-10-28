import type {
  AppContext,
  ConnectMessage,
  HelloMessage,
  MethodName,
  Methods,
  StackComponentId,
  StackFileKind,
  StackSpec,
  ThemeTokens,
} from './protocol.ts'
import type { Transport } from './transport.ts'
import { embedTokenParameter, protocolVersion } from './protocol.ts'
import { portTransport } from './transport.ts'

export * from './protocol.ts'
export { portTransport, StudioError } from './transport.ts'
export type { Transport } from './transport.ts'

export interface ConnectOptions {
  /** How long to wait for Studio to answer. Default 10 s. */
  timeoutMs?: number
}

/**
 * The connection of an app frame to Studio. Every call is checked by Studio
 * against the app's declared permissions and the user's rights.
 */
export class StudioClient {
  readonly aas = {
    listShells: (params: Methods['studio.aas.listShells']['params'] = {}) => this.call('studio.aas.listShells', params),
    getShell: (shellId: string) => this.call('studio.aas.getShell', { shellId }),
    listSubmodels: (shellId: string) => this.call('studio.aas.listSubmodels', { shellId }),
    getSubmodel: (submodelId: string) => this.call('studio.aas.getSubmodel', { submodelId }),
    getElement: (submodelId: string, idShortPath: string) => this.call('studio.aas.getElement', { submodelId, idShortPath }),
    /**
     * The concept descriptions for semantic IDs, e.g. for units and readable
     * names: up to `describeConceptsMaxIds` (500) IDs, answered in their
     * order, `null` where the target has none (Studio ≥ 0.1.15).
     */
    describeConcepts: (ids: string[]) => this.call('studio.aas.describeConcepts', { ids }),
    setElementValue: (params: Methods['studio.aas.setElementValue']['params']) => this.call('studio.aas.setElementValue', params),
    // Structural writes and attachments (needs studio.aas.write and Studio's
    // edit mode; Studio ≥ 0.1.5).
    /** A submodel with the revisions for `putSubmodel` and top-level `addElement`. */
    getSubmodelSnapshot: (submodelId: string) => this.call('studio.aas.getSubmodelSnapshot', { submodelId }),
    /** Creates a shell and new submodels it references; identifiers left out are generated. */
    createShell: (params: Methods['studio.aas.createShell']['params']) => this.call('studio.aas.createShell', params),
    /** Creates a submodel; with `shellId`, the shell references it. */
    createSubmodel: (params: Methods['studio.aas.createSubmodel']['params']) => this.call('studio.aas.createSubmodel', params),
    putSubmodel: (params: Methods['studio.aas.putSubmodel']['params']) => this.call('studio.aas.putSubmodel', params),
    addElement: (params: Methods['studio.aas.addElement']['params']) => this.call('studio.aas.addElement', params),
    /** Replaces an element; a new idShort renames it, and a container keeps its children. */
    putElement: (params: Methods['studio.aas.putElement']['params']) => this.call('studio.aas.putElement', params),
    deleteElement: (params: Methods['studio.aas.deleteElement']['params']) => this.call('studio.aas.deleteElement', params),
    deleteSubmodel: (params: Methods['studio.aas.deleteSubmodel']['params']) => this.call('studio.aas.deleteSubmodel', params),
    deleteShell: (params: Methods['studio.aas.deleteShell']['params']) => this.call('studio.aas.deleteShell', params),
    /** Replaces a File element's content, up to `putAttachmentMaxBytes`; e.g. `{ ..., fileName: file.name, contentType: file.type, data: await file.arrayBuffer() }`. */
    putAttachment: (params: Methods['studio.aas.putAttachment']['params']) => this.call('studio.aas.putAttachment', params),
  }

  readonly ui = {
    notify: (message: string, level: Methods['studio.ui.notify']['params']['level'] = 'info') => this.call('studio.ui.notify', { message, level }),
    /**
     * Changes the module's sub-path in Studio's URL (nested routes). With
     * `{ history: 'push' }`, the browser's back button returns to the
     * previous sub-path (Studio ≥ 0.1.8); by default the entry is replaced.
     */
    navigate: (subPath: string, options: { history?: 'push' | 'replace' } = {}) => this.call('studio.ui.navigate', {
      subPath,
      ...(options.history === undefined ? {} : { history: options.history }),
    }),
    /** Sizes the frame to a content height; see `fitHeight` to follow the document. */
    setHeight: (height: number) => this.call('studio.ui.setHeight', { height: Math.ceil(height) }),
    /** Opens a File element's content in a new tab; `download` saves it instead. */
    openFile: (submodelId: string, idShortPath: string, download = false) => this.call('studio.ui.openFile', { submodelId, idShortPath, download }),
    /** Reads a File element's content into the app (needs studio.aas.read; Studio ≥ 0.1.1). */
    readFile: (submodelId: string, idShortPath: string) => this.call('studio.ui.readFile', { submodelId, idShortPath }),
    /** Reads a file an element names by an http(s) address at another host (needs studio.ui.externalFiles; Studio ≥ 0.1.2). */
    readExternalFile: (submodelId: string, idShortPath: string) => this.call('studio.ui.readExternalFile', { submodelId, idShortPath }),
    /** Shows a File or Blob element in Studio's full-screen file viewer (needs studio.aas.read; Studio ≥ 0.1.12). */
    previewFile: (submodelId: string, idShortPath: string) => this.call('studio.ui.previewFile', { submodelId, idShortPath }),
    /**
     * Opens this view again in a full-screen dialog; `context.fullscreen` is
     * true there, and `context.viewState` is `state` (Studio ≥ 0.1.1). With
     * `{ header: false }` the frame shows over the dimmed page without
     * Studio's header; close it with `closeFullscreen` (Studio ≥ 0.1.7).
     */
    openFullscreen: (state?: string, options: { header?: boolean } = {}) => this.call('studio.ui.openFullscreen', {
      ...(state === undefined ? {} : { state }),
      ...(options.header === undefined ? {} : { header: options.header }),
    }),
    /** Closes the full-screen dialog this view runs in (Studio ≥ 0.1.7). */
    closeFullscreen: () => this.call('studio.ui.closeFullscreen', {}),
    /**
     * Tells Studio what the view shows, so that Studio's own full-screen
     * button (on the Overview card) opens it as `openFullscreen(state)` would;
     * the view there reads it from `context.viewState` (Studio ≥ 0.1.13).
     */
    setViewState: (state: string) => this.call('studio.ui.setViewState', { state }),
    /** Opens a target in Studio (needs studio.ui.navigation). */
    openTarget: (targetId: string) => this.call('studio.ui.openTarget', { targetId }),
    /**
     * Opens Studio's page of a shell of the active target in this tab, where
     * the submodel views show its submodels; `submodelId` selects one of them
     * (needs studio.ui.navigation; Studio ≥ 0.1.4). Call it from a click handler.
     */
    openShell: (shellId: string, options: { submodelId?: string } = {}) => this.call('studio.ui.openShell', options.submodelId === undefined ? { shellId } : { shellId, submodelId: options.submodelId }),
    /**
     * Shows a submodel of the active target in another installed app's view,
     * in Studio's full-screen dialog over this app, e.g. a bill of material
     * or a time series: the view Studio would pick on the shell's Overview,
     * or that of `appId` (and its `viewId`). `shellId` names the shell the
     * submodel belongs to. `context.fullscreenOpen` is true until the user
     * closes it (needs studio.ui.navigation; Studio ≥ 0.1.10). Call it from a
     * click handler.
     */
    openView: (submodelId: string, options: Omit<Methods['studio.ui.openView']['params'], 'submodelId'> = {}) => this.call('studio.ui.openView', { ...options, submodelId }),
    /**
     * The frame URL of the same view for an `<iframe>` in this app's page
     * (needs studio.ui.navigation; Studio ≥ 0.1.11, with an origin per app).
     * The view connects to Studio itself and is read-only there. Keep the
     * frame's origin: no `sandbox` attribute. Ask for a new URL each time
     * the frame is created; it is valid for an hour.
     */
    embedView: (submodelId: string, options: Omit<Methods['studio.ui.embedView']['params'], 'submodelId'> = {}) => this.call('studio.ui.embedView', { ...options, submodelId }),
    /**
     * Opens a URL in the system browser (needs studio.ui.navigation): https,
     * or http to this computer; `mailto:` and `tel:` in the system's mail or
     * phone app (Studio ≥ 0.1.14). Call it from a click handler.
     */
    openExternal: (url: string) => this.call('studio.ui.openExternal', { url }),
    /** Copies text to the clipboard (needs studio.ui.clipboard). Call it from a click handler. */
    copyText: (text: string) => this.call('studio.ui.copyText', { text }),
    /**
     * Saves a text file the app created, e.g. a vCard, to the user's
     * computer (needs studio.ui.saveFiles; Studio ≥ 0.1.14). Call it from a
     * click handler.
     */
    saveFile: (fileName: string, text: string, contentType = 'text/plain') => this.call('studio.ui.saveFile', { fileName, contentType, text }),
  }

  /** Local BaSyx instances on Docker or Podman; desktop and bundled apps only (ADR 0033). */
  readonly containers = {
    listEngines: () => this.call('studio.containers.listEngines', {}),
    selectEngine: (host: string | null) => this.call('studio.containers.selectEngine', { host }),
    listStacks: () => this.call('studio.containers.listStacks', {}),
    getStack: (stackId: string) => this.call('studio.containers.getStack', { stackId }),
    planStack: (spec: StackSpec, stackId?: string) => this.call('studio.containers.planStack', stackId ? { spec, stackId } : { spec }),
    createStack: (params: Methods['studio.containers.createStack']['params']) => this.call('studio.containers.createStack', params),
    changeStack: (params: Methods['studio.containers.changeStack']['params']) => this.call('studio.containers.changeStack', params),
    startStack: (stackId: string) => this.call('studio.containers.startStack', { stackId }),
    stopStack: (stackId: string) => this.call('studio.containers.stopStack', { stackId }),
    updateStack: (stackId: string) => this.call('studio.containers.updateStack', { stackId }),
    removeStack: (params: Methods['studio.containers.removeStack']['params']) => this.call('studio.containers.removeStack', params),
    getJob: (jobId: string) => this.call('studio.containers.getJob', { jobId }),
    getLogs: (stackId: string, component: StackComponentId, tail?: number) => this.call('studio.containers.getLogs', tail === undefined ? { stackId, component } : { stackId, component, tail }),
    getSignIn: (stackId: string) => this.call('studio.containers.getSignIn', { stackId }),
    /** Lets the user choose files in a native dialog of the host; empty when cancelled. */
    pickFiles: (kind: StackFileKind, suggestedName?: string) => this.call('studio.containers.pickFiles', suggestedName ? { kind, suggestedName } : { kind }),
    /** AASX files to load at startup; pass their handles to `createStack` or `changeStack`. */
    pickAasxFiles: () => this.containers.pickFiles('stack-aasx'),
    /** Asks where to save, then writes the last 500 lines of a component's log; `null` when cancelled. */
    saveLogs: async (stackId: string, component: StackComponentId) => {
      const file = await this.#pickOne('stack-logs')
      return file ? this.call('studio.containers.saveLogs', { stackId, component, fileHandle: file }) : null
    },
    /** Asks where to save (prefilled with `suggestedName`), then writes the export; `null` when cancelled. */
    exportStack: async (stackId: string, suggestedName?: string) => {
      const file = await this.#pickOne('stack-export', suggestedName)
      return file ? this.call('studio.containers.exportStack', { stackId, fileHandle: file }) : null
    },
    /** Lets the user choose an exported ZIP or `basyx-stack.json` and reads it; `null` when cancelled. */
    importStack: async () => {
      const file = await this.#pickOne('stack-import')
      return file ? this.call('studio.containers.importStack', { fileHandle: file }) : null
    },
  }

  readonly timeseries = {
    /** Reads a segment of an IDTA Time Series Data submodel (bundled apps; Studio ≥ 0.1.2). */
    read: (params: Methods['studio.timeseries.read']['params']) => this.call('studio.timeseries.read', params),
  }

  /** HTTP services the app declares in `connections` (needs studio.connections; Studio ≥ 0.1.6, ADR 0047). */
  readonly connections = {
    /**
     * Calls a declared operation through the connection an administrator
     * bound to it on the active target's infrastructure. Every status is a
     * result; refusals and transport failures reject with a `StudioError`.
     */
    call: (params: Methods['studio.connections.call']['params']) => this.call('studio.connections.call', params),
  }

  readonly backend = {
    /** Calls an exported handler of the app's backend. */
    call: <T = unknown>(method: string, params?: unknown) => this.call('studio.backend.call', { method, params }) as Promise<T>,
  }

  #transport: Transport
  #context: AppContext
  #listeners = new Set<(context: AppContext) => void>()

  /**
   * Apps get a client from `connect()` or, without Studio, from
   * `createTestStudio()` of `@basyx/studio-sdk/testing`.
   */
  constructor (transport: Transport, context: AppContext) {
    this.#transport = transport
    this.#context = context
    transport.onContext(next => {
      this.#context = next
      for (const listener of this.#listeners) {
        listener(next)
      }
    })
  }

  /** The current context: target, shell, submodel, sub-path, locale and theme. */
  get context (): AppContext {
    return this.#context
  }

  /** Called whenever the context changes, e.g. the theme or the module sub-path. Returns an unsubscribe function. */
  onContext (listener: (context: AppContext) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  call<M extends MethodName> (method: M, params: Methods[M]['params']): Promise<Methods[M]['result']> {
    return this.#transport.call(method, params) as Promise<Methods[M]['result']>
  }

  /** Ends the connection; pending calls are rejected. */
  close (): void {
    this.#transport.close()
  }

  /** The handle of the one file the user chose, or `null` when cancelled. */
  async #pickOne (kind: StackFileKind, suggestedName?: string): Promise<string | null> {
    const { files } = await this.containers.pickFiles(kind, suggestedName)
    return files[0]?.handle ?? null
  }
}

/**
 * Connects the app frame to Studio. Studio answers only to the frame it
 * created, and only once per page load.
 */
export function connect (options: ConnectOptions = {}): Promise<StudioClient> {
  if (window.parent === window) {
    return Promise.reject(new Error('A Studio app must run inside BaSyx Studio. Outside it, use createTestStudio() of @basyx/studio-sdk/testing.'))
  }
  // A view inside another app's page (`studio.ui.embedView`) talks to
  // Studio's page directly, never to the app around it (ADR 0051).
  const embed = new URLSearchParams(location.search).get(embedTokenParameter)
  const host = embed ? window.top! : window.parent
  return new Promise((resolve, reject) => {
    const instance = embed ? [...crypto.getRandomValues(new Uint8Array(12))].map(byte => byte.toString(16).padStart(2, '0')).join('') : ''
    const hello: HelloMessage = embed ? { protocol: protocolVersion, type: 'hello', embed, instance } : { protocol: protocolVersion, type: 'hello' }
    // The frame does not know Studio's origin (and may have an opaque one
    // itself); the hello carries no data but the embed token, which only
    // Studio's page acts on, and the reply is checked by its source.
    const send = () => host.postMessage(hello, '*')
    const retry = setInterval(send, 250)
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('BaSyx Studio did not answer.'))
    }, options.timeoutMs ?? 10_000)
    function onMessage (event: MessageEvent) {
      const message = event.data as Partial<ConnectMessage> | null
      if (event.source !== host || message?.protocol !== protocolVersion || message.type !== 'connect' || !event.ports[0] || !message.context) {
        return
      }
      cleanup()
      resolve(new StudioClient(portTransport(event.ports[0]), message.context))
    }
    function cleanup () {
      clearInterval(retry)
      clearTimeout(timeout)
      window.removeEventListener('message', onMessage)
    }
    window.addEventListener('message', onMessage)
    send()
  })
}

/**
 * Applies Studio's theme to the document as CSS custom properties
 * (`--studio-color-primary`, …) and `color-scheme`.
 */
export function applyTheme (theme: ThemeTokens, root: HTMLElement = document.documentElement): void {
  root.style.colorScheme = theme.dark ? 'dark' : 'light'
  for (const [name, value] of Object.entries(theme.colors)) {
    root.style.setProperty(`--studio-color-${name}`, value)
  }
}

/** Picks the text for a locale from a localized label, falling back to English and then to any language. */
export function localized (text: Record<string, string>, locale: string): string {
  return text[locale] ?? text[locale.split('-', 1)[0]!] ?? text.en ?? Object.values(text)[0] ?? ''
}

/**
 * Keeps the frame as tall as an element (the document by default), for views
 * that Studio embeds next to others, e.g. on a shell's overview. Returns a
 * function that stops following.
 */
export function fitHeight (client: StudioClient, element: HTMLElement = document.documentElement): () => void {
  let last = -1
  const update = () => {
    const height = Math.ceil(element.getBoundingClientRect().height)
    if (height !== last) {
      last = height
      void client.ui.setHeight(height)
    }
  }
  const observer = new ResizeObserver(update)
  observer.observe(element)
  update()
  return () => observer.disconnect()
}
