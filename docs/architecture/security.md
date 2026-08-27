# Security Architecture

Studio is a security boundary between users, third-party apps, local files, and one or more AAS infrastructures. The BFF and capability broker are therefore core architecture, not optional deployment helpers.

Authentication sequences are consolidated in [mechanisms.md](mechanisms.md).

## BFF boundary

The browser and Electron renderer communicate with a same-origin/local Studio API using an HttpOnly session cookie. They never receive downstream OAuth access tokens, refresh tokens, or confidential client secrets.

The Studio Service:

- resolves the active target from an authorized server-side identifier
- loads infrastructure configuration and credentials server-side
- performs resource-oriented AAS calls through `basyx-typescript-sdk`
- enforces per-user authorization before downstream calls
- records the Studio user, deployment, target, and downstream identity in audit events
- applies timeouts, limits, validation, and observability

Studio must not expose a generic authenticated proxy or accept an arbitrary renderer-supplied upstream URL.

Multiple configured infrastructures remain separate security contexts. Session
and token records are keyed by user, deployment, and opaque target ID. The BFF
never selects credentials from a renderer-provided URL and never reuses a token
for a different target merely because issuers or endpoints look similar.

Cross-target copy reauthorizes the source read and every planned destination
write immediately before execution. Its audit record identifies the Studio user,
both target IDs, both downstream identities, collision policy, idempotency key,
and per-resource outcome without logging transferred AAS contents.

## Authentication modes

### Authorization code with PKCE

Use for user login. The BFF creates state, nonce, and PKCE verifier material, receives the callback, exchanges the code, and keeps tokens server-side.

Hosted user sessions are stored in PostgreSQL initially. Desktop token material is protected through Electron `safeStorage` and the operating-system keychain. Native login opens the system browser.

### Client credentials

Use when an AAS provider intentionally gives only a particular hosted Studio deployment access to its infrastructure, for example a product catalogue.

The client secret is deployment configuration, not user data. The BFF obtains and caches service tokens. Because the downstream server sees the Studio service identity, Studio must independently authorize the logged-in user and audit both identities.

### Unsecured infrastructure

Studio may connect without OAuth when explicitly configured. The same endpoint validation and authorization rules still apply.

## OIDC portability

Keycloak is the primary reference and development IdP, but implementation must use standard discovery, authorization, token, logout, and claim handling. BaSyx Go also tests alternative providers such as Ory and Entra ID; Studio must not hard-code realm URLs or Keycloak-only claim shapes.

## Hosted authorization

Initial authorization may use deployment roles and OIDC user/group claims stored/mapped in PostgreSQL. Keep installation scope separate from visibility:

- deployment administrators install/update/remove apps and infrastructures
- app visibility rules select permitted users/groups
- app capabilities remain subject to the current user's rights on the active target

Adopt a relationship-authorization service only if the PostgreSQL policy model becomes demonstrably insufficient.

## Network security

All downstream and app-mediated requests require:

- configured target or declared-origin allowlists
- scheme and port policy
- DNS resolution and private/link-local/loopback policy appropriate to deployment
- redirect revalidation on every hop
- connection, request, and response timeouts
- response-size and streaming limits
- proxy behavior that cannot bypass address checks
- rejection of embedded credentials and unsafe URL forms

Local Docker targets are a supported desktop use case, so loopback/private-address policy must be explicit rather than globally forbidden.

## App security

App signatures establish artifact integrity and publisher identity; they do not prove that an app is safe. Runtime permissions and isolation remain mandatory.

- UI apps use sandboxed isolated origins and strict content security policy.
- Backend apps use separate constrained runtimes/processes.
- Capability requests are validated, authorized, and audited.
- Network plus AAS-read permission receives an explicit data-egress warning.
- Apps never receive OAuth tokens, client secrets, database credentials, host Pinia stores, or unrestricted Electron IPC.
- Revoked artifacts cannot be newly installed and can be disabled according to deployment policy.

## View-definition and binding security

Treat imported/saved view definitions, widget configuration, and AAS binding
descriptors as untrusted data. Validate schema version, sizes, identifiers,
layout bounds, binding kinds, and app contribution ownership before persistence
and again before rendering.

- Definitions contain no executable JavaScript, Vue templates, HTML, service
  URLs, credentials, or ambient filesystem paths.
- Opening or editing a shared view does not grant access to its bound AAS data.
- Every binding call is authorized for the current user, target, action, and app
  identity where applicable.
- Write bindings and AAS operations require explicit widget declarations and UI
  actions; safety-relevant actions may require confirmation.
- App widgets remain cross-origin sandboxed and receive scoped handles through
  the capability broker.
- Rich text and labels are rendered with safe components and sanitization where
  formatted content is intentionally supported.

## Electron security

- renderer sandbox enabled
- `contextIsolation: true`
- no Node integration in renderers
- minimal preload API
- schema validation for every IPC message and return value
- native file operations constrained to validated handles/workspaces
- local Studio Service bound to random loopback port
- one-time launch secret between Electron and local Studio Service
- explicit readiness and process supervision
- code-signed/notarized application and signed updates
- secrets stored through OS-protected storage

The local Nitro service, workspace worker, and app extension host are distinct processes with explicit shutdown and crash behavior.

## Input validation

- Use Zod for Studio-owned HTTP, WebSocket, Electron IPC, configuration, and internal app-RPC boundaries.
- Use strict schemas for security-sensitive objects.
- Use JSON Schema/Ajv for public app manifests.
- Use JSON Schema/Ajv for portable view definitions and app widget contribution schemas.
- Use generated client types plus AAS Core/package validation for AAS payloads.
- Validate persisted data again when it crosses into a newer application version.

## Browser protections

- HttpOnly, Secure, SameSite session cookies in hosted production
- CSRF protection or strict Origin validation for state-changing endpoints
- restrictive CSP and no inline third-party app execution
- output escaping and safe URL rendering
- frame/source separation for UI apps
- no secret-bearing public runtime configuration

## Audit versus diagnostic logs

Security/audit events and diagnostic logs are different data products. Audit records are durable, authorized application records. Diagnostic logs are operational streams. Do not rely on Loki retention as the only audit trail, and do not put secrets or package contents in either.
