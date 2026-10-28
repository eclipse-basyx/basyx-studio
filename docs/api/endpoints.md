# Endpoint overview: Frontend ↔ BFF

The complete machine-readable definition is in
[openapi.yaml](openapi.yaml). This document explains the endpoints at the
functional level without duplicating the OpenAPI schemas.

## Common rules

- Under a base path (`STUDIO_BASE_PATH`, [ADR 0035](../adr/0035-container-image-and-base-path.md))
  every path moves below it, e.g. `/studio/api/studio/v1`. Outside the API
  are the probes `GET <base>health/live` and `GET <base>health/ready` and the
  deployment's logos at `GET <base>branding/logo-light` and `-dark`.
- Base: `/api/studio/v1`; the same contract applies to the browser and Electron.
- The session is an opaque, server-side HttpOnly cookie. OAuth tokens and
  downstream credentials never reach the frontend.
- Every domain target request contains an opaque `targetId`. The frontend does
  not send a BaSyx service URL as a routing decision.
- Mutations require `X-CSRF-Token`; revision-protected mutations also require
  `If-Match`. Responses return the new revision as `ETag`.
- Lists use `limit` and an opaque `cursor`.
- Repeatable commands use `Idempotency-Key`.
- Longer flows return `202 Accepted` and an operation resource. Progress can be
  followed through SSE or, as a fallback, through polling.
- Errors use `application/problem+json` with stable `code`,
  `requestId`, `correlationId` and `retryable`.

## Context and sign-in

| Method and path | Purpose |
| --- | --- |
| `GET /context` | Returns the deployment mode, API/Studio version, available platform functions and the session context for UI startup. Can be called anonymously. |
| `GET /session` | Returns the signed-in user, groups/roles, CSRF value, active target and session expiry. |
| `POST /auth/login` | Starts OIDC Authorization Code with PKCE. The response contains only a validated navigation URL. |
| `GET /auth/callback` | Receives the OIDC code; the BFF checks state/nonce, exchanges tokens server-side and sets or resumes the session. Also applies to target reauthentication. |
| `POST /auth/logout` | Ends the Studio session and the server-side target contexts. |
| `GET/PUT /me/preferences` | Reads or replaces the signed-in user's preferences: recently opened shells (`{ key, title }`) per target, theme, language of multi-language values, auto-refresh and `syncOverrides` per infrastructure (MVP-4). |

## Targets and infrastructures

| Method and path | Purpose |
| --- | --- |
| `GET /targets` | Lists visible live infrastructures and local AASX workspaces with status, capabilities and permissions. |
| `GET /targets/{targetId}` | Returns the detailed status of a target; credentials and unsafe internal details stay hidden. Capabilities (among others `search`, `queryTarget`, `elementSearch`, `listSource`, `submodelListSource`, `submodelSearch`) follow from the stored service profiles ([ADR 0021](../adr/0021-feature-detection-from-service-profiles.md)); `registrySync` names the sync default and the user override where Studio keeps registries and discovery up to date. |
| `PUT /targets/{targetId}/activation` | Checks rights/health and sets the active target of the session. The decision about unsaved UI drafts comes from the frontend in the request. |
| `POST /targets/{targetId}/authorization` | Starts or resumes authentication for exactly this target. Other target sessions stay unchanged. |
| `DELETE /targets/{targetId}/authorization` | Disconnects only the credential context of this target. |
| `GET /infrastructures` | Lists administratively managed live infrastructures. |
| `POST /infrastructures` | Accepts an admin configuration (template, endpoints, `listSource`, `sync`, security, `connections` to third-party services, `http` ones with their `apps` bindings), validates the template and SSRF/network rules as well as an optional client certificate (`clientCertificate`, PKCS#12), runs a probe and only then registers it. When hosted, secrets and certificates are handled only as references; the desktop stores uploaded values encrypted. |
| `GET /infrastructures/{infrastructureId}` | Returns sanitized configuration details, endpoints, service profiles (`serviceProfiles`, `probedAt`, `announced`) and revision. |
| `PUT /infrastructures/{infrastructureId}` | Replaces the configuration with `If-Match`, renewed validation and a probe. An omitted `clientCertificate` is kept; `null` removes it. |
| `DELETE /infrastructures/{infrastructureId}` | Removes the Studio configuration, not the data of the infrastructure. |
| `GET /infrastructures/export` | Exports all infrastructures, or those named by `ids`, in the format of `STUDIO_INFRASTRUCTURES_FILE` (YAML, [ADR 0037](../adr/0037-declared-infrastructures-export-and-import.md)). References to deployment secrets are kept; secrets and certificates stored in Studio are replaced by a comment. `?download` answers with a file. |
| `POST /infrastructures/import` | Checks (`dryRun`) or imports YAML in the same format: reports problems and name conflicts per entry, and creates or replaces entries one by one (`resolutions`), each with a probe. Refused when the deployment fixes its infrastructures. |
| `POST /infrastructures/{infrastructureId}/probe` | Queries `/description` of each endpoint again, returns reachability and profiles per endpoint and replaces the stored profiles. |
| `POST /infrastructures/{infrastructureId}/connections/{connectionKey}/test` | Tests a connection to a third-party service (ADR 0040): obtains its credentials and runs the type's checks, e.g. `GET /health` and a read-only query for `influxdb2`, `GET` of the URL for `http`. Tests the stored connection, or the edited one in the body with the stored secret where none is given. Returns each check without the secret; audited. |

## AAS and target data

All of the following paths are scoped under `/targets/{targetId}`. The BFF
selects the BaSyx TypeScript SDK client or the Workspace Worker server-side.

| Method and path | Purpose |
| --- | --- |
| `GET/POST /targets/{targetId}/shells` | Lists shells from the list source (AAS registry or repository) with a cursor, or creates a validated shell. Each summary has the asset kind, type, global and specific asset IDs. |
| `POST /targets/{targetId}/shell-availability` | Reports for up to 50 shell keys whether the shell can be opened: `available`, `forbidden`, `not_found`, `blocked` (descriptor endpoint outside the infrastructure) or `unreachable`. |
| `POST /targets/{targetId}/searches` | Searches shells or submodels (`scope: submodels`) by search expression (`expression`) or AAS query (`query`) with a cursor, or submodel elements by text (`scope: elements`). Invalid queries result in `query_invalid` with `violations`, missing query support in `query_unsupported`. |
| `GET /targets/{targetId}/lookup` | Finds the shells of an asset by its global asset ID: through discovery, otherwise through a query on the AAS repository where it announces queries. |
| `GET/PUT/DELETE /targets/{targetId}/shells/{shellKey}` | Reads a shell, replaces it with `If-Match` or deletes it. Deletion returns the registry and discovery steps that Studio ran afterwards (`sync`). |
| `GET /targets/{targetId}/shells/{shellKey}/submodel-refs` | Referenced submodels with status (`available`, `forbidden`, `not_found`, `blocked`, `error`). |
| `GET /targets/{targetId}/shells/{shellKey}/thumbnail` | Streams the shell's thumbnail; `204` if it has none. |
| `GET /targets/{targetId}/shells/{shellKey}/export` | Downloads the shell with its submodels and concept descriptions as AASX, JSON or XML. |
| `GET /targets/{targetId}/shells/{shellKey}/rights` | The signed-in user's effective rights on the shell, so that the UI hides disallowed actions. |
| `GET/PUT /targets/{targetId}/shells/{shellKey}/access` | Reads a shell's ReBAC shares or replaces them with `If-Match`. |
| `POST /targets/{targetId}/shells/{shellKey}/access/invitations` | Creates an invitation that grants a relation on the shell. |
| `POST /targets/{targetId}/invitations` | Accepts an invitation for the signed-in user. |
| `GET/POST /targets/{targetId}/submodels` | Lists submodels on their own from `submodelListSource`, cursor-paged, or creates one without a shell (empty, from a template or from JSON). |
| `POST /targets/{targetId}/submodel-owners` | The shells that reference up to 100 submodels, found by AAS query or by reading the shells (`method`, `complete`, `scanned`). |
| `GET/PUT/DELETE /targets/{targetId}/submodels/{submodelKey}` | Reads a submodel (`content=metadata\|full`, `format=json\|xml`, `at`, `download`), replaces or deletes it (`removeReferences` removes the references of the shells that point to it first). |
| `GET /targets/{targetId}/submodels/{submodelKey}/shells` | The shells that reference the submodel, as `submodel-owners` reports them. |
| `GET/POST /targets/{targetId}/submodels/{submodelKey}/elements` | Tree nodes below the submodel or `parentElementKey`, with as many complete levels as fit into `budget` nodes (default 2,000, at most 5,000), also historically with `at`; or creates an element. |
| `GET/PUT/DELETE /targets/{targetId}/submodels/{submodelKey}/elements/{elementKey}` | Reads a single element as JSON with revision and `ancestors` or as AAS XML (`format`, `at`), replaces or deletes it. |
| `POST /targets/{targetId}/submodels/{submodelKey}/elements/{elementKey}/moves` | Moves an element to a position among its siblings; `If-Match` with the structure revision of the parent node (`structure_conflict` on a concurrent structural change). |
| `PUT /targets/{targetId}/submodels/{submodelKey}/elements/{elementKey}/value` | Sets the value of a Property or MultiLanguageProperty with `If-Match`. |
| `GET/PUT /targets/{targetId}/submodels/{submodelKey}/elements/{elementKey}/attachment` | Streams the content of a File element or replaces it with `If-Match`. A File without a value is `target_resource_not_found` (404) before Studio asks the AAS server. |
| `GET /targets/{targetId}/submodels/{submodelKey}/elements/{elementKey}/external-file` | Fetches the file that a File or Property element names at another host, for origins the deployment lists (ADR 0042). |
| `POST /targets/{targetId}/submodels/{submodelKey}/elements/{elementKey}/invocations` | Invokes an Operation synchronously or asynchronously; asynchronous invocations return a handle. |
| `GET /targets/{targetId}/submodels/{submodelKey}/elements/{elementKey}/invocations/{handle}` | Queries the state and outputs of an asynchronous invocation. |
| `GET/POST /targets/{targetId}/concept-descriptions` | Lists or creates concept descriptions (without an ID, Studio generates one following the infrastructure's scheme; `identifier_conflict` if the ID exists). |
| `GET/PUT/DELETE /targets/{targetId}/concept-descriptions/{resourceKey}` | Reads a concept description as JSON with revision or as AAS XML (`format`), replaces it with `If-Match` or deletes it. |
| `GET /targets/{targetId}/concept-descriptions/{resourceKey}/usages` | Counts submodels and elements whose semantic ID names the concept description (for the delete confirmation). |
| `GET /targets/{targetId}/changes` | Reads change events of shells, submodels and assets where the server announces its event feed. |
| `POST /targets/{targetId}/uploads` | Adds the content of an AASX, JSON or XML file; returns the new shells and the registry and discovery steps (`sync`). |
| `POST /targets/{targetId}/operation-invocations` | Runs an explicitly selected AAS operation with validated inputs and, if required, confirmation. |
| `GET/POST /targets/{targetId}/files` | Lists supplementary file metadata or streams a bounded upload. |
| `GET/DELETE /targets/{targetId}/files/{fileKey}` | Streams a file within limits or deletes it. No local paths are returned. |
| `GET /targets/{targetId}/semantic-index` | Searches semantic facts for shell/submodel selection, bindings and app applicability. |

AAS models stay deliberately generic in the contract: validation uses the
authoritative AAS Core 3.1 types and package validators, not a second Studio
metamodel specification.

Status MVP-4: Implemented are the shell list, reading single shells, submodels
and elements, as well as `shell-availability`, `searches`, `lookup`,
`submodel-refs`, `thumbnail`, `export`, `rights`, `access`, invitations,
`changes`, `concept-descriptions` (read-only), `uploads`, shell deletion,
values, attachments and invocations per Operation element. Creating and
replacing whole shells, submodels, elements and concept descriptions, the
submodel list, `operation-invocations`, `files` and `semantic-index` remain
draft. Studio offers optional functions (history through `at`, `changes`,
shares, queries) only where the server announces them in its service profiles
([ADR 0021](../adr/0021-feature-detection-from-service-profiles.md)); search and
queries run through the BFF
([ADR 0024](../adr/0024-aas-query-language-through-the-bff.md)). The routes
`GET /targets/{targetId}/search` and
`GET /targets/{targetId}/submodels/{submodelKey}/tree` of the viewer port are
replaced by `POST …/searches` and the level route `…/elements` with a node
budget. After uploads and deletions, Studio writes or removes registry
descriptors and discovery asset links where the server does not maintain them
itself and the effective sync mode is `autoCreate`
([ADR 0020](../adr/0020-infrastructure-templates-registries-and-sync.md)).
New problem codes: `descriptor_endpoint_blocked`, `query_invalid` and
`query_unsupported`. Details are in the
[MVP-4 plan](../development/mvp-4-plan.md#studio-api).

Status MVP-6: Concept descriptions are created, replaced and deleted, on live
targets as in workspaces, checked with AAS Core and with the same revisions as
submodels; `validations` also accepts `conceptDescription`. Shells, submodels
and elements write their `embeddedDataSpecifications` (IEC 61360) through the
existing routes. Details are in the
[MVP-6 plan](../development/mvp-6-plan.md#implementation-status).

Infrastructures can have a TLS client certificate (mTLS), independent of the
access mode ([ADR 0025](../adr/0025-client-certificates-for-infrastructures.md)).
The Studio Service presents it on every HTTPS request to the endpoints and to
the IdP. The API returns only the subject, issuer, expiry date and, where
applicable, the reference, never the bundle, key or passphrase. New problem
codes: `target_client_certificate_required`,
`target_client_certificate_rejected` and `client_certificate_invalid`.

## Desktop workspaces and AASX

Native file and folder dialogs belong to the Electron IPC contract. The BFF sees
only short-lived opaque handles.

| Method and path | Purpose |
| --- | --- |
| `GET /workspaces` | Lists local projects, never native paths. Only available with the desktop capability. |
| `POST /workspaces` | Creates a project at an approved destination handle. |
| `POST /workspaces/imports` | Imports an AASX through the Workspace Worker; archive size, paths, entry count, MIME type and resource limits are checked. |
| `GET/PATCH/DELETE /workspaces/{workspaceId}` | Reads metadata and recovery/validation status, changes metadata or deletes the project. Deleting the file is an explicit option. |
| `PUT /workspaces/{workspaceId}/activation` | Opens the project and provides it as a local `AasTarget`. |
| `POST /workspaces/{workspaceId}/duplications` | Duplicates the project to an approved destination handle. |
| `POST /workspaces/{workspaceId}/saves` | Saves the current revision atomically into the package. |
| `POST /workspaces/{workspaceId}/exports` | Exports the validated revision atomically to an approved destination handle. |

After opening, AAS reads and mutations run through the normal
`/targets/{targetId}/...` endpoints.

Status MVP-2: Implemented are `POST /workspaces` (opens an AASX from a file
handle), `POST /workspaces/{workspaceId}/saves`,
`POST /workspaces/{workspaceId}/exports` (save as) and
`DELETE /workspaces/{workspaceId}?force=`. `GET /workspaces/{workspaceId}/download?format=`
returns the whole package, unsaved changes included, as AASX, JSON or XML.
Only the Electron main process issues
file handles, through `POST /desktop/file-grants`
([ADR 0015](../adr/0015-desktop-native-bridge-and-file-grants.md)); details and
deviations are in the [MVP-2 plan](../development/mvp-2-plan.md#results).

## Cross-target copy

Copy and paste of shells, submodels and concept descriptions, between any
targets, from AAS JSON or XML text and from imported files
([package editing plan](../development/package-editing-plan.md), K3 to K9,
E1).

| Method and path | Purpose |
| --- | --- |
| `POST /copy-plans` | Plans a copy from resources of a target, or from AAS JSON or XML text, into a target: the chosen resources, a shell's submodels, the concept descriptions the source has for their semantic IDs and their files, with their state at the destination and AAS Core findings. Writes nothing; the plan expires after 30 minutes. |
| `POST /copy-plans/uploads?destinationTargetId=&fileName=` | Plans the import of an AASX, JSON or XML file (the body) as a copy. Packages import this way. |
| `GET /copy-plans/{copyPlanId}` | Reads the plan again. |
| `POST /copy-plans/{copyPlanId}/executions` | Runs the plan with the confirmed collision policy and answers with the report: `created`, `replaced`, `skipped` or `failed` per resource, and the registry entries. The source stays unchanged; atomicity is not claimed. The same `Idempotency-Key` answers with the first report; running the plan again skips what an earlier run wrote. |

The collision policies are `fail_without_changes` (the default),
`skip_existing`, `replace` (with structural writes, not within one target) and
`new_identifiers`, which gives copied shells and submodels new identifiers and
rewrites the references inside the copied set (the default within one target).

## Views, widgets and bindings

| Method and path | Purpose |
| --- | --- |
| `GET/POST /views` | Lists visible views or saves a validated declarative view. |
| `GET/PUT/DELETE /views/{viewId}` | Loads a view, replaces it with revision protection or deletes it. |
| `POST /views/validations` | Checks an unsaved draft including bindings and widget compatibility. |
| `POST /views/imports` / `GET /views/{viewId}/export` | Imports a portable definition or exports it without apps, secrets or AAS values. |
| `GET/PUT /views/{viewId}/access-rules` | Manages view opening and view authorization separately. |
| `POST /views/{viewId}/runtime-contexts` | Migrates the definition, authorizes widgets and resolves all bindings in the active context. Individual broken widgets are returned as diagnostics. |
| `POST /binding-resolutions` | Resolves a proposed instance or semantic binding. Status: `resolved`, `ambiguous`, `missing`, `incompatible`, `unauthorized`. |
| `POST /binding-executions` | Runs a concrete, authorized binding read, write or operation call. Opening a view alone grants no data rights. |
| `GET /widget-types` | Returns the built-in and app widgets allowed for the target/context, with schema, slots, compatibility, applicability and permissions. |

View definitions are declarative data; JavaScript, Vue, HTML, credentials,
service URLs and file system paths are excluded.

## Apps

| Method and path | Purpose |
| --- | --- |
| `GET /apps/catalog` | Sanitized marketplace projection for the UI, including compatibility and applicability. |
| `GET /apps/catalog/{appId}/versions/{version}` | Immutable version with digest, signature/revocation status, SBOM/review information and requested capabilities. |
| `GET/POST /app-installations` | Shows installations or installs digest-pinned with explicit permissions. Installation runs asynchronously; a package (`application/zip`) is checked and installed synchronously (MVP-3). Its signature goes in `Studio-App-Signature`; a signed package of a trusted publisher needs no developer mode. `?inspect=true` only checks the package and returns the verification result and, for an update, the changed permissions. Installing an installed app ID updates it in place under the same installation ID (ADR 0044). Each installation has its `trust`, verified publisher and revocation. |
| `GET/DELETE /app-installations/{installationId}` | Shows lifecycle and permissions or removes the installation. Apps shipped with Studio (`bundled`, ADR 0023) and managed packages (`managed`, ADR 0044) cannot be removed (MVP-4). |
| `PUT /app-installations/{installationId}/settings` | Replaces the installation's values of the app's declared settings (ADR 0048); values the settings do not accept are refused with a violation per key. Administrators only; audited with the changed keys. |
| `GET /app-installations/{installationId}/context?targetId=` | The settings and connection status Studio's page adds to a frame's context on a target: every declared setting's value (infrastructure, else installation, else default, else `null`) and `{ bound }` per declared connection (ADR 0048). Only for users who may open the infrastructure. |
| `GET /app-installations/{installationId}/compatibility` | Assesses technical compatibility and semantic applicability separately. |
| `GET /app-contributions` | Modules of the installed apps and, for one or more semantic IDs (repeated parameter, MVP-4), matching submodel views with a reason (MVP-3). |
| `POST /app-calls` | Capability call for an app: from the host bridge by session or from the backend by a short-lived capability token; checked against the manifest and user rights (MVP-3, ADR 0018). MVP-4 adds `shellId`, `studio.ui.setHeight` and `studio.ui.openFile`; the app context names the mode (`view` or `edit`). `studio.ui.openFullscreen` opens the view again in a fullscreen dialog (without permission, only in the host bridge); there, `fullscreen` is set in the context. With `header: false` (app API 0.1.7) the dialog shows the frame alone over the dimmed page, and `studio.ui.closeFullscreen` closes it; from a full-screen dialog only such a header-less one opens, above it. `studio.connections.call` (ADR 0047, frames and backends) calls a declared OpenAPI operation of the app's `connections` through the `http` connection of the target's infrastructure that binds it; bytes travel as base64 (`encoding: base64`), and every status of the service is a result. With app API 0.1.8, `studio.ui.navigate` takes `history: 'push'` (default `replace`), and `studio.aas.listShells` summaries carry `assetType` and `specificAssetIds`. With app API 0.1.13, `studio.ui.setViewState` (without permission, only in the host bridge) tells Studio what the view shows; the full-screen button of its Overview card opens the view with that state. With app API 0.1.14, `studio.ui.openExternal` also takes `mailto:` and `tel:` URLs, which open in the system's mail or phone app, and `studio.ui.saveFile` (permission `studio.ui.saveFiles`, after a click, only in the host bridge) saves up to 1 MiB of text the app created, e.g. a vCard, through Studio's page. With app API 0.1.15, `studio.aas.describeConcepts` (permission `studio.aas.read`, also for backends and embedded views) returns the IEC 61360 preferred name, short name, definition, unit and data type of the target's concept descriptions for up to 500 semantic IDs, in their order, `null` where there is none. |
| `PUT /app-calls/attachment` | `studio.aas.putAttachment` from the host bridge: the file as the body, the call in the query; authorized and audited like `/app-calls`, with the attachment route's checks (ADR 0049). Since then `/app-calls` also takes Studio's `mode`, which structural writes need as `edit`. |
| `POST/DELETE /app-installations/{installationId}/activations` | Activates or deactivates for a target/context. |
| `POST /app-installations/{installationId}/updates` | Checks a signed immutable version from the marketplace and provides it as an update. Uploaded updates use `POST /app-installations` (ADR 0044). |
| `POST /app-installations/{installationId}/rollbacks` | Rolls back to a verified previous version. |
| `GET/PUT /app-installations/{installationId}/visibility` | Manages visibility for users/groups independently of the installation scope. |

App `postMessage`/capability RPC and App Runner communication are a separate
contract; these endpoints manage only the BFF-side app lifecycle.

## Operations, events and audit

| Method and path | Purpose |
| --- | --- |
| `GET /operations` | Bounded list of running or completed copy/app operations for polling. |
| `GET /operations/{operationId}` | Queries a single status, progress, errors and links. |
| `GET /operations/{operationId}/events` | One-way SSE stream for progress and outcomes; resume through `Last-Event-ID`. |
| `GET /events` | Topic-filtered SSE notifications and cache invalidations; not a command channel. |
| `GET /audit-events` | Authorized, sanitized audit summaries. No tokens, bodies, package contents or secrets. |

## Not part of this API

Electron IPC, the Workspace Worker API, the App SDK RPC, the marketplace
publisher/OCI API, the OIDC provider API, the BaSyx downstream API and the
desktop updater remain separate contracts. This keeps the trust boundaries
described in the architecture and security parts of the documentation intact.

## Status MVP-5: Editor

Structural writes use structure revisions (`s.<hash>`, ADR 0027) and whole
resources. In addition to the routes above, the following are implemented:

| Route | Purpose |
| --- | --- |
| `POST /targets/{targetId}/submodels/{submodelKey}/elements` | Inserts an element (`parentElementKey`, `index`); `If-Match` with the structure revision of the parent node. |
| `PUT/DELETE /targets/{targetId}/submodels/{submodelKey}/elements/{elementKey}` | Replaces (also renames) or deletes an element; `If-Match` with the element revision. |
| `POST …/elements/{elementKey}/moves` | Moves an element (list elements; BaSyx Go sorts named children by name). |
| `PUT /targets/{targetId}/submodels/{submodelKey}` | Replaces submodel metadata; elements stay. |
| `POST /targets/{targetId}/shells` | Creates a shell with new submodels (wizard); submodels first, steps in the result. |
| `PUT /targets/{targetId}/shells/{shellKey}` | Replaces shell metadata and asset information; submodel references stay. |
| `PUT /targets/{targetId}/shells/{shellKey}/thumbnail` | Sets the thumbnail. |
| `POST /targets/{targetId}/shells/{shellKey}/instances` | Instance from a type shell. |
| `POST/DELETE /targets/{targetId}/shells/{shellKey}/submodel-refs[/{submodelKey}]` | Adds or removes a submodel (`deleteSubmodel`). |
| `POST /targets/{targetId}/submodels/{submodelKey}/instance-conversions` | Converts a template into an instance. |
| `GET /targets/{targetId}/templates[/{templateId}]`, `GET /submodel-templates/{templateId}` | Templates and their fields. |
| `POST /targets/{targetId}/validations` | AAS Core findings for JSON, without writing. |
| `POST /workspaces` with `{ "empty": true }` | New, empty package. |
| `POST /workspaces/{workspaceId}/undos`, `/redos` | Undo / redo until save or close. |

New problem codes: `idshort_conflict`, `structure_conflict`,
`identifier_conflict`, `partial_write` (with `steps`), `template_invalid`.

## Status: Submodel view

Submodels can be browsed and edited without a shell. The capability
`submodelListSource` names where the list comes from: the submodel registry or
the submodel repository (the infrastructure's `listSource` where it has both),
or `null` where submodels are served only through their shell. `submodelSearch`
is `query` where the submodel repository announces the AAS Query Language,
`expression` for AASX workspaces and `filter` otherwise. Registry descriptors
carry no `kind`, so the Instance/Template filter needs the repository.

| Route | Purpose |
| --- | --- |
| `GET /targets/{targetId}/submodels` | Submodel descriptors or the repository's `$metadata`, cursor-paged (`SubmodelSummary`). |
| `POST /targets/{targetId}/searches` with `scope: submodels` | Expression over `id`, `idShort` and `semanticId`, or a raw query with the roots `$sm` and `$sme`; runs on the submodel repository. |
| `POST /targets/{targetId}/submodels` | Creates a submodel without a shell (`empty`, `template`, `json`; not `existing`); its descriptor follows the sync plan. |
| `DELETE /targets/{targetId}/submodels/{submodelKey}` | Deletes a submodel; with `removeReferences=true` the referencing shells lose their reference first. Each step is reported, a failure becomes `partial_write`. |
| `GET /targets/{targetId}/submodels/{submodelKey}/shells`, `POST /targets/{targetId}/submodel-owners` | Referencing shells: an AAS query on `$aas#submodels[].keys[].value` where the AAS repository announces queries, else a scan of at most 1,000 shells (`method: scan`); without `complete`, an empty list does not prove an orphan. |
| `GET /targets/{targetId}/submodels/{submodelKey}?content=full&download=true` | The whole submodel as a JSON file (export). |

## Local BaSyx instances (desktop, ADR 0033)

The native Studio page uses `POST /containers/{operation}`. Each call requires
the user's Studio session and CSRF token; in hosted mode the manager is not
available. Container access is not exposed to installed apps.

| Operation | Purpose |
| --- | --- |
| `listEngines`, `selectEngine` | Detects the local engine or selects the socket/pipe |
| `listStacks`, `getStack`, `planStack` | Inventory, status and start plan |
| `createStack`, `changeStack`, `startStack`, `stopStack`, `updateStack`, `removeStack` | Lifecycle as jobs; only labeled objects |
| `getJob` | Progress and errors by polling |
| `getLogs`, `saveLogs` | Reads the latest log lines or saves them to a native file location |
| `getSignIn` | Shows generated credentials after an explicit user action |
| `exportStack`, `importStack` | Export or import through native file dialogs; the export contains passwords and a database snapshot |

The parameters and results are in `shared/contract/containers.ts`; the
compatibility operation schemas are in `shared/contract/apps.ts`. Tested images are pinned
by digest; a missing digest is not replaced by SNAPSHOT. When a stack is
removed without deleting data, the spec and the encrypted secrets are kept for
restoring it.

External links and clipboard writes run from an explicit action on the native
page. Lifecycle calls are audited with their result when their job ends.
