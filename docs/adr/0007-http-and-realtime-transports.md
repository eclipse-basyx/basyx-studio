# 0007: HTTP and realtime transports

- Status: Accepted
- Date: 2026-08-24
- Deciders: BaSyx Studio maintainers
- Requirements: DATA-010, DATA-016, OPS-007

## Context

The prototype demonstrates Nitro WebSockets, and future features may need live
progress, target change notifications, or collaborative editing. WebSocket
availability does not by itself justify using a persistent bidirectional channel
for ordinary AAS queries and commands.

## Decision

Use versioned HTTP APIs for Studio queries and commands. Preserve normal status
codes, request IDs, authorization checks, idempotency where required, and
OpenTelemetry propagation.

For one-way server-to-client updates such as operation progress, notifications,
and cache invalidation, prefer Server-Sent Events when deployment constraints
permit it. Use bounded polling as the portable fallback.

Introduce WebSockets only for a documented bidirectional use case, such as
collaborative editing, interactive app protocols, or presence. A feature that
uses WebSockets must define authentication and reauthentication, authorization,
message schemas, backpressure, ordering, reconnect/resume behavior, resource
limits, observability, and multi-instance fan-out.

Do not expose a generic client-configurable WebSocket proxy or use WebSockets as
the default CRUD transport.

## Consequences

- Core behavior works through common reverse proxies, container deployments, and
  desktop loopback services.
- HTTP operations stay independently observable, retryable, and testable.
- Realtime infrastructure is added only with a clear product need.
- Collaborative editing may require a dedicated protocol and coordination
  service rather than an enlarged generic Nitro handler.

## Alternatives considered

- **WebSockets for all AAS operations:** rejected because it adds connection,
  retry, scaling, and observability complexity without improving ordinary CRUD.
- **Polling only:** reliable as a fallback, but inefficient for timely progress
  and invalidation streams.
