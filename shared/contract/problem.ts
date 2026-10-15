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
  'app_not_found',
  'app_permission_not_declared',
  'app_backend_unavailable',
  'app_backend_failed',
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
