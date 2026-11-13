import { z } from 'zod'

/**
 * Stable problem codes of the Studio API. The UI branches on these codes,
 * never on HTTP status codes or message texts.
 */
export const problemCodes = [
  // Studio-level
  'unauthenticated',
  'forbidden',
  'csrf_rejected',
  'invalid_request',
  'not_found',
  'revision_conflict',
  'precondition_required',
  'unsupported_operation',
  'validation_failed',
  /** An element with this idShort exists among the siblings. */
  'idshort_conflict',
  /** The children of the parent changed since the structure revision was read. */
  'structure_conflict',
  /** A shell or submodel with this identifier exists already; nothing was written. */
  'identifier_conflict',
  /** Some steps of a write over several resources were written, others were not (see `steps`). */
  'partial_write',
  /** A submodel template cannot be instantiated. */
  'template_invalid',
  'internal_error',
  // Infrastructure administration
  'endpoint_rejected',
  'infrastructure_unreachable',
  // Downstream target access
  'target_auth_required',
  'target_credentials_rejected',
  'target_forbidden',
  'target_resource_not_found',
  'target_request_rejected',
  'target_unreachable',
  'target_blocked',
  'descriptor_endpoint_blocked',
  'target_error',
  'target_invalid_response',
  'target_client_certificate_required',
  'target_client_certificate_rejected',
  'client_certificate_invalid',
  // Search
  'query_invalid',
  'query_unsupported',
  // Desktop workspaces
  'workspace_unsaved_changes',
  'package_rejected',
  // Apps
  'app_package_rejected',
  'app_incompatible',
  'app_already_installed',
  'app_unsigned_disabled',
  /** The signature is malformed, or does not verify with any key of the trust store (ADR 0044). */
  'app_signature_invalid',
  /** The signing key may not sign this app ID, or an update comes from another publisher than the installation. */
  'app_signer_not_allowed',
  /** The key that signed the installed app was removed from the trust store, or no longer covers its app ID. */
  'app_revoked',
  /** The package combines connect origins with WebAssembly or workers, and its publisher has no `remoteCode` grant (ADR 0045). */
  'app_sandbox_not_granted',
  /** The calling frame or backend runs an older version of the app than the installed one; reload it. */
  'app_outdated',
  /** A structural write or attachment upload of an app outside Studio's edit mode (MVP-7 A1). */
  'app_edit_mode_required',
  /** The App Builder built another preview package after the one the user was asked to allow (ADR 0054, plan B4). */
  'preview_changed',
  'app_not_found',
  'app_permission_not_declared',
  'app_backend_unavailable',
  'app_backend_failed',
  /** A file that AAS content names at another host could not be fetched (unreachable, refused by CORS, an error status, or too large). */
  'external_file_unavailable',
  /** The deployment does not let Studio's server fetch files from that origin or address (ADR 0042). */
  'external_file_refused',
  // Local BaSyx instances (ADR 0033)
  /** No container engine answers, or the chosen one is not running. */
  'container_engine_unavailable',
  /** Another operation runs for this instance. */
  'container_busy',
  /** A port the instance needs is used by another program. */
  'container_port_in_use',
  /** An image could not be downloaded. */
  'container_image_unavailable',
  /** The engine has no disk space left. */
  'container_disk_full',
  /** A component did not get ready; `violations[0].path` names it. */
  'container_start_failed',
  /** The engine refused an operation. */
  'container_operation_failed',
  // The App Builder's coding agents (ADR 0054)
  /** The agent's CLI is missing or signed out, or the agent process stopped. */
  'agent_unavailable',
  /** The conversation is in a turn already, or not in one. */
  'agent_busy',
  // Connections to third-party services (ADR 0040)
  /** No connection of the infrastructure serves this purpose for the service the content names. */
  'connection_not_configured',
  /** The secret of the connection could not be resolved (a missing env: or file: reference). */
  'connection_credentials_unavailable',
  /** The service rejected the connection's credentials (HTTP 401 or 403). */
  'connection_rejected',
  /** The service could not be reached, did not answer in time or answered too much. */
  'connection_unavailable',
  /** The service reported an error for the request. */
  'connection_error',
  /** The content asks for something the adapter does not send, e.g. a Flux query that writes. */
  'connection_request_refused',
  // HTTP connections for apps (ADR 0047)
  /** No `http` connection of the target's infrastructure binds the app's connection, or the frame has no infrastructure. */
  'connection_not_bound',
  /** The app's manifest does not declare the connection, or does not list the operation for it. */
  'connection_operation_not_declared',
  /** Four calls of this session to the connection are in progress. */
  'connection_busy',
  // Time series (ADR 0040)
  /** The submodel is not an IDTA Time Series Data submodel, or the segment or records are not in it. */
  'timeseries_invalid',
] as const

export const problemCodeSchema = z.enum(problemCodes)
export type ProblemCode = z.infer<typeof problemCodeSchema>

export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: problemCodeSchema,
  detail: z.string().optional(),
  requestId: z.string(),
  retryable: z.boolean(),
  violations: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  /** What a write over several resources did, step by step (`partial_write`). */
  steps: z.array(z.object({
    resource: z.enum(['submodel', 'shell', 'submodelReference', 'shellDescriptor', 'submodelDescriptor', 'assetLinks']),
    id: z.string(),
    outcome: z.enum(['written', 'removed', 'failed', 'skipped']),
    detail: z.string().optional(),
  })).optional(),
})
export type Problem = z.infer<typeof problemSchema>

export function isProblem (value: unknown): value is Problem {
  return problemSchema.safeParse(value).success
}
