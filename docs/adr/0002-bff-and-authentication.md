# 0002: BFF and authentication

- Status: Accepted
- Date: 2026-08-24
- Deciders: BaSyx Studio maintainers
- Requirements: DATA-003, SEC-001 through SEC-006, SEC-009

## Context

Studio must connect to differently secured AAS infrastructures, support normal
interactive login, and support hosted catalogue scenarios where the Studio
deployment authenticates to an AAS provider with client credentials. Browser
code and installed apps must not receive reusable downstream secrets.

## Decision

Use the Studio Service as a backend-for-frontend (BFF). Browser clients receive
an opaque, secure, HttpOnly Studio session. The BFF owns OAuth/OIDC protocol
handling, token refresh, credential selection, target resolution, authorization,
and audit attribution.

Support these downstream strategies behind one target configuration:

- user's delegated access token when the infrastructure is user-aware;
- Studio deployment client credentials for curated hosted access;
- explicitly configured unsecured access for trusted local development only.

Use authorization code with PKCE for interactive login. Use standards-based
generic OIDC integration before adding provider-specific behavior. Store client
secrets in a deployment secret store or desktop OS credential storage, never in
client-delivered configuration or ordinary database columns.

Studio authorization is always evaluated even when a single service identity is
used downstream. Audit records identify both the Studio user and the downstream
service identity.

## Consequences

- The browser has a same-origin Studio API and no direct dependency on AAS CORS
  or token storage.
- Client credentials can be used without disclosing them to users.
- BFF compromise is security-significant and requires hardened sessions, CSRF
  protection, SSRF defenses, secret isolation, and audit coverage.
- Horizontal hosted scaling needs a shared or cryptographically verifiable
  session strategy.
- Direct browser-to-AAS calls are not a supported privileged path.

## Alternatives considered

- **Tokens in browser storage:** rejected because XSS would expose reusable
  credentials and client credentials cannot be kept secret.
- **Authentication proxy only:** insufficient because Studio also needs
  target-aware policy, app capabilities, auditing, and SDK orchestration.
