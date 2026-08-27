# 0003: AAS targets and workspaces

- Status: Accepted
- Date: 2026-08-24
- Deciders: BaSyx Studio maintainers
- Requirements: PROD-002 through PROD-004, PROD-007, DATA-001 through DATA-003,
  DATA-005 through DATA-007, DATA-009 through DATA-016

## Context

Studio needs one understandable editing experience for live Type 2 shells and
desktop-local AASX packages. Their implementation and persistence semantics
differ, but the core UI and installed apps should not contain independent
feature implementations for each data source.

## Decision

Define a versioned `AasTarget` capability contract used by the core UI and apps.
Target IDs are opaque and target-scoped revisions, permissions, and capabilities
are explicit.

Implement target adapters as follows:

- Live targets use the BaSyx TypeScript SDK from the Studio Service. The SDK is
  the reusable AAS client layer; Studio adds target policy and workflow logic.
- Desktop AASX targets use a separately supervised local Workspace Worker with
  brokered filesystem access and atomic writes.

Use optimistic concurrency with explicit revisions. Qualify the desktop package
engine using golden round-trip fixtures covering supplementary files,
relationships, unknown extensions, ordering-sensitive data, and supported
metamodel versions.

Keep independently authenticated target sessions keyed by opaque target ID. The
UI normally selects one active target, but an explicit cross-target workflow may
resolve two targets simultaneously. Implement live-to-live AAS copy as a Studio
Service orchestration over source- and destination-configured TypeScript SDK
clients. Require a preflight plan and explicit collision policy; do not claim a
distributed transaction or continuous synchronization.

## Consequences

- UI workflows and app capabilities can operate over different locations without
  pretending their transaction models are identical.
- All query keys, drafts, events, and caches must be target-scoped.
- Local revisions, recovery, atomic writes, and package safety are explicit
  Workspace Worker responsibilities.
- Live and package targets can expose different capabilities without branching
  the entire UI.
- Copy workflows can reuse target adapters without turning target selection into
  one mutable global connection or building a separate transfer service.
- Partial destination success is represented explicitly and safely retryable.

## Alternatives considered

- **Use the TypeScript SDK as the package engine:** rejected because a client SDK
  does not by itself supply safe AASX import/export, attachments, revisions, and
  recovery.
- **Build separate UI feature stacks per target:** rejected because it repeats
  the maintainability problem that the shared Studio API and capability model
  are intended to solve.
