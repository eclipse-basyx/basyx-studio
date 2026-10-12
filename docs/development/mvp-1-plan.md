# MVP-1 plan: live AAS access through the Studio BFF

- Status: Implemented; decision gate closed in MVP-2 (see [results](#results))
- Date: 2026-10-06
- Scope decision gate: the first representative vertical slice

## Goal

Prove the Studio architecture on one path that delivers real value, before
porting features from the BaSyx AAS Web UI:

> sign in → choose target → authorize target if needed → list shells → open
> shell → list submodels → browse element tree → see element JSON

Every call goes UI → `/api/studio/v1` → Studio BFF → `basyx-typescript-sdk` →
BaSyx. The renderer never sees an infrastructure URL, token, or credential.

Porting the old UI's Vue components starts in MVP-2, on top of the contract this
slice establishes. Compiling copied components before a target contract exists
proves nothing.

## Scope decisions

| Topic | MVP-1 decision |
| --- | --- |
| Data operations | Read-only. Editing (save, reload, conflicts) is MVP-2. |
| Shell source | AAS repository with cursor paging. Registry and discovery resolution come later. |
| Downstream authentication | `unsecured`, `deployment_client_credentials`, and `delegated_user` (per-target OIDC authorization code with PKCE) |
| Studio login | OIDC authorization code with PKCE for hosted deployments; the local OS user on desktop |
| Infrastructure configuration | Stored in the database and managed through the admin API (`/infrastructures`), plus a minimal admin page |
| Persistence | One PostgreSQL schema: a PostgreSQL server when hosted, embedded PGlite on desktop ([ADR 0011](../adr/0011-single-postgresql-dialect-with-pglite.md)) |
| Runtimes | Hosted web (dev and production build) and packaged Electron |
| Visualization | Shell list, submodel tree, and a JSON panel; no specialized viewers |

## Definition of done

Run against the [test environment](../../test-setup/README.md), in both hosted
web and packaged Electron:

1. **studio-admin** signs in and registers three targets through the admin API:
   - **Open:** `unsecured`.
   - **Secured (as user):** `delegated_user`.
   - **Secured (as Studio):** `deployment_client_credentials`.
2. **alice** signs in, sees that the "Secured (as user)" target requires
   authorization, authorizes it, and browses both secured shells.
   Meanwhile:
   - the "Secured (as Studio)" target works without a per-user authorization;
   - the open target works without any credential.
3. **carol** sees only the public shell. Opening the restricted `Costs` submodel
   shows a typed *forbidden* state while the rest of the tree stays usable.
4. **bob** gets a typed *forbidden* state for the secured target; the open target
   still works.
5. **Browsing the open target works for the hard cases:**
   - all 62 shells page correctly;
   - `EdgeCasesShell` shows nested collections, lists of lists, operation
     variables, and the large submodel;
   - the dangling submodel reference appears as *not found*.
6. **Target switching is clean.** Switching while requests are in flight never
   shows data from the previous target.
7. **Expiry and outages are handled.** An expired access token is refreshed
   transparently. A revoked session or a stopped BaSyx container results in a
   typed state and a clear message.
8. **No secrets reach the client.** No response, log line, or renderer storage
   contains a token, client secret, or downstream URL.

## Results

The slice is implemented and was verified on 2026-10-06 against the test
environment in the dev server, the hosted production build (SSR), and the
desktop production bundle (Nitro in desktop mode and a packaged macOS arm64
app).

| Definition of done | Status | Evidence |
| --- | --- | --- |
| 1. Admin registers three targets | Done | Admin page; endpoints and issuer are checked against the network policy and probed before saving; client secrets are stored as `env:` references |
| 2. Per-user authorization; service and open targets need none | Done | Hosted: browser flow with `studio-web`. Desktop bundle: system-browser flow with the public `studio-desktop` client on a dynamic loopback port |
| 3. `carol` sees partial data | Done | `Costs` is listed as *No access*; the internal shell answers `target_forbidden` |
| 4. `bob` is forbidden | Done | Integration test (`target_forbidden`); not clicked through in the UI |
| 5. Hard cases on the open target | Done | 62 shells over cursor pages; nested collections; lists of lists; operation variables, including locators inside variables; 300-element submodel; dangling reference shown as *Not found* |
| 6. Clean target switching | Implemented | Every query key starts with the target ID; tree requests carry a generation counter; the tree is keyed by target and submodel. No automated test yet |
| 7. Expiry, revocation, outages | Implemented | Refresh 30 s before expiry; `invalid_grant` leads to re-authorization; a downstream 401 drops the stored credential (integration test). A stopped container maps to `target_unreachable`, but this was not exercised manually |
| 8. No secrets reach the client | Done | The database holds only `v1.` AES-GCM ciphertexts; API responses carry secret references, never values; CSRF and Origin checks are enforced |

Automated checks: `pnpm lint`, `pnpm typecheck`, and `pnpm test` (unit), plus
`pnpm test:integration` (64 tests, needs `pnpm testenv:up`).

### PGlite qualification gate (ADR 0011)

| Gate | Result |
| --- | --- |
| 1. Packaging | Passed on macOS arm64. Nitro traces `pglite.wasm` and `pglite.data` into `.output`; the packaged app starts the service and applies migrations; no install scripts. Windows and Linux are not yet verified |
| 2. Crash safety | Passed. SIGKILL during writes, then reopen: every acknowledged commit is present. PGlite disables fsync by default (`-F`); Studio turns it on (200 commits took 29 ms) |
| 3. Footprint | **Open decision.** Cold reopen takes about 100 ms. The local service uses about 610 MB RSS under Node and about 860 MB inside packaged Electron, mostly the WebAssembly engine; `shared_buffers=16MB` saves only about 100 MB. Package size grows by about 25 MB unpacked. Maintainers must accept this, or the `embedded-postgres` fallback must be measured first |
| 4. Migrations | Passed. One chain applies to PostgreSQL 18 and PGlite (tests) |
| 5. Engine upgrade | Passed for dump/restore of a migrated database into a fresh engine (test). Not yet run across real PostgreSQL major versions |
| 6. Semantics | Passed for transactions, constraints, and the advisory lock used by the migrator. No row-locking repository code exists yet |

### Findings and deviations

**API contract**

The Zod schemas in `shared/contract` are authoritative for the implemented
routes. Deviations from the `openapi.yaml` draft:
- `PUT /infrastructures/{id}` (full replacement with `If-Match`) replaces `PATCH`;
- `GET /targets/{id}/shells/{shellKey}/submodel-refs` is added;
- `GET /targets/{id}/submodels/{key}` returns metadata only;
- `PUT /targets/{id}/activation` is not needed, because the route carries the target;
- starting an authorization returns `{ authorizationUrl, mode }`.

Element keys are base64url-encoded locators that extend idShortPaths with
`@input`, `@output` and `@inoutput`, because the AAS API cannot address
operation variables.

**BaSyx Go 1.1.0**
- No `ETag` on any response, so MVP-2 conflict detection needs another mechanism.
- A request without a token gets 403, not 401.

**SDK and aas-core**
- The SDK bundles its own aas-core copy, so results are converted to JSON at the
  adapter boundary.
- `$metadata` results are plain JSON.
- Transport failures surface as status 0, so the guarded fetch records the
  reason.
- The aas-core 1.0.1 ESM build cannot load in plain Node; Nitro and Vitest
  inline it.

**Tooling**
- `vue-tsc` does not support TypeScript 7, so TypeScript 6 is pinned for type
  checking.
- The guarded fetch uses the fetch of the undici package together with its
  dispatcher, not Node's built-in fetch: a dispatcher only works with the fetch
  of the same undici major, and Node bundles its own undici.

**Nuxt 5 readiness**
- Route handlers, server middleware and `server/utils` use the portable
  `nuxt/server` API (Nuxt 4.6+), so they run on Nitro v2 today and on Nuxt 5's
  Nitro v3.
- Only two Nitro-specific places remain, both marked for porting:
  - `server/nitro/migration-assets.ts`, which loads migrations from Nitro
    server assets;
  - `server/plugins/studio.ts`, the startup and shutdown plugin.
- The Origin check moved from middleware into `defineStudioHandler`, because
  server middleware may only extend the context or throw.

**Not done yet**
- per-target authorization (every signed-in user may use every target);
- Playwright smoke test;
- visual check of the packaged renderer (the service itself was verified);
- Windows and Linux packages;
- OpenTelemetry;
- automated target-switch test;
- the about 24 px layout shift on the first SSR paint;
- revealing a deep-linked element in the tree.

### Code map

| Path | Content |
| --- | --- |
| `shared/contract/` | Versioned UI↔BFF contract (Zod) |
| `server/lib/` | Framework-independent modules:<br>• `config`<br>• `crypto`<br>• `database` (schema, migrator, PostgreSQL/PGlite)<br>• `network` (address policy, guarded fetch)<br>• `oidc`<br>• `infrastructures`<br>• `targets` (credential broker, `LiveAasTarget`)<br>• `aas` (keys, locators, outline) |
| `server/api/studio/v1/` | Thin Nitro handlers |
| `server/utils/`, `server/middleware/`, `server/plugins/` | Runtime wiring, sessions, CSRF/Origin checks, launch secret |
| `app/` | Pages, components, `useStudioApi`, `useTarget`, session store |
| `test/` | Unit tests and integration tests (`STUDIO_TESTENV=1`) |

## ADRs to write during MVP-1

- Session, CSRF, and token-encryption model (phases 1–2).
- Desktop OIDC loopback flow and launch-secret exemption (phase 4).
- Drizzle adoption, after the phase-0 qualification.

## Known risks

| Risk | Mitigation |
| --- | --- |
| PGlite footprint (about 0.6–0.9 GB RSS) is not accepted | Accepted for the MVP phase on 2026-10-09; `embedded-postgres` is measured before the first public desktop release (ADR 0011) |
| BaSyx Go 1.1.0 sends no `ETag` | Not needed in read-only MVP-1. MVP-2 needs a fallback, such as comparing against a fresh read, or ETag support upstream. |
| The SDK bundles its own aas-core copy | Use type helpers instead of `instanceof`; propose externalizing aas-core in the SDK build |
| aas-core 1.0.1 ESM build fails in plain Node | Confirm bundler behavior in phase 0; report upstream |
| `*.localhost` doesn't resolve on some Linux hosts or CI | Documented `/etc/hosts` entry in the test environment README |
| No Studio session hardening beyond MVP-1 | Hosted MVP-1 builds are not exposed publicly until the session ADR is implemented |

## After MVP-1

The order was revised on 2026-10-08:

- [MVP-2](mvp-2-plan.md): one property edit on a live target and in a local AASX
  package through a shared target contract, plus end-to-end tests for both
  runtimes.
- [MVP-3](mvp-3-plan.md): runtime-installable apps (submodel views, modules, a
  backend app); it decides which BaSyx AAS Web UI parts become core components
  and which become apps.
- Then: porting BaSyx AAS Web UI components and the infrastructure management
  UI, registry and discovery resolution, cross-target copy, and the marketplace.

Open question for porting: which BaSyx AAS Web UI codebase is the source for
components, upstream `main` or a fork branch.
