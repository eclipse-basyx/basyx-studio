# MVP-4 plan: AAS viewer, registries, discovery and query search

- Status: Planned; implementation in progress
- Date: 2026-10-13, consolidated 2026-10-14
- Depends on: [MVP-3](mvp-3-plan.md) (implemented) and `basyx-typescript-sdk`
  2.4.0 (in use), which provides
  [eclipse-basyx/basyx-typescript-sdk#549](https://github.com/eclipse-basyx/basyx-typescript-sdk/issues/549)
  (query clients) and
  [eclipse-basyx/basyx-typescript-sdk#550](https://github.com/eclipse-basyx/basyx-typescript-sdk/issues/550)
  (descriptor endpoint resolution)
- Starting point: the viewer port on `feature/aas-viewer-port` (Jannik Fried,
  2026-10-14), finalized on the `mvp-4` branch. This plan replaces the port's
  own plan (`aas-viewer-port-plan.md`); where the two differed, the decisions
  of 2026-10-14 below apply.
- Scope decision gate: Studio replaces the BaSyx AAS Web UI viewer for
  browsing, finding and operating AAS data on registry- and repository-based
  infrastructures, so that editing, dashboards and further apps can build on it

## Goal

Studio becomes an understandable replacement for the BaSyx AAS Web UI viewer
(PROD-001), with the interaction design of the AAS viewer prototype:

> an administrator configures an infrastructure from a template (AAS
> environment, separate services, …) with registries and discovery → a user
> opens it, finds a shell in the shell list by scrolling, by query search, by
> asset ID or through ⌘K → reads it in the shell header, the submodel tree with
> inline values and the details drawer (details, app visualizations, JSON,
> XML, UML) → follows a deep link to the same element → uses the operations
> the server supports (history, changes, sharing, upload, export, delete,
> operations, files), each shown only where the server and the user's rights
> allow it

The user interface follows the prototype, not the Web UI: navigation rail,
shell list drawer, shell header card, tabs, a tree with values inline, and a
details drawer. The Web UI defines the functional bar: what its viewer can
find, show and do (search syntax, registry resolution, visualizations,
JSON/UML) must be possible in Studio as well.

## Starting point

`feature/aas-viewer-port` (5 commits, 148 files) contains, built against
SDK 2.3.0:

- **UI:** navigation rail and app bar with target switcher, View/Edit toggle and
  ⌘K; shell list drawer (filter, kind chips, favorites, sort, thumbnails);
  shell header card; tabs *Submodels*, *Overview*, *Changes*, *JSON*; tree with
  inline values, expand/collapse all and filter; element details drawer;
  typed value views; operation panel; share, upload and settings dialogs;
  command palette; target dashboard; concept descriptions page; bottom
  navigation on phones; Material 3 blueprint with its own palette.
- **API:** capabilities (`deleteShells`, `files`, `operations`,
  `conceptDescriptions`, `search`, `discovery`, `export`, `upload`, `history`,
  `changeFeed`, `sharing`); routes for preferences, changes, concept
  descriptions, discovery lookup, search, shell access and invitations,
  export, delete, rights, thumbnails, attachments, invocations, whole-submodel
  trees and uploads.
- **Server:** an HTTP client for endpoints the SDK lacked (queries,
  serialization, upload, history, events, ReBAC, operations); feature
  detection by probing endpoints, cached for 5 minutes; infrastructure
  endpoint types `aasEnvironment` and `discovery`; migration `0002`
  (`user_preferences`, `app_installations.bundled`).
- **Apps:** four bundled first-party apps (Nameplate, Carbon Footprint,
  Handover Documentation, Technical Data) in `apps/`, installed at startup.
- **Test setup:** history and the event feed enabled on `basyx-open`.

On `mvp-4` with SDK 2.4.0: lint and typecheck pass, 135 unit tests pass.
Integration, e2e and desktop runs are part of phase 0.

## Decisions

Made on 2026-10-14. They replace the port plan's decisions D1–D17 and the
earlier MVP-4 decisions where they differ.

### Layout and look

| # | Topic | Decision |
| --- | --- | --- |
| L1 | Page structure | The port's layout: app bar, navigation rail, shell list drawer, shell header card, tabs, tree with inline values, details drawer on the right. The Web UI's three-pane layout and the `@vuetify/v0` splitter are dropped. |
| L2 | Look | Studio's theme with a calm, shadcn-like finish: no Material 3 blueprint; small radii (at most Vuetify `lg`, 8 px) on cards, buttons, chips and fields; outlined fields with a thin border instead of `solo-filled`; borders instead of shadows; neutral surfaces; Studio's brand colours only. Extra theme tokens only where a component needs them. All of it lives in `vuetify.config.ts` defaults and aliases. |
| L3 | App bar and rail | The port's app bar and rail, with their Vuetify glitches found and fixed (phase 0 inventory, web and desktop, phone, tablet and desktop widths). |
| L4 | Small screens | The port's behaviour: bottom navigation, temporary drawers, full-screen palette. |

### Routes

| # | Topic | Decision |
| --- | --- | --- |
| R1 | `/targets/{targetId}` | A slim landing page as placeholder for a later dashboard MVP: target status and capabilities, *Open viewer*, *Upload* (where supported), and an empty state that names the coming dashboard. The port's change-feed and discovery cards are removed until the dashboard requirements exist. |
| R2 | Viewer routes | `/targets/{targetId}/shells` (no shell open) and `/targets/{targetId}/shells/{shellKey}`. |
| R3 | Deep links | Query parameters: `tab` (`submodels`, `overview`, `changes`, `json`), `submodel`, `element`, `mode` (`details`, `visualization`, `json`, `xml`, `uml`) and `view` (an app view ID). A link with `element` opens the tree path (from `ancestors`) and the drawer. `?globalAssetId=` on `/targets/{targetId}/shells` resolves through discovery. Links of MVP-1 to MVP-3 keep working. |

### Infrastructure and data access

| # | Topic | Decision |
| --- | --- | --- |
| I1 | Templates | As in the Web UI: `full` (every service with its own URL), `mono-all` (one AAS environment URL for every API), `mono-repo` (an AAS environment for the repositories, plus separate registries and discovery) and `identifiable` (an AAS repository only; submodels through the shell superpath). The template is stored with the infrastructure, drives the admin form and decides which endpoints exist. Catena-X is out of scope. |
| I2 | Endpoint types | `aasEnvironment`, `aasRegistry`, `submodelRegistry`, `aasDiscovery`, `aasRepository`, `submodelRepository`, `conceptDescriptionRepository`. An `aasEnvironment` serves every repository, registry and discovery API that has no endpoint of its own, plus the environment-only operations (upload, serialization). |
| I3 | List source | With both an AAS registry and an AAS repository, the administrator chooses the list source (`registry` by default). No automatic fallback when the registry is empty. The list reads descriptors or shells with the SDK clients directly, not with `AasService.getAasList` (one request per row, silent fallback). |
| I4 | Descriptor endpoints | Followed if they lie under the base URL of one of the infrastructure's endpoints (same scheme, host and port, base path as prefix at a segment boundary); otherwise `blocked` and never contacted. Single resources are resolved with the SDK's `AasService` and `SubmodelService` and the endpoint hook; rows show an availability marker. |
| I5 | Registry and discovery sync | Per infrastructure: whether the server synchronizes the registries and discovery itself, as in the Web UI. If it does not, the infrastructure sets the default (`autoCreate` or `dontCreate`) and whether users may override it; the user's choice is a preference. With `autoCreate`, the BFF writes descriptors and asset links after an upload and removes them after a delete, and reports each resource's result. |
| I6 | Feature detection | Only from the `/description` profiles, read at every probe and stored with the infrastructure. Studio shows a feature only if the server advertises it, because BaSyx Go is not the only possible backend. History and the event feed have no profiles in BaSyx Go yet: Studio implements detection for the profile URIs proposed in two BaSyx Go tickets and hides both features until servers advertise them. The port's endpoint probing and its in-memory cache are removed. |
| I7 | Clients | `basyx-typescript-sdk` for every standard AAS endpoint: registries, discovery, repositories, queries, operations, files, thumbnails, deletes. A separate BaSyx Go client (`server/lib/basyx-go/`) for proprietary endpoints only: `/upload`, `$history`, `$recent-changes`, `/events` and the event-feed description, `$access` and the ReBAC endpoints. Serialization also stays in that client for now, because the SDK cannot choose the format. |

### Search

| # | Topic | Decision |
| --- | --- | --- |
| S1 | Entry points | ⌘K palette for quick navigation: shells, elements, actions and asset-ID lookup. The shell list drawer gets the Web UI's search field: syntax with chips, the advanced query dialog, and the search in the URL (`?search=`, `?query=`). Both run the same server search. |
| S2 | Semantics | The Web UI's: free text plus `field:value`, `field=value`, `field!=value`, `-field:value`, quoted values; fields `id`, `idShort`, `assetKind`, `assetType`, `globalAssetId`, `specificAssetId`; case-insensitive regex for free text. Queries are built with the SDK's `Query` model and sent through its query clients; raw queries from the dialog are validated with Ajv against the IDTA-01002-3 schema (readable findings, 64 KiB, roots of the queried endpoint, no `$select`) and converted with `queryFromJsonable`. Element search (palette) uses `/query/submodels` with `$sme` roots where the server supports it. Without query support, the drawer falls back to filtering loaded rows, with a hint. AASX workspaces evaluate expressions in the workspace worker. |

### Tree, details and apps

| # | Topic | Decision |
| --- | --- | --- |
| T1 | Tree | Submodel refs as roots with their status (`forbidden`, `blocked`, `not_found`, `error`); element levels loaded on demand; `ElementDetail.ancestors` for deep links. *Expand all* loads the remaining levels of the open submodels breadth-first up to a configurable cap; the filter covers loaded nodes. The whole-submodel route is kept only for history (`at`), where the snapshot is one document. Refined after measuring: levels come with a node budget, and the level route also serves `at` ([Phase E measurements](#phase-e-measurements)). |
| T2 | Details drawer | Modes *Details*, *Visualization*, *JSON*, *XML*, *UML* for the selected submodel or element, like the Web UI's right pane. *Visualization* hosts the selected submodel's app views; the drawer can be widened to full width. XML uses aas-core's `xmlization` on the server; UML uses PlantUML as in the Web UI: Studio generates the PlantUML source from the AAS and renders it with `@plantuml/core` (one package without dependencies; decided 2026-10-14 instead of Mermaid, which brings 23 dependencies). The shell-wide *Overview* tab with all matching app views stays. |
| T3 | Editing | The global View/Edit toggle stays, with today's abilities: Property and MultiLanguageProperty values (MVP-2 write path) and replacing File contents. The drawer's edit area is generic, so a later editing MVP can add element types, creation and deletion without restructuring. |
| T4 | Bundled apps | The four bundled apps stay, installed at startup and not uninstallable. The bundled Nameplate replaces `examples/apps/nameplate`; the MVP-3 tests move to it. Shell Explorer, the backend demo and the isolation probe stay examples. A later MVP refines the apps. |

### Persistence, scope and quality

| # | Topic | Decision |
| --- | --- | --- |
| P1 | Preferences | `user_preferences` in the database per user: recently opened shells per target, theme, MultiLanguageProperty language, auto-refresh, and the sync overrides of I5. Layout state (drawer widths, open panels) stays in `localStorage`. |
| X1 | Extra features | Kept and polished: history, the *Changes* tab, ReBAC sharing (only with ReBAC and `delegated_user`, as the port decided), upload (100 MiB, DATA-006 checks), export (AASX, JSON, XML), deleting shells (with confirmation, UX-003), operations (sync and async), file download and replacement, thumbnails, the concept descriptions page and auto-refresh. AASX workspaces offer delete, files and search, not the live-only features. |
| Q1 | Quality bar | The full definition of done for every feature: hosted web and packaged Electron, `large` profile performance, AASX workspaces, lint, typecheck, unit, integration and e2e tests, at least one e2e test per feature, screenshots in the results. |

## Design

### Layout

```text
┌ app bar: ☰ · logo · [⌘K search] ········· target ▾ · View|Edit · theme · account ┐
├────┬──────────────┬──────────────────────────────────────────┬──────────────────┤
│rail│ shell list   │ shell header: avatar, name, chips, IDs   │ details drawer   │
│    │ search ⌨ ⋮   │ [Submodels|Overview|Changes|JSON]        │ [Details|Visual- │
│ ⌂  │ chips        │ ┌ filter · history ▾ · auto · ⊞ ⊟ ┐      │  ization|JSON|   │
│ ▤  │ ┌──────────┐ │ │ ▾ 📂 TechnicalData             │      │  XML|UML]        │
│ ⚙  │ │ shell  ● │ │ │    ⓟ MaxTorque   40 Nm         │      │ breadcrumb       │
│    │ │ shell  ⚠ │ │ │ 🔒 Secured                     │      │ header, value,   │
│    │ └──────────┘ │ └────────────────────────────────┘      │ edit area        │
└────┴──────────────┴──────────────────────────────────────────┴──────────────────┘
```

Phones: bottom navigation, the list and the drawer as temporary drawers, the
palette full screen.

### Server structure

- `server/lib/aas/services.ts`: per request, the SDK clients and services for
  the infrastructure's endpoints, with the guarded fetch, the target token, the
  list source and the base-URL check as endpoint hook.
- `server/lib/basyx-go/`: the proprietary client (from the port's
  `targets/http.ts` and `aas/basyx-go.ts`), limited to I7.
- `server/lib/aas/query.ts`: search expressions to SDK queries, raw-query
  validation.
- `server/lib/infrastructures.ts`: templates, endpoint expansion, sync
  settings, stored profiles; `server/lib/targets/capabilities.ts` derives the
  capabilities from profiles, target kind and security mode.
- `server/lib/aas/sync.ts`: descriptor and asset-link writes after upload and
  delete (I5).

## Studio API

Changes against MVP-3, combining the port's routes with the plan's:

| Area | Routes and fields |
| --- | --- |
| Infrastructures | `template`; endpoint types of I2; `listSource`; `sync` (`server` flags, default, user override allowed); probe results with profiles |
| Capabilities | the port's set, plus `listSource`, `search: 'query' \| 'expression' \| 'filter'`, `queryTarget` (where raw queries run), `elementSearch`; derived from profiles. `discovery` stays; the asset-ID lookup also works without it, through a repository query |
| Shells | list (registry or repository), `shell-availability`, `?globalAssetId=` lookup (the port's `/lookup`), delete, export, thumbnail, rights, access and invitations |
| Search | `POST /targets/{targetId}/searches` with `{ expression }` or `{ query }` and a scope (`shells`, `elements`), cursor-paged; replaces the port's `GET /search` |
| Submodels and elements | `submodel-refs` with `blocked`; elements per level with a node budget and `at` ([Phase E measurements](#phase-e-measurements)); `ElementDetail.ancestors`; `GET …/elements/{key}?format=xml`; attachments; invocations |
| Target | `changes`, `concept-descriptions`, `uploads`, `invitations` |
| User | `GET`/`PUT /me/preferences` |
| Problems | `query_invalid` (findings), `query_unsupported`, `descriptor_endpoint_blocked`; sync outcomes come per resource in the upload and delete results (`SyncStep`) instead of a problem |

`openapi.yaml` and `endpoints.md` are updated with the implementation.

## Definition of done

Run in hosted web (Chromium) and the packaged Electron app against the test
environment, and against the `large` profile where stated.

**Core**

1. **Infrastructures.** An administrator creates infrastructures from each
   template; invalid endpoint combinations are refused with findings; the
   stored profiles, derived features and sync settings are shown. A user
   overrides the sync default only where the infrastructure allows it.
2. **Registries.** On the registry-based target, the list comes from the AAS
   registry, shells and submodels resolve through descriptors, a descriptor
   outside the configured base URLs is `blocked` and never contacted (network
   log), and rows show availability. The repository-only target works as
   before.
3. **Search.** In the list drawer: free text, `field:value`, `field=value` and
   exclusions through `/query/shell-descriptors` and `/query/shells`, cursor
   paging, the search in the URL, the advanced dialog with findings and
   refusals, the client filter without query support, expressions on a
   workspace. In the palette: shells, elements, actions and asset-ID lookup.
4. **Discovery.** `?globalAssetId=` opens the shell; several shells show a
   picker; an unknown asset ID says so.
5. **Layout and look.** The port's layout at phone, tablet and desktop widths
   in web and Electron without Vuetify glitches (overlaps, clipped or
   misaligned controls, wrong drawer behaviour, hydration warnings); the look
   of L2 on every page, admin and app pages included. Screenshots in the
   results.
6. **Shell list.** On `large`, paging through 2,000 shells with virtual
   scrolling, filter chips, the open shell highlighted and
   pinned on a deep link, nothing of the previous target after a switch.
7. **Tree and deep links.** Submodel roots with status, levels on demand,
   *expand all* within the cap, a deep link three levels down opens the path,
   the drawer and the right mode; MVP-1 to MVP-3 links still work.
8. **Details drawer.** Every element type of the fixtures has a typed view;
   *Visualization* shows the Nameplate app for nameplate submodels only;
   *JSON*, *XML* and *UML* render the selected submodel or element.
9. **Editing.** In edit mode, Property and MultiLanguageProperty values and
   File contents can be changed with MVP-2's conflict and permission
   behaviour; view mode shows no edit controls.
10. **Performance.** On `large`, production build: first list page within 1 s
    of the response, no long task over 200 ms while scrolling 2,000 shells, a
    quick search within 2 s, expanding the 1,000-entry list within 1 s.
11. **Workspaces.** Criteria 6 to 9 hold for the desktop workspace of
    `IESEDriveMotorDM3000.aasx`, including the unsaved state after an edit;
    live-only features are not offered.

**Viewer features**

<!-- The numbering continues from the steps above. -->
<!-- markdownlint-disable MD029 -->
12. **History.** With the history profile advertised, a date in the past shows
    the submodel as it was, read-only; without it, the control is absent.
13. **Changes.** With the event-feed profile advertised, the *Changes* tab
    lists the shell's events; without it, the tab is absent.
14. **Sharing.** With ReBAC and `delegated_user`, the owner grants and revokes
    access and creates an invitation that another user accepts; the dialog is
    absent otherwise, and the admin page says why.
15. **Upload and export.** An AASX, JSON and XML file within the limit is
    uploaded (invalid ones are refused with findings) and appears in the
    list, with descriptors and asset links written according to the sync
    setting; a shell is exported as AASX, JSON and XML.
16. **Delete.** Deleting a shell needs confirmation, removes it from the list
    and, according to the sync setting, its descriptor and asset links.
17. **Operations.** A synchronous and an asynchronous operation run with
    inputs and show their outputs; refused calls explain why.
18. **Files and thumbnails.** File elements download and, in edit mode, are
    replaced; shells show their thumbnails.
19. **Concept descriptions, preferences, apps.** The concept descriptions page
    lists and shows them; recent shells and settings survive a new
    session and another browser; the four bundled apps are installed on a
    fresh start and cannot be uninstalled.
20. **Landing page.** `/targets/{targetId}` shows the placeholder of R1.
21. **Parity list.** Every feature of the Web UI viewer and of the port is
    listed as done, later (with the MVP or prerequisite) or dropped, with a
    reason.

<!-- markdownlint-enable MD029 -->

## Results

Implemented on `mvp-4` and verified on 2026-10-14 against the test
environment (BaSyx Go `SNAPSHOT` with history, event feed and registry sync;
the `large` profile on demand) in the dev server, the hosted production build
(Chromium) and the packaged macOS arm64 app (unpacked).

| Definition of done | Status | Evidence |
| --- | --- | --- |
| 1. Infrastructures | Done | Admin form with templates, per-template endpoints and findings, list source, sync settings, stored profiles and derived features; user override in *Settings*. Unit tests for template rules and capabilities, migration `0003` upgrade test. No e2e test drives the form yet (the e2e helpers register targets through the API) |
| 2. Registries | Done | Integration tests: the registry-based list, resolution through descriptors without repositories, a foreign descriptor `blocked` before any request (base-URL rule, unit-tested), availability markers, the identifiable superpath; the repository-only target as before |
| 3. Search | Done | Integration tests on both query endpoints (case-insensitive text, filters, exclusions, empty search, raw query, `$select` and foreign roots refused with findings, element search); parser unit tests; workspace expressions in the worker model tests; web e2e for the palette's element search. The list search, its chips, the advanced dialog, URL state and the local-filter hint were checked in the browser; no e2e test covers them yet |
| 4. Discovery | Done | Web e2e: `?globalAssetId=` opens the shell; the picker and the unknown-asset message were checked in the browser |
| 5. Layout and look | Done | Screenshots at 1440, 768 and 375 px during phases A, D and E; no hydration warnings after the hotkey fix (D25); the app bar, rail, drawers and tree toolbar fixed (D1–D10). Dark mode was checked in phase A and again for the drawer modes and the list search in phase G |
| 6. Shell list | Done | On `large`: 2,000 shells in a virtual scroll (15 rows in the DOM), filter chips, the open shell highlighted, scrolled to and pinned when not loaded; the target switch test (web e2e) |
| 7. Tree and deep links | Done | Levels with a node budget, *expand all* within its cap, `Deep.Level1.Level2.Level3.Leaf` on `large` opened from a link with its path and the drawer; MVP-1 to MVP-3 links (`submodel`, `element`, `view`) work; web e2e for filter and details |
| 8. Details drawer | Done | A typed view for every element type of the fixtures; *Visualization* with the Nameplate app for nameplate submodels only; *JSON*, *XML* and *UML* of submodels and elements (screenshots) |
| 9. Editing | Done | Web e2e: read-only in view mode, Property edit with reload, conflict with kept draft, value-type errors; app writes with conflicts and rights (web e2e); File replacement as in MVP-2 |
| 10. Performance | Done | [Phase E measurements](#phase-e-measurements): first list page 102 ms, no long task while scrolling 2,000 shells, quick search 0.79 s, the 1,000-entry list's first page 0.44 s |
| 11. Workspaces | Partly | Desktop e2e: open, edit, save, save as, close with unsaved changes, app writes on a local package. Criteria 6–9 on a workspace were not run as a whole in the packaged app |
| 12. History | Done | Web e2e: a past date shows the submodel read-only; without the profile the control is absent (capability tests) |
| 13. Changes | Done | Web e2e: the *Changes* tab lists the shell's events; absent without the profile |
| 14. Sharing | Not verified | Kept from the port and shown only with ReBAC and `delegated_user`, but the test environment has no ReBAC server |
| 15. Upload and export | Done | Web e2e: JSON export and its upload; invalid packages refused with findings (integration); descriptors and asset links written per sync setting (integration). AASX and XML export were checked by hand |
| 16. Delete | Done | Web e2e: only in edit mode, after confirmation; descriptor and asset links removed per sync setting (integration) |
| 17. Operations | Partly | The drawer's operation panel runs synchronous and asynchronous invocations, and a refused call explains why (integration test). The test environment's operation has no delegation target, so no successful run was verified |
| 18. Files and thumbnails | Done | Integration tests for attachments and thumbnails; thumbnails in the list and header |
| 19. Concept descriptions, preferences, apps | Done | Web e2e: concept descriptions, recent shells and settings per user; the four bundled apps on the overview, without an uninstall button |
| 20. Landing page | Done | Web e2e |
| 21. Parity list | Done | [Parity](#parity-with-the-web-ui-and-the-port) |

Automated checks: `pnpm lint`, `pnpm typecheck`, `pnpm test` (153 tests),
`pnpm test:integration` (204), `pnpm testenv:smoke` (40 checks),
`pnpm test:e2e:web` (22) and `pnpm test:e2e:desktop` (3).

### Findings and deviations

- **Tree loading** (T1): BaSyx Go reads the whole submodel for every element
  request, so a request per level costs as much as the whole tree. Levels come
  with a node budget instead; the `tree` route is gone and the level route
  serves history ([Phase E measurements](#phase-e-measurements)).
- **Rendering**: tree rows cost about 2 ms each; closed groups are not
  rendered, long levels are paged, and the shell list is virtual.
- **Blob values**: the AAS API leaves them out of element reads unless
  `extent=withBlobValue` is given.
- **BaSyx Go**: with registry integration, deleting a shell whose descriptor
  is already missing fails with 404 ("AAS Descriptor not found"), and the shell
  stays. Worth an issue upstream.
- **SDK**: `postInvokeOperationAsync` returns no handle, so asynchronous
  invocations stay on the raw layer ([ADR 0022](../adr/0022-basyx-go-endpoints-outside-the-sdk.md)).
  Fixed in SDK 2.4.1, which Studio now uses for invocations.
- **Vuetify**: `VHotkey` rendered "Ctrl" on the server and ⌘ in a Mac browser;
  Studio now sets its platform from the request. Its accessible label for
  icon keys reads "$COMMAND"; to be reported upstream.
- **vue-tsc 3.3.12** garbles `//` inside bound template expressions; URLs in
  templates are kept in script constants.
- **App frames** may not submit forms (sandbox without `allow-forms`), and
  auto-sized views do not suit dialogs; the bundled Nameplate edits in place.
- **Apps** receive Studio's mode in their context (`mode`), so they offer edit
  controls only in edit mode, as Studio does.
- **Dropped after review**: the port's favorites and the shell list's sort.
  Both worked only on the shells already loaded, so on a large target they
  gave incomplete results; *recently opened* covers returning to a shell.
  Favorites stored by earlier builds are ignored and removed on the next
  save. Auto-refresh is off by default, as auto-sync in the Web UI.

### Not done yet

- e2e tests for the admin form, the list search and the advanced query dialog;
- sharing against a ReBAC server, and operations against a delegation target
  (a test-environment operation service would cover DoD 17);
- DoD 11 as a whole in the packaged app;
- the Web UI features listed as *later* below.

### Code map

| Path | Content |
| --- | --- |
| `shared/contract/infrastructure.ts`, `server/lib/infrastructures.ts`, `server/database/migrations/0003_*` | Templates, endpoint types, list source, sync settings, stored profiles |
| `server/lib/targets/profiles.ts`, `capabilities.ts` | Features from profiles |
| `server/lib/targets/resolution.ts`, `server/lib/aas/availability.ts` | Registry resolution, base-URL rule, availability |
| `server/lib/aas/sync.ts` | Descriptors and asset links after uploads and deletes |
| `shared/search/expression.ts`, `server/lib/aas/query.ts`, `query-schema.json` | Search syntax, query building, raw-query checks |
| `server/lib/aas/tree.ts`, `app/composables/useShellTrees.ts` | Tree levels with a node budget, lazy tree, paging |
| `server/lib/aas/xml.ts`, `shared/aas/plantuml.ts`, `app/utils/plantuml.ts` | XML and UML modes |
| `app/components/ElementDetailsDrawer.vue` and `Element*Panel.vue`, `ElementStructureView.vue`, `ElementEditArea.vue` | Details drawer, modes, typed views, edit area |
| `app/components/ShellListDrawer.vue`, `ShellQueryDialog.vue`, `CommandPalette.vue` | List, search and palette |
| `apps/nameplate/` | The bundled Digital Nameplate |
| `test-setup/` | History, event feed, registry sync, the `large` profile |

### Parity with the Web UI and the port

Against the BaSyx AAS Web UI `main` of 2026-10-14 and the viewer port.

| Feature | Status | Note |
| --- | --- | --- |
| Infrastructures with templates, registries, discovery | Done | Catena-X template out of scope |
| AAS list from registry or repository, availability markers | Done | |
| Search syntax, query language, advanced dialog | Done | |
| Command palette, asset-ID lookup | Done | |
| Submodel tree with values, filter, expand all | Done | |
| Element views for all element types | Done | |
| Visualization: Nameplate, Technical Data, Carbon Footprint, Handover Documentation | Done | As bundled apps |
| Visualization: Contact Information, Time Series, Hierarchical Structures, Models3D, Production Calendar and Plan, File System | Later | As first-party apps, one by one |
| JSON and UML views | Done | XML added |
| File previews (PDF, image, CAD, IFC, JSON, XML) | Later | Core feature for `File` and `Blob` (MVP-3 classification); images and downloads work |
| Editing of Property, MultiLanguageProperty and File | Done | |
| Full AAS and submodel editor, creation wizard, importer, instance conversion | Later | Editing MVP; the edit area is generic (T3) |
| Upload, download, delete | Done | With registry and discovery sync |
| Auto-refresh | Done | Opened levels are re-read |
| History, changes | Done | Studio additions, shown where announced |
| ReBAC sharing and invitations | Done | Not verified without a ReBAC server |
| ABAC editor | Later | Admin feature (MVP-3 classification) |
| QR code of the global asset ID, QR scanner | Done | IEC 61406 frame drawn as SVG; scanning with the camera or an image, then the asset ID lookup |
| Charts and widgets | Later | Dashboards and views (VIEW requirements) |
| Concept descriptions | Done | Page; per-element concept descriptions later |
| Ecosystem modules (Catena-X, company lookup, DPP, PCF) | Later | As apps |
| Port's dashboard | Dropped | Replaced by the landing placeholder (R1) until its requirements exist |
| Port's whole-submodel tree route | Dropped | Replaced by levels with a node budget |
| Port's favorites and shell list sort | Dropped | Client-side only, incomplete on large targets; recently opened shells instead |

## Phases

| Phase | Content | Exit |
| --- | --- | --- |
| 0. Inventory (done) | Run the port in web and Electron at three widths and record every visual and content defect in [Defects](#defects); integration, e2e and desktop baseline; BaSyx Go tickets for the history and event-feed profiles; registry integration in the test environment; lazy-tree measurements | Defect list; baseline; tickets |
| A. Look and shell | L2 theme without the blueprint, app bar and rail glitches, phones, landing page, routes and deep links | DoD 5, 20 |
| B. Infrastructures | Templates, endpoint types, list source, sync settings and overrides, stored profiles, admin form | DoD 1 |
| C. Data access | SDK for standard endpoints, BaSyx Go client for proprietary ones, registry resolution and the base-URL rule, availability, discovery, capabilities from profiles | DoD 2, 4 |
| D. Search | Palette and list search, syntax, advanced dialog, URL state, element search, workspace expressions | DoD 3 |
| E. Tree and drawer | Lazy tree with `ancestors`, *expand all*, drawer modes, XML and UML, generic edit area, *Overview* and *Visualization* | DoD 6–9 |
| F. Viewer features | History, changes, sharing, upload and export with sync, delete with sync, operations, files and thumbnails, concept descriptions, preferences, bundled apps | DoD 12–19 |
| G. Wrap-up | Workspace and performance runs, desktop e2e, screenshots, parity list, results, ADRs, `requirements.md` and `design-guidelines.md`, `openapi.yaml` | DoD 10, 11, 21 |

A and B can start right after phase 0; C needs B's endpoint model; D and E
need C; F needs C and E. Defects from phase 0 are fixed in the phase that owns
the area.

### Work breakdown

**0. Inventory**

- Start the test environment, the dev server and the packaged app; walk
  through every page at 375, 768 and 1440 px in light and dark; record
  defects with screenshots.
- `pnpm test:integration`, `pnpm test:e2e:web`, `pnpm test:e2e:desktop`
  against the port; record failures.
- BaSyx Go tickets: profiles for history (`$history`, `$recent-changes`) and
  the event feed (`/events`, `/.well-known/event-feed.json`) in
  `/description`, with proposed URIs.
- `basyx-open`: registry integration (`GENERAL_AASREGISTRYINTEGRATION`,
  `GENERAL_SUBMODELREGISTRYINTEGRATION`, `GENERAL_EXTERNALURL`) next to history
  and the event feed; a foreign descriptor fixture; the `large` profile.
- Lazy tree with 1,000 siblings and 5,000 nodes; `@plantuml/core` bundle size
  (lazy-loaded) and rendering of a large submodel.

**A. Look and shell**

- `vuetify.config.ts`: remove the `md3` blueprint and the port's palette;
  defaults for L2; aliases for recurring roles (pane, header card, toolbar
  button) instead of restated props.
- App bar, rail, bottom navigation and drawers: fix the inventory's glitches;
  check SSR hydration and the theme switch (`app.vue`).
- Landing page (R1); viewer routes and deep links (R2, R3), including the
  MVP-3 `?view=` links.

**B. Infrastructures**

- Contract: `template`, endpoint types, combination rules per template,
  `listSource`, `sync`; probe results with profiles.
- Migration `0003` (after the port's `0002`): template, list source, sync
  settings, profiles and probe time on `infrastructures`; upgrade test
  (DEP-007).
- Admin form: template choice, endpoints per template, list source, sync,
  stored profiles and derived features (replacing the port's capability
  chips from probing).

**C. Data access**

- `server/lib/aas/services.ts` and the endpoint hook; registry listing and
  resolution; `blocked`; `shell-availability`.
- Move the port's raw calls for queries, operations, files, thumbnails and
  deletes to the SDK; move the rest to `server/lib/basyx-go/`.
- Capabilities from stored profiles (I6); remove `features.ts` and its cache.
- Discovery lookup and `?globalAssetId=`.

**D. Search**

- `shared/aas/search-expression.ts` (parser, fields, chips) with the Web UI's
  cases; `server/lib/aas/query.ts`; `POST …/searches`.
- List drawer search field, advanced dialog, URL state; palette on the same
  route; workspace worker expressions.

**E. Tree and drawer**

- Replace the port's whole-submodel tree with per-level loading and
  `ancestors` (keep `tree?at=` for history); *expand all* with the cap.
- Drawer modes; XML route; UML with PlantUML (source generation ported from the Web UI's `PlantUMLRenderer.ts`, SVG sanitized as there); *Visualization* with app views;
  generic edit area for the MVP-2 editors and File replacement.

**F. Viewer features**

- Polish each feature of X1 against its definition of done, including empty,
  error, forbidden and unsupported states and i18n.
- `server/lib/aas/sync.ts` for upload and delete.
- Bundled Nameplate replaces the example; MVP-3 tests move to it.

**G. Wrap-up**

- e2e per feature; desktop e2e; performance traces; screenshots.
- ADRs (below), requirements and design guidelines, `openapi.yaml`,
  `endpoints.md`, results section, code map, parity list.

## Phase 0 results

Recorded on 2026-10-14 on `mvp-4` (the port plus SDK 2.4.0), against the test
environment, the dev server (walkthrough at 1440, 768 and 375 px, light and
dark) and the builds used by the e2e suites.

| Check | Result |
| --- | --- |
| Lint, typecheck, unit tests | Pass (135 unit tests) |
| `pnpm testenv:smoke`, `pnpm test:integration` | Pass (34 checks, 167 tests), before and after the test environment changes |
| `pnpm test:e2e:web` | 13 passed, 2 failed, 7 not run (serial groups after the failures): D14, D20 |
| `pnpm test:e2e:desktop` | 3 of 3 failed: D21 |
| BaSyx Go profiles | [eclipse-basyx/basyx-go-components#763](https://github.com/eclipse-basyx/basyx-go-components/issues/763), PR [eclipse-basyx/basyx-go-components#764](https://github.com/eclipse-basyx/basyx-go-components/pull/764): IDTA history profiles (AAS Repository SSP-006, Submodel Repository SSP-007) when history is recorded, `https://basyx.org/aas/API/3/2/EventFeed/1.0` when the feed is on |
| Test environment | `basyx-open` syncs its registries (62 shell and 7 submodel descriptors, endpoints `AAS-3.2` under `http://localhost:18081`), discovery resolves global asset IDs, feed links use the external URL; the feed variable is now the documented `BASYX_EVENTING_FEED_ENABLED` |
| UML | `@plantuml/core` instead of Mermaid (T2): one package of 7.8 MB without dependencies against 23 dependencies |

Moved to the phases that use them: the foreign descriptor fixture (C), and the
`large` profile with the lazy-tree and `@plantuml/core` measurements (start of
E). The app frames could not be inspected in the walkthrough, because the
browser pane blocks `apps.localhost`; D14 relies on the e2e run.

## Phase E measurements

Recorded on 2026-10-14 against the `large` profile (`pnpm testenv:large`:
2,000 shells; the submodel `LargeTree` with a list of 1,000 collections,
about 5,000 elements, and `Deep.Level1.Level2.Level3.Leaf`).

| Measurement | Result |
| --- | --- |
| BaSyx Go, whole submodel (`level=deep`, 473 KB) | 390 ms |
| BaSyx Go, any element or level (`level=core`, from 130 B) | 325–345 ms: the server reads the whole submodel for every element request |
| Studio level request, list of 1,000 collections (217 KB) | 374 ms, Studio's own share negligible |
| Rendering tree rows (production build, headless Chromium) | about 2 ms per row: 1,000 rows took 2.0 s, closed groups rendered too |
| Shell list, 2,000 shells (production build, before) | infinite scroll without virtualization: 34 long tasks over 200 ms while scrolling, the longest 5.6 s; a quick search took 2.1 s |
| Shell list, 2,000 shells (after) | virtual scroll: 15 rows in the DOM, no long task; first page on screen 102 ms after navigation (list API 12 ms); a quick search 0.79 s including the 300 ms debounce |
| Expanding the 1,000-entry list (after) | first page of 200 rows in 0.44 s |

DoD 10 holds with these numbers. The shell list became a virtual scroll that
loads the next page when its last rows come into view, scrolls to the open
shell, and pins a deep-linked shell that is not loaded yet.

Consequences for T1, without changing its intent:

- A tree request returns the children of a submodel or element with as many
  complete levels below them as fit into a node budget (2,000 by default),
  breadth first. A request per level would cost a full submodel read per
  level, so small submodels arrive in one request as before, and large ones
  stop at a level boundary and continue on demand, for *expand all* (capped at
  10,000 elements) and for deep links (`ElementDetail.ancestors`).
- The `tree` route is gone; the level route takes `at` for history.
- VTreeview registers items from props (`itemsRegistration: 'props'`), so
  closed groups are not rendered; levels longer than 200 children show a
  *Show more* row. Expanding the 1,000-entry list now renders its first page
  in about 450 ms; a filter shows whole levels; deep links extend the page to
  the selected element.

## Defects

Worked off by phase. Widths are viewport widths; "full load" means a page
loaded from the server rather than reached by navigation in the app.

| # | Area | Defect | Expected | Phase | Status |
| --- | --- | --- | --- | --- | --- |
| D1 | Layout (SSR) | Every full load at desktop width renders the phone layout (bottom navigation, no rail or shell list, content under the app bar) until hydration; the server does not know the viewport | The desktop layout from the first paint (viewport client hint or desktop default) | A | Fixed (A) |
| D2 | Images (SSR) | After a full load the app-bar logo and all shell avatars (list and header) stay empty; they appear only after navigation in the app | Logo and avatars after every load; an icon when a shell has no thumbnail | A | Fixed (A) |
| D3 | Theme | A theme applied on the client after server rendering leaves server-rendered cards in the previous theme (dark page, light cards) | One theme for the whole page, from the first paint | A | Fixed (A) |
| D4 | Dark mode | The app bar's search label and the *View/Edit* labels are dark on dark | Readable labels in both themes | A | Fixed (A) |
| D5 | Details drawer | Temporary with a scrim below 1920 px, so at 1440 px it covers the tree | Beside the tree on desktop widths, temporary only on narrow screens | E | Fixed (E): beside the tree from 1145 px (Vuetify `lg`), temporary below; it can be widened to the whole content area |
| D6 | Details drawer | The value is set in display size and wraps for long text; semantic ID, kind and category are missing from the metadata | Body-sized values; the Web UI's header fields | E | Fixed (E): values in body size; idShort, display name, semantic ID, kind, category, value and content type, version and idShortPath |
| D7 | Shell header | The title is cut without ellipsis or wrap at 768 and 375 px; the subtitle repeats the idShort; an empty box instead of an icon without thumbnail | Wrapping title, no repetition, icon fallback | A | Fixed (A) |
| D8 | Shell header | The chip row runs off the screen at 375 px without a scroll hint; identifiers are truncated without a way to read them | Wrapping chips; full identifier on hover and on copy | A | Fixed (A) |
| D9 | Tablet | Below 960 px the target switcher is hidden, so the active target is not visible; the search icon floats in the app bar | Active target always visible (design guidelines) | A | Fixed (A) |
| D10 | Phone | Five bottom-navigation items, the last label cut; the tree toolbar squeezes the filter to "Filte"; no values in the tree | Fewer or shorter navigation items; a toolbar that wraps or collapses into a menu | A, E | App bar and navigation fixed (A); tree toolbar wraps, tree rows show values (E) |
| D11 | Palette | Search is case-sensitive and ignores display names: "Servo" and "dm3000" find nothing, "DM3000" finds the shell | Case-insensitive search over the Web UI's fields (S2) and, in the palette, display names of loaded shells | D | Fixed (D): the palette searches through `POST /searches` with the Web UI's case-insensitive expression, element search where announced, and matches display names of the loaded shells |
| D12 | JSON tab | Long lines are cut off without horizontal scrolling or wrapping | All content reachable | E | Fixed (E): JSON, XML and PlantUML source scroll in both directions in their own panels |
| D13 | Changes tab, dashboard cards | The card header icon is not aligned with the title; events do not say what changed or who changed it | Aligned headers; element or value and actor where the feed provides them | F | Fixed (F): aligned header; events name the shell or submodel, link to it, show the exact time and collapse repeats. The BaSyx event feed records neither the element nor who changed it; the tab says so |
| D14 | App frames | The Nameplate app's *Save* button is out of reach inside its frame (web e2e `apps.spec`); a frame that fails to load stays blank | Frames sized to or scrolling their content; loading and error states | E, F | Fixed (E, F): a frame that does not connect within 15 s says so and offers a retry; the bundled Nameplate, which replaced the example (T4), edits in place instead of in a dialog, which neither fits a frame sized to its content nor may submit a form in the sandbox |
| D15 | History detection | Probes `$recent-changes`, which BaSyx Go serves in every history mode, so history is offered without recorded versions | Detection from the history profiles (I6) | C | Fixed (B): history and the event feed are offered only where `/description` announces their profiles |
| D16 | Accessibility | Icon buttons without accessible names in the app bar and the shell list | A label on every icon button | A | No defect: every icon button has a label or text; the walkthrough tool listed only `aria-label` names |
| D17 | Infrastructure dialog | Fields have placeholders but no labels; the sharing notice is shown for *Unsecured* | Labelled fields; notices only where they apply | B | Fixed (B): every field is labelled; the sharing notice shows only for client credentials |
| D18 | Concept descriptions | *Unit* and *Source* are empty for every entry | Values where the data has them, else no empty columns | F | Fixed (F): *Unit* and *Source* columns and the source filters appear only where the data has them; IEC CDD identifiers are recognized as a source |
| D19 | Lists | *Recently opened* shows identifiers; shell rows repeat the idShort as subtitle | Names first, identifier as subtitle (as in the Web UI) | A | Fixed (A) |
| D20 | e2e web | `viewer.spec` "shows a read-only past state" clicks Vuetify 3 classes (`v-date-picker-month__day--today`) | Role-based locators | F | Fixed (F): the past-state test finds today by `aria-current="date"`; the dashboard test became the landing, asset-ID and changes test of R1 and R3. Web e2e: 22 of 22 pass |
| D21 | e2e desktop | `apps.spec` looks for the removed *Browse* link; `workspace.spec` cannot reach a package's shell rows (the list is off-screen at the window size) | Tests updated to the rail; shell list reachable in the desktop window | A | Fixed (A, G): window 1440×900; the tests follow the MVP-4 layout (rail links for modules, the bundled Nameplate on the overview, edit mode, labelled fields). The package state is shown next to its actions, and *Close package* is no longer confused with closing the drawer. Desktop e2e: 3 of 3 pass |
| D22 | Console | Three 503 responses on every full load in the dev server; no matching server log | Explained or gone in the production build | A | Open |
| D24 | Routes | A URL with an unknown target (for example after the test environment was reset) breaks server rendering with a 500 | The target's problem shown on the page | A | Fixed (A) |
| D23 | Test environment | Event-feed schema links pointed to the container port (`localhost:5004//…`); the feed variable used an undocumented name | External URL and documented variable | 0 | Fixed |
| D25 | App bar | The ⌘K hotkey renders "Ctrl" on the server and ⌘ in a Mac browser, a hydration mismatch on every load; its accessible label reads "$COMMAND plus K" | Same rendering on both sides; a readable label | D | Fixed (D): the platform comes from the request and is VHotkey's default on both sides. The label is a Vuetify defect (icon keys are looked up by icon name), to be reported upstream |

## ADRs written during MVP-4

The port cited ADR 0020 and 0021 before they existed; its code references now
use the numbers below.

- [ADR 0020](../adr/0020-infrastructure-templates-registries-and-sync.md):
  infrastructure templates, registries, discovery, descriptor endpoints and
  synchronization (I1–I5).
- [ADR 0021](../adr/0021-feature-detection-from-service-profiles.md): feature
  detection from service profiles (I6).
- [ADR 0022](../adr/0022-basyx-go-endpoints-outside-the-sdk.md): BaSyx
  Go-specific endpoints outside `basyx-typescript-sdk` (I7).
- [ADR 0023](../adr/0023-bundled-first-party-apps.md): bundled first-party
  apps (T4).
- [ADR 0024](../adr/0024-aas-query-language-through-the-bff.md): AAS Query
  Language through the BFF (S1, S2).

## Known risks

| Risk | Mitigation |
| --- | --- |
| History and the event feed stay hidden until BaSyx Go advertises their profiles, so DoD 12–13 cannot pass against released BaSyx Go | Implement the BaSyx Go tickets first, as with the SDK, or verify against a BaSyx Go build with the profiles |
| The scope is far larger than earlier MVPs | Phases with their own exits; the defect list makes the remaining work visible; the parity list records what moves on |
| Removing the md3 blueprint changes components implicitly configured by it | Screenshots of every page before and after; the e2e suites |
| Studio-written descriptors and asset links can fail after a successful upload or delete | Per-resource results (`sync_incomplete`), never reported as atomic (as DATA-014 for copies) |
| *Expand all* on a lazy tree causes many requests | Breadth-first with a cap and limited concurrency; measured in phase 0 |
| The proprietary client grows into a second SDK | Limited to I7 by ADR 0022; anything standard goes to the SDK, with upstream tickets where needed |
| Descriptors with internal host names | `blocked` with the origin shown; `GENERAL_EXTERNALURL` in the deployment guide |
| `/description` profile URIs differ between servers | Detection rules per feature in ADR 0021, unit-tested with BaSyx Go's and other servers' profiles |

## Out of scope

Editing beyond Property and MultiLanguageProperty values and File
replacement (creating, deleting and editing other elements and shells),
dashboard content, aggregated views across targets, Catena-X and EDC access,
the company lookup service, QR scanning, per-endpoint credentials, URL
rewriting for descriptor endpoints, the Web UI's editor and submodel viewer
routes.

## After MVP-4

- Editing MVP: element creation, deletion and editing of every type, AAS
  editor parity, on the MVP-2 revision path.
- Dashboard MVP for `/targets/{targetId}`.
- Apps MVP: refine the bundled apps and port further first-party apps from the
  MVP-3 classification.
- QR scanning through discovery.
