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
  'target_error',
  'target_invalid_response',
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
})
export type Problem = z.infer<typeof problemSchema>

export function isProblem (value: unknown): value is Problem {
  return problemSchema.safeParse(value).success
}
