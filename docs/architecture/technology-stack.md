# Technology Stack

This page turns the accepted architecture into pragmatic implementation
defaults. It distinguishes decisions from candidates that still need a focused
proof. A library should earn its place by removing real Studio code or risk.

## Core product

| Concern | Default | Runs in | Status and rationale |
| --- | --- | --- | --- |
| Package manager | PNPM only, integrity-pinned through Corepack | Development, CI, containers, release builds, isolated app builds | Accepted; one lockfile and deny-by-default dependency build scripts reduce supply-chain exposure |
| UI | Vue 3, Nuxt 4, Vuetify | Browser or Electron renderer | Accepted; matches team experience and current prototype |
| Studio API/BFF | Nitro/H3 on Node.js | Hosted container or desktop child process | Accepted; one application and contract surface across web and desktop |
| SSR | Nuxt hybrid/route rules | Hosted Studio Service | Accepted capability; enable where first-load, catalogue, or public routes benefit rather than forcing every editor route through SSR |
| Desktop host | Electron, Electron Builder, Electron Updater | User computer | Accepted; harden the host and validate N−2 update/migration paths before reconsidering the shell |
| Live AAS client | `basyx-typescript-sdk` | Studio Service | Required; upgrade the prototype to the SDK's AAS Core 3.1 peer version before core feature work |
| AAS model | `@aas-core-works/aas-core3.1-typescript` | Shared trusted TypeScript code | Required by the current SDK; do not maintain a parallel Studio metamodel |
| Styling and icons | Vuetify and Material Design Icons | UI | Continue the current stack and shared interaction patterns |

Keep the Studio Service modular inside one deployable until workload, trust, or
release independence requires extraction. The desktop Workspace Worker and app
runners already meet that threshold because they process local packages or
third-party code.

## State, contracts, and validation

| Concern | Default | Guidance |
| --- | --- | --- |
| Component state | Vue composition API | Use for state with component lifetime |
| UI/editor state | Pinia | Active selection, drafts, undo/redo, and client-owned preferences |
| Simple SSR/page data | Nuxt `useFetch` and `useAsyncData` | First choice for ordinary route data |
| Complex shared remote state | Pinia Colada | Add only for features needing serious invalidation, pagination, optimistic mutation, polling, or deduplication; use the Nuxt module for SSR hydration |
| Studio-owned runtime schemas | Zod | Small HTTP inputs, configuration, IPC, and app RPC at TypeScript-owned trust boundaries |
| Public ecosystem schemas | JSON Schema 2020-12 and Ajv | App manifests and language-neutral capability messages |
| Graphical view definitions | JSON Schema 2020-12 and the existing Studio API | Keep definitions declarative; reuse the app sandbox for contributed widgets |
| AAS validation | AAS Core verification plus package/semantic checks | Preserve domain correctness and metamodel compatibility |
| API description | OpenAPI 3.1 generated from the authoritative Studio route/contract source | Publish when external app tooling needs HTTP-level contracts; avoid hand-maintained duplicate DTOs |

Do not introduce GraphQL for the initial Studio API. Resource-oriented HTTP and
purpose-built editor commands fit the existing BaSyx APIs and are easier to
authorize, observe, cache, and support in desktop loopback mode.

Pinia Colada is the preferred query layer because it is implemented around
Pinia, Vue reactivity, reactive getters, and Nuxt SSR integration. TanStack Query
has a longer track record and a broader utility surface, but it is not a baseline
dependency. Introduce it only through a later ADR if an implemented Studio
feature exposes a concrete gap that cannot be addressed cleanly with Pinia
Colada, its official plugins, or a small Vue composable. Do not run both query
caches for the same application data.

For the graphical builder, start with Vue/Vuetify components and one small
responsive-layout proof. Do not select a low-code platform, renderer framework,
or drag-and-drop dependency until the proof measures accessibility,
serialization stability, bundle size, maintenance, and how much Studio-owned
code it removes.

## Persistence and jobs

| Concern | Hosted | Desktop | Direction |
| --- | --- | --- | --- |
| Relational metadata | PostgreSQL | SQLite | Accepted baseline |
| Database access | Drizzle ORM/query builder candidate | Same schema tooling where practical | Prove migrations, transactions, PostgreSQL row locking, and Electron packaging in a vertical slice before final adoption |
| Secrets | Deployment secret manager | OS keychain/Electron `safeStorage` | Store references in relational metadata, not secret values |
| Background work | Separate Node worker with PostgreSQL-backed durable job records | Supervised utility process and local job records | Start without Redis; evaluate Graphile Worker or an equivalent PostgreSQL queue when retry/concurrency needs are concrete |

PostgreSQL and SQLite are not assumed to have identical capabilities. Share
domain repositories and migrations only where doing so stays clear; do not
degrade hosted behavior merely to force one SQL dialect.

## Desktop AASX workspace

| Concern | Default | Qualification gate |
| --- | --- | --- |
| Desktop package engine | Separate local Workspace Worker using AAS package and AAS Core libraries | Cross-platform packaging, crash isolation, fidelity, atomic save, and recovery |
| Local progress and diagnostics | Versioned local API/IPC contract | Cancellation, recovery, bounded diagnostics, and renderer isolation |

Keep the local target contract independent from the chosen serializer so golden
tests can replace an engine without rewriting the UI or app capability surface.

## Runtime-installable apps and marketplace

| Concern | Default | Notes |
| --- | --- | --- |
| UI isolation | Sandboxed iframe on a separate/opaque origin | Versioned `postMessage` RPC exposed through `@basyx/studio-sdk` |
| Standard backend runtime | Deno evaluation target plus process/container isolation | Deny file, network, environment, subprocess, native, and FFI access by default |
| Privileged desktop runtime | Separate Node extension host | Full-trust classification, explicit approval, signed publishers, and platform policy |
| Hosted workload isolation | One app/version per constrained container or pod where hostile-code isolation is required | Non-root, read-only root, quotas, no service-account token, constrained egress |
| Artifact format | Immutable OCI artifacts | Reuse mature registry distribution and digest semantics |
| Signing/provenance | Sigstore/Cosign-compatible signatures and attestations | Verify digest, publisher, compatibility, and revocation before activation |
| Dependency metadata | PNPM lockfile, SBOM in CycloneDX or SPDX | Dependencies are resolved with PNPM in isolated builds, never installed into Studio at runtime |
| Catalogue metadata | Separate marketplace API with PostgreSQL | Central service shared by hosted and desktop Studio installations |

Start with UI-only apps and a narrow capability API. Add standard backend apps
after the runner proves termination, quotas, egress policy, logs, upgrades, and
revocation. Add privileged/native apps only when real use cases cannot fit the
standard runtime.

## Authentication and security libraries

- Use a standards-focused OAuth/OIDC client such as `openid-client` in the BFF;
  keep provider adapters thin.
- Use secure server-side sessions with key rotation and CSRF/Origin protection.
- Use platform secret integrations rather than framework runtime configuration
  for secret persistence.
- Use JSON Schema/Ajv for manifests and Zod for the smaller internal TypeScript
  boundaries described above.
- Use Electron's sandbox, context isolation, restrictive CSP, a minimal preload
  bridge, and validated IPC from the first production slice.
- Centralize outbound HTTP in target and egress clients with DNS/address checks,
  redirect revalidation, timeouts, and byte limits.

Do not adopt an authentication framework that hides downstream token ownership
or makes client-credentials and multi-infrastructure sessions provider-specific.

## JavaScript supply-chain baseline

PNPM is the only supported package manager for Studio development, CI,
containers, releases, workspaces, and isolated JavaScript/TypeScript app builds.
Pin the exact PNPM version and distribution integrity in the `packageManager`
field, keep the same exact version as a development dependency, and commit only
`pnpm-lock.yaml`.

Follow the hardened pattern already used by `basyx-aas-web-ui`:

- activate PNPM through Corepack and verify the running version against
  `packageManager` before installing;
- use `pnpm install --frozen-lockfile` in CI, container, and release builds;
- set `minimumReleaseAge: 1440` explicitly so the 24-hour delay is strict;
- keep dependency lifecycle/build scripts deny-by-default with an explicitly
  reviewed `allowBuilds` map and `strictDepBuilds: true`;
- keep exotic transitive sources blocked and never enable
  `dangerouslyAllowAllBuilds`;
- review every lockfile and build-script allowlist change; generate and scan an
  SBOM with tooling that fully understands the PNPM lockfile format;
- pin third-party CI actions to immutable commit SHAs and publish provenance,
  SBOMs, and signed release artifacts.

Do not commit `package-lock.json`, `yarn.lock`, `bun.lock`, or another package
manager lockfile. Do not invoke npm, Yarn, Bun, or another package manager as a
fallback when PNPM fails.

## Observability and testing

| Concern | Default |
| --- | --- |
| Traces and metrics | OpenTelemetry Node SDK with selected HTTP/Undici and PostgreSQL instrumentation |
| Structured logging | Pino JSON logs to stderr in hosted processes |
| Collector/backends | Existing BaSyx Go OTel Collector, Prometheus, Tempo, Loki, Alloy, and Grafana stack |
| Unit/component tests | Vitest, Vue Test Utils, and Nuxt Test Utils |
| Browser workflows | Playwright across hosted and Electron-relevant UI paths |
| Service integration | Testcontainers for PostgreSQL, an OIDC test provider, and qualified BaSyx targets |
| Package fidelity | Versioned golden AASX corpus and semantic round-trip comparison |
| Contracts | Consumer/provider tests for Studio SDK, capability RPC, local target API, and marketplace manifests |
| Desktop releases | Clean-install, N−1, N−2, failed-migration, update-signature, and rollback tests on each supported OS |

Use OpenTelemetry semantic conventions and BaSyx Go field names where they fit.
Do not emit user/AAS identifiers as unbounded metric labels.

## Deliberately deferred

- Redis until coordination, cache, or queue measurements justify it
- Kafka/MQTT until Studio owns an event use case that cannot use target APIs,
  PostgreSQL, or ordinary worker coordination
- Kubernetes as a desktop or small on-premise prerequisite
- GraphQL as a second API paradigm
- Module Federation as an untrusted app security boundary
- browser telemetry before a privacy and operational-value decision
