import type { MethodName, Methods } from '@basyx/studio-sdk/protocol'
import { describeConceptsMaxIds, editModeMethods, permissions, protocolVersion, putAttachmentMaxBytes, sandboxOriginKinds, stackFileKinds } from '@basyx/studio-sdk/protocol'
import { z } from 'zod'
import { displayBreakpoints } from '../overview'
import { connectionCallParamsSchema } from './connections'
import { engineHostSchema, stackComponentIdSchema, stackSpecSchema } from './containers'
import { appSettingSummarySchema, appSettingValuesSchema } from './settings'
import { langStringSchema, listQuerySchema } from './target'
import { timeSeriesReadParamsSchema } from './timeseries'
import { fileHandleSchema } from './workspace'

// Runtime-installable apps (ADR 0004, MVP-3). The `studio-sdk/0` message
// types are defined by @basyx/studio-sdk; these schemas validate what Studio
// receives from app frames and serves through `/app-installations`,
// `/app-contributions` and `/app-calls`.

export const appPermissionSchema = z.enum(permissions)
export type AppPermission = z.infer<typeof appPermissionSchema>

export const localizedTextSchema = z.record(z.string(), z.string())
export type LocalizedText = z.infer<typeof localizedTextSchema>

export const appTrustSchema = z.enum(['bundled', 'signed', 'managed', 'unsigned'])
export type AppTrust = z.infer<typeof appTrustSchema>

/** Why a signed installation is no longer trusted (ADR 0044), or lost the grant for code from outside its package (ADR 0045). */
export const appRevocationSchema = z.enum(['keyRemoved', 'appIdNotAllowed', 'remoteCodeNotGranted'])
export type AppRevocation = z.infer<typeof appRevocationSchema>

export const sandboxOriginKindSchema = z.enum(sandboxOriginKinds)
export type SandboxOriginKind = z.infer<typeof sandboxOriginKindSchema>

const appSandboxSchema = z.object({
  webAssembly: z.boolean(),
  workers: z.boolean(),
  /** Declared third-party origins (ADR 0045); empty when not declared. */
  frameOrigins: z.array(z.string()),
  connectOrigins: z.array(z.string()),
  imageOrigins: z.array(z.string()),
  mediaOrigins: z.array(z.string()),
})

/** An operation an app connection declares, as the consent and binding dialogs show it (ADR 0047). */
export const appConnectionOperationSchema = z.object({
  operationId: z.string(),
  method: z.string(),
  path: z.string(),
  summary: z.string().nullable(),
})
export type AppConnectionOperation = z.infer<typeof appConnectionOperationSchema>

/** A connection of an app's manifest with its declared operations (ADR 0047). */
export const appConnectionSummarySchema = z.object({
  id: z.string(),
  title: localizedTextSchema,
  description: localizedTextSchema.nullable(),
  operations: z.array(appConnectionOperationSchema),
})
export type AppConnectionSummary = z.infer<typeof appConnectionSummarySchema>

export const appInstallationSchema = z.object({
  id: z.string(),
  appId: z.string(),
  version: z.string(),
  title: localizedTextSchema,
  description: localizedTextSchema.nullable(),
  publisher: z.string(),
  /** `sha256:<hex>` of the uploaded package. */
  digest: z.string(),
  /**
   * How Studio trusts its files (ADR 0044): shipped with Studio, signed by a
   * key of the trust store, mounted unsigned by the operator, or installed
   * unsigned in developer mode.
   */
  trust: appTrustSchema,
  /** The trust store's name of the publisher whose key signed it; `null` unless signed and trusted. */
  verifiedPublisher: z.string().nullable(),
  /** `sha256:<hex>` of the signing key; `null` unless signed. */
  keyFingerprint: z.string().nullable(),
  /** Why a signed installation is no longer trusted; its frames and calls are refused. */
  revoked: appRevocationSchema.nullable(),
  /** Shipped with Studio and installed at startup (ADR 0023). */
  bundled: z.boolean(),
  /** Installed by the deployment from STUDIO_APP_PACKAGES; not changed or removed here. */
  managed: z.boolean(),
  permissions: z.array(appPermissionSchema),
  /** Reserved permissions it may use: all for bundled apps, those its publisher is granted for signed ones. */
  grantedPermissions: z.array(appPermissionSchema),
  /** What its pages may run and reach beyond their own files (manifest `sandbox`, ADR 0038, ADR 0045). */
  sandbox: appSandboxSchema,
  /**
   * It may fetch from connect origins and run WebAssembly or `blob:` workers,
   * so it could run code that is not in its package (ADR 0045). Installed
   * only for bundled apps and publishers the trust store grants `remoteCode`.
   */
  remoteCode: z.boolean(),
  /** The HTTP services it calls through Studio, each with its operations; called only where an administrator binds them (ADR 0047). */
  connections: z.array(appConnectionSummarySchema),
  /** The settings it declares (ADR 0048). */
  settings: z.array(appSettingSummarySchema),
  /** The values set for this installation; infrastructures may set their own for `infrastructure` settings. */
  settingValues: appSettingValuesSchema,
  submodelViews: z.number().int(),
  modules: z.number().int(),
  backend: z.boolean(),
  installedAt: z.string(),
  installedBy: z.string(),
})
export type AppInstallation = z.infer<typeof appInstallationSchema>

/**
 * What `POST /app-installations?inspect=true` found in a package (ADR 0044),
 * for the consent dialog. Nothing is stored.
 */
export const appPackageInspectionSchema = appInstallationSchema
  .pick({ appId: true, version: true, title: true, description: true, publisher: true, digest: true, verifiedPublisher: true, keyFingerprint: true, permissions: true, grantedPermissions: true, sandbox: true, remoteCode: true, connections: true, settings: true, submodelViews: true, modules: true, backend: true })
  .extend({
    trust: z.enum(['signed', 'unsigned']),
    /** The installation this package updates in place, and what changes; `null` for a new installation. */
    update: z.object({
      installationId: z.string(),
      version: z.string(),
      trust: appTrustSchema,
      verifiedPublisher: z.string().nullable(),
      permissionsAdded: z.array(appPermissionSchema),
      permissionsRemoved: z.array(appPermissionSchema),
      sandboxAdded: z.array(z.enum(['webAssembly', 'workers'])),
      /** Declared origins the update adds and removes, per kind (ADR 0045). Added ones need the confirmation. */
      originsAdded: z.array(z.object({ kind: sandboxOriginKindSchema, origin: z.string() })),
      originsRemoved: z.array(z.object({ kind: sandboxOriginKindSchema, origin: z.string() })),
      /**
       * Operations the update adds to its connections, also those of a new
       * connection or with a changed method or path (ADR 0047). They need the
       * confirmation; bindings keep applying to them.
       */
      operationsAdded: z.array(z.object({ connection: z.string(), operationId: z.string() })),
      operationsRemoved: z.array(z.object({ connection: z.string(), operationId: z.string() })),
      /**
       * Settings the update adds, removes, and changes in type, allowed
       * values or scope (ADR 0048), and the keys of installation values it
       * drops because their setting no longer accepts them. Settings grant
       * nothing, so they are shown, not consented to separately.
       */
      settingsAdded: z.array(z.string()),
      settingsRemoved: z.array(z.string()),
      settingsChanged: z.array(z.string()),
      valuesDropped: z.array(z.string()),
      backendAdded: z.boolean(),
    }).nullable(),
  })
export type AppPackageInspection = z.infer<typeof appPackageInspectionSchema>

/** `GET /app-installations`. */
export interface AppInstallationList {
  items: AppInstallation[]
  enabled: boolean
  allowUnsigned: boolean
  /** Names of the publishers whose signed packages may be installed (STUDIO_APPS_TRUSTED_PUBLISHERS). */
  trustedPublishers: string[]
  /**
   * Every installation has an origin of its own (ADR 0045). Without, frames
   * share one apps origin and stay opaque, so embedded pages run without
   * cookies or storage.
   */
  installationOrigins: boolean
}

const contributionBase = {
  installationId: z.string(),
  appId: z.string(),
  appTitle: localizedTextSchema,
  id: z.string(),
  title: localizedTextSchema,
  /** URL of the sandboxed entry document on the app origin. */
  entryUrl: z.string(),
  permissions: z.array(appPermissionSchema),
  /** The package the entry is served from; a frame's calls carry it, so an update cuts off frames of the old version. */
  digest: z.string(),
  /** Installed in developer mode, without a signature (ADR 0044). */
  unsigned: z.boolean(),
  bundled: z.boolean(),
  /**
   * The origin the frame runs in when the installation has one of its own
   * (ADR 0045): the frame then gets `allow-same-origin`, and the bridge talks
   * to this origin only. `null` with a shared apps origin: opaque frames.
   */
  frameOrigin: z.string().nullable(),
}

export const submodelViewContributionSchema = z.object({
  kind: z.literal('submodelView'),
  ...contributionBase,
  /** Why the view is offered, e.g. the semantic ID that matched. */
  reason: z.object({ semanticId: z.string() }),
  /** Default widths on the Overview per breakpoint, in columns of 12 (manifest `columns`). */
  columns: z.partialRecord(z.enum(displayBreakpoints), z.number().int().min(3).max(12)).default({}),
})
export type SubmodelViewContributionInfo = z.infer<typeof submodelViewContributionSchema>

export const moduleContributionSchema = z.object({
  kind: z.literal('module'),
  ...contributionBase,
  icon: z.string().nullable(),
  route: z.string(),
  context: z.enum(['global', 'target', 'shell']),
  /** `fullPage`: the frame fills the page, without header, card or padding (ADR 0045). */
  layout: z.enum(['standard', 'fullPage']),
})
export type ModuleContributionInfo = z.infer<typeof moduleContributionSchema>

export type AppContributionInfo = SubmodelViewContributionInfo | ModuleContributionInfo

export const appContributionsQuerySchema = z.object({
  /**
   * Submodel semantic IDs; submodel views are returned only for given IDs.
   * Repeat the parameter for several submodels, e.g. a shell's overview.
   */
  semanticId: z.union([z.string().min(1).max(2048), z.array(z.string().min(1).max(2048)).max(100)]).optional().transform(value => value === undefined ? [] : (Array.isArray(value) ? value : [value])),
})

export const appContributionsSchema = z.object({
  submodelViews: z.array(submodelViewContributionSchema),
  modules: z.array(moduleContributionSchema),
})
export type AppContributions = z.infer<typeof appContributionsSchema>

/**
 * What Studio's server answers the host bridge for `studio.ui.openView`
 * (ADR 0051): the view to show and what it shows. The app that asked gets
 * `null`; only Studio's page learns which app's view it is.
 */
export const openedViewSchema = z.object({
  view: submodelViewContributionSchema,
  submodel: z.object({ id: z.string(), semanticId: z.string(), idShort: z.string().nullable() }),
  shellId: z.string().nullable(),
})
export type OpenedView = z.infer<typeof openedViewSchema>

/**
 * What Studio's server answers the host bridge for `studio.ui.embedView`
 * (ADR 0051): the view, and the frame URL with the token that lets the
 * embedding app frame it. The app gets the URL only.
 */
export const embeddedViewSchema = openedViewSchema.extend({
  token: z.string(),
  url: z.string(),
})
export type EmbeddedView = z.infer<typeof embeddedViewSchema>

// ---------------------------------------------------------------------------
// Bridge messages from app frames (validated by the host renderer)

export const appHelloSchema = z.object({
  protocol: z.literal(protocolVersion),
  type: z.literal('hello'),
  /** The embed token of a view inside another app's page (ADR 0051). */
  embed: z.string().max(2000).optional(),
  /** Random per document of such a view, so that its repeated hellos get one port. */
  instance: z.string().max(64).optional(),
})

export const appRequestMessageSchema = z.object({
  type: z.literal('request'),
  id: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  method: z.string().max(100),
  params: z.unknown(),
})
export type AppRequestMessage = z.infer<typeof appRequestMessageSchema>

// ---------------------------------------------------------------------------
// Capability calls

const identifier = z.string().min(1).max(2048)

/** A percent-encoded text decoded; `null` for a malformed escape. */
function decoded (value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

/**
 * URLs an app may open outside Studio: https, or http of this computer, where
 * local BaSyx instances answer, in the system browser; an email address
 * (`mailto:`) or a phone number (`tel:`) in the system's mail or phone app
 * (app API 0.1.14).
 */
export function isExternalUrl (value: string): boolean {
  const url = URL.parse(value)
  switch (url?.protocol) {
    case 'https:': {
      return true
    }
    case 'http:': {
      return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    }
    case 'mailto:': {
      return /^[^\s/?#@]+@[^\s/?#@]+(?:\?.*)?$/.test(value.slice('mailto:'.length))
    }
    case 'tel:': {
      // A malformed escape such as `tel:%` is no number, not an error.
      const number = decoded(url.pathname)
      return number !== null && /^\+?[\d\s().\-/]{2,40}$/.test(number)
    }
    default: {
      return false
    }
  }
}
/**
 * The http(s) address of a file that an element names at another host: the
 * value of a File, or of a Property holding the address (IDTA 02026
 * `ExternalUrl`); `null` for anything else (`studio.ui.readExternalFile`).
 */
export function externalFileUrl (element: unknown): string | null {
  const { modelType, value } = (element ?? {}) as { modelType?: unknown, value?: unknown }
  if ((modelType !== 'File' && modelType !== 'Property') || typeof value !== 'string') {
    return null
  }
  const url = URL.parse(value.trim())
  return url && (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.href : null
}

const stackId = z.string().regex(/^[\w-]{1,64}$/)
const idShortPath = z.string().min(1).max(4000)
const revision = z.string().min(1).max(200)
/** AAS content as JSON (a shell, submodel or element); Studio verifies it with AAS Core before writing. */
const aasJson = z.record(z.string(), z.unknown())

/**
 * The bytes of `studio.aas.putAttachment`, as the frame sends them (an
 * `ArrayBuffer` or a typed array) and as Studio's page forwards them; up to
 * `putAttachmentMaxBytes`.
 */
const attachmentData = z.union([z.instanceof(ArrayBuffer), z.instanceof(Uint8Array)])
  .transform(data => data instanceof Uint8Array ? data : new Uint8Array(data))
  .refine(data => data.byteLength > 0, 'must not be empty')
  .refine(data => data.byteLength <= putAttachmentMaxBytes, `must be at most ${putAttachmentMaxBytes / 1024 / 1024} MiB`)

/** A media type without parameters, in lower case, as Studio stores it with a File's content. */
const mediaType = z.string().min(1).max(200).transform(value => value.split(';', 1)[0]!.trim().toLowerCase()).pipe(z.string().regex(/^[a-z]+\/[\w.+-]+$/, 'must be a media type such as image/png'))

/** A file name without directories, as the attachment route takes it. */
const fileName = z.string().min(1).max(255).refine(name => !/[/\\\0]/.test(name), 'must not contain / or \\')

/** Parameters of every capability method; anything else is rejected. */
export const appMethodParamsSchemas = {
  'studio.ui.getContext': z.object({}).strict(),
  'studio.ui.notify': z.object({
    message: z.string().min(1).max(500),
    level: z.enum(['info', 'success', 'warning', 'error']).default('info'),
  }).strict(),
  'studio.ui.navigate': z.object({
    subPath: z.string().max(500).regex(/^(?:[\w.~-]+(?:\/[\w.~-]+)*)?$/, 'must be a relative path'),
    history: z.enum(['push', 'replace']).default('replace'),
  }).strict(),
  'studio.ui.setHeight': z.object({ height: z.number().int().min(0).max(20_000) }).strict(),
  'studio.ui.openFile': z.object({ submodelId: identifier, idShortPath, download: z.boolean().default(false) }).strict(),
  'studio.ui.readFile': z.object({ submodelId: identifier, idShortPath }).strict(),
  'studio.ui.readExternalFile': z.object({ submodelId: identifier, idShortPath }).strict(),
  'studio.ui.previewFile': z.object({ submodelId: identifier, idShortPath }).strict(),
  'studio.ui.openFullscreen': z.object({ state: z.string().max(4000).optional(), header: z.boolean().default(true) }).strict(),
  'studio.ui.closeFullscreen': z.object({}).strict(),
  'studio.ui.setViewState': z.object({ state: z.string().max(4000) }).strict(),
  'studio.aas.listShells': listQuerySchema.strict(),
  'studio.aas.getShell': z.object({ shellId: identifier }).strict(),
  'studio.aas.listSubmodels': z.object({ shellId: identifier }).strict(),
  'studio.aas.getSubmodel': z.object({ submodelId: identifier }).strict(),
  'studio.aas.getElement': z.object({ submodelId: identifier, idShortPath }).strict(),
  'studio.aas.describeConcepts': z.object({ ids: z.array(identifier).max(describeConceptsMaxIds) }).strict(),
  'studio.aas.setElementValue': z.object({
    submodelId: identifier,
    idShortPath,
    value: z.union([
      z.string().max(1_000_000).nullable(),
      z.array(langStringSchema.extend({ language: z.string().min(1).max(64), text: z.string().max(1_000_000) })).max(200),
    ]),
    revision,
  }).strict(),
  'studio.aas.getSubmodelSnapshot': z.object({ submodelId: identifier }).strict(),
  'studio.aas.createShell': z.object({ shell: aasJson, submodels: z.array(aasJson).max(50).default([]) }).strict(),
  'studio.aas.createSubmodel': z.object({ submodel: aasJson, shellId: identifier.optional() }).strict(),
  'studio.aas.putSubmodel': z.object({ submodelId: identifier, submodel: aasJson, revision }).strict(),
  'studio.aas.addElement': z.object({
    submodelId: identifier,
    parentPath: idShortPath.optional(),
    element: aasJson,
    index: z.number().int().min(0).optional(),
    structureRevision: revision,
  }).strict(),
  'studio.aas.putElement': z.object({ submodelId: identifier, idShortPath, element: aasJson, revision }).strict(),
  'studio.aas.deleteElement': z.object({ submodelId: identifier, idShortPath, revision }).strict(),
  'studio.aas.deleteSubmodel': z.object({ submodelId: identifier, removeReferences: z.boolean().default(false) }).strict(),
  'studio.aas.deleteShell': z.object({ shellId: identifier, deleteSubmodels: z.boolean().default(false) }).strict(),
  'studio.aas.putAttachment': z.object({ submodelId: identifier, idShortPath, fileName, contentType: mediaType, data: attachmentData, revision }).strict(),
  'studio.backend.call': z.object({
    method: z.string().regex(/^[A-Z]\w{0,63}$/i, 'must be the name of an exported function'),
    params: z.unknown().optional(),
  }).strict(),
  'studio.ui.openTarget': z.object({ targetId: z.string().min(1).max(200) }).strict(),
  'studio.ui.openShell': z.object({ shellId: identifier, submodelId: identifier.optional() }).strict(),
  'studio.ui.openView': z.object({
    submodelId: identifier,
    shellId: identifier.optional(),
    appId: z.string().regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*){1,9}$/, 'must be an app ID').max(128).optional(),
    viewId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/, 'must be the ID of a submodel view').optional(),
  }).strict().refine(view => view.viewId === undefined || view.appId !== undefined, { message: 'needs appId', path: ['viewId'] }),
  'studio.ui.embedView': z.object({
    submodelId: identifier,
    shellId: identifier.optional(),
    appId: z.string().regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*){1,9}$/, 'must be an app ID').max(128).optional(),
    viewId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/, 'must be the ID of a submodel view').optional(),
  }).strict().refine(view => view.viewId === undefined || view.appId !== undefined, { message: 'needs appId', path: ['viewId'] }),
  'studio.ui.openExternal': z.object({ url: z.url({ protocol: /^(?:https?|mailto|tel)$/ }).max(2000).refine(isExternalUrl, 'must be an https URL, an http URL of this computer, an email address (mailto:) or a phone number (tel:)') }).strict(),
  'studio.ui.copyText': z.object({ text: z.string().max(10_000) }).strict(),
  'studio.ui.saveFile': z.object({ fileName, contentType: mediaType, text: z.string().max(1024 * 1024) }).strict(),
  'studio.containers.listEngines': z.object({}).strict(),
  'studio.containers.selectEngine': z.object({ host: engineHostSchema.nullable() }).strict(),
  'studio.containers.listStacks': z.object({}).strict(),
  'studio.containers.getStack': z.object({ stackId }).strict(),
  'studio.containers.planStack': z.object({ spec: stackSpecSchema, stackId: stackId.optional() }).strict(),
  'studio.containers.createStack': z.object({
    spec: stackSpecSchema,
    aasxFiles: z.array(fileHandleSchema).max(20).optional(),
    importId: z.string().max(64).optional(),
  }).strict(),
  'studio.containers.changeStack': z.object({ stackId, spec: stackSpecSchema, aasxFiles: z.array(fileHandleSchema).max(20).optional() }).strict(),
  'studio.containers.startStack': z.object({ stackId }).strict(),
  'studio.containers.stopStack': z.object({ stackId }).strict(),
  'studio.containers.updateStack': z.object({ stackId }).strict(),
  'studio.containers.removeStack': z.object({ stackId, deleteData: z.boolean(), removeInfrastructure: z.boolean() }).strict(),
  'studio.containers.getJob': z.object({ jobId: z.string().min(1).max(64) }).strict(),
  'studio.containers.getLogs': z.object({ stackId, component: stackComponentIdSchema, tail: z.number().int().min(1).max(5000).default(500) }).strict(),
  'studio.containers.saveLogs': z.object({ stackId, component: stackComponentIdSchema, fileHandle: fileHandleSchema }).strict(),
  'studio.containers.getSignIn': z.object({ stackId }).strict(),
  // Studio authorizes the pick; then the host shows the native dialog (ADR 0015).
  'studio.containers.pickFiles': z.object({ kind: z.enum(stackFileKinds), suggestedName: z.string().max(200).optional() }).strict(),
  'studio.containers.exportStack': z.object({ stackId, fileHandle: fileHandleSchema }).strict(),
  'studio.containers.importStack': z.object({ fileHandle: fileHandleSchema }).strict(),
  'studio.timeseries.read': timeSeriesReadParamsSchema,
  // The HTTP binding of the call, with bytes as base64 (ADR 0047).
  'studio.connections.call': connectionCallParamsSchema,
} satisfies Record<MethodName, z.ZodType>

export type AppMethodParams<M extends MethodName> = Methods[M]['params']

/** Methods that change AAS content; Studio's page refreshes its own views after them. */
export const studioAppWriteMethods: ReadonlySet<MethodName> = new Set<MethodName>(['studio.aas.setElementValue', ...editModeMethods])

export const appMethodNameSchema = z.enum(Object.keys(appMethodParamsSchemas) as [MethodName, ...MethodName[]])

/** A capability call from the host bridge (session) or a backend app (capability token). */
export const appCallInputSchema = z.object({
  /** Required for host calls; implied by the token for backend calls. */
  installationId: z.string().max(64).optional(),
  /**
   * The package digest the calling frame was loaded from (ADR 0044). Studio's
   * page always sends it; a call from an older version is refused with
   * `app_outdated`.
   */
  digest: z.string().max(80).optional(),
  /** The target the frame is bound to; `null` for a global module outside a target. */
  targetId: z.string().max(200).nullable().optional(),
  /** The shell the frame shows, if any; some infrastructures reach submodels only through it. */
  shellId: z.string().max(4000).nullable().optional(),
  /**
   * Studio's mode on the page that hosts the frame. Structural writes and
   * attachments need `edit` (MVP-7 A1); for a backend, the mode of the call
   * that started it counts, which its capability token carries.
   */
  mode: z.enum(['view', 'edit']).optional(),
  method: appMethodNameSchema,
  params: z.unknown(),
})
export type AppCallInput = z.infer<typeof appCallInputSchema>

/**
 * `PUT /app-calls/attachment`: `studio.aas.putAttachment` from the host
 * bridge. The body is the file, its media type the `Content-Type`; the rest
 * of the call is in the query, so the bytes cross no JSON.
 */
export const appAttachmentQuerySchema = z.object({
  installationId: z.string().min(1).max(64),
  digest: z.string().max(80).optional(),
  targetId: z.string().min(1).max(200),
  shellId: z.string().max(4000).optional(),
  mode: z.enum(['view', 'edit']),
  submodelId: identifier,
  idShortPath,
  fileName,
  revision,
})
export type AppAttachmentQuery = z.infer<typeof appAttachmentQuerySchema>

export const appCallResultSchema = z.object({
  result: z.unknown(),
})
export type AppCallResult = z.infer<typeof appCallResultSchema>

export { type AppContext, type MethodName as AppMethodName, protocolVersion as appProtocol, editModeMethods, embedTokenParameter, methodPermissions, putAttachmentMaxBytes, readFileMaxBytes } from '@basyx/studio-sdk/protocol'
