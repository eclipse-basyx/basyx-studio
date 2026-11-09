import type { Problem, ProblemCode } from '#shared/contract'

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
  idshort_conflict: { status: 409, title: 'An element with this idShort already exists here', retryable: false },
  structure_conflict: { status: 412, title: 'The structure was changed by someone else', retryable: false },
  identifier_conflict: { status: 409, title: 'This identifier is used already', retryable: false },
  partial_write: { status: 502, title: 'Only some of the changes were written', retryable: false },
  template_invalid: { status: 422, title: 'The template cannot be used', retryable: false },
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
  descriptor_endpoint_blocked: { status: 502, title: 'The registry points to an endpoint outside this infrastructure', retryable: false },
  query_invalid: { status: 422, title: 'The query is not valid', retryable: false },
  query_unsupported: { status: 422, title: 'This target cannot run queries', retryable: false },
  target_error: { status: 502, title: 'The target reported an error', retryable: true },
  target_invalid_response: { status: 502, title: 'The target returned an invalid response', retryable: false },
  target_client_certificate_required: { status: 502, title: 'The target requires a TLS client certificate', retryable: false },
  target_client_certificate_rejected: { status: 502, title: 'The target rejected the TLS client certificate', retryable: false },
  client_certificate_invalid: { status: 422, title: 'The configured client certificate cannot be used', retryable: false },
  workspace_unsaved_changes: { status: 409, title: 'The workspace has unsaved changes', retryable: false },
  package_rejected: { status: 422, title: 'The package cannot be opened', retryable: false },
  app_package_rejected: { status: 422, title: 'The app package is not valid', retryable: false },
  app_incompatible: { status: 422, title: 'The app is not compatible with this Studio', retryable: false },
  app_already_installed: { status: 409, title: 'This app version or a newer one is already installed', retryable: false },
  app_unsigned_disabled: { status: 403, title: 'Installing unsigned apps is disabled in this deployment', retryable: false },
  app_signature_invalid: { status: 422, title: 'The app package signature is not valid', retryable: false },
  app_signer_not_allowed: { status: 403, title: 'The signer may not publish this app', retryable: false },
  app_revoked: { status: 403, title: 'The app is no longer trusted', retryable: false },
  app_sandbox_not_granted: { status: 403, title: 'The publisher may not publish apps that run code from outside their package', retryable: false },
  app_outdated: { status: 409, title: 'The app was updated; reload it', retryable: false },
  app_edit_mode_required: { status: 403, title: 'Switch to edit mode to change content from an app', retryable: false },
  app_not_found: { status: 404, title: 'The app is not installed', retryable: false },
  app_permission_not_declared: { status: 403, title: 'The app did not declare the permission for this call', retryable: false },
  app_backend_unavailable: { status: 503, title: 'The app backend is not available', retryable: true },
  app_backend_failed: { status: 502, title: 'The app backend failed', retryable: false },
  external_file_unavailable: { status: 502, title: 'The external file could not be fetched', retryable: true },
  external_file_refused: { status: 403, title: 'Studio does not fetch files from this address', retryable: false },
  container_engine_unavailable: { status: 503, title: 'No container engine is running', retryable: true },
  container_busy: { status: 409, title: 'Another operation is running for this instance', retryable: true },
  container_port_in_use: { status: 409, title: 'A port is used by another program', retryable: false },
  container_image_unavailable: { status: 502, title: 'An image could not be downloaded', retryable: true },
  container_disk_full: { status: 507, title: 'The container engine has no disk space left', retryable: false },
  container_start_failed: { status: 502, title: 'A component did not start', retryable: true },
  container_operation_failed: { status: 502, title: 'The container engine refused the operation', retryable: false },
  agent_unavailable: { status: 503, title: 'The coding agent is not available', retryable: true },
  agent_busy: { status: 409, title: 'The conversation is busy', retryable: true },
  connection_not_configured: { status: 422, title: 'No connection is configured for this service', retryable: false },
  connection_credentials_unavailable: { status: 502, title: 'The credentials of the connection could not be resolved', retryable: false },
  connection_rejected: { status: 502, title: 'The service rejected the connection\'s credentials', retryable: false },
  connection_unavailable: { status: 502, title: 'The service could not be reached', retryable: true },
  connection_error: { status: 502, title: 'The service reported an error', retryable: true },
  connection_request_refused: { status: 422, title: 'Studio does not send this request', retryable: false },
  connection_not_bound: { status: 403, title: 'The app\'s connection is not bound to a connection of this infrastructure', retryable: false },
  connection_operation_not_declared: { status: 403, title: 'The app did not declare this connection or operation', retryable: false },
  connection_busy: { status: 429, title: 'Too many calls to this connection are in progress', retryable: true },
  timeseries_invalid: { status: 422, title: 'The time series cannot be read', retryable: false },
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
  readonly steps: Problem['steps']

  constructor (code: ProblemCode, detail?: string, options?: { violations?: Violation[], steps?: Problem['steps'], cause?: unknown }) {
    const definition = definitions[code]
    super(detail ?? definition.title, { cause: options?.cause })
    this.name = 'StudioProblem'
    this.code = code
    this.status = definition.status
    this.title = definition.title
    this.retryable = definition.retryable
    this.detail = detail
    this.violations = options?.violations
    this.steps = options?.steps
  }
}
