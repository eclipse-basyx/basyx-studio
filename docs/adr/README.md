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
| [0005](0005-storage-and-observability.md) | Accepted | PostgreSQL/SQLite baseline and reuse of the BaSyx Go observability stack |
| [0006](0006-frontend-state-and-validation.md) | Accepted | Pragmatic Nuxt/Pinia state with selective Pinia Colada and layered validation |
| [0007](0007-http-and-realtime-transports.md) | Accepted | HTTP by default; SSE or WebSockets only for justified realtime behavior |
| [0008](0008-evolutionary-architecture-and-dependencies.md) | Accepted | Evolutionary architecture and explicit justification for added complexity |
| [0009](0009-declarative-graphical-views.md) | Accepted | Declarative graphical views with capability-bound built-in and app widgets |
| [0010](0010-pnpm-only-supply-chain.md) | Accepted | PNPM-only package management with hardened supply-chain controls |

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
