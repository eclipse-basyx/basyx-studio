# Product Requirements

This document captures the currently agreed BaSyx Studio requirements. Stable IDs allow issues, pull requests, tests, and architecture decisions to reference product intent without copying it.

Priority terms follow this meaning:

- **Must**: required for the intended product or its security model
- **Should**: expected capability that may follow the first usable release
- **Could**: explicitly optional or exploratory

## Product goals

| ID | Priority | Requirement |
| --- | --- | --- |
| PROD-001 | Must | Studio shall become an understandable replacement for the BaSyx AAS Web UI for browsing, creating, editing, and operating live AAS data. |
| PROD-002 | Must | Studio shall replace the essential AASX package-explorer/designer workflow for users who do not operate an AAS server. |
| PROD-003 | Must | The same product concepts and user interface shall cover hosted web and installed desktop deployments. |
| PROD-004 | Must | End users shall be able to create valid AAS content without needing expert knowledge of API topology or internal metamodel implementation details. |
| PROD-005 | Must | Studio shall support live Type 2 shell workflows without copying live server data into an unrelated local model. |
| PROD-006 | Must | Users shall be able to compose graphical AAS views and dashboards without writing frontend code. |
| PROD-007 | Must | Users shall be able to work with multiple configured AAS infrastructures and copy an AAS between independently authenticated infrastructures. |

## Supported variants

| ID | Priority | Requirement |
| --- | --- | --- |
| DEP-001 | Must | A centrally hosted Studio shall connect to a live remote or local-network AAS infrastructure. |
| DEP-003 | Must | An installed desktop Studio shall connect to a live Internet, local-network, or localhost/Docker AAS infrastructure. |
| DEP-004 | Must | An installed desktop Studio shall open, edit, and save AASX packages on the user's computer. |
| DEP-005 | Must | The hosted product shall be deployable in public cloud and on-premise environments. |
| DEP-006 | Must | Desktop installation and updates shall be straightforward for non-developer users on supported operating systems. |
| DEP-007 | Must | A supported Studio version shall be upgradeable from at least the previous two supported versions through tested, ordered data migrations. |
| DEP-008 | Should | Desktop updates shall support signed automatic updates, release channels, staged rollout, and recovery from a failed update. |

## AAS data and SDK

| ID | Priority | Requirement |
| --- | --- | --- |
| DATA-001 | Must | Live AAS client operations shall use `basyx-typescript-sdk` rather than reimplementing repository, registry, discovery, or semantic client logic. |
| DATA-002 | Must | Studio shall support multiple simultaneously available AAS infrastructures with independent endpoints, permissions, sessions, and authentication settings. |
| DATA-003 | Must | UI features and installed apps shall address a logical active AAS target without needing to know whether it is a live infrastructure or workspace. |
| DATA-005 | Must | A desktop AASX workspace shall use the native file system through a constrained Electron bridge or trusted local workspace worker. |
| DATA-006 | Must | AASX import shall defend against malformed archives, path traversal, decompression bombs, excessive size, and unsafe attachment paths. |
| DATA-007 | Must | AAS metamodel validation shall use AAS Core/package validation rather than a separately maintained Studio metamodel schema. |
| DATA-009 | Should | Editing shall use explicit revisions or ETags to detect conflicting writes. |
| DATA-010 | Could | Multi-user collaboration, presence, history browsing, and conflict resolution may be added after revision semantics and server eventing are established. |
| DATA-011 | Must | A user shall be able to authenticate to more than one infrastructure in one Studio session without replacing or leaking another infrastructure's credentials or cached data. |
| DATA-012 | Must | Studio shall support copying an AAS from a source target to a destination target through the BFF and `basyx-typescript-sdk`, including an explicitly selected dependency closure of submodels, concept descriptions, and supplementary files where supported. |
| DATA-013 | Must | Before a cross-target copy, Studio shall present a plan covering source and destination permissions, target capabilities, identifier collisions, dependency selection, validation findings, and the chosen collision policy. |
| DATA-014 | Must | Cross-target copy shall leave the source unchanged, report each created/skipped/failed resource, and never imply atomicity across independent infrastructures. |
| DATA-015 | Should | Cross-target copy commands shall support idempotency and safe retry so interrupted transfers do not silently create inconsistent duplicates. |
| DATA-016 | Must | Browser and Electron renderer features shall use the same versioned Studio API and target contract; they shall not access BaSyx services or the desktop package engine directly. |

## Runtime-installable apps

| ID | Priority | Requirement |
| --- | --- | --- |
| APP-001 | Must | Independent third parties shall be able to create and publish Studio apps. |
| APP-002 | Must | The same central app store shall be reachable from hosted and installed Studio variants. |
| APP-003 | Must | App compatibility shall include Studio/runtime compatibility and AAS-semantic applicability. |
| APP-004 | Must | Cloud app installation shall be scoped to one Studio deployment. Per-user or per-group visibility shall be enforced independently from installation. |
| APP-005 | Must | Desktop app installation shall be scoped to the local OS user/machine. |
| APP-006 | Must | Apps shall access AAS operations through a versioned Studio capability API. They shall not receive infrastructure tokens or client secrets. |
| APP-007 | Must | Apps shall be able to request constrained file-selection, file-read, file-write, and upload capabilities. |
| APP-008 | Must | Apps shall be able to request HTTP access to declared third-party origins through permission-controlled egress. |
| APP-009 | Must | Apps shall be able to use stable common Studio functionality, including selected AAS types and semantic utilities exposed by `@basyx/studio-sdk`. |
| APP-010 | Must | App UI code shall not execute in the core Studio renderer context. Backend app code shall not execute in the Studio Service process. |
| APP-011 | Must | Installation shall verify immutable artifact digests, signatures, compatibility, and requested permissions. |
| APP-012 | Must | App authors shall declare and lock dependencies during an isolated build. End users shall not mutate an installed app's dependency tree. |
| APP-013 | Should | The marketplace shall provide publisher identity, review status, SBOM/provenance, vulnerability information, revocation, and rollback. |
| APP-014 | Should | Pure TypeScript/JavaScript backend apps should run with deny-by-default permissions in an isolated runtime. Privileged Node/native apps shall be clearly classified as full-trust software. |
| APP-015 | Could | A developer mode may allow local or forked app development while clearly separating unsigned development artifacts from marketplace installations. |
| APP-016 | Must | Apps shall be able to contribute sandboxed visual-builder widgets through the versioned Studio SDK, including configuration schemas, binding inputs/outputs, semantic applicability, and requested capabilities. |

## Graphical AAS views and dashboards

| ID | Priority | Requirement |
| --- | --- | --- |
| VIEW-001 | Must | Users shall compose views by arranging and configuring built-in and installed-app widgets in a graphical editor. |
| VIEW-002 | Must | A saved view shall be a versioned declarative document containing layout, widget instances, AAS bindings, and presentation settings; it shall not contain arbitrary JavaScript or generated Vue source. |
| VIEW-003 | Must | A widget binding shall support both an instance-specific AAS reference and a reusable semantic binding resolved against a compatible shell or submodel context. |
| VIEW-004 | Must | Widgets shall read AAS values through the Studio AAS capability API and may request explicit write or operation-invocation bindings subject to the current user's permissions. |
| VIEW-005 | Must | Opening a view shall resolve bindings against the active target and explain missing elements, semantic mismatches, unavailable apps, and insufficient permissions without corrupting the saved definition. |
| VIEW-006 | Must | An app-provided widget shall retain the same origin/process isolation and least-authority capability checks as the app outside a user-built view. |
| VIEW-007 | Must | Hosted view definitions shall support owner and user/group access control. Desktop view definitions shall be stored locally and remain usable offline when their widgets and AAS data are local. |
| VIEW-008 | Must | Studio shall distinguish view-authoring permission from permission to open a view or perform a bound AAS write/operation. |
| VIEW-009 | Should | View definitions shall support import/export and forward migrations across supported Studio versions. |
| VIEW-010 | Should | Layouts shall support responsive breakpoints, keyboard-accessible authoring, and accessible runtime rendering. |
| VIEW-011 | Should | The builder shall preview a view using the same renderer, bindings, app sandbox, and authorization path as runtime viewing. |
| VIEW-012 | Could | Views may later expose reusable templates and parameters for applying one semantic dashboard to many compatible shells. |

## Authentication and authorization

| ID | Priority | Requirement |
| --- | --- | --- |
| SEC-001 | Must | Browser and Electron renderer JavaScript shall not receive OAuth access tokens, refresh tokens, or confidential client secrets. |
| SEC-002 | Must | The Studio BFF shall support authorization-code flow with PKCE for user authentication. |
| SEC-003 | Must | A hosted Studio shall support client-credentials flow when an AAS provider intentionally exposes infrastructure only through that Studio deployment. |
| SEC-004 | Must | Studio shall remain generic OIDC and shall not depend on Keycloak-specific behavior. |
| SEC-005 | Must | When downstream requests use a Studio service identity, Studio shall enforce end-user authorization and audit both the Studio user and downstream identity. |
| SEC-006 | Must | Hosted app visibility and administration shall support users and groups from the configured identity provider. |
| SEC-007 | Must | Desktop secrets shall use operating-system protected storage. Hosted secrets shall use deployment-provided secret management. |
| SEC-008 | Must | Network access shall enforce allowlists, redirect validation, private-network policy, timeouts, and protection against server-side request forgery. |
| SEC-009 | Must | Electron shall use context isolation, renderer sandboxing, validated IPC, a restrictive content security policy, and no renderer Node integration. |

## Persistence and operations

| ID | Priority | Requirement |
| --- | --- | --- |
| OPS-001 | Must | Hosted durable Studio metadata shall use PostgreSQL with a Studio-owned schema/database and database user. |
| OPS-003 | Must | Desktop project metadata and app installations shall use a local application database; package bytes shall remain in user-controlled files. |
| OPS-004 | Must | Studio services shall emit structured logs, traces, and metrics compatible with the existing BaSyx Go OpenTelemetry/Grafana stack. |
| OPS-005 | Must | Studio shall propagate W3C trace context and canonical request/correlation identifiers to BaSyx services. |
| OPS-006 | Must | Observability shall not capture tokens, secrets, authorization headers, request/response bodies, AASX contents, or unbounded AAS identifiers as metric labels. |
| OPS-007 | Should | Cross-target copy and app lifecycle operations shall expose progress and failure information without requiring a generic WebSocket command protocol. |
| OPS-008 | Could | Redis or a dedicated message broker may be introduced only when measured scaling or durability requirements cannot be met pragmatically with PostgreSQL and process-local coordination. |

## Architecture and dependency constraints

| ID | Priority | Requirement |
| --- | --- | --- |
| ARCH-001 | Must | Studio shall use the simplest architecture that satisfies current requirements and security boundaries; hypothetical future scale is not sufficient justification for complexity. |
| ARCH-002 | Must | Every additional deployable service, runtime process, datastore, broker, framework, or major dependency shall have a documented justification based on a concrete trust boundary, resource isolation need, independent lifecycle, measured scale, or substantial reduction of maintained code. |
| ARCH-003 | Must | A dependency decision shall consider maintenance activity, API stability, security history, license, transitive dependencies, bundle/runtime cost, operability, team familiarity, and the code or risk it removes. |
| ARCH-004 | Must | Studio shall begin as a modular Studio Service plus only the already justified desktop Workspace Worker and app isolation boundaries; modules shall not be extracted into services pre-emptively. |
| ARCH-005 | Must | New abstractions and shared packages shall be extracted from at least one real workflow and consumer rather than created speculatively. |
| ARCH-006 | Must | The baseline hosted deployment shall not require Kubernetes, a service mesh, Redis, Kafka, or MQTT. Optional scale-out profiles require measured need and an ADR. |
| ARCH-007 | Should | Architecture experiments shall be time-boxed, preserve a replaceable boundary, and define the evidence required for adoption. |
| ARCH-008 | Should | Prefer platform and BaSyx capabilities already operated by the project before adding an overlapping service or library. |
| ARCH-009 | Must | Studio development, CI, container/release builds, workspaces, and isolated JavaScript/TypeScript app builds shall use PNPM exclusively with one committed `pnpm-lock.yaml`, an integrity-pinned PNPM version, frozen installs, delayed resolution of new releases, and deny-by-default dependency build scripts. |

## User experience

| ID | Priority | Requirement |
| --- | --- | --- |
| UX-001 | Must | Users shall choose an infrastructure or workspace before Studio exposes target-specific actions. |
| UX-002 | Must | The UI shall explain app compatibility, missing semantic requirements, and requested permissions in end-user language. |
| UX-003 | Must | Destructive operations shall require clear context and confirmation where recovery is not immediate. |
| UX-004 | Should | Remote infrastructure and local workspace pickers shall share a consistent select-review-open/connect interaction model. |
| UX-005 | Should | Studio shall distinguish saved server/package state from unsaved editor drafts. |

## Explicit non-goals for the first product increment

- General-purpose arbitrary-code hosting inside the Studio Service process
- Mutable `node_modules` for installed marketplace apps
- Browser-held infrastructure client secrets
- A generic authenticated forward proxy
- Kafka/MQTT as an initial prerequisite
- Real-time collaborative editing before revision and conflict semantics exist
- Continuous synchronization between infrastructures as part of the initial AAS-copy workflow
- Arbitrary executable code inside saved graphical view definitions
- A separate low-code/dashboard backend when the Studio Service and existing app capability system can own the workflow
- One independently deployed service per internal Studio module
