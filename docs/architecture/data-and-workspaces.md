# Data Sources and Workspaces

Studio supports live AAS data and desktop-local AASX packages through one target
abstraction. This document defines what is shared and what is necessarily
different.

## Target contract

An `AasTarget` provides capabilities such as:

- list and resolve shells
- read and mutate AAS and submodels
- read and mutate concept descriptions where supported
- invoke AAS operations where supported
- read and write attachments through constrained APIs
- expose target capabilities and metamodel versions
- expose revision or ETag information where supported
- build a semantic index for app applicability

Feature code should request capabilities instead of branching on deployment type.

## Multiple infrastructure targets

Studio keeps a collection of configured targets, not one mutable global server
configuration. The UI normally has one **active target** for navigation and
editing, while an explicit workflow such as copy may address a source and a
destination target at the same time.

Each target has independent:

- endpoint and capability metadata;
- authorization and credential strategy;
- server-side OAuth tokens/session state;
- SDK client configuration;
- health and compatibility state;
- query-cache namespace and audit identity.

Changing the active target never overwrites another target's credentials or
reuses its cached data. A target-aware SDK client factory in the Studio Service
creates or reuses clients by opaque target ID. This is a module, not another
deployable service.

## Live infrastructure target

The Studio Service configures `basyx-typescript-sdk` for the active infrastructure. The SDK owns reusable client logic for repositories, registries, discovery, AASX File Server access, orchestration services, and semantic utilities.

Rules:

- Instantiate and configure SDK clients in the BFF, never in untrusted app UI code.
- Inject downstream credentials and tracing in the BFF transport.
- Do not expose a generic proxy; expose resource-oriented Studio endpoints.
- Include `targetId` in cache keys, audit events, and authorization decisions.
- Align Studio with the current SDK and `@aas-core-works/aas-core3.1-typescript` before building core features.

## Copy an AAS between infrastructures

The first cross-target workflow is a snapshot copy from one live infrastructure
to another. It is neither continuous synchronization nor a distributed
transaction.

The user chooses source target, shell, destination target, dependency scope, and
collision policy. The Studio Service then:

1. authorizes the user against both targets and establishes each target's own
   downstream credentials;
2. reads the source shell and the selected closure of referenced submodels,
   concept descriptions, and supplementary files through source-configured
   `basyx-typescript-sdk` clients;
3. validates the source model and destination metamodel/capabilities;
4. produces a preflight plan showing dependencies, identifier collisions,
   unsupported resources, permissions, estimated transfer size, and actions;
5. requires confirmation before any destination write;
6. writes through destination-configured SDK clients with an idempotency key and
   records the outcome of every resource;
7. re-reads/validates the destination and returns a copy report.

The default collision policy is **fail without changes**. Additional explicit
policies may include skip existing or replace when the destination API and user
permissions support it. Identifier remapping is a separate advanced capability
because it must rewrite all affected references consistently.

The source is never changed. Because independent AAS infrastructures do not
share a transaction, partial destination success is possible. Studio keeps a
durable operation report and offers safe retry; it does not automatically delete
pre-existing resources or claim rollback that the target cannot guarantee.

Model data and attachments are streamed through bounded BFF/worker paths rather
than materialized in browser state. The browser receives the plan, progress, and
result—not reusable source/destination credentials.

## Desktop AASX workspace

The Electron main process exposes constrained native file selection. A trusted Workspace Worker parses and serializes packages outside the renderer and outside the local Studio Service request loop.

The worker uses the AAS package library and AAS Core verification. The client-oriented BaSyx SDK is not forced into the package data path, although its stable AAS types and semantic utilities may be reused.

The desktop workspace owns:

- a user-selected folder and `project.aasx`
- local draft/recovery snapshots
- explicit save and save-as behavior
- package validation and export
- local project metadata in SQLite

No BaSyx server is required for this variant.

Required import protections include compressed/uncompressed size limits,
entry-count limits, normalized paths, rejection of traversal and absolute paths,
MIME/content checks where meaningful, timeouts, and bounded resource use.

## Revision model

Editing must distinguish three states:

1. persisted target revision
2. editor draft derived from that revision
3. save result with a new revision

Live targets use server ETags/revision facilities when available. The desktop
AASX workspace defines its own monotonically advancing revision. A conflicting
save returns a structured conflict and preserves the user's draft.

This model is a prerequisite for reliable autosave, history, and collaboration.

## Round-trip qualification

Before selecting the desktop package engine, maintain a golden suite containing
representative AASX packages with:

- AAS, submodels, and concept descriptions
- all important submodel element kinds
- internal files and thumbnails
- XML and JSON representations where applicable
- supplementary files and unusual valid paths
- multiple metamodel versions that Studio claims to support

For each package, import, edit, serialize, reopen, validate, and compare semantic
content and supplementary files. The result should qualify the selected local
TypeScript package library and Workspace Worker implementation.
