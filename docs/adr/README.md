# Architecture Decision Records

Architecture decision records (ADRs) capture consequential choices, their
context, and their trade-offs. Accepted ADRs are normative. If a later decision
changes one, add a new ADR with `Supersedes` and mark the old record
`Superseded`; do not silently rewrite the original reasoning.

## Index

| ADR | Status | Decision |
| --- | --- | --- |
| [0001](0001-runtime-and-service-boundaries.md) | Accepted | Nuxt/Nitro Studio Service with Electron as the desktop host |
| [0002](0002-bff-and-authentication.md) | Accepted | BFF owns authentication, credentials, and downstream access |
| [0003](0003-aas-targets-and-workspaces.md) | Accepted | One target contract for live servers and isolated AASX workspaces |
| [0004](0004-runtime-installable-apps.md) | Accepted | Signed, capability-based, isolated runtime-installable apps |
| [0005](0005-storage-and-observability.md) | Partially superseded by 0011 | PostgreSQL baseline and reuse of the BaSyx Go observability stack; desktop SQLite superseded |
| [0006](0006-frontend-state-and-validation.md) | Accepted | Pragmatic Nuxt/Pinia state with selective Pinia Colada and layered validation |
| [0007](0007-http-and-realtime-transports.md) | Accepted | HTTP by default; SSE or WebSockets only for justified realtime behavior |
| [0008](0008-evolutionary-architecture-and-dependencies.md) | Accepted | Evolutionary architecture and explicit justification for added complexity |
| [0009](0009-declarative-graphical-views.md) | Accepted | Declarative graphical views with capability-bound built-in and app widgets |
| [0010](0010-pnpm-only-supply-chain.md) | Accepted, amended by 0012 | PNPM-only package management with hardened supply-chain controls |
| [0011](0011-single-postgresql-dialect-with-pglite.md) | Accepted | PostgreSQL as the only SQL dialect; embedded PGlite for desktop metadata |
| [0012](0012-release-age-exceptions-for-basyx-packages.md) | Accepted | Exact-version release-age exceptions for reviewed Eclipse BaSyx packages |
| [0013](0013-revision-tokens-and-conditional-writes.md) | Accepted | Element-hash revision tokens; conditional writes on the fresh downstream ETag |
| [0014](0014-workspace-worker-and-package-engine.md) | Accepted | Supervised Workspace Worker process; aas-package3-typescript with archive checks |
| [0015](0015-desktop-native-bridge-and-file-grants.md) | Accepted | Two-call preload bridge; single-use file grants from the Electron main process |
| [0016](0016-app-manifest-and-packages.md) | Accepted | Versioned JSON Schema manifest; packages checked completely and stored content-addressed |
| [0017](0017-app-origin-and-content-security-policy.md) | Accepted | Sandboxed frames on a separate apps origin or `studio-app:` protocol, strict CSP |
| [0018](0018-capability-bridge-and-authorization.md) | Accepted | `studio-sdk/0` MessagePort bridge; manifest permissions plus the user's own rights |
| [0019](0019-backend-app-runner.md) | Accepted | Deno process per backend, deny-by-default, short-lived capability tokens |

## Template

```markdown
# NNNN: Short decision title

- Status: Proposed
- Date: YYYY-MM-DD
- Deciders: BaSyx Studio maintainers
- Requirements: REQ-001

## Context

What forces or constraints require a decision?

## Decision

What is being decided?

## Consequences

What becomes easier, harder, required, or intentionally deferred?

## Alternatives considered

Which credible alternatives were rejected, and why?
```
