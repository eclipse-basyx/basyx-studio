import type { BinaryContent } from '../targets/aas-target'
import type { PackageFiles } from './model'
import type { OpenedPackage } from './package'
import type { WorkerProblem, WorkerRequest, WorkerResponse, WorkerResults, WorkspaceCalls, WorkspaceInfo, WorkspaceMethod } from './protocol'
import type { Part } from 'aas-package3-typescript'
import { randomBytes } from 'node:crypto'
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { StudioProblem } from '../problem'
import { defaultArchiveLimits } from './archive'
import { WorkspaceModel } from './model'
import { inspectEnvironment, newPackageBytes, readPackage, writePackage } from './package'

/** Operations that change the environment; each one goes into the undo log (W8). */
const mutating = new Set<string>([
  'setElementValue', 'addElement', 'replaceElement', 'deleteElement', 'moveElement', 'replaceSubmodelMetadata',
  'createSubmodel', 'deleteSubmodel', 'createShell', 'replaceShell', 'replaceSubmodel', 'addSubmodelRef',
  'removeSubmodelRef', 'deleteShell', 'replaceAttachment', 'setThumbnail',
  'createConceptDescription', 'replaceConceptDescription', 'deleteConceptDescription',
])

interface OpenWorkspace {
  /** Empty for a package that was never saved. */
  path: string
  opened: OpenedPackage
  model: WorkspaceModel
  diagnostics: string[]
}

const callable = new Set<string>([
  'listShells', 'shell', 'submodelIds', 'submodelMetadata', 'submodel', 'element', 'setElementValue',
  'addElement', 'replaceElement', 'deleteElement', 'moveElement', 'replaceSubmodelMetadata',
  'undo', 'redo', 'setThumbnail',
  'createSubmodel', 'deleteSubmodel', 'createShell', 'replaceShell', 'addSubmodelRef', 'removeSubmodelRef', 'replaceSubmodel',
  'deleteShell', 'thumbnail', 'attachment', 'replaceAttachment', 'conceptDescriptions', 'searchShells', 'searchElements',
  'conceptDescription', 'searchConceptDescriptions', 'createConceptDescription', 'replaceConceptDescription', 'deleteConceptDescription', 'conceptDescriptionUsages',
])

/** Largest file a user may add to a package through Studio. */
const maxAttachmentBytes = 50 * 1024 * 1024

function toContent (part: Part): BinaryContent {
  return { bytes: part.ReadAllBytes(), contentType: part.ContentType || 'application/octet-stream', fileName: part.URI.pathname.split('/').pop() || null }
}

/** Package parts of an opened workspace; supplementary files go below `/aasx-suppl/`. */
function packageFiles (opened: OpenedPackage): PackageFiles {
  const uriOf = (path: string) => new URL(path.startsWith('/') ? path : `/${path}`, opened.spec.URI)
  return {
    read: async path => {
      // Only paths inside the package; File values may also be external URLs.
      if (/^[a-z][\w+.-]*:/i.test(path)) {
        return null
      }
      const part = await opened.pkg.FindPart(uriOf(path))
      return part ? toContent(part) : null
    },
    write: async (fileName, file) => {
      if (file.bytes.length > maxAttachmentBytes) {
        throw new StudioProblem('invalid_request', 'The file is too large.')
      }
      const safe = fileName.replaceAll(/[^\w.-]/g, '_').replace(/^\.+/, '').slice(0, 120) || 'file'
      const path = `/aasx-suppl/${randomBytes(6).toString('hex')}/${safe}`
      const part = await opened.pkg.PutPart(uriOf(path), file.contentType, file.bytes)
      await opened.pkg.RelateSupplementaryToSpec(part, opened.spec)
      return path
    },
    thumbnail: async () => {
      const part = await opened.pkg.Thumbnail()
      return part ? toContent(part) : null
    },
  }
}

/**
 * The Workspace Worker's request handling: opened packages, their models,
 * and atomic saves. Runs in its own process (see `server/workers`), so a
 * malformed package can only take down the worker, not the Studio Service.
 */
export class WorkspaceWorker {
  readonly #workspaces = new Map<string, OpenWorkspace>()

  async handle (request: WorkerRequest): Promise<WorkerResults[WorkerRequest['op']]> {
    switch (request.op) {
      case 'open': {
        return this.#open(request.path)
      }
      case 'call': {
        const workspace = this.#get(request.workspaceId)
        if (!callable.has(request.method)) {
          throw new StudioProblem('invalid_request', 'Unknown workspace operation.')
        }
        const method = workspace.model[request.method] as (...args: unknown[]) => ReturnType<WorkspaceCalls[WorkspaceMethod]>
        const before = mutating.has(request.method) ? workspace.model.snapshot() : null
        const result = await method.apply(workspace.model, request.args)
        if (before) {
          workspace.model.recordChange(before)
        }
        return result
      }
      case 'create': {
        return this.#create()
      }
      case 'save': {
        return this.#save(request.workspaceId, request.path)
      }
      case 'inspect': {
        return inspectEnvironment(request.bytes, request.format)
      }
      case 'close': {
        this.#workspaces.delete(request.workspaceId)
        return null
      }
      default: {
        return [...this.#workspaces.keys()].map(id => this.#info(id))
      }
    }
  }

  async #open (path: string): Promise<WorkspaceInfo> {
    const size = (await stat(path)).size
    if (size > defaultArchiveLimits.maxArchiveBytes) {
      throw new StudioProblem('package_rejected', 'The package is too large.')
    }
    const opened = await readPackage(new Uint8Array(await readFile(path)))
    const workspaceId = `ws-${randomBytes(9).toString('base64url')}`
    this.#workspaces.set(workspaceId, { path, opened, model: new WorkspaceModel(opened.environment, packageFiles(opened)), diagnostics: opened.diagnostics })
    return this.#info(workspaceId)
  }

  async #create (): Promise<WorkspaceInfo> {
    const opened = await readPackage(await newPackageBytes())
    const workspaceId = `ws-${randomBytes(9).toString('base64url')}`
    const model = new WorkspaceModel(opened.environment, packageFiles(opened))
    model.markUnsaved()
    this.#workspaces.set(workspaceId, { path: '', opened, model, diagnostics: [] })
    return this.#info(workspaceId)
  }

  /** Writes a temporary file next to the target and renames it over it, so a crash never leaves a partial package. */
  async #save (workspaceId: string, target: string | undefined): Promise<WorkspaceInfo> {
    const workspace = this.#get(workspaceId)
    const path = target ?? workspace.path
    if (!path) {
      throw new StudioProblem('invalid_request', 'A new package has no file yet. Use Save as.')
    }
    const revision = workspace.model.revision
    const bytes = await writePackage(workspace.opened, workspace.model.environment)
    const temporary = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`)
    try {
      await writeFile(temporary, bytes, { flag: 'wx' })
      await rename(temporary, path)
    } catch (error) {
      await rm(temporary, { force: true })
      throw error
    }
    workspace.path = path
    workspace.model.savedRevision = revision
    return this.#info(workspaceId)
  }

  #get (workspaceId: string): OpenWorkspace {
    const workspace = this.#workspaces.get(workspaceId)
    if (!workspace) {
      throw new StudioProblem('not_found', 'This workspace is not open.')
    }
    return workspace
  }

  #info (workspaceId: string): WorkspaceInfo {
    const workspace = this.#get(workspaceId)
    return {
      workspaceId,
      fileName: workspace.path ? basename(workspace.path) : 'Untitled.aasx',
      unsavedChanges: workspace.model.unsavedChanges,
      isNew: workspace.path === '',
      canUndo: workspace.model.canUndo,
      canRedo: workspace.model.canRedo,
      diagnostics: workspace.diagnostics,
    }
  }
}

function toProblem (error: unknown): WorkerProblem {
  if (error instanceof StudioProblem) {
    return { code: error.code, detail: error.detail, violations: error.violations }
  }
  const code = (error as NodeJS.ErrnoException | null)?.code
  if (code === 'ENOENT') {
    return { code: 'not_found', detail: 'The file does not exist (anymore).' }
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return { code: 'forbidden', detail: 'Studio may not access this file.' }
  }
  return { code: 'internal_error', detail: error instanceof Error ? error.message : undefined }
}

/** Serves requests from the parent process over the IPC channel. */
export function serveWorker (worker = new WorkspaceWorker()): void {
  // Requests are handled one at a time, so no two operations interleave.
  let queue = Promise.resolve()
  process.on('message', (message: { id: number, request: WorkerRequest }) => {
    queue = queue.then(async () => {
      let response: WorkerResponse
      try {
        response = { id: message.id, ok: true, result: await worker.handle(message.request) }
      } catch (error) {
        response = { id: message.id, ok: false, problem: toProblem(error) }
      }
      process.send?.(response)
    })
  })
  // Without the parent there is no one to serve; never outlive it.
  process.on('disconnect', () => process.exit(0))
}
