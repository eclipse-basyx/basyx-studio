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
| [0004](0004-runtime-installable-apps.md) | Accepted, amended by 0044 | Signed, capability-based, isolated runtime-installable apps |
| [0005](0005-storage-and-observability.md) | Partially superseded by 0011 | PostgreSQL baseline and reuse of the BaSyx Go observability stack; desktop SQLite superseded |
| [0006](0006-frontend-state-and-validation.md) | Accepted | Pragmatic Nuxt/Pinia state with selective Pinia Colada and layered validation |
| [0007](0007-http-and-realtime-transports.md) | Accepted | HTTP by default; SSE or WebSockets only for justified realtime behavior |
| [0008](0008-evolutionary-architecture-and-dependencies.md) | Accepted | Evolutionary architecture and explicit justification for added complexity |
| [0009](0009-declarative-graphical-views.md) | Accepted | Declarative graphical views with capability-bound built-in and app widgets |
| [0010](0010-pnpm-only-supply-chain.md) | Accepted, amended by 0012 | PNPM-only package management with hardened supply-chain controls |
| [0011](0011-single-postgresql-dialect-with-pglite.md) | Accepted | PostgreSQL as the only SQL dialect; embedded PGlite for desktop metadata |
| [0012](0012-release-age-exceptions-for-basyx-packages.md) | Accepted, amended by 0031 | Exact-version release-age exceptions for reviewed Eclipse BaSyx packages |
| [0013](0013-revision-tokens-and-conditional-writes.md) | Accepted | Element-hash revision tokens; conditional writes on the fresh downstream ETag |
| [0014](0014-workspace-worker-and-package-engine.md) | Accepted | Supervised Workspace Worker process; aas-package3-typescript with archive checks |
| [0015](0015-desktop-native-bridge-and-file-grants.md) | Accepted | Two-call preload bridge; single-use file grants from the Electron main process |
| [0016](0016-app-manifest-and-packages.md) | Accepted, amended by 0044 | Versioned JSON Schema manifest; packages checked completely and stored content-addressed |
| [0017](0017-app-origin-and-content-security-policy.md) | Accepted, amended by 0045, 0051 | Sandboxed frames on a separate apps origin or `studio-app:` protocol, strict CSP |
| [0018](0018-capability-bridge-and-authorization.md) | Accepted, amended by 0049, 0051 | `studio-sdk/0` MessagePort bridge; manifest permissions plus the user's own rights |
| [0019](0019-backend-app-runner.md) | Accepted, amended by 0049 | Deno process per backend, deny-by-default, short-lived capability tokens |
| [0020](0020-infrastructure-templates-registries-and-sync.md) | Accepted | Infrastructure templates, registry resolution under the base-URL rule, sync after writes |
| [0021](0021-feature-detection-from-service-profiles.md) | Accepted | Optional features from the stored `/description` profiles, never from probing |
| [0022](0022-basyx-go-endpoints-outside-the-sdk.md) | Accepted | The SDK for standard endpoints; a guarded raw layer for BaSyx Go-specific ones |
| [0023](0023-bundled-first-party-apps.md) | Accepted | Four first-party apps shipped with Studio on the app platform |
| [0024](0024-aas-query-language-through-the-bff.md) | Accepted | Web UI search syntax and checked raw queries, run through the BFF |
| [0025](0025-client-certificates-for-infrastructures.md) | Accepted | PKCS#12 client certificates per infrastructure, presented by the Studio Service on every HTTPS request |
| [0026](0026-ui-translation.md) | Proposed | Seven UI locales, lazy-loaded; UI language separate from content language; CI key checks |
| [0027](0027-structure-revisions-and-structural-writes.md) | Accepted | Structure revisions for add and move; whole-resource structural writes; `writeStructure` capability |
| [0028](0028-identifier-generation-per-infrastructure.md) | Accepted | IRI or URN identifiers per infrastructure; collision check before writes |
| [0029](0029-submodel-templates-and-instantiation.md) | Accepted | Bundled IDTA templates, instantiation and partial writes |
| [0030](0030-workspace-undo-log.md) | Accepted | Undo and redo log in the Workspace Worker |
| [0031](0031-release-age-exceptions-for-aas-core-works-packages.md) | Accepted | Exact-version release-age exceptions extended to reviewed Eclipse AAS Core Works packages |
| [0032](0032-overview-grid-layout.md) | Accepted | Overview widgets on a user-arranged 12-column grid, stored per shell |
| [0033](0033-desktop-container-capability.md) | Proposed | Native desktop feature for BaSyx Go stacks from a fixed catalogue on Docker or Podman |
| [0034](0034-bom-viewer-graph-library.md) | Accepted | Vue Flow for the graph of the bundled BOM viewer app |
| [0035](0035-container-image-and-base-path.md) | Accepted | One multi-arch container image, configured by environment, served under a runtime base path |
| [0036](0036-anonymous-mode.md) | Accepted | Hosted Studio without login: per-browser sessions as the shared `anonymous` user |
| [0037](0037-declared-infrastructures-export-and-import.md) | Accepted | Infrastructures declared in a YAML file, applied at startup and read-only; export and import in the same format |
| [0038](0038-webassembly-workers-and-file-reads-for-apps.md) | Proposed, amended by 0045 | `studio.ui.readFile`, and WebAssembly and `blob:` workers for app frames that declare them |
| [0039](0039-3d-viewer-libraries.md) | Proposed | three.js, web-ifc and OpenCascade (occt-import-js) for the 3D view of File elements |
| [0040](0040-connections-on-infrastructures.md) | Proposed | Connections to third-party services on infrastructures, used only by Studio-side adapters; `studio.timeseries.read` |
| [0041](0041-apexcharts-for-time-series.md) | Proposed | ApexCharts in the bundled Time Series Data app, not in Studio |
| [0042](0042-external-files-through-studio.md) | Proposed | Files that AAS content names at other hosts, fetched by Studio's server for origins the deployment lists |
| [0043](0043-published-sdk-and-app-kit.md) | Proposed, amended by 0053 | `@basyx/studio-sdk`, `@basyx/studio-app-kit` and `@basyx/file-viewer` on npm with provenance; a test transport; the `studio-app` command |
| [0044](0044-app-package-signatures-trust-store-and-updates.md) | Proposed | cosign-compatible package signatures, a trust store of publisher keys per app ID, in-place updates with consent, managed packages |
| [0045](0045-app-origins-embeds-and-full-page-modules.md) | Proposed, amended by 0051 | One origin per app installation; declared frame, connect, image and media origins; full-page modules |
| [0047](0047-http-connections-for-apps.md) | Proposed | `http` connections bound to app connections; declared OpenAPI operations; `studio.connections.call`; token exchange for the signed-in user |
| [0048](0048-app-settings-and-connection-status.md) | Proposed | Declared app settings per installation and per infrastructure (dialog, declared YAML), resolved into the context with each connection's `{ bound }`; not for secrets |
| [0049](0049-structural-writes-and-attachments-for-apps.md) | Proposed | Structural writes and attachment uploads for apps on the editor's paths; edit mode checked on the server |
| [0050](0050-pdfjs-for-the-file-system-view.md) | Proposed, amended by 0052 | PDF.js in the bundled FileSystem view for PDF previews, on the page, without worker or WebAssembly |
| [0051](0051-views-of-other-apps.md) | Proposed | Other apps' submodel views in Studio's dialog (`studio.ui.openView`) and, with an origin per installation, read-only inline (`studio.ui.embedView`); no chart component in the app kit |
| [0052](0052-one-file-viewer-for-studio-and-apps.md) | Proposed | One file viewer (`@basyx/file-viewer`) for Studio and apps: text in Monaco, Markdown, CSV, PDF.js, images, 3D, media; Studio's one full-screen dialog (`studio.ui.previewFile`) |
| [0052](0052-outbound-http-proxy.md) | Proposed | Outbound requests through the `HTTP_PROXY`/`HTTPS_PROXY` proxy, except loopback and `NO_PROXY` (hosts, suffixes, ports, CIDR ranges); the guards apply to the target, not the proxy |
| [0053](0053-one-version-for-studio-and-its-packages.md) | Proposed | One version for Studio, `@basyx/studio-sdk`, `@basyx/studio-app-kit` and `@basyx/file-viewer`; a release workflow, run with the version, commits and tags it and releases the packages, binaries and image |
| [0054](0054-app-builder-with-coding-agents.md) | Proposed | App Builder on the desktop: Claude, Codex and opencode through ACP write apps in a git folder per app; Studio builds them, shows a preview installation and installs them unsigned or signed with a machine or own key |

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
