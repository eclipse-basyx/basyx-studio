# Architecture Overview

BaSyx Studio is one product with three primary deployment variants. The variants
share one UI codebase and Studio API, but they do not place every component in
the same process or location.

See the canonical [deployment component diagrams](deployment-variants.md) and [mechanism sequence diagrams](mechanisms.md).

## Core model

The UI and installed apps work against an active logical `AasTarget`:

```text
AasTarget
├── InfrastructureTarget
│   └── live AAS APIs reached through basyx-typescript-sdk
└── LocalAasxTarget
    └── desktop Workspace Worker and user-controlled package files
```

The target router hides placement differences from features. A shell browser,
editor, dashboard binding, semantic matcher, or installed app invokes the same
Studio capability API whether the selected data is live or package-backed. Most
UI has one active target; explicit workflows may address a source and destination
target simultaneously.

## Component ownership

### Studio UI

The Vue/Nuxt UI runs in a browser or sandboxed Electron renderer. It owns
presentation, navigation, user interaction, target selection, editable UI drafts,
and the graphical view builder/renderer. It communicates only with the Studio
API and constrained Electron/app bridges.

### Uniform UI and API

Browser and Electron render the same Nuxt/Vue application and use the same
feature components. Variant-specific entry points and controls are driven by
capabilities—for example, native open/save is visible only when a local AASX
target is available. This is conditional presentation inside one UI, not separate
frontends.

The UI calls one versioned, resource-oriented Studio API. The BFF/target router
selects either a live `basyx-typescript-sdk` client or the desktop Workspace
Worker and returns common Studio DTOs plus explicit target capabilities,
revisions, and normalized errors. It abstracts access mechanics, but it does not
pretend that every target supports identical transactions or operations.

Transport is intentionally conventional:

- HTTP for commands, queries, uploads, and downloads;
- SSE for one-way progress, notifications, and cache invalidation where useful;
- bounded polling as a fallback;
- WebSockets only for a proven bidirectional mechanism such as later
  collaboration.

The abstraction is the Studio API and target contract—not “sockets.”

### Studio Service

The Studio Service is one trusted Nuxt/Nitro Node.js deployable. In web mode it is hosted centrally; in desktop mode the Electron main process starts it locally on loopback.

It owns:

- Nuxt rendering and core assets
- the backend-for-frontend API
- user sessions and downstream token handling
- infrastructure configuration and authorization
- the AAS target router
- independently authenticated target sessions and the cross-target copy workflow
- the server-side BaSyx TypeScript SDK adapter
- declarative view-definition storage, authorization, and binding resolution
- app installation metadata, visibility, and compatibility decisions
- the app capability broker
- request validation, auditing, and observability

It does not execute third-party backend app code or parse untrusted packages in its request/event loop.

### Desktop AASX implementation

Desktop AASX editing uses a trusted local Workspace Worker. It exposes the local
target adapter used by the Studio API and keeps parsing, serialization, native
file access, and crash recovery outside the renderer.

### App runtime

UI apps execute in isolated frames/origins. Backend apps execute in a separate app-runner container/pod in hosted deployments or a separate extension-host process on desktop. They communicate through capability APIs and never receive host internals or downstream credentials.

### App store

The central BaSyx App Store is independent from individual Studio deployments. It owns catalogue metadata, immutable artifacts, publisher identity, signing/attestations, compatibility metadata, revocation, and publication workflows.

### Graphical views

The view builder and renderer are ordinary Studio UI modules. View definitions
are versioned declarative documents stored in the existing Studio database.
Built-in widgets use the core renderer; app-contributed widgets reuse the app
sandbox and capability broker. This feature does not introduce a separate
dashboard service, scripting runtime, or data-access path.

### BaSyx infrastructure

A live BaSyx Go deployment remains independent from Studio. The Studio Service
is an AAS API client.

## Shared contracts

The following contracts should become versioned packages as implementation grows:

- `@basyx/studio-sdk`: public app-facing capabilities and selected stable AAS types/utilities
- `@basyx/studio-protocol`: Studio UI/BFF and app RPC DTOs
- `@basyx/studio-semantic`: semantic requirement manifest and applicability engine
- `@basyx/studio-view-schema`: extract only after the first real builder/renderer
  vertical slice proves the public definition and app-widget contract

Public app contracts must remain backward-compatible within their declared version range. Internal implementation packages may evolve faster.

## Persistence baseline

- Hosted Studio metadata and sessions: PostgreSQL
- Desktop metadata and installed-app state: SQLite
- Desktop package bytes: user-controlled filesystem
- Marketplace app artifacts: OCI registry

Redis, MongoDB, Kafka, and MQTT are not baseline requirements. They require a measured need and an architecture decision.

## Request and state ownership

- Pinia owns UI state, selection, editor drafts, and undo/redo.
- Nuxt `useFetch`/`useAsyncData` owns SSR and straightforward route data.
- Pinia Colada may own complex shared remote state with target-aware keys.
- The BFF owns authentication, authorization, server tokens, and credentialed AAS access.
- AAS Core/package tooling owns metamodel validation.
- PostgreSQL or SQLite/filesystem owns persisted state depending on variant.

## Current prototype versus target

The current repository proves selected UI and packaging ideas. Known differences from the target architecture include:

- Nuxt currently has SSR disabled although hosted route-level SSR is a target capability.
- The current Studio dependency versions lag behind the current BaSyx TypeScript SDK/AAS Core 3.1 combination.
- The Docker example currently uses MongoDB, which is superseded by the PostgreSQL decision.
- WebSocket code is a technical demo, not the target command/query API.
- Infrastructure picker data is mocked and does not yet model multiple
  independently authenticated target sessions or cross-target copy.
- The graphical view builder, declarative renderer, bindings, and app widget
  contributions are not implemented.
- Electron currently starts Nitro on a fixed port and needs production process, IPC, secret-storage, packaging, and updater hardening.
- The desktop Workspace Worker, app store, app isolation, signing, and capability APIs are not implemented yet.

Implementation work should reduce these gaps without treating them as independently accepted designs.

## Target repository evolution

The current repository should remain simple while boundaries are still small. When components become independently deployable or reusable, evolve toward:

```text
app/                         Nuxt/Vue UI
server/                      Studio Service / Nitro BFF
electron/                    Electron main and preload
packages/studio-sdk/         public app SDK
packages/studio-protocol/    shared validated DTOs
services/app-runner/         hosted app runner control plane
docs/                        central product and architecture documentation
```

Do not create empty packages in advance. Extract a boundary when its contract and independent lifecycle are real.

## Complexity budget

The default is a modular Studio Service, not a collection of microservices. A
module becomes another process or deployable only when a concrete trust boundary,
resource-isolation requirement, independent release lifecycle, or measured scale
requires it. The desktop Workspace Worker and app runners meet this test; target
copy and graphical views do not.

Every new framework, major library, datastore, broker, or deployable records the
capability or maintained code it replaces and its operational/security cost.
Prefer a small vertical slice and a replaceable interface over speculative
generalization. ADR 0008 defines the decision rule.
