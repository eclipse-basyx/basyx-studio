# MVP-3 plan: runtime-installable apps

- Status: Implemented (see [results](#results))
- Date: 2026-10-08, implementation plan added and implemented 2026-10-09
- Depends on: [MVP-2](mvp-2-plan.md) (implemented: target contract, write path,
  revision tokens, workspace targets)
- Scope decision gate: the extension model is proven before BaSyx AAS Web UI
  features are ported

## Goal

Prove [ADR 0004](../adr/0004-runtime-installable-apps.md) with the two
extension types the BaSyx AAS Web UI has today, plus one app with server-side
logic:

> an administrator installs an app package while Studio is running → users see
> it without a reload of the service → a submodel view appears for matching
> submodels, a module appears in the navigation → both read and write AAS data
> only through declared capabilities → uninstalling removes them

| BaSyx AAS Web UI | Studio app contribution |
| --- | --- |
| Submodel plugin (Vue component compiled in, selected by `semanticId`) | **Submodel view**: sandboxed UI entry offered for submodels whose semantic ID matches the manifest |
| Module (page compiled in, own route, optional nested routes, menu entry, visibility options) | **Module**: sandboxed UI entry with its own Studio route, a sub-path for nested routes, a navigation item and declarative visibility |
| None | **Backend app**: app code in an isolated Deno process that calls Studio capabilities with a scoped token |

In the BaSyx AAS Web UI both types are built into the bundle. In Studio they
are installed data, so the core UI only knows the contribution points, not the
apps.

The result also decides, for each BaSyx AAS Web UI plugin and module, whether
it becomes a core Studio component or an app. That list is the input for
porting.

## Scope decisions

| Topic | MVP-3 decision |
| --- | --- |
| Distribution | Install from an uploaded `.zip` (developer mode, APP-015). No marketplace, OCI registry, signing, or review. Installations are marked unsigned. |
| Unsigned installs | Controlled by `STUDIO_APPS_ALLOW_UNSIGNED`. Default `false` for hosted production, `true` for desktop and for `nuxt dev` and the test environment. When disabled, the install endpoint answers `app_unsigned_disabled` and the admin UI hides the upload. |
| Integrity | Studio computes the SHA-256 digest of every file and of the package at install, stores the files content-addressed in the database (`bytea`), and verifies the digest when serving. This works the same with PostgreSQL and PGlite and across hosted replicas, and keeps ADR 0004's digest pinning without the marketplace. |
| Manifest | Versioned JSON Schema (draft 2020-12), validated with Ajv (`ajv/dist/2020`, already a dependency) as ADR 0006 requires. Contains ID, version, publisher, Studio app API range, runtimes, entry points, contributions, permissions. |
| Contribution points | `submodelViews` (semantic IDs, title, entry) and `modules` (title, icon, route segment, entry, `context`: `global`, `target` or `shell`). Modules receive a sub-path for nested routes. Element views and graphical-builder widgets come later. |
| UI isolation | Sandboxed `iframe` with `sandbox="allow-scripts"` only (no `allow-same-origin`, popups, forms, top navigation, downloads). Served from a separate origin: `STUDIO_APPS_URL` in hosted mode (dev: `http://apps.localhost:3000`), a `studio-app:` protocol on the renderer session in Electron. Strict CSP per document. |
| Bridge | `postMessage` handshake that transfers a `MessagePort`, versioned protocol `studio-sdk/0`, every message validated with Zod on the host side. One port per frame; a frame that navigates loses its port. |
| Studio SDK | `@basyx/studio-sdk` as a pnpm workspace package (`packages/studio-sdk`): framework-independent RPC client, types, context and theme helpers. Published to npm later. |
| Permissions and methods | The manifest declares coarse permissions, which are what an administrator approves and what `openapi.yaml` already names: `studio.aas.read`, `studio.aas.write`, `studio.ui.notifications`, `studio.ui.navigation`, `studio.backend`. Each RPC method requires one permission. Context (`studio.ui.getContext`) needs none. |
| Data scope | Apps may read any shell, submodel and element **on the active target** (decision of 2026-10-09). The host binds each frame to one target; calls carry AAS identifiers, never a target ID. Switching the target tears the frame down. |
| Capability methods | `studio.ui.getContext` (target, capabilities, shell, submodel, element, sub-path, locale, theme tokens), `studio.ui.notify`, `studio.ui.navigate` (within the module's own route), `studio.aas.listShells`, `studio.aas.getShell`, `studio.aas.listSubmodels`, `studio.aas.getSubmodel`, `studio.aas.getElement`, `studio.aas.setElementValue` (MVP-2 write path: apps pass the revision from `getElement` and get the same problems and `strong` or `best_effort` semantics as the core UI), `studio.backend.call` (phase B). |
| Authorization | Every call is checked against the installed manifest *and* the signed-in user's target access (`openTarget` with the user's session). An app never gains rights the user lacks. Writes and refusals are always audited with the app identity; reads follow the existing `target.read` audit rule and carry the app identity. |
| Installation scope | Hosted: deployment-wide, by `studio-admin`. Desktop: the local OS user (whose session already has the admin role). Per-user or per-group visibility (SEC-006) is out of scope. |
| Install flow | Synchronous: the upload is at most 20 MiB, so validation runs in the request and answers `201` or `app_package_rejected` with findings. Deviates from the asynchronous install in `openapi.yaml`; the marketplace install stays asynchronous. |
| Runtime install | Install and uninstall change only database rows. The Studio Service and the renderer bundle are not rebuilt or restarted. Open sessions pick changes up when the contribution query refetches (window focus, navigation, and every 30 s). |
| Backend apps | Phase B, hosted and desktop. Deno with deny-by-default permissions, one process per installation, started on demand and supervised by the Studio Service; network access only to the Studio capability endpoint. A backend app runs only on behalf of a user request from its own UI. Container isolation for hosted production is out of scope. |

## Design

### Package and manifest

```text
nameplate.zip
├── studio-app.json          manifest
├── ui/index.html            UI entry (one HTML document per contribution or shared)
├── ui/assets/…              scripts, styles, images, fonts
└── backend/main.js          optional, single bundled ES module for Deno
```

```json
{
  "manifestVersion": 0,
  "id": "org.eclipse.basyx.examples.nameplate",
  "version": "0.1.0",
  "publisher": { "name": "Eclipse BaSyx" },
  "title": { "en": "Digital Nameplate" },
  "studioApi": "^0.1.0",
  "runtimes": ["hosted", "desktop"],
  "permissions": ["studio.aas.read", "studio.aas.write", "studio.ui.notifications"],
  "contributes": {
    "submodelViews": [{
      "id": "nameplate",
      "title": { "en": "Nameplate" },
      "entry": "ui/index.html",
      "semanticIds": ["https://admin-shell.io/idta/nameplate/3/0/Nameplate"]
    }]
  }
}
```

Package checks, all before anything is stored:

- archive limits reuse `inspectArchive` and `isSafeEntryName` from
  `server/lib/workspaces/archive.ts` (path traversal, absolute names, entry
  count, declared sizes, compression ratio), with app-specific limits:
  20 MiB compressed, 50 MiB uncompressed, 2 000 entries;
- file types from an allow-list by extension (HTML, JS, CSS, JSON, SVG, PNG,
  JPEG, WebP, WOFF2, WASM); content types are derived from it, never sniffed;
- manifest schema, `studioApi` range against the Studio app API version,
  `runtimes` against the deployment mode, entry points exist in the archive,
  route segments and contribution IDs are unique, the same app ID and version
  is not installed already.

### App origin and CSP

| Runtime | Frame URL | Served by |
| --- | --- | --- |
| Hosted | `https://<STUDIO_APPS_URL>/app/<installationId>/<path>` | the same Nitro process; `server/routes/app/[...path].get.ts` answers only on the apps host, and a middleware throws `not_found` for every other path on that host |
| Desktop | `studio-app://<installationId>/<path>` | `protocol.handle` on the `studio` session in the Electron main process, which fetches the file from the local service with the launch secret |

Every app document gets:

```text
default-src 'none';
script-src <app base URL>/;  style-src <app base URL>/ 'unsafe-inline';
img-src <app base URL>/ data: blob:;  font-src <app base URL>/;
connect-src 'none';  frame-src 'none';  worker-src 'none';
form-action 'none';  base-uri 'none';
frame-ancestors <Studio origin>
```

Because the frame has an opaque origin, app assets are served with
`Access-Control-Allow-Origin: *` (module scripts need CORS) and no cookies.
App files are therefore not secret; this is stated in the deployment guide.
Studio pages get `frame-ancestors 'none'` so an app cannot embed Studio.

In Electron the main process additionally denies permission requests from app
frames (`setPermissionRequestHandler`), limits subframe navigation
(`will-frame-navigate`) to `studio-app:` URLs of the same installation, and
`isTrustedSender` already excludes subframes from the native bridge.

### Bridge

```text
App frame (opaque origin)          Studio renderer (host)               Studio Service
  sdk.connect() ── "studio-sdk/0 hello" ─▶ checks event.source = this frame
                ◀── MessagePort + context ─┤ (once; a second load event resets)
  sdk.aas.getElement(...) ── port ────────▶ Zod-validates, adds installation,
                                           frame context, target  ── POST /app-calls ─▶ manifest check
                                                                                       user target access
                                                                                       AasTarget call, audit
                ◀──────────── result or typed problem ◀──────────────────────────────────┘
```

The host never trusts the frame's claims about who it is: the installation and
target come from the frame the host created. The server never trusts the host
about permissions: it reads the manifest of the installation itself.

### Backend apps (phase B)

- A UI entry calls `studio.backend.call(method, params)`. The service mints a
  capability token (HMAC with the data key; installation, session, target,
  permissions, 60 s expiry) and passes it with the request to the app's Deno
  process over a local JSON-RPC channel (stdin/stdout).
- The Deno process calls `POST /api/studio/v1/app-calls` with the token as a
  bearer. The token is accepted only on that route, only while the session is
  valid, and grants no more than the manifest *and* the user. The launch-secret
  middleware exempts this route when a capability token is present.
- Deno runs with `--no-prompt --no-remote --cached-only
  --allow-net=127.0.0.1:<service port>` and no other permissions, from a
  per-digest directory under the data directory, with a heap limit. One process
  per installation, started on demand, stopped when idle and on uninstall,
  restarted with backoff, and killed when a call exceeds its time limit (as the
  Workspace Worker is today).
- `openTarget(event)` is split so that a target can be opened for a session ID
  without an HTTP event.
- Deno is shipped with Electron as an extra resource and in the hosted image.
  Phase 0 qualifies how Deno is obtained under the pnpm supply-chain rules
  ([ADR 0010](../adr/0010-pnpm-only-supply-chain.md)).

## Studio API changes

| Method and path | Purpose |
| --- | --- |
| `GET /app-installations` | List installations with status, digest, `unsigned`, permissions. |
| `POST /app-installations` | Admin. Body `application/zip`. `201` with the installation, or `app_package_rejected` (422) with findings, `app_unsigned_disabled`, `app_incompatible`. |
| `GET/DELETE /app-installations/{id}` | Details and requested permissions; uninstall (stops a backend process). |
| `GET /app/{id}/{path}` (apps origin) | App files with their CSP. Hosted only on the apps host; on desktop only for the Electron main process, which serves them as `studio-app:`. |
| `GET /app-contributions?semanticId` | Modules, and the submodel views for a semantic ID, with the reason for each match (for example *semantic ID `…/nameplate/3/0/Nameplate` matches*). |
| `POST /app-calls` | Capability call from the host bridge (session cookie and CSRF) or from a backend app (capability token). |

New problem codes in `server/lib/problem.ts` and `shared/contract/problem.ts`:
`app_package_rejected`, `app_incompatible`, `app_unsigned_disabled`,
`app_permission_not_declared`, `app_not_found`, `app_backend_unavailable`.
`openapi.yaml` is synced in phase C, including the reconciled permission names.

## Definition of done

Run in hosted web and packaged Electron against the test environment:

1. **Install at runtime.** `studio-admin` installs the demo apps while `alice`
   has Studio open. Within one refresh of the contribution list, without a
   service restart, `alice` sees them. Uninstalling removes them in the same
   way. On desktop, the local user installs and sees the app in the open
   window.
2. **Submodel view.** A *Digital Nameplate* app (IDTA 02006-3-0) is offered as a
   tab next to the generic tree for the nameplate submodels of the open target
   (`IESEDriveMotorDM3000`), the secured target, and the desktop workspace of
   `IESEDriveMotorDM3000.aasx`, and is not offered for other submodels. The UI
   explains why it matches.
3. **Module.** A demo module adds a navigation entry and a route, uses a nested
   route, and lists shells of the active target through capabilities.
   Switching targets updates it without showing data from the previous target.
   A `shell`-context module appears only while a shell is selected.
4. **Write through an app.** The nameplate view edits one value through
   `studio.aas.setElementValue`. `dave` succeeds; conflicts return
   `revision_conflict`; `alice` (read-only) gets `target_forbidden`; a write to
   a workspace target marks it unsaved.
5. **Undeclared permissions are refused.** A test app calling a method whose
   permission it did not declare gets `app_permission_not_declared`, and the
   call is audited.
6. **Isolation holds.** Security tests prove that an app cannot read Studio
   cookies or storage, cannot call `/api/studio/v1` directly, cannot navigate
   the top window, cannot embed Studio, cannot open or forge the bridge of
   another app, and cannot load code outside its own package.
7. **Invalid packages are rejected.** Schema violations, incompatible Studio API
   ranges, path traversal in the archive, disallowed file types, and oversized
   packages fail with findings and leave nothing installed. With unsigned
   installs disabled, the upload is refused.
8. **Backend app.** A backend app runs in its own Deno process with only the
   capability endpoint allowed, reads AAS data with a short-lived capability
   token on behalf of the calling user, and is stopped on uninstall. A token
   outside its scope, after expiry, or after logout is refused. Killing its
   process does not affect the Studio Service. Verified in hosted web and the
   packaged Electron app.
9. **Classification.** Every plugin and module of the BaSyx AAS Web UI is
   listed as core component, app, or dropped, with a reason.

## Results

The slice was implemented and verified on 2026-10-09 against the test
environment (BaSyx Go `SNAPSHOT`) in the dev server, the hosted production
build (Chromium) and the packaged macOS arm64 app (unpacked, ad-hoc signed).

| Definition of done | Status | Evidence |
| --- | --- | --- |
| 1. Install at runtime | Done | Web e2e: `studio-admin` installs the Nameplate app through the admin page while `alice` has the nameplate open; her page shows the tab without a reload and loses it after the uninstall. Desktop e2e: the local user installs three apps and uses them in the open window |
| 2. Submodel view | Done | Offered for the nameplate of `IESEDriveMotorDM3000` on the open target and as a local package, and for the secured target's nameplate; not for `TechnicalData`; the reason is shown above the frame |
| 3. Module | Done | Shell Explorer (target module) lists the shells, navigates to a nested route (`…/explorer/shells/<id>`), and after a target switch shows only the new target's shells; the shell module appears only while a shell is open |
| 4. Write through an app | Done | Nameplate edits `SerialNumber`: success with a Studio notification; `revision_conflict` keeps the draft; on the delegated secured target `alice` gets `target_forbidden` and `dave` succeeds; on a local package the write marks it unsaved |
| 5. Undeclared capabilities | Done | The probe app's `setElementValue` and `notify` get `app_permission_not_declared`; both refusals are in `audit_events` with the installation |
| 6. Isolation | Done | Probe app in both runtimes: no cookies, storage or IndexedDB, no parent DOM, no top navigation, no popups, no Studio API (`connect-src`), no foreign or external scripts (`script-src`), no framing of Studio (`frame-src`), and no second bridge |
| 7. Invalid packages | Done | Unit tests and API e2e: schema violations, incompatible ranges and runtimes, path traversal, disallowed file types, oversized archives and compression bombs give findings and install nothing; refused when unsigned installs are disabled |
| 8. Backend app | Done | Target Summary runs in Deno (hosted and packaged desktop), reads all 62 shells with the user's rights, and its isolation check reports file, environment, internet and subprocess access as denied. Runner tests: forged, expired and out-of-scope tokens are refused, a hung backend is killed and restarted, a killed process does not affect the service, uninstall stops the process |
| 9. Classification | Done | [Classification](#classification) |

Automated checks: `pnpm lint`, `pnpm typecheck`, `pnpm test` (108 tests,
including 31 for apps and the Deno runner), `pnpm test:integration` (129),
`pnpm testenv:smoke` (34 checks), `pnpm test:e2e:web` (12, of which 8 for
apps) and `pnpm test:e2e:desktop` (3, of which 1 for apps).

### Findings and deviations

**Phase 0**
- Deno is installed by pnpm as a runtime (`devEngines.runtime`,
  `deno@runtime:2.9.6`): the lockfile pins the official release archive per
  platform with its integrity, so no new release-age exception or install
  script is needed. The binary is 81 MB; a backend process starts in about
  30 ms.
- Sandboxed frames with an opaque origin need `Access-Control-Allow-Origin: *`
  on app files (module scripts are CORS requests with `Origin: null`).

**Platform**
- Contributions are requested with the submodel's semantic ID, which the shell
  page already has, instead of `targetId` and `submodelKey`; this saves a
  downstream read per selection. Modules are always returned; the UI shows
  them for their context.
- The app file route is `/app/{installation}/{path}` on the apps origin. The
  internal `/app-installations/{id}/files` route was not needed: the Electron
  main process fetches `/app/…` from the local service with the broker secret.
- One version per app ID can be installed (`app_already_installed`);
  uninstalling answers `204`.
- `studio.ui.getContext` is answered by the host without a server call; all
  other methods, UI methods included, are authorized by the server.
- App frames are created only after hydration. A frame in server-rendered HTML
  loaded and sent its `hello` before the bridge listened; the SDK retries
  `hello`, but the bridge should not depend on it.
- A browser cannot stop a sandboxed frame from navigating itself. Studio
  revokes the bridge and reloads the entry when that happens, and Electron
  blocks the navigation ([ADR 0017](../adr/0017-app-origin-and-content-security-policy.md)).
- Fonts (`woff`, `ttf`, `otf`, `eot`), `gif` and `avif` were added to the
  allowed file types; icon fonts ship all formats.
- Package findings are in `violations`; the problem detail only counts them.
- A crashing backend is started again by the next call, without backoff.

**Example apps**
- The example apps use Vue and Vuetify with Studio's defaults and theme. Their
  packages are about 2.4 MB, mostly icon fonts.

**Desktop**
- The packaged app ships Deno as an extra resource
  (`Resources/deno/deno`); its size grows accordingly.
- Without Developer ID signing, macOS runs the bundled Deno binary ad-hoc
  signed; release builds must sign it with the app.

**Not done yet**
- per-user or per-group visibility, updates and rollback, marketplace,
  signatures (out of scope);
- container isolation for hosted backend apps;
- element views (needed only for `HTWFuehrungskomponente`);
- a push channel for installs (contributions are polled every 30 s and on
  focus);
- Windows and macOS desktop e2e in CI; the Linux desktop job runs the app test
  on its first CI run.

### Code map

| Path | Content |
| --- | --- |
| `packages/studio-sdk/` | `@basyx/studio-sdk`: protocol types, client, backend types, manifest JSON Schema |
| `shared/contract/apps.ts` | Zod schemas for installations, contributions, bridge messages and calls |
| `server/lib/apps/` | Manifest and package checks, store, contributions, CSP, call authorization, capability tokens, Deno runner |
| `server/utils/apps.ts`, `server/api/studio/v1/app-*` | Call broker and routes |
| `server/routes/app/`, `server/middleware/01.apps-host.ts` | App files on the apps origin |
| `electron/main.ts` | `studio-app:` protocol, frame navigation and permission guards, bundled Deno |
| `app/components/AppFrame.vue`, `app/composables/useAppBridge.ts` | Sandboxed frame and host bridge |
| `app/components/AppModuleView.vue`, `app/pages/apps/`, `app/pages/targets/[targetId]/apps/` | Module routes |
| `app/pages/admin/apps.vue` | Install and uninstall |
| `examples/apps/`, `scripts/build-example-apps.mjs` | Nameplate, Shell Explorer and Target Summary apps (`pnpm apps:build`) |
| `test/apps/` | Unit tests and the isolation probe app |
| `test/e2e/web/apps.spec.ts`, `test/e2e/desktop/apps.spec.ts` | End-to-end tests |

### Classification

The result of DoD 9, against the BaSyx AAS Web UI `main` of 2026-10-09
(`src/components/Plugins` and `src/pages/modules`).

| BaSyx AAS Web UI | Becomes | Reason |
| --- | --- | --- |
| File previews (PDF, image, CAD, IFC, JSON, XML) | Core | Selected by content type, not semantics; needed by the generic `File` and `Blob` editor |
| Nameplate 2.0 and 3.0, ContactInformations, TechnicalData 1.2 and 2.0, HandoverDocumentation 1.2 and 2.0, CarbonFootprint 0.9 and 1.0, TimeSeries, HierarchicalStructures, Models3D, ProductionCalendar, ProductionPlan, FileSystem | App (first-party) | Bound to IDTA submodel templates by semantic ID; versioned independently from Studio |
| `JSONArrayProperty` element plugin | Core | Generic value rendering, not domain-specific |
| `HTWFuehrungskomponente` element plugin | App (third-party) | Project-specific; needs element views |
| AASCreationWizard, AasImporter, QueryLanguage | Core | Generic AAS authoring and querying |
| ABAC, ResourceAccess | Core (admin) | Security administration must not run with app trust |
| CatenaXplorer, CompanyDataPortal, CompanyDescriptorViewer, CompanyLookup, DPPDemo, PcfProcess | App | Use-case or ecosystem specific |
| ModuleRoutingShowcase, `Test*.vue` | Dropped | Examples and tests of the old plugin loader |

## Phases

| Phase | Content | Exit |
| --- | --- | --- |
| 0. Contracts | Manifest JSON Schema, `studio-sdk/0` protocol, permission and method list, app origin and CSP per runtime, Deno qualification (distribution, permissions, startup on macOS, Windows, Linux, container) | Reviewed schema; ADR drafts |
| A1. Install and serve | Package validation, content-addressed storage, install and uninstall API, admin page, apps host and `studio-app:` protocol | DoD 7 |
| A2. Bridge and read capabilities | Host bridge, `@basyx/studio-sdk`, context and read methods, authorization and audit, isolation test app | DoD 5–6 |
| A3. Contribution points | Submodel view tab, module routes and navigation, contribution query; Nameplate and demo module apps | DoD 1–3 |
| A4. Write capability | `setElementValue` on the MVP-2 write path | DoD 4 |
| B. Backend app | Deno runner, supervision, capability tokens, demo backend app, packaging for Electron and the hosted image | DoD 8 |
| C. Wrap-up | Classification list, results section, ADRs, `openapi.yaml` sync | DoD 9 |

A2 and B can overlap once A1 is done; B depends on the `/app-calls` route of A2.

### Work breakdown

**0. Contracts**

- `shared/apps/manifest.schema.json` and a typed loader in `server/lib/apps/manifest.ts`.
- `shared/contract/apps.ts`: Zod schemas for the bridge messages, the
  `/app-calls` request and result, installations and contributions.
- Spike: an iframe with `allow-scripts` on `apps.localhost` and on a
  `studio-app:` protocol, loading an ES module and receiving a `MessagePort`,
  in Chromium and packaged Electron.
- Spike: Deno binary acquisition, size, permission flags, and startup time on
  the three desktop platforms and in the hosted image.

**A1. Install and serve**

- Migration `0001`: `app_installations` (ID, app ID, version, package digest,
  manifest, unsigned, status, installed by, installed at), `app_files`
  (installation, path, digest, content type), `app_blobs` (digest, bytes), and
  a nullable `app_installation_id` on `audit_events`.
- `server/lib/apps/`: `package.ts` (archive and manifest checks, findings),
  `store.ts` (install, uninstall, read file with digest verification),
  `compat.ts` (`studioApi` range, runtimes).
- Config: `STUDIO_APPS_URL` (hosted; required when apps are enabled),
  `STUDIO_APPS_ALLOW_UNSIGNED`.
- Routes: `server/api/studio/v1/app-installations/…`, `server/routes/app/[...path].get.ts`,
  apps-host middleware.
- Electron: `protocol.registerSchemesAsPrivileged` (`standard`, `secure`,
  `supportFetchAPI`, `corsEnabled`) and `protocol.handle` on the `studio`
  session.
- Admin page `app/pages/admin/apps.vue`: upload, findings, list, uninstall,
  unsigned label; navigation entry for admins.
- Unit tests for the validator with fixture packages (traversal, bomb,
  schema, incompatible range, disallowed type, duplicate).

**A2. Bridge and read capabilities**

- `packages/studio-sdk` (first workspace package; `pnpm-workspace.yaml` gains
  `packages/*` and `examples/apps/*`).
- `app/components/AppFrame.vue` and `app/composables/useAppBridge.ts`: frame
  creation, handshake, Zod validation, request forwarding, teardown on
  navigation, target switch, and uninstall.
- `server/lib/apps/calls.ts`: method table (method → permission → handler on
  `AasTarget`), refusal, audit; `server/api/studio/v1/app-calls.post.ts`.
- Theme tokens from the Vuetify theme and the locale in the context; the SDK
  applies them as CSS custom properties.
- `test/apps/probe`: a test app that tries every isolation breach and
  undeclared call; Playwright inspects its frame.

**A3. Contribution points**

- `server/lib/apps/contributions.ts`: match submodel semantic IDs (exact
  match, as the BaSyx AAS Web UI does) and module context; reasons.
- Shell page: `v-tabs` around `ElementTree` in the *Elements* pane (*Tree* plus
  one tab per matching view); the selected tab is in the URL (`?view=`).
- Modules: `app/pages/apps/[installationId]/[...path].vue` (global) and
  `app/pages/targets/[targetId]/apps/[installationId]/[...path].vue` (target
  and shell context, shell in `?shell=`). Navigation entries in
  `layouts/default.vue` from the contribution query.
- Contribution query with key `['app-contributions', targetId, submodelKey]`,
  refetch on focus, navigation and every 30 s.
- Example apps in `examples/apps/nameplate` and `examples/apps/shell-explorer`
  (Vue and Vuetify, built with Vite), and `pnpm apps:build`, which produces the
  zips used by the tests.
- Fixture: give the secured `Nameplate` the semantic ID
  `https://admin-shell.io/idta/nameplate/3/0/Nameplate` and nameplate
  properties (today it has none, so DoD 2 could not pass).

**A4. Write capability**

- `studio.aas.setElementValue` through `AasTarget.setElementValue` and the
  existing audit, problem mapping, and workspace unsaved state.
- Nameplate edit UI; integration tests for `dave`, `alice`, and conflicts.

**B. Backend app**

- `server/lib/apps/runner/`: process manager (spawn, idle stop, backoff,
  timeouts, kill on uninstall), JSON-RPC over stdio, capability tokens.
- `openTarget` split into an event-free core used by both the HTTP route and
  token calls.
- `examples/apps/backend-demo`: a UI that asks its backend to summarize the
  active target's shells.
- Packaging: Deno in `electron-builder` extra resources; Deno in the hosted
  image; path configurable through `STUDIO_DENO_PATH`.
- Tests: token scope, expiry and logout; denied network and file access from
  the Deno process; killing the process.

**C. Wrap-up**

- Classification (DoD 9), results section and code map, ADRs, `openapi.yaml`.

## ADRs written during MVP-3

- [ADR 0016](../adr/0016-app-manifest-and-packages.md): app manifest and packages.
- [ADR 0017](../adr/0017-app-origin-and-content-security-policy.md): app origin and Content Security Policy.
- [ADR 0018](../adr/0018-capability-bridge-and-authorization.md): capability bridge and app authorization.
- [ADR 0019](../adr/0019-backend-app-runner.md): backend app runner.

## Known risks

| Risk | Mitigation |
| --- | --- |
| A separate app origin complicates hosted deployment (DNS, TLS) | One extra host name served by the same Nitro process; documented in the deployment guide; dev uses `apps.localhost` |
| Sandboxed iframes limit what apps can do (downloads, popups, clipboard, storage) | Add host-mediated capabilities when a demo app needs them, never by relaxing the sandbox |
| Reading any data on the active target gives apps a large read scope | Reads stay limited by the user's rights and are attributable; once `studio.http` exists, the install dialog must warn about AAS read plus egress (as the app platform doc requires) |
| A frame navigates itself to a page that then receives the bridge | The port is handed out once per frame load; a second `load` event revokes it and reloads the entry; CSP keeps scripts inside the package |
| Apps look foreign inside Studio | Pass Vuetify theme tokens and locale in the context; the example apps use Vuetify with those tokens |
| Bundling Deno with Electron adds size and platform work | Qualified in phase 0; measure size and startup; `STUDIO_DENO_PATH` allows a system Deno |
| Deno permissions are not a complete boundary for hostile code in hosted mode | Container isolation stays a production requirement; MVP-3 documents that hosted backend apps run in the Studio container |
| Polling the contribution list is coarse | 30 s plus refetch on focus and navigation is enough for DoD 1; a realtime channel can replace it later (ADR 0007) |
| The developer-mode install path becomes the de facto distribution | Unsigned installs are off by default in hosted production and labelled everywhere; the marketplace replaces them |

## Out of scope

Marketplace, signing, OCI artifacts, publisher review, per-user or per-group
visibility, app updates and rollback, element views, graphical-builder widgets,
file and HTTP egress capabilities, background jobs, privileged or native apps,
container isolation for hosted backend apps, cross-target data access.

## After MVP-3

- Port BaSyx AAS Web UI components and modules according to the classification.
- Element views, if the classification keeps element plugins as apps.
- Registry and discovery resolution.
- Cross-target AAS copy. With BaSyx Go conditional requests, the default
  `fail_without_changes` policy can write with `If-None-Match: *` (create-only
  `PUT`), so a resource created concurrently in the destination is never
  overwritten.
- Marketplace: catalogue, signed OCI artifacts, updates, rollback, visibility.
