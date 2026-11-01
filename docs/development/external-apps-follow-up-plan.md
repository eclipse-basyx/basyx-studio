# External apps follow-up plan: what a multi-page app still misses

- Status: Proposed
- Date: 2026-10-21
- Depends on:
  - phases A–E of the [external apps plan](external-apps-plan.md)
    (implemented: ADRs 0043–0045, 0047, 0049, 0050; app API 0.1.7,
    packages 0.1.5), whose phase F this plan is;
  - [MVP-7](mvp-7-plan.md) for single-app mode (ADR 0046) and A3–A5, which
    stay there (see [Relation to MVP-7](#relation-to-mvp-7)).
- Scope decision gate:
  - an app that works on shells of one asset type, and on the shells related
    to them, reads them without one call per shell;
  - one signed package serves deployments that name their asset types,
    semantic IDs and external IDs differently, without a rebuild;
  - a multi-page module behaves like a web application in the browser (back
    returns to its previous page) and follows Studio's look without
    restating it;
  - an app shows other apps' submodel views without leaving its own pages.
- Not in scope: the end of the pilot's forked web UI image. The pilot's
  repository keeps working on its app first and decides when the fork and
  its image end. Nothing here schedules it.
- Requirements: APP-006, APP-009, APP-016, APP-018, APP-019, APP-023,
  APP-024, CON-002, CON-003, SAP-002, SAP-004, and the new APP-025 and
  APP-026 ([requirements](../requirements.md), see
  [Requirement changes](#requirement-changes))

## Goal

The external apps plan made Studio a platform for apps built in other
repositories and proved it with a pilot: an existing multi-page AAS
application that now runs in Studio as a signed, managed full-page module.
Building it showed what such an app still has to work around. This plan
lists those gaps, each with a proposal and a phase, so they can be
implemented one by one.

> a team builds a multi-page app against the published packages → it lists
> the shells of its asset type and their related shells in one call per
> page → the operator sets the app's asset types and external IDs for the
> deployment in the *Apps* page or the infrastructure YAML → users move
> between the app's pages with the browser's back button, and see the bill
> of material, files and charts of a shell without leaving the app.

## Starting point

Verified on `main` (d8a77e0) for each gap the pilot reported:

| # | Gap | Today on `main` | Item |
| --- | --- | --- | --- |
| 1 | Shells by asset type, related through a specific asset ID | `ShellSummary` has `id`, `idShort`, `displayName`, `assetKind` and `globalAssetId` (`packages/studio-sdk/src/protocol.ts`). Studio reads whole shells or descriptors for the list (`server/lib/aas/shells.ts`) and drops the rest, so an app calls `getShell` for every shell | R1, R2 |
| 2 | Asset types, semantic IDs, idShorts and external IDs per deployment | Compiled into the app. The manifest has no settings, and the context none (`AppContext`) | G1–G3 |
| 3 | An app whose first language is not English | `provideI18n(client, en, translations)` treats the base catalog as English and falls back to it; the locale for numbers and dates is Studio's even where texts fall back; keys are `section.key` only (`packages/studio-app-kit/src/i18n.ts`) | L1–L3 |
| 4 | Size of an IFC-only package | `@basyx/file-viewer`'s 3D viewer has one entry, and its parser client imports both WebAssembly files as Vite assets (`src/parsers/client.ts`). Every build ships occt-import-js's 7.6 MB WebAssembly, a large share of the 20 MiB package limit (ADR 0016), even where STEP is never loaded | B1 |
| 5 | The back button in a multi-page module | `studio.ui.navigate` ends in `router.replace` (`app/components/AppModuleView.vue`), so back leaves the module | N1 |
| 6 | `studio.ui.readFile` on a File without a value | Workspaces answer 404 (`server/lib/workspaces/model.ts`); live targets ask the AAS server anyway (`LiveTarget.attachment`), which fails with 500, and Studio answers 502 | R3 |
| 7 | Layout of a full-page module with its own navigation | The app kit's defaults (`src/defaults.ts`) cover cards, buttons, fields, lists and menus, not `VAppBar`, `VNavigationDrawer`, `VMain` or `VToolbar`, which Studio does configure (`vuetify.config.ts`). No helper connects an app's router to its sub-path, and no documented pattern places a module's own bar and navigation next to Studio's rail | N2, N3 |
| 8 | Permissions in the test Studio | `createTestStudio({ permissions })` takes `Permission[]`; a manifest imported from JSON gives `string[]`, so apps cast | W1 |
| 9 | Signing in CI other than GitHub | `examples/deployment/signed-app/ci/release-app.yml` is for GitHub Actions; the README says only that other CI systems run the same cosign commands. GitLab masks single-line variables only, and cosign's container image has no shell for CI jobs | W2 |
| 10 | Whether a connection is bound | Only a failed call says so (`connection_not_bound`, ADR 0047) | G4 |
| 11 | Other apps' submodel views in an app's pages | Not possible; `studio.ui.openShell` leaves the app for Studio's shell page (external apps plan X2) | E1, E2 |
| 12 | Charts of time series in an app | The app brings its own chart code; the Time Series app's chart is not reusable (ADR 0041 keeps ApexCharts in that app) | E3 |
| 13 | Embeds that need the third party's sign-in | Documented as unsupported in ADR 0045 and the SDK README (*Third-party origins*); nothing else changed | E4 |
| 14 | Packages on npm and a released image | The `@basyx` scope exists on npm, but the packages are not published yet, so trusted publishing for `release.yml` cannot be set up; no Studio release exists, only snapshot images from `main` | O1, O2 |

No gap is solved on `main` already. Gap 13 needs no work beyond the
decision E4, because the limit is documented.

## Decisions

Proposed on 2026-10-21. Methods and fields that are added are optional, so
each raises the app API by a patch version while it is 0.x, as A1 and A2
did, and older packages run unchanged (SAP-002).

### AAS reads

| # | Topic | Proposal |
| --- | --- | --- |
| R1 | Shell summaries | `ShellSummary` gains `assetType: string \| null` and `specificAssetIds: { name: string, value: string }[]`, from the shell's `assetInformation` or the registry descriptor, which Studio already reads for the list. `specificAssetIds` are what the server returns to the user; Studio filters nothing itself. An app selects shells by type and relates them through an ID from the pages of `listShells`, one call per page. |
| R2 | Filters | `listShells` gets no filter parameters. The AAS repository API filters by asset IDs, not by asset type, so a Studio-side type filter would still read every shell. Selecting by type on the server and relating by asset ID are MVP-7 A3 (`studio.aas.query`, `studio.aas.lookupShells`), which stays there and is the next step for large repositories. |
| R3 | Empty File elements | `studio.ui.readFile` and `studio.ui.openFile` on a File element without a value are answered with `target_resource_not_found` (404) before Studio contacts the AAS server, on live targets as on workspaces. The check sits in `LiveTarget.attachment`, so Studio's own pages get the same answer. |

### Settings and status per installation

Decided in [ADR 0048](../adr/0048-app-settings-and-connection-status.md),
which names the second scope `infrastructure`.

| # | Topic | Proposal |
| --- | --- | --- |
| G1 | Declared settings | The manifest declares `settings: [{ key, type, title, description?, default?, scope }]`. `type` is `string`, `number`, `boolean` or `stringList`, with an optional `enum` for `string`. `scope` is `installation` or `target`. Titles are localized like connection titles. At most 32 settings; no free JSON Schema, because Studio renders the form and validates the values. Settings are not permissions: adding one on an update needs no consent. |
| G2 | Values | Administrators set installation values on the *Apps* page. Target-scoped values are set per infrastructure, next to the connection bindings: in the infrastructure dialog and in declared YAML (`apps: [{ app, settings: { … } }]`), so managed and single-app deployments configure an app declaratively. Workspaces use installation values and defaults. Values are checked against the declared type when saved and when the package changes; values of removed settings are dropped. |
| G3 | Reading | `AppContext.settings` carries the resolved values (target value, else installation value, else default) and changes with the target, like the rest of the context. Backends get the same values with each call (`BackendContext.settings`). Settings are visible to the app and to the user's browser: they are not for secrets, which stay with connections (ADR 0047). |
| G4 | Connection status | `AppContext.connections` maps each declared connection ID to `{ bound: boolean }` for the active target. Nothing else: no URL, scheme or connection key (CON-002, CON-003). An app shows "not configured" before its first call. Calls still check the binding, which can change between context updates. |

### Navigation and layout

| # | Topic | Proposal |
| --- | --- | --- |
| N1 | History | `studio.ui.navigate({ subPath, history? })`: `history: 'push'` adds an entry, so back returns to the module's previous page; `'replace'` stays the default, so existing packages behave as before and filter state does not fill the history. Back and forward change the sub-path, which reaches the app with the context as today. In single-app mode the same entries are the root URL's (SAP-004). |
| N2 | Layout defaults | The app kit's defaults gain `VAppBar`, `VNavigationDrawer`, `VMain`, `VToolbar` and `VTabs` as Studio sets them, shared through `vuetify-defaults.ts` like the menu defaults, so the ESLint rules refuse restating them in apps as in Studio. |
| N3 | Multi-page modules | `@basyx/studio-app-kit` gains `createStudioHistory(client)`, a Vue Router history over the module's sub-path: route changes call `navigate` with `push` (N1), and context updates move the router. The kit's README documents the pattern for a full-page module (ADR 0045): a toolbar or a drawer inside the frame for the module's pages, no second app bar or rail, and the target's name shown by the app where it needs it. An example app with three pages uses it. |

### Localization

| # | Topic | Proposal |
| --- | --- | --- |
| L1 | Base language | `provideI18n(client, base, translations, { baseLocale })`: the base catalog is in `baseLocale` (default `en`, so existing apps are unchanged), and every missing text falls back to it. |
| L2 | Formatting locale | `I18n.formatLocale` is the locale whose catalog the texts come from, with Studio's dialects mapped to their language (`de-saar` → `de`). Apps pass it to `Intl` and Vuetify, so numbers and dates follow the texts. |
| L3 | Nested keys | Catalogs may nest to any depth (`section.group.key`); the type of partial catalogs follows the nesting. Two-level catalogs stay valid. |

### Packages and developer workflow

| # | Topic | Proposal |
| --- | --- | --- |
| B1 | Viewer per format | `@basyx/file-viewer` gets entries per parser (`/model/ifc`, `/model/step`; STL, OBJ and glTF need no WebAssembly) that an app registers with the viewer. Only registered formats bring their WebAssembly and worker into the build. The current entry keeps registering all formats. ADR 0039 stays as it is. |
| W1 | Test Studio from the manifest | `createTestStudio({ manifest })` takes the manifest as imported from JSON and uses its permissions, connections (refusing undeclared operations as Studio does) and declared settings defaults (G1). Unknown permissions in the manifest fail the test. `permissions` stays for tests that narrow them. |
| W2 | Signing on GitLab | `examples/deployment/signed-app/ci/` gains `.gitlab-ci.yml` and the README a section on other CI systems: store the key base64-encoded in a masked variable and decode it into the variable cosign reads with `env://`; install cosign's release binary with its checksum in a job image that has a shell, because cosign's image has none. Without cosign, `studio-app sign` reads a PEM key from a file. Documentation only. |

### Views of other apps and charts

To be decided in ADR 0051.

| # | Topic | Proposal |
| --- | --- | --- |
| E1 | Views in Studio's dialog | `studio.ui.openView({ submodelId, viewId? })` (permission `studio.ui.navigation`) shows the submodel in the view that Studio would pick on the shell's *Overview*, from any installed app, in Studio's full-screen dialog over the app. The view runs in its own frame with its own manifest and the user's rights, as on the shell page. Closing returns to the app unchanged, without navigation. It needs a click or key press just before, like `openShell`. |
| E2 | Inline views | ADR 0051 decides whether an app may place another app's view in its own page. The proposal: with one origin per installation (ADR 0045), the app asks for a view (`studio.ui.embedView`) and gets a frame URL at the other installation's origin; that frame connects to Studio's page itself and is identified by its origin, so the embedding app never holds its port or its permissions. On the shared apps origin, only E1 works. |
| E3 | Charts | No chart component in the app kit. A chart library in the kit would set one library and version for every app, which ADR 0041 avoided for Studio. Apps chart `studio.timeseries.read` results with their own code, or show the Time Series view with E1 or E2. Revisit when a second app needs the same chart. |
| E4 | Third-party sign-in in embeds | Nothing planned. ADR 0045 and the SDK README say that embeds needing the third party's sign-in may not work, because browsers block or partition third-party cookies. Apps open such pages with `studio.ui.openExternal`. The Storage Access API or popups would each need their own decision on sandbox flags. |

### Release prerequisites

Not new features: they close phases B and D of the external apps plan.

| # | Topic | Proposal |
| --- | --- | --- |
| O1 | Packages on npm | `@basyx/studio-sdk`, `@basyx/studio-app-kit` and `@basyx/file-viewer` are published by `release.yml` with provenance, with Studio's version ([ADR 0053](../adr/0053-one-version-for-studio-and-its-packages.md)). npm sets up trusted publishing only for existing packages, so each is first published by hand at 0.1.10. Until 0.2.0 is released, apps build against the packed tarballs. |
| O2 | Studio release | A released Studio image with app API 0.1.6 or later, so deployments need neither snapshots nor own builds for HTTP connections, structural writes and full-page modules. Studio 0.2.0 is that release, with the packages of O1 and app API 0.1.15. |

## Requirement changes

This plan adds two requirements (`docs/requirements.md`):

- **APP-025 (Should):** An app shall be able to declare settings that an
  administrator sets per installation and per infrastructure. Studio shall
  validate the values and pass them to the app. Settings shall not carry
  secrets.
- **APP-026 (Could):** An app shall be able to show the submodel views of
  other installed apps, which run with their own permissions and the user's
  rights.

APP-018 stays as it is; R2 relies on it.

## Code structure

- **`packages/studio-sdk/`:** `ShellSummary` (R1), `navigate`'s `history`
  (N1), `AppContext.settings` and `connections` (G3, G4), `openView` and
  `embedView` (E1, E2), the manifest schema (`settings`), `testing.ts`
  (`manifest` option, W1).
- **`packages/studio-app-kit/`:** `i18n.ts` (L1–L3), `defaults.ts` and
  `vuetify-defaults.ts` (N2), a router history module (N3), the manifest
  checks for `settings` (G1).
- **`packages/file-viewer/`:** per-format entries and registration (B1).
- **`server/lib/aas/shells.ts`, `server/lib/apps/calls.ts`:** summary fields
  (R1).
- **`server/lib/targets/live-target.ts`:** the empty File check (R3).
- **`server/lib/apps/`:** stored settings values and their checks (G1, G2),
  the resolved settings and connection status in the context (G3, G4).
- **`server/database/migrations/`:** installation settings values (G2).
- **`server/lib/infrastructures.ts`, `server/lib/infrastructure-file.ts`:**
  target-scoped values in the dialog and the declared YAML (G2).
- **`app/components/AppModuleView.vue`, `app/composables/useAppBridge.ts`:**
  push navigation (N1), `openView` (E1).
- **`app/components/AppsPanel.vue` and the infrastructure dialog:** the
  settings forms (G2).
- **`examples/apps/`:** the three-page example (N3) and an IFC-only viewer
  build (B1).
- **`examples/deployment/signed-app/`:** the GitLab CI example (W2).

## Phases

| Phase | Content | Done when |
| --- | --- | --- |
| A | ADRs: 0048 (settings and connection status per installation, G1–G4) and 0051 (views of other apps, E1–E4). ADR 0046 stays reserved for MVP-7's single-app mode, and 0049 and 0050 are taken, so the next free numbers are 0048 and 0051. Requirements APP-025 and APP-026 are added with this plan. Updates to `app-platform.md`. | ADRs reviewed |
| B | Capability fixes without an ADR: R1, R3, N1. *Done: app API 0.1.8, packages 0.1.6 (see [Phase B status](#phase-b-status)).* | An app reads the asset type and specific asset IDs of every shell from `listShells` pages alone. `readFile` on an empty File answers 404 without a request to the AAS server, on a live target and a workspace. In a module that pushes, back returns to its previous page and forward again; modules that do not push are unchanged. |
| C | App kit and packages: L1–L3, N2, N3, W1, B1. *Done: packages 0.1.7, app API unchanged (see [Phase C status](#phase-c-status)).* | An app with a German base catalog falls back to German texts and formats numbers and dates in German. The three-page example uses the router history and the kit's layout defaults and restates none of them (ESLint). A test Studio built from an imported manifest needs no cast. An IFC-only build contains no occt-import-js WebAssembly. |
| D | Settings and connection status G1–G4 (ADR 0048). *Done: app API 0.1.9, packages 0.1.8 (see [Phase D status](#phase-d-status)).* | One signed package runs on two infrastructures whose asset types and external IDs differ, configured in YAML and in the dialog, without a rebuild. An app shows that a connection is not bound before calling it. A value of the wrong type is refused. |
| E | Views of other apps: E1, then E2 as ADR 0051 decides. *E1 done: app API 0.1.10, packages 0.1.9 (see [Phase E status](#phase-e-status)).* | From an app's page, the user opens a shell's bill of material, files and time series in Studio's dialog and returns to the same page. With E2, the Time Series view shows inside the app's page, and the app cannot call methods with the view's permissions. |
| F | Signing on GitLab (W2), at any time. *Done: `examples/deployment/signed-app/ci/.gitlab-ci.yml` and the README's [GitLab CI](../../examples/deployment/signed-app/README.md#gitlab-ci) section. Checked against GitLab's CI schema; its job script, run in `node:24` with a throwaway key, signs a package that `studio-app verify` and Studio's signature check accept. Not yet run on a GitLab runner.* | A GitLab pipeline signs a package that `studio-app verify` and Studio accept, with the key in a masked variable |

### Phase B status

| Item | Status | Evidence |
| --- | --- | --- |
| R1 | Done | `ShellSummary.assetType` and `specificAssetIds` (`{ name, value }`) in `studio.aas.listShells`, from the shell's asset information or the registry descriptor (`server/lib/aas/shells.ts`); Studio's own shell list API has them too. Unit tests for both sources against a stand-in repository and registry, the workspace and `memoryAas`; the hosted e2e test finds the asset type in the Shell Explorer's list |
| R3 | Done | `LiveAasTarget.attachment` and the workspace model answer a File without a value with `target_resource_not_found` (404) after reading the element, before asking the AAS server or the package for its content, so `studio.ui.readFile`, `openFile` and Studio's attachment route all do. Unit tests show that no content request is sent |
| N1 | Done | `studio.ui.navigate({ subPath, history: 'push' })`, `client.ui.navigate(subPath, { history: 'push' })`; `'replace'` stays the default and the client sends `history` only when given. `AppModuleView` pushes or replaces the route. The module pages are keyed by module and target, not by sub-path, so the frame stays loaded and gets the new sub-path with the context; before, Nuxt's default page key reloaded the frame on every `navigate`. `@basyx/studio-sdk/testing` records `navigations` and moves with `back()` and `forward()`. The Shell Explorer example pushes its pages; the hosted e2e test goes back to the list and forward to the shell in the same frame |

### Phase C status

| Item | Status | Evidence |
| --- | --- | --- |
| L1–L3 | Done | `packages/studio-app-kit/src/i18n.ts`: `provideI18n(client, base, translations, { baseLocale })`, `formatLocale`, nested catalogs and `PartialCatalog` to any depth; existing calls are unchanged. Unit tests: a German base catalog with a partial English translation falls back to German and formats `1.234,5`; dialects format as their language; nested and two-level keys |
| N2 | Done | `layoutDefaults` in `vuetify-defaults.ts` (`VAppBar`, `VNavigationDrawer`, `VToolbar`, `VTabs`), used by `vuetify.config.ts` and the kit's `appDefaults`. Studio's in-page toolbars were all compact and transparent, so that became `VToolbar`'s default and the templates no longer state it; the app bar keeps its surface (`color: 'surface'`), because it renders a `VToolbar` itself. `VMain` gets no default: Studio sets none, and a scrollable `VMain` would keep a standard module's frame from growing with its content |
| N3 | Done | `@basyx/studio-app-kit/router` (`createStudioHistory(client, { history: 'push' })`), `mountApp`'s `setup`, the kit README's *Modules with pages*, and `examples/apps/inventory`: a full-page module with an overview, a list of shells and a page per shell, checked against the kit's defaults by `eslint.config.js`. Pushing is opt-in, because it needs app API 0.1.8 (N1); without it the history replaces Studio's entry. A sandboxed frame cannot move the browser's history (checked in Chromium), so `router.back()` moves through the pages the history visited. Unit tests run the example's router on the test Studio, including the browser's back and forward buttons |
| W1 | Done, without settings | `createTestStudio({ manifest })` in `packages/studio-sdk/src/testing.ts`: permissions (unknown ones fail, `permissions` narrows them), connections and operations refused before any handler, the app ID and first contribution in the context. The starter's dev Studio uses it. Declared settings defaults (G1) came with phase D |
| B1 | Done | `@basyx/file-viewer/model/ifc`, `/model/step`, `/model/viewer/core` and `/model/vue/core`, one worker per parser; `/model/viewer` and `/model/vue` register both, so existing imports are unchanged. A unit test builds the example, which registers only `ifcParser`, and finds web-ifc's WebAssembly and worker and nothing of STEP; the bundled 3D Models app still holds both |

### Phase D status

ADR 0048 decides G1–G4. Compared with the proposal, the second scope is
called `infrastructure` (values are set on infrastructures; workspaces have
none), settings may be `required`, and `enum` also applies to the items of a
`stringList`.

| Item | Status | Evidence |
| --- | --- | --- |
| G1 | Done | `settings` in the manifest (`packages/studio-sdk/app-manifest.schema.json`) and its checks in `@basyx/studio-app-kit/manifest` (`checkSettingValue`, `checkSettingValues`), shared by `studio-app pack`, `verify` and the upload; `^0.1.9` for `settings`. Unit tests for the findings and the value checks |
| G2 | Done | Installation values on the *Apps* page (`PUT /app-installations/{id}/settings`, migration 0009); infrastructure values in the dialog, the declared YAML, export and import (`apps: [{ app, settings }]`), checked against the installed manifests. Studio installs managed and bundled apps before it applies declared infrastructures. Unit tests resolve one package on two declared infrastructures and refuse wrong types in every path; the hosted e2e test sets values by API, in the dialog and on the *Apps* page |
| G3 | Done | `context.settings` from `GET /app-installations/{id}/context`, read before the frame loads; `settings` in a backend's context (Deno runner test); defaults from the manifest in `createTestStudio({ manifest })` (W1). The `asset-board` example |
| G4 | Done | `context.connections` with `{ bound }` per declared connection; `connectionsHandler` refuses unbound ones. The `work-orders` example shows "not configured" before calling (hosted e2e test) |

### Phase E status

| Item | Status | Evidence |
| --- | --- | --- |
| A (ADR 0051) | Proposed | [ADR 0051](../adr/0051-views-of-other-apps.md) decides E1–E4 |
| E1 | Done | App API 0.1.10, packages 0.1.9: `studio.ui.openView` in the protocol, `shared/contract/apps.ts`, `server/utils/apps.ts` (`checkViewToOpen`, `viewToOpen`), the host bridge and `AppFrame.vue` (Studio's dialog), the SDK client and `@basyx/studio-sdk/testing` (`openedViews`). Unit tests for the choice of view, the submodel and shell checks, authorization and the test Studio; the Shell Explorer example shows submodels in their views, and says so above its list when none fits. The hosted apps e2e tests open the Digital Nameplate view from it and return to the same page, and keep an opened view in step with an update of its app |
| E2 | Done | App API 0.1.11, packages 0.1.10: `studio.ui.embedView` and `context.embedded` in the protocol, `server/lib/apps/embeds.ts` (signed embed tokens, `isEmbeddable`), the app file route (`frame-ancestors` for a token's entry, `frame-src` of installation origins for apps with `studio.ui.navigation`), the host bridge (ports of embedded views, an allowlist of reads, their own app's settings, reloads after updates), `connect()` of the SDK and `@basyx/studio-sdk/testing` (`embeddedViews`). Desktop and the shared apps origin refuse it. Unit tests for tokens, embeddability and the policy; the app origins e2e test embeds the bundled Time Series view and a probe view in a test app's page, checks that the app gets no port and cannot reach the views' documents, that the probe connects once, gets its own settings, reads but cannot write or call its backend or connections, the `frame-ancestors` of the entry with and without a valid token, the probe's full screen in Studio's dialog with `fullscreenOpen`, and that an update in place loads the embedded probe again with the new package; with one shared apps origin, `embedView` is refused |
| E3 | Decided | ADR 0051: no chart component in the app kit |
| E4 | Decided | ADR 0051: nothing for embeds that need a sign-in |

O1 and O2 are not phases of this plan. They depend on the `@basyx` scope and
on Studio's first release. Phases B, C and F can start at once; D and E
follow phase A.

## Relation to MVP-7

- **A3** (`studio.aas.query`, `studio.aas.lookupShells`) stays with MVP-7.
  R1 removes the N+1 reads for repositories an app pages through; A3 is the
  server-side filter after it (R2).
- **A4, A5** (rights, user in context) stay with MVP-7. G3 and G4 add to the
  context in the same way and do not change them.
- **Single-app mode** (M1–M9, ADR 0046) stays with MVP-7. N1 gives its
  deep links working back and forward (SAP-004); G2's YAML values configure
  a single-app deployment's app.
- **MVP-7 phase G** is done with this plan, as phase F of the external apps
  plan is.
- **"Apps embedding other apps' submodel views"** in MVP-7's and the external
  apps plan's *Later* is taken here (E1, E2).

## Later

- Filters in `listShells` if MVP-7 A3 does not come before repositories grow
  too large to page through.
- A shared chart package, if several apps need the Time Series view's chart
  in their own pages (E3).
- Storage access for embedded pages that need the third party's sign-in
  (E4).
- Secret settings, should an app need a value that the browser must not see
  and that is not a connection credential.
