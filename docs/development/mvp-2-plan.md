# MVP-2 plan: one edit on a live target and in a local AASX package

- Status: Implemented (see [results](#results))
- Date: 2026-10-08
- Depends on: [MVP-1](mvp-1-plan.md) and its decision gate
- Scope decision gate: the target abstraction and the write path are proven for
  both data sources before features are ported

## Goal

Prove that one UI and one Studio API can edit AAS data regardless of where it
lives (DATA-003, DATA-016):

> choose target or open AASX file → browse → edit one property value → apply →
> see the new value after reload; a conflicting or forbidden write keeps the
> draft and explains why

Live targets go UI → `/api/studio/v1` → Studio BFF → `basyx-typescript-sdk` →
BaSyx. Desktop AASX workspaces go UI → `/api/studio/v1` → Studio BFF → local
Workspace Worker → package file. The routes, DTOs, revision tokens, and problem
types are the same; only the target capabilities differ.

MVP-1 hard-codes the only adapter: `kind` is `z.literal('live')` and
`openTarget` constructs `LiveAasTarget` directly. Building editing on that would
produce a live-only write path that must be redone for packages. That is why
MVP-2 adds both sources at once and keeps the edit itself small.

## Scope decisions

| Topic | MVP-2 decision |
| --- | --- |
| Edit operation | Set the value of a `Property` (and a `MultiLanguageProperty`) through the value-only representation. No structural edits (create, delete, move), no metadata edits. |
| Target contract | `AasTarget` interface in `server/lib/targets`, implemented by `LiveAasTarget` and `WorkspaceAasTarget`. A target router replaces the direct construction in `openTarget`. `kind` becomes `'live' \| 'workspace'`. |
| Capabilities | Each target reports `write`, `concurrency` (`strong` or `best_effort`) and `persistence` (`immediate` or `explicit_save`). The UI branches on capabilities, never on `kind`. |
| Revisions | The Studio API always uses `ETag` / `If-Match` with opaque Studio revision tokens. The adapter decides how strong the guarantee is (see [concurrency](#concurrency-on-live-targets)). |
| Drafts | Per target and element in Pinia (ADR 0006); never in the query cache. A failed apply keeps the draft. |
| Live targets | AAS and Submodel Repository only, as in MVP-1. |
| Upstream versions | `basyx-typescript-sdk` ≥ 2.3.0 (installed through an exact-version release-age exception, [ADR 0012](../adr/0012-release-age-exceptions-for-basyx-packages.md)). The test environment runs the BaSyx Go `SNAPSHOT` images, as the SDK's own integration tests do, so Studio sees upstream changes as they land. |
| Desktop workspace | Open an existing `.aasx`, edit, Save, Save As, close. No new packages, no attachments editing, no recovery snapshots. |
| Hosted web | No workspace targets. The workspace capability is absent in hosted mode. |
| Package engine | Chosen by a round-trip qualification in phase 0, run in a separate Electron `utilityProcess` (the Workspace Worker). |
| End-to-end tests | Playwright for the hosted build (PostgreSQL) and the packaged Electron app (PGlite), both against the test environment, in CI. |
| Component porting | Not in MVP-2. It starts after the app platform slice ([MVP-3](mvp-3-plan.md)) decides which BaSyx AAS Web UI plugins become core components and which become apps. |

### Concurrency on live targets

Upstream support landed on 2026-10-08:

- BaSyx Go ([basyx-go-components#742](https://github.com/eclipse-basyx/basyx-go-components/pull/742),
  closes [#737](https://github.com/eclipse-basyx/basyx-go-components/issues/737)):
  strong `ETag`s, `If-Match` / `If-None-Match`, `412`, and an optional `428`
  in all services. It is on `main` and in the `SNAPSHOT` images; it needs
  database schema `v1.2.3`.
- `basyx-typescript-sdk` 2.3.0 ([basyx-typescript-sdk#547](https://github.com/eclipse-basyx/basyx-typescript-sdk/pull/547),
  closes [#546](https://github.com/eclipse-basyx/basyx-typescript-sdk/issues/546)):
  per-call `ifMatch` / `ifNoneMatch`, `etag` in every `ApiResult`, and
  `preconditionFailed` / `preconditionRequired` flags. Published to npm on
  2026-10-08 and already used by Studio.
- The AAS API specification does not define ETags yet
  ([aas-specs-api#691](https://github.com/admin-shell-io/aas-specs-api/issues/691)),
  so other servers and older BaSyx Go versions send none.

BaSyx Go semantics that shape the adapter:

- **One revision per top-level resource.** A submodel element shares the
  revision of its submodel. A tag read from an element works as `If-Match` for
  writes to that element, because writes compare only the revision part.
- **Coarse conflicts.** A change to *any* element of the submodel invalidates
  the tag, so two users editing different properties of one submodel conflict.
- **`412` carries no current tag.** The current state must be read again.
- **`PATCH` returns the new tag; `PUT` does not.** JSON representations above
  16 MiB are streamed without a tag.

The live adapter therefore has two modes, selected per read from whether the
downstream response carries an `ETag`:

- **`strong`:** the Studio revision token holds the downstream `ETag` and a
  hash of the element as read. Apply sends the tag through the SDK's `ifMatch`.
  On `preconditionFailed`, the BFF reads the element again: if its value still
  equals the hashed base, the conflict came from another element of the same
  submodel, and the BFF retries once with the new tag (still conditional, so a
  concurrent change is still detected). Otherwise it returns
  `revision_conflict` with the current value.
- **`best_effort`:** for targets without `ETag`. The token is only the element
  hash. On apply, the BFF reads the element again, compares the hash, and writes
  unconditionally if it matches. A write by someone else between that check and
  the write is not detected; the UI states this for these targets.

After a successful apply, the BFF reads the element again and returns the stored
(normalized) value with a fresh token. `preconditionRequired` (a target that
requires `If-Match`) maps to a typed problem; it cannot occur in `strong` mode.

### Workspace semantics

Applying an edit to a workspace target changes the Worker's in-memory model and
advances its revision; the package file changes only on Save. The UI shows the
unsaved state (UX-005) and asks before closing a window or workspace with
unsaved changes. Save writes a temporary file in the same directory and renames
it over the original.

## Studio API changes

| Method and path | Purpose |
| --- | --- |
| `GET /targets/{id}/submodels/{key}/elements/{elementKey}` | Now returns an `ETag` (Studio revision token). |
| `PUT /targets/{id}/submodels/{key}/elements/{elementKey}/value` | Set the value. Requires `If-Match`. Returns the new value and `ETag`, or `revision_conflict` (412) with the current value, or `target_forbidden`. |
| `GET /targets/{id}` | Adds `capabilities`. |
| `GET /workspaces` | Open workspaces of this desktop session. Desktop only. |
| `POST /workspaces` | Open a package from a file handle issued by the Electron main process; returns the target ID and import diagnostics. |
| `POST /workspaces/{id}/saves` | Save atomically to the opened file. |
| `POST /workspaces/{id}/exports` | Save As to a new file handle. |
| `DELETE /workspaces/{id}` | Close; refuses with `unsaved_changes` unless `force` is set. |

Native dialogs are an Electron IPC contract, not part of the HTTP API. MVP-2
adds the first preload script: two schema-validated calls, `chooseAasxFile` and
`chooseSaveLocation`, which return short-lived opaque handles. The renderer
never sees a native path.

## Definition of done

Run against the [test environment](../../test-setup/README.md):

1. **Shared contract.** Browsing pages, components, and query keys contain no
   `kind` checks. A live target and a workspace target are opened through the
   same routes and render the same tree.
2. **Live edit.** A user with write access (a new test user with only the
   `basyx-admin` BaSyx role, not `studio-admin`) changes a property on the open
   target and on the secured target. Both modes, delegated user and client
   credentials, work. After a reload the new value is shown.
3. **Forbidden write.** `alice` (`basyx-reader`) edits a property; apply returns
   `target_forbidden`, the draft remains, and reading still works.
4. **Conflict.** Two sessions edit the same property; the second apply gets
   `revision_conflict` with the current value and keeps its draft. Two sessions
   editing *different* properties of one submodel both succeed (retry after the
   submodel-level `412`). An integration test with the `ETag` header removed
   covers `best_effort` and documents its race window.
5. **Desktop package.** In the packaged app, open
   `IESEDriveMotorDM3000.aasx`, edit a property, Save, close, reopen: the value
   persists. Save As writes a second file and leaves the first unchanged.
   Closing with unsaved changes asks for confirmation.
6. **Package safety (DATA-006).** Fixture packages with path traversal, absolute
   paths, too many entries, an oversized or highly compressed entry, and invalid
   XML/JSON are rejected with a typed problem, and the Worker stays responsive.
7. **Round trip.** Each fixture in the golden set opens, saves without edits, and
   reopens with semantically equal content and byte-identical supplementary
   files.
8. **End-to-end in CI.** Playwright runs the browsing and edit flows for hosted
   (PostgreSQL) and packaged Electron on Linux (PGlite, under `xvfb`). The
   target-switch test from MVP-1 is included.
9. **MVP-1 gate closed.** The PGlite footprint is accepted by the maintainers,
   or the `embedded-postgres` fallback has been measured with the same schema.

## Results

The slice was implemented and verified on 2026-10-08 against the test
environment (BaSyx Go `SNAPSHOT`) in the dev server, the hosted production
build, and the packaged macOS arm64 app (unpacked, ad-hoc signed).

| Definition of done | Status | Evidence |
| --- | --- | --- |
| 1. Shared contract | Done | Route handlers use `AasTarget`; the UI branches on `capabilities` and the optional `workspace` state, never on `kind` |
| 2. Live edit | Done | `dave` (`basyx-editor`) on the secured target, the Studio service account (client credentials, now `basyx-editor`) and the open target: integration tests; web e2e edits and reloads |
| 3. Forbidden write | Done | `alice` gets `target_forbidden` (integration test); the draft stays |
| 4. Conflict | Done | Stale revision → `revision_conflict`; an edit to another element of the same submodel is not a conflict; *Apply mine anyway* overwrites deliberately (integration and web e2e); `best_effort` covered with the `ETag` removed |
| 5. Desktop package | Done | Packaged-app e2e: open, edit, Save, Save As (original untouched), close prompts in the app and for the window |
| 6. Package safety | Done | Path traversal, absolute names, more than 10 000 entries, a decompression bomb, non-ZIP files and invalid AAS XML are rejected; the worker keeps serving; a request over its time limit kills and restarts the worker |
| 7. Round trip | Done | `IESEDriveMotorDM3000.aasx` (XML) and an edge-case JSON package: equal AAS content, byte-identical supplementary files |
| 8. End-to-end in CI | Implemented | `pnpm test:e2e:web` and `pnpm test:e2e:desktop` pass locally (web: Chromium; desktop: packaged macOS app). CI runs both; the Linux desktop job (Xvfb, gnome-keyring) first runs on the MVP-2 pull request |
| 9. MVP-1 gate closed | Done | PGlite accepted for the MVP phase; measuring `embedded-postgres` is a gate before the first public desktop release ([ADR 0011](../adr/0011-single-postgresql-dialect-with-pglite.md#qualification-gate)) |

Automated checks: `pnpm lint`, `pnpm typecheck`, `pnpm test` (unit, including
the worker process), `pnpm test:integration` (98 tests), `pnpm testenv:smoke`
(34 checks), and the two Playwright suites.

### Findings and deviations

**Concurrency**

- The revision token is the hash of the element as read (`h.<hash>`). A write
  reads the element again, compares the hash, and writes with `If-Match` on
  the *fresh* BaSyx `ETag`; a 412 caused by another element of the submodel is
  retried up to three times. The token never contains the downstream `ETag`,
  so tokens do not go stale when unrelated elements change.
- Workspaces use the same token. The worker checks and writes in one step, so
  their concurrency is `strong`. There is no separate workspace revision token.
- `concurrency` is reported per element read (`ElementDetail.concurrency`),
  not as a target capability, because it depends on what the server sends.
- The revision is in the response body as well as the `ETag` header: the UI's
  fetch helper does not expose response headers.
- A conflict answers `revision_conflict` without the current value; the UI
  reloads the element to show it.

**Writes**

- Writes `PATCH` the whole element (`patchSubmodelElementByPath`) instead of the
  value-only representation, which would need a JSON type per `valueType`.
  The element is validated with AAS Core (including its language strings)
  before it is sent.
- The SDK accepts Studio's aas-core instances for writes, although it bundles
  its own aas-core copy.

**Desktop**

- The Workspace Worker is a child process forked and supervised by the local
  Studio Service, not an Electron `utilityProcess`: it then runs the same way
  in `nuxt dev`, tests and the packaged app. It is bundled with esbuild
  (`modules/workspace-worker.ts`) to `.output/server/workspace-worker.mjs`.
- Package engine: `aas-package3-typescript` 1.1.0 with AAS Core 3.1. Studio
  checks entry names, counts, declared sizes and compression ratios before the
  library decompresses anything; the decompressor never writes more than an
  entry's declared size. AAS Core's XML reader needs the XML declaration
  removed first.
- Only AAS 3.1 packages with exactly one spec part are opened; AAS 3.0 packages
  are rejected with a clear message.
- The library writes packages uncompressed (ZIP level 0), so a saved package
  can be larger than the original (the fixture: 1.8 MB → 2.0 MB).
- Native paths reach the service only from the Electron main process, as
  single-use file grants authenticated with a broker secret that the renderer
  never receives (`/desktop/file-grants`). `nuxt dev --envName electron` shares
  the secret through the environment (`modules/desktop-dev.ts`).
- Preventing a window close during a quit cancels the quit; the main process
  resumes it after the unsaved-changes check.

**API**

Deviations from the `openapi.yaml` draft (the Zod schemas in `shared/contract`
are authoritative):

- `PUT /targets/{id}/submodels/{key}/elements/{elementKey}/value` with
  `If-Match` (428 `precondition_required` without it);
- new problem codes: `precondition_required`, `unsupported_operation`,
  `validation_failed`, `workspace_unsaved_changes`, `package_rejected`;
- `POST /workspaces {fileHandle}` opens a package (instead of
  `/workspaces/imports` and `/activation`); `POST /workspaces/{id}/saves`,
  `POST /workspaces/{id}/exports {fileHandle}` (Save As), and
  `DELETE /workspaces/{id}?force=`;
- `POST /desktop/file-grants` and `GET /desktop/state` for the Electron main
  process only.

**Test environment**

- BaSyx Go runs `SNAPSHOT` images; the realm adds `basyx-editor` and the user
  `dave`; the service account is an editor.
- `EmptyValue` comes back as `""` after a write without a value, so a cleared
  property reads as an empty string at BaSyx Go.

**Not done yet**

- measuring `embedded-postgres` against PGlite (gate before the first public
  desktop release);
- Windows and macOS e2e in CI; Windows and Linux packages beyond the CI build;
- recovery snapshots, new packages, attachments, AAS 3.0 packages;
- syncing the `openapi.yaml` draft.

### Code map

| Path | Content |
| --- | --- |
| `server/lib/targets/aas-target.ts` | The `AasTarget` interface |
| `server/lib/targets/revision.ts` | Revision tokens |
| `server/lib/aas/values.ts` | Value changes validated with AAS Core |
| `server/lib/workspaces/` | Archive checks, package read/write, workspace model, worker, worker client, manager and file grants |
| `server/workers/workspace-worker.ts` | Worker process entry |
| `modules/` | Worker bundling, dev broker secret |
| `electron/preload.ts` | The native bridge (two dialogs) |
| `app/components/ElementValueEditor.vue`, `app/stores/drafts.ts` | Editor and drafts |
| `app/components/WorkspaceActions.vue` | Save, Save As, Close |
| `test/e2e/` | Playwright suites (web, desktop) |

## Phases

| Phase | Content | Exit |
| --- | --- | --- |
| 0. Decisions and harness | PGlite footprint decision; package-engine round-trip qualification; Playwright harness for both runtimes with the MVP-1 flows; BaSyx Go `SNAPSHOT` images in the test environment | Engine chosen; e2e green in CI; smoke test checks `ETag` and `412` |
| 1. Target contract | `AasTarget` interface, target router, capabilities in the contract, `kind` union; no behavior change | MVP-1 tests and e2e unchanged and green |
| 2. Live write | Revision tokens, value `PUT`, conflict and forbidden handling, draft store, edit UI for `Property` and `MultiLanguageProperty` | DoD 2–4 |
| 3. Workspace read | Preload and IPC handles, Workspace Worker process with supervision, open and browse a package, import limits | DoD 1, 6 |
| 4. Workspace write | Apply, Save, Save As, close guard, round-trip suite | DoD 5, 7 |
| 5. Wrap-up | Results section, ADR updates, `openapi.yaml` sync | DoD 8–9 documented |

## ADRs written during MVP-2

- [ADR 0013](../adr/0013-revision-tokens-and-conditional-writes.md): revision
  tokens and conditional writes.
- [ADR 0014](../adr/0014-workspace-worker-and-package-engine.md): Workspace
  Worker process and package engine.
- [ADR 0015](../adr/0015-desktop-native-bridge-and-file-grants.md): desktop
  native bridge and file grants.

## Known risks

| Risk | Mitigation |
| --- | --- |
| A `SNAPSHOT` change breaks the test environment | CI logs the image digests; a failing run can be reproduced with the logged digest and reported upstream |
| Submodel-level revisions cause conflicts between unrelated edits | Retry once when the element itself is unchanged; ask BaSyx Go for element-level revisions only if retries show up in practice |
| Targets without `ETag` (other servers, older BaSyx Go) | Explicit `best_effort` capability shown in the UI; the specification proposal aims to make ETags common |
| No TypeScript AASX library passes the round-trip qualification | Qualify early in phase 0; fall back to the aas-core JSON/XML de/serializers plus an OPC zip layer owned by the Worker |
| Electron e2e is flaky on CI (`xvfb`, startup time) | Start with Linux only; keep macOS packaged checks manual until stable |
| The first preload widens the renderer attack surface | Two calls, schema-validated in both directions, handles instead of paths, covered by security tests |

## Out of scope

Structural edits, concept descriptions, attachments, autosave and recovery
snapshots, new packages, registry and discovery, cross-target copy, porting BaSyx
AAS Web UI components, Windows and macOS e2e in CI.
