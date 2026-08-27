# 0005: Storage and observability baseline

- Status: Accepted
- Date: 2026-08-24
- Deciders: BaSyx Studio maintainers
- Requirements: DEP-007, OPS-001, OPS-003 through OPS-006, SEC-009

## Context

The prototype uses MongoDB and explored additional infrastructure. Studio's
hosted data is predominantly relational configuration, authorization,
installation, view definitions, operation records, and audit references. BaSyx
Go already has an OpenTelemetry and Grafana observability composition that
Studio deployments can share.

## Decision

Use PostgreSQL as the default hosted Studio metadata store and the deployment
secret store for hosted secrets. Use SQLite plus user-controlled AASX files and
OS credential storage for desktop-local metadata, packages, and secrets.
Marketplace app artifacts use the independently operated OCI registry from the
app-platform architecture.

Do not require MongoDB, Redis, Kafka, or MQTT in the baseline architecture.
Introduce them only when a measured workload and an ADR justify the operational
cost.

Instrument Studio services with OpenTelemetry and structured JSON logs. Reuse
the BaSyx Go deployment pattern and compatible shared backends:

- OpenTelemetry Collector;
- Prometheus for metrics;
- Tempo for traces;
- Loki and Alloy for logs;
- Grafana for exploration and dashboards.

Propagate W3C trace context across Studio, app runners, and BaSyx Go. Keep
security audit records in durable Studio storage, not only in the log pipeline.
Desktop telemetry is opt-in and privacy-preserving.

## Consequences

- Relational policy and lifecycle data have transactions and migrations.
- The default hosted deployment stays operationally understandable.
- Browser, server, runner, and BaSyx telemetry can be correlated when
  they share trace context and service naming.
- App runners need app/version attributes with bounded metric cardinality.
- Existing prototype persistence is migration work, not an architectural
  precedent.

## Alternatives considered

- **MongoDB for all Studio data:** rejected as the default because the core
  domain includes strongly related policy and lifecycle records.
- **A dedicated Studio observability stack:** rejected because it duplicates an
  already suitable BaSyx Go ecosystem and hinders end-to-end diagnosis.
