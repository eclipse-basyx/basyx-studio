# Observability

Studio reuses the observability conventions and operated services already established by BaSyx Go instead of introducing a separate frontend platform.

## Reused BaSyx stack

BaSyx Go already provides an executable observability example with:

- OpenTelemetry Collector for OTLP ingestion
- Prometheus for metrics
- Tempo for traces
- Loki for logs
- Grafana Alloy for container log collection
- Grafana for exploration and correlation

Reference material:

- [BaSyx Go telemetry documentation](https://github.com/eclipse-basyx/basyx-go-components/blob/main/docu/user/telemetry.md)
- [BaSyx Go logging documentation](https://github.com/eclipse-basyx/basyx-go-components/blob/main/docu/user/logging.md)
- [BaSyx observability example](https://github.com/eclipse-basyx/basyx-go-components/tree/main/examples/BaSyxObservabilityExample)

The executable example currently uses Tempo. Any older prose mentioning Jaeger should not cause Studio to add a second trace backend.

## Hosted topology

```text
Studio Service ----------\
App Runner platform -------+-- OTLP/HTTP --> OTel Collector --> Tempo
BaSyx Go services --------/                         \-------> Prometheus

JSON stderr --> Grafana Alloy --> Loki

Grafana --> Tempo + Prometheus + Loki
```

Observability services are deployment/platform services, not modules inside the Studio Service.

## Node/Nitro instrumentation

Initialize OpenTelemetry before loading the Nitro application. Use the Node SDK, OTLP protobuf exporters, and only the required HTTP/Undici and PostgreSQL instrumentation. Avoid pulling the entire auto-instrumentation dependency graph when a small known set is sufficient.

Create:

- one server span per Studio request
- client spans for BFF-to-BaSyx and controlled third-party requests
- bounded spans for cross-target copy and app installation/execution jobs
- HTTP request metrics and PostgreSQL pool metrics
- bounded domain counters/histograms where they answer an operational question

Propagate W3C `traceparent`/`tracestate` and canonical `X-Request-ID`/`X-Correlation-ID` through TypeScript SDK transports to BaSyx Go.

## Service identity

Use distinct service names:

- `basyx-studio`
- `basyx-studio-app-runner`
- `basyx-studio-marketplace` for separately operated marketplace services

Set `service.version` and `deployment.environment.name` as resource attributes. App ID/version may appear as bounded app-runner log or trace attributes, but user, workspace, shell, submodel, and package identifiers must not become metric labels.

## Structured logging

Use a small logger abstraction backed by Pino for Node processes. Hosted logs are JSON on stderr so the platform collector owns forwarding, rotation, and retention.

Match BaSyx Go fields where applicable:

- `time`, `level`, `msg`, `service.name`
- `request.id`, `correlation.id`
- `trace_id`, `span_id`, `trace_flags`
- `http.request.method`, `url.path`, `http.route`
- `http.response.status_code`, `http.response.body.size`, `duration_ms`
- stable `error.code`

Do not log query strings, authorization headers, cookies, tokens, secrets, request/response bodies, AASX contents, database DSNs, or arbitrary app output as trusted fields.

## App-runner telemetry

Third-party app output is untrusted. Apps do not receive Collector credentials. The runner:

- captures stdout/stderr with size and rate limits
- tags output with validated app ID/version and execution ID
- keeps platform audit events separate
- exposes bounded execution duration, failure, timeout, and resource metrics
- redacts or rejects fields that collide with trusted platform identity

## Browser and desktop policy

Do not add browser OpenTelemetry in the first increment. Server traces cover the critical BFF-to-BaSyx path without exposing the Collector or collecting user interaction data.

Desktop telemetry is disabled by default. The application keeps bounded local diagnostics and can export a user-approved support bundle. Remote crash/usage reporting requires an explicit later privacy decision and user/operator control.

## Availability behavior

Telemetry is optional and fail-open after startup configuration has been validated. Collector outages must not fail AAS requests, package saves, or app execution. Shutdown should flush with a bounded timeout.

## Minimum operational signals

- request count, latency, status, and active requests per service
- PostgreSQL pool size, use, waits, and wait time
- downstream AAS request latency/failures by configured component type, not URL
- cross-target copy duration, planned/completed resource counts, collision policy, and partial-failure category without target or AAS identifiers as labels
- view binding-resolution failures and widget render/capability failures using bounded built-in/app type categories
- app install/activation duration and failure category
- backend app execution duration, timeout, crash, and resource-limit termination
- Electron local service/worker startup and crash diagnostics stored locally
