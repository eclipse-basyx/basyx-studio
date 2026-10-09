import type { MethodName, Methods } from '@basyx/studio-sdk/protocol'
import { permissions, protocolVersion } from '@basyx/studio-sdk/protocol'
import { z } from 'zod'
import { langStringSchema, listQuerySchema } from './target'

// Runtime-installable apps (ADR 0004, MVP-3). The `studio-sdk/0` message
// types are defined by @basyx/studio-sdk; these schemas validate what Studio
// receives from app frames and serves through `/app-installations`,
// `/app-contributions` and `/app-calls`.

export const appPermissionSchema = z.enum(permissions)
export type AppPermission = z.infer<typeof appPermissionSchema>

export const localizedTextSchema = z.record(z.string(), z.string())
export type LocalizedText = z.infer<typeof localizedTextSchema>

export const appInstallationSchema = z.object({
  id: z.string(),
  appId: z.string(),
  version: z.string(),
  title: localizedTextSchema,
  description: localizedTextSchema.nullable(),
  publisher: z.string(),
  /** `sha256:<hex>` of the uploaded package. */
  digest: z.string(),
  /** Installed through developer mode, without a marketplace signature. */
  unsigned: z.boolean(),
  permissions: z.array(appPermissionSchema),
  submodelViews: z.number().int(),
  modules: z.number().int(),
  backend: z.boolean(),
  installedAt: z.string(),
  installedBy: z.string(),
})
export type AppInstallation = z.infer<typeof appInstallationSchema>

const contributionBase = {
  installationId: z.string(),
  appId: z.string(),
  appTitle: localizedTextSchema,
  id: z.string(),
  title: localizedTextSchema,
  /** URL of the sandboxed entry document on the app origin. */
  entryUrl: z.string(),
  permissions: z.array(appPermissionSchema),
  unsigned: z.boolean(),
}

export const submodelViewContributionSchema = z.object({
  kind: z.literal('submodelView'),
  ...contributionBase,
  /** Why the view is offered, e.g. the semantic ID that matched. */
  reason: z.object({ semanticId: z.string() }),
})
export type SubmodelViewContributionInfo = z.infer<typeof submodelViewContributionSchema>

export const moduleContributionSchema = z.object({
  kind: z.literal('module'),
  ...contributionBase,
  icon: z.string().nullable(),
  route: z.string(),
  context: z.enum(['global', 'target', 'shell']),
})
export type ModuleContributionInfo = z.infer<typeof moduleContributionSchema>

export type AppContributionInfo = SubmodelViewContributionInfo | ModuleContributionInfo

export const appContributionsQuerySchema = z.object({
  /** Submodel semantic ID; submodel views are returned only when it is given. */
  semanticId: z.string().min(1).max(2048).optional(),
})

export const appContributionsSchema = z.object({
  submodelViews: z.array(submodelViewContributionSchema),
  modules: z.array(moduleContributionSchema),
})
export type AppContributions = z.infer<typeof appContributionsSchema>

// ---------------------------------------------------------------------------
// Bridge messages from app frames (validated by the host renderer)

export const appHelloSchema = z.object({
  protocol: z.literal(protocolVersion),
  type: z.literal('hello'),
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
const idShortPath = z.string().min(1).max(4000)

/** Parameters of every capability method; anything else is rejected. */
export const appMethodParamsSchemas = {
  'studio.ui.getContext': z.object({}).strict(),
  'studio.ui.notify': z.object({
    message: z.string().min(1).max(500),
    level: z.enum(['info', 'success', 'warning', 'error']).default('info'),
  }).strict(),
  'studio.ui.navigate': z.object({
    subPath: z.string().max(500).regex(/^(?:[\w.~-]+(?:\/[\w.~-]+)*)?$/, 'must be a relative path'),
  }).strict(),
  'studio.aas.listShells': listQuerySchema.strict(),
  'studio.aas.getShell': z.object({ shellId: identifier }).strict(),
  'studio.aas.listSubmodels': z.object({ shellId: identifier }).strict(),
  'studio.aas.getSubmodel': z.object({ submodelId: identifier }).strict(),
  'studio.aas.getElement': z.object({ submodelId: identifier, idShortPath }).strict(),
  'studio.aas.setElementValue': z.object({
    submodelId: identifier,
    idShortPath,
    value: z.union([
      z.string().max(1_000_000).nullable(),
      z.array(langStringSchema.extend({ language: z.string().min(1).max(64), text: z.string().max(1_000_000) })).max(200),
    ]),
    revision: z.string().min(1).max(200),
  }).strict(),
  'studio.backend.call': z.object({
    method: z.string().regex(/^[A-Z]\w{0,63}$/i, 'must be the name of an exported function'),
    params: z.unknown().optional(),
  }).strict(),
} satisfies Record<MethodName, z.ZodType>

export type AppMethodParams<M extends MethodName> = Methods[M]['params']

export const appMethodNameSchema = z.enum(Object.keys(appMethodParamsSchemas) as [MethodName, ...MethodName[]])

/** A capability call from the host bridge (session) or a backend app (capability token). */
export const appCallInputSchema = z.object({
  /** Required for host calls; implied by the token for backend calls. */
  installationId: z.string().max(64).optional(),
  /** The target the frame is bound to; `null` for a global module outside a target. */
  targetId: z.string().max(200).nullable().optional(),
  method: appMethodNameSchema,
  params: z.unknown(),
})
export type AppCallInput = z.infer<typeof appCallInputSchema>

export const appCallResultSchema = z.object({
  result: z.unknown(),
})
export type AppCallResult = z.infer<typeof appCallResultSchema>

export { type AppContext, type MethodName as AppMethodName, protocolVersion as appProtocol, methodPermissions } from '@basyx/studio-sdk/protocol'
