import type { ProblemCode } from '#shared/contract'

interface ProblemDefinition {
  status: number
  title: string
  retryable: boolean
}

const definitions: Record<ProblemCode, ProblemDefinition> = {
  unauthenticated: { status: 401, title: 'Sign-in required', retryable: false },
  forbidden: { status: 403, title: 'Not permitted', retryable: false },
  csrf_rejected: { status: 403, title: 'Request origin or CSRF token rejected', retryable: false },
  invalid_request: { status: 400, title: 'Invalid request', retryable: false },
  not_found: { status: 404, title: 'Not found', retryable: false },
  revision_conflict: { status: 412, title: 'The resource was changed by someone else', retryable: false },
  precondition_required: { status: 428, title: 'The request needs the revision it is based on (If-Match)', retryable: false },
  unsupported_operation: { status: 422, title: 'This operation is not supported here', retryable: false },
  validation_failed: { status: 422, title: 'The value is not valid', retryable: false },
  internal_error: { status: 500, title: 'Internal error', retryable: true },
  endpoint_rejected: { status: 422, title: 'Endpoint not permitted by the network policy', retryable: false },
  infrastructure_unreachable: { status: 422, title: 'Infrastructure could not be reached', retryable: true },
  target_auth_required: { status: 409, title: 'Authorization for this target is required', retryable: false },
  target_credentials_rejected: { status: 502, title: 'The target rejected Studio\'s credentials', retryable: false },
  target_forbidden: { status: 403, title: 'The target denied access', retryable: false },
  target_resource_not_found: { status: 404, title: 'The target has no such resource', retryable: false },
  target_request_rejected: { status: 400, title: 'The target rejected the request', retryable: false },
  target_unreachable: { status: 502, title: 'The target could not be reached', retryable: true },
  target_blocked: { status: 502, title: 'The request was blocked by the network policy', retryable: false },
  target_error: { status: 502, title: 'The target reported an error', retryable: true },
  target_invalid_response: { status: 502, title: 'The target returned an invalid response', retryable: false },
  workspace_unsaved_changes: { status: 409, title: 'The workspace has unsaved changes', retryable: false },
  package_rejected: { status: 422, title: 'The package cannot be opened', retryable: false },
  app_package_rejected: { status: 422, title: 'The app package is not valid', retryable: false },
  app_incompatible: { status: 422, title: 'The app is not compatible with this Studio', retryable: false },
  app_already_installed: { status: 409, title: 'This app version is already installed', retryable: false },
  app_unsigned_disabled: { status: 403, title: 'Installing unsigned apps is disabled in this deployment', retryable: false },
  app_not_found: { status: 404, title: 'The app is not installed', retryable: false },
  app_permission_not_declared: { status: 403, title: 'The app did not declare the permission for this call', retryable: false },
  app_backend_unavailable: { status: 503, title: 'The app backend is not available', retryable: true },
  app_backend_failed: { status: 502, title: 'The app backend failed', retryable: false },
}

export interface Violation {
  path: string
  message: string
}

/** An expected, user-presentable failure that maps to `application/problem+json`. */
export class StudioProblem extends Error {
  readonly code: ProblemCode
  readonly status: number
  readonly title: string
  readonly retryable: boolean
  readonly detail: string | undefined
  readonly violations: Violation[] | undefined

  constructor (code: ProblemCode, detail?: string, options?: { violations?: Violation[], cause?: unknown }) {
    const definition = definitions[code]
    super(detail ?? definition.title, { cause: options?.cause })
    this.name = 'StudioProblem'
    this.code = code
    this.status = definition.status
    this.title = definition.title
    this.retryable = definition.retryable
    this.detail = detail
    this.violations = options?.violations
  }
}
