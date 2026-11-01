# Deployment plan: container image, configuration and managed infrastructures

- Status: Implemented (phases A to H). Open outside this repository: the
  Docker Hub repository and secrets (phase G), and the Helm chart
- Date: 2026-10-18
- Template: the BaSyx AAS Web UI (`eclipse-basyx/basyx-aas-web-ui`,
  `aas-web-ui/Dockerfile`, `entrypoint.sh`, `docker-prerelease-ui.yml`,
  `docker-release-ui.yml`)
- Depends on: hosted mode and login ([ADR 0002](../adr/0002-bff-and-authentication.md)),
  infrastructure templates ([ADR 0020](../adr/0020-infrastructure-templates-registries-and-sync.md)),
  the apps origin ([ADR 0017](../adr/0017-app-origin-and-content-security-policy.md)),
  PGlite or PostgreSQL ([ADR 0011](../adr/0011-single-postgresql-dialect-with-pglite.md))
- Scope: one PR. After the merge, a snapshot image on Docker Hub runs with
  `docker run` or Docker Compose, and a Helm chart can be written against it
  without changing Studio.

## Goal

> an operator pulls `eclipsebasyx/basyx-studio:SNAPSHOT` → starts it with a
> data key and, for a quick try, `STUDIO_AUTH_MODE=none` → mounts an
> `infrastructures.yaml` that lists their BaSyx servers → opens
> `https://example.org/studio/` behind their ingress → the infrastructures
> are there, marked *managed by the deployment* → an admin copies one as YAML,
> pastes it into another Studio and gets the same infrastructure there

## Decisions

Made on 2026-10-18.

| Topic | Decision |
| --- | --- |
| Login | OIDC stays the default. New optional anonymous mode (`STUDIO_AUTH_MODE=none`) with configurable roles. |
| YAML infrastructures | Managed and read-only in the UI; upserted on every start; entries that leave the file are removed. An env var decides whether admins may add more infrastructures at runtime. |
| YAML format | Studio's own: a YAML form of `infrastructureInputSchema` plus a stable `key`. Not the Web UI's `basyx-infra.yml`. |
| Export and import | The same format. Export one or all, copy to the clipboard, import by paste or file. |
| Registry | Docker Hub `eclipsebasyx/basyx-studio`, `linux/amd64` and `linux/arm64`. Snapshot on every push to `main`, release on a published GitHub release. |
| Apps | Off unless `STUDIO_APPS_URL` is set (unchanged). The examples show the second host. |
| Further env groups | Version and commit info, branding, legal links, feature toggles. |
| Helm | Not in this PR. The chart goes to `eclipse-basyx/charts` as a follow-up; this PR makes the image ready for it. |

*Assumptions* (proposed with this plan, not discussed one by one): the base path is
set at runtime and not baked into the build; health endpoints live outside
`/api/studio/v1`; a hosted start with an invalid configuration exits non-zero;
image signing, SBOM and provenance follow the Web UI's workflows one to one;
no `linux/arm/v7` (Deno and PGlite don't support it).

## Starting point

- **Configuration** is env-only and validated in `server/lib/config.ts`.
  Secrets already accept `*_FILE` (`STUDIO_DATA_KEY_FILE`,
  `STUDIO_OIDC_CLIENT_SECRET_FILE`), and infrastructure secrets already accept
  `env:NAME` and `file:/path` references (`secretRefSchema`). This fits
  Kubernetes as it is.
- **Hosted mode needs OIDC.** `loadStudioConfig` throws without
  `STUDIO_OIDC_ISSUER` and `STUDIO_OIDC_CLIENT_ID`.
- **Startup errors are only logged** (`server/plugins/studio.ts`). The process
  keeps running, so an orchestrator sees a live but broken container.
- **No health endpoint and no Dockerfile.** There's only a `.dockerignore`.
- **Base path:** Nuxt supports `NUXT_APP_BASE_URL` at runtime, so we don't
  need the Web UI's sed placeholders. Several places still assume `/`:
  - Plain URLs that skip `$fetch`'s `baseURL`, built from `apiBasePath`:
    `FileValue.vue:72`, `ShellAvatar.vue:8`, the export links in
    `pages/targets/[targetId]/shells/[shellKey].vue:91,125`, and
    `useAppBridge.ts:121`.
  - `window.location.assign(result.logoutUrl ?? '/')` (`stores/session.ts:37`),
    the invitation link in `ShareDialog.vue:193`, and `returnTo ?? '/'` in
    `auth/login.post.ts`.
  - Head links `/layers.css`, `/favicon.svg` and `/favicon.ico` in
    `nuxt.config.ts`.
  - Cookies with `path: '/'` (`auth/callback.get.ts`, `auth/logout.post.ts`).
  - `callbackUri` and `publicUrl`, which keep only the origin
    (`server/lib/urls.ts`, `config.ts`).
  - The apps base URL `${appsOrigin}/app/` and the host check in
    `server/middleware/01.apps-host.ts`.
- **Infrastructures** are DB rows (`server/lib/infrastructures.ts`), created
  through the admin panel (`InfrastructuresPanel.vue`,
  `InfrastructureDialog.vue`). There's no export or import.
- **Deno** for backend apps comes from `node_modules/deno`, which is per-arch.
  A cross-built image can't copy it from the build stage.
- **Deployment settings** already reach the UI through `GET /context`
  (`studioContextSchema`). Branding, legal links, toggles and version can go
  there too and render server-side without a flash.

## Phase A: container image

1. **`Dockerfile`** (multi-stage):
   - The `build` stage is `node:24-bookworm-slim` (`--platform=$BUILDPLATFORM`).
     It enables pnpm exactly like `.github/scripts/setup-pnpm.sh`, runs
     `pnpm install --frozen-lockfile` with a BuildKit cache mount, then
     `pnpm build`.
   - Build args `STUDIO_VERSION`, `STUDIO_COMMIT_SHA` and `STUDIO_BUILD_DATE`
     go into the build (Phase F).
   - The `runtime` stage is `node:24-bookworm-slim`. It copies `.output/` and
     takes Deno from `denoland/deno:bin-<devEngines version>`, which is
     multi-arch, setting `STUDIO_DENO_PATH=/usr/local/bin/deno`.
   - It runs as user `node` (uid 1000) with `ENV NODE_ENV=production
     NITRO_PORT=3000 STUDIO_DATA_DIR=/data`, `VOLUME /data`, `EXPOSE 3000`,
     a `HEALTHCHECK` that calls `/health/live` with `node -e fetch(...)`, and
     OCI labels.
   - It writes only to `/data` and `/tmp`, so a read-only root filesystem works.
2. **`docker/start.mjs`** (a Node launcher instead of a shell entrypoint, so
   no file is rewritten and no shell is needed):
   - It normalizes `STUDIO_BASE_PATH` (`studio`, `/studio` and `/studio/` all
     become `/studio/`) into `NUXT_APP_BASE_URL` (`docker/base-path.mjs`,
     shared with `docker/healthcheck.mjs`), exiting 1 on an invalid path.
   - Then it imports `server/index.mjs` in the same process, so SIGTERM
     reaches Nitro's graceful shutdown.
3. **`.dockerignore`**: add `.data`, `test-results`, `apps/*/node_modules`,
   `apps/*/dist`, `server/bundled-apps/*.zip`, `examples/**/demo` output and
   `docs/`.
4. **Fail fast:** when hosted, a `ConfigurationError` or a failed migration at
   startup logs the problem and exits with code 1
   (`server/plugins/studio.ts`). Desktop keeps today's behaviour.
5. **Health:** add `server/routes/health/live.get.ts` (the process answers)
   and `server/routes/health/ready.get.ts` (config loaded, migrations done,
   DB reachable, managed infrastructures reconciled; otherwise 503 with a
   problem body). Both are served under the base path, need no auth and
   return version and commit.

## Phase B: base path

1. Introduce `STUDIO_BASE_PATH`, mapped to `NUXT_APP_BASE_URL` by the
   entrypoint. Document `NUXT_APP_BASE_URL` for running without the image.
   `config.ts` reads the effective base from runtime config
   (`app.baseURL`) into `StudioConfig.basePath`. If `STUDIO_PUBLIC_URL` has a
   path, it must equal the base path, else it's a `ConfigurationError`.
2. Add a shared helper `withBase(path)` (`app/utils/urls.ts`, built on
   `useRuntimeConfig().app.baseURL`) and use it for every plain `href` and
   `src` listed above, the invitation link and the logout fallback. An ESLint
   `no-restricted-imports` rule forbids `apiBasePath` in `app/` outside the
   fetch helpers, so new plain URLs can't skip the base path.
3. Server:
   - `callbackUri` and the post-logout redirect use
     `publicUrl + basePath + callbackPath`.
   - Cookies keep `Path=/`, which the `__Host-` prefix requires. A Studio under
     a base path gets its own cookie name instead, from a hash of the whole
     base path, so two Studios on one origin keep their sessions apart.
   - `returnTo` is validated against the base path.
   - The apps base URL becomes `${appsOrigin}${basePath}app/`.
4. The `layers.css` head link moves from `nuxt.config.ts` to `app.vue`, under
   `app.baseURL` with `tagPriority: 'critical'`. Backend apps get the
   app-calls path under the base path too (`BackendRunner` option `callPath`).
5. Fonts and icon fonts from CSS: checked, Vite already emits relative URLs
   (`url(./materialdesignicons-webfont…)`), so nothing to change.
6. Electron and `nuxt dev` stay on `/`.

## Phase C: anonymous mode

1. `STUDIO_AUTH_MODE=oidc|none` (default `oidc`). With `none`, the OIDC vars
   aren't required and are ignored with a warning.
2. Every browser gets its own anonymous session through the normal session
   cookie, created on first request by the session middleware. Downstream
   target tokens (`delegated_user`) stay per browser. All anonymous sessions
   share one principal (`anonymous`), so preferences and workspaces are
   shared.
3. `STUDIO_ANONYMOUS_ROLES` (CSV, default empty) sets the roles. Adding
   `STUDIO_ADMIN_ROLE` makes visitors admins. The roles decide admin rights
   exactly as for OIDC users, so the authorization code doesn't fork.
4. UI: no login or logout buttons, and the account menu shows *Anonymous*.
5. Startup logs a warning when `none` is combined with admin roles and a
   non-loopback public URL.
6. Write an ADR (0036) as an amendment to ADR 0002 that states the threat
   model: this mode is for demos, closed networks, or setups behind an
   authenticating proxy.
7. The server render's own API calls send the session cookie created during
   the same request (`app/composables/useStudioFetch.ts`); rewriting the
   request's cookie header does not reach Nitro's internal fetches, and one
   page load created four sessions that way.

## Phase D: managed infrastructures from YAML

1. **Sources** (all optional, merged, duplicate `key` is a startup error):
   - `STUDIO_INFRASTRUCTURES_FILE`: path to a YAML file; a missing file is a
     startup error. There is no implicit default path, so a mounted file is
     always named in the configuration.
   - `STUDIO_INFRASTRUCTURES`: the same YAML inline, handy for Helm values
     and compose.
2. **Runtime additions:** `STUDIO_INFRASTRUCTURES_EDITABLE=true|false`
   (default `true`). `false` blocks create, edit, delete and import of
   infrastructures in the BFF (`forbidden`), and the panel becomes read-only.
   Managed entries are read-only either way.
3. **Format:** a YAML form of `infrastructureInputSchema`, so the parser is
   the existing Zod schema plus `key`:

   ```yaml
   version: 1
   infrastructures:
     - key: factory-a                 # stable identity; [a-z0-9-], unique
       name: Factory A
       description: Line 3 digital twins
       template: full
       endpoints:
         - { type: aasRegistry, url: https://basyx.example.org/aas-registry }
         - { type: submodelRegistry, url: https://basyx.example.org/sm-registry }
         - { type: aasDiscovery, url: https://basyx.example.org/discovery }
         - { type: aasRepository, url: https://basyx.example.org/aas-repo }
         - { type: submodelRepository, url: https://basyx.example.org/sm-repo }
       listSource: registry
       security:
         mode: deployment_client_credentials
         issuer: https://id.example.org/realms/basyx
         clientId: studio
         clientSecret: { ref: env:FACTORY_A_CLIENT_SECRET }
       allowPrivateNetwork: false
   ```

4. **Storage:** migration `00NN` adds `managed_key text unique null` to
   `infrastructures`. On startup, `reconcileManagedInfrastructures` (in
   `server/lib/infrastructures.ts`, so it stays free of `nuxt/server`) does
   the following:
   - It upserts by `managed_key` and keeps the row id, so workspaces,
     preferences and per-user tokens survive restarts.
   - It deletes managed rows whose key is gone.
   - It probes changed entries as `withProfiles` already does.
   - It writes audit events with actor `deployment`.

   Secrets follow the API's rule: hosted Studio accepts only `env:`/`file:`
   references, so a plain `value` in the file is a startup error there.
   Endpoints are checked only statically (scheme, no credentials), not
   resolved or contacted, because BaSyx may start after Studio; the first
   load probes them. A `managed_digest` (HMAC of the entry under the data key)
   skips unchanged entries, so restarts don't bump revisions. A transaction
   with an advisory lock keeps replicas that start together from racing.
5. **API and UI:** `Infrastructure` gets `managed: boolean`. The panel shows a
   *Managed by deployment* chip, the dialog opens read-only for managed rows,
   and the BFF rejects writes to them. `GET /context` carries
   `infrastructuresEditable`.

## Phase E: export and import

1. **`GET /infrastructures/export?ids=…`** (admin) returns
   `application/yaml` in the format above.
   - `env:`/`file:` secrets and `file` certificates are exported as their
     references.
   - Stored secrets and stored certificates are left out and replaced by a
     YAML comment (`# clientSecret: stored in the source Studio, set it
     here`). The UI says so before copying.
   - `key` comes from `managed_key`, or a slug of the name.
2. **`POST /infrastructures/import?dryRun=true|false`** (admin, needs
   `infrastructuresEditable`) takes YAML text.
   - The dry run returns each entry with its validation result and whether
     the name already exists.
   - The real run creates normal, not managed, infrastructures. For
     conflicts, the user picks *skip*, *replace* or *keep both* per entry.
   - One audit event per entry.
3. **UI** in `InfrastructuresPanel.vue`:
   - Per row: *Copy as YAML*. In the header: *Export all* (a download).
   - Entries pasted for import may leave out `key`; the deployment's file
     may not.
   - *Import* opens a dialog with a code editor for pasting (Monaco is
     already a dependency), `FileDropZone` for `.yaml`/`.yml`, the dry-run
     preview with per-entry problems through `ProblemAlert`, then *Import*.
   - Every string goes into i18n in all locales (`pnpm i18n:check`).
4. **Library:** add `yaml` (eemeli/yaml, YAML 1.2, typed), subject to the pnpm
   release-age policy (ADR 0010). It's used on the server for parse and
   stringify, so the client only sends and receives text.

## Phase F: deployment settings (version, branding, legal, toggles)

All of these arrive through `GET /context`, are rendered server-side and are
documented in one table (Phase H).

| Variable | Effect |
| --- | --- |
| `STUDIO_VERSION`, `STUDIO_COMMIT_SHA`, `STUDIO_BUILD_DATE` (build args) | Shown in Settings → About and `/health/*`, and set as OCI labels. Snapshot builds use `SNAPSHOT-<ts>-<sha>`. |
| `STUDIO_LOGO_LIGHT`, `STUDIO_LOGO_DARK`, `STUDIO_LOGO` (both) | Replace the BaSyx logo in the app bar and welcome screen. The value is an `https:` URL or a path to a mounted file, which Studio serves at `<base>/branding/logo-{light,dark}` with the right content type (SVG, PNG, WebP). |
| `STUDIO_PRIMARY_COLOR`, `STUDIO_PRIMARY_COLOR_LIGHT`, `STUDIO_PRIMARY_COLOR_DARK` | The deployment's default accent, replacing `basyx` in `shared/appearance.ts` for users who haven't picked one. Users can still choose their own. Startup warns below 4.5:1 contrast. |
| `STUDIO_PRODUCT_NAME` | Window title and app bar text (default *BaSyx Studio*). |
| `STUDIO_COPYRIGHT_NAME`, `STUDIO_LEGAL_NOTICE_URL`, `STUDIO_PRIVACY_POLICY_URL` | Footer of the welcome screen and Settings → About. |
| `STUDIO_READ_ONLY=true` | No writes or uploads to any target. Enforced in the BFF by masking the write capabilities each target reports, so the UI hides edit actions through the same capability checks it already uses. |
| `STUDIO_ALLOW_UPLOADS=false` | Masks only the upload capabilities. |
| `STUDIO_APPS_ALLOW_INSTALL=false` | Admins can't install apps at runtime; bundled apps stay. |
| `STUDIO_INFRASTRUCTURES_EDITABLE` | See Phase D. |

Toggles only ever narrow what roles allow. They never grant anything.

As built: `STUDIO_PRODUCT_NAME` sets the window title and the app bar, not the
product name inside translated texts. `STUDIO_READ_ONLY` also hides the
view/edit switch and is enforced in `openTargetFor` for every request that is
not a read (searches, availability checks and validations count as reads).
`STUDIO_APPS_ALLOW_INSTALL=false` blocks uninstalls too. Legal links appear on
the sign-in page and in Settings → About.

## Phase G: workflows

The actions are pinned to the same SHAs as the Web UI workflows and the
existing ones here.

1. **`.github/workflows/docker-snapshot.yml`**:
   - Triggers on push to `main` (paths-ignore `docs/**`, `**/*.md`) and on
     `workflow_dispatch`. A guard job skips forks
     (`github.repository == 'eclipse-basyx/basyx-studio'`).
   - Sets up QEMU and Buildx, logs in with `DOCKER_HUB_USER` and
     `DOCKER_HUB_TOKEN`, then runs `docker/build-push-action` for
     `linux/amd64,linux/arm64` with registry build cache, `provenance:
     mode=max` and `sbom: true`.
   - Tags `SNAPSHOT`, `SNAPSHOT-<ts>-<sha>` and `<shortsha>`.
   - Cosign keyless signs and attests, then runs `verify` and
     `verify-attestation`. Syft writes SPDX and CycloneDX artifacts, kept for
     14 days.
2. **`.github/workflows/docker-release.yml`**:
   - Runs on a release tag, started by `release.yml` (ADR 0053).
   - Tags `<version>` (from the tag, without `v`) and `latest`.
   - The version must be the one in `package.json`, which Studio and its
     packages share (ADR 0053); `release.yml` checks it the same way.
   - A second job attaches the SBOMs and the supply-chain manifest to the
     release.
3. **`ci.yml`** gets an `image` job on PRs:
   - Builds `linux/amd64` only, without pushing.
   - Smoke test: start the container with `STUDIO_AUTH_MODE=none`,
     `STUDIO_BASE_PATH=/studio`, a generated data key and an inline
     `STUDIO_INFRASTRUCTURES`.
   - Wait for `/studio/health/ready`, then `curl` `/studio/` and one
     `/studio/_nuxt/*.js` asset.
   - Check that `/studio/api/studio/v1/infrastructures` lists the managed
     entry.
   - Run as `--user 1000 --read-only --tmpfs /tmp`.
4. **`vuln-scan.yml`**: add a Trivy image scan (not on PRs) as the Web UI
   does.
5. **`dependabot.yml`**: add the `docker` ecosystem for the base images.
6. **As built:** the smoke test is `.github/scripts/image-smoke-test.sh`
   (also for local runs). It runs the container with `STUDIO_AUTH_MODE=none`
   and an inline infrastructure instead of the plan's pages-only check, and
   also asserts uid 1000 and the read-only root. Prereleases don't get
   `latest`. The Dockerfile names its base images literally so Dependabot can
   update them; Deno is bumped together with `devEngines` instead.
7. **Prerequisite outside the repo:** Docker Hub repository
   `eclipsebasyx/basyx-studio` and the two secrets on
   `eclipse-basyx/basyx-studio`, requested from the Eclipse Foundation
   (helpdesk), as for the other BaSyx images.

## Phase H: examples and documentation

1. **`examples/deployment/quickstart/`**: `compose.yaml` with only Studio,
   using `STUDIO_AUTH_MODE=none`, PGlite on a named volume, a mounted
   `infrastructures.yaml` and `.env.example` with `STUDIO_DATA_KEY`.
2. **`examples/deployment/production-like/`** adds:
   - PostgreSQL for Studio and Keycloak with a realm import
     (`studio-web` client, `studio-admin` role).
   - BaSyx Go.
   - Caddy (or Traefik) serving Studio at `https://studio.localhost/studio/`
     and the apps host `https://apps.studio.localhost`, with the header rules
     from `deployment-variants.md`.
   - `*_FILE` secrets.
   It reuses `test-setup/` pieces where possible.
3. **`docs/deployment/README.md`** (new) covers:
   - Image tags and verifying signatures.
   - Every env var in one table: required, default, secret, file variant.
   - The base path and reverse-proxy rules, and the YAML reference.
   - Anonymous mode caveats.
   - Kubernetes notes for the chart: probes, `/data` PVC, PGlite means one
     replica, PostgreSQL for more, the two ingress hosts, `fsGroup: 1000`,
     read-only root filesystem.
4. **ADRs:**
   - 0035: container image and runtime configuration, including the base
     path.
   - 0036: anonymous mode.
   - 0037: declarative infrastructures, export and import.
5. **Updates:** `deployment-variants.md` (env table), `README.md` (quick
   start with `docker run`), `docs/api/openapi.yaml` and `endpoints.md`
   (export, import, health).

As built: both examples were run end to end with a local image. The
production-like example routes Keycloak through Caddy under `/auth`, and gives
Caddy the network aliases `studio.localhost` and `apps.studio.localhost`, so
Studio reaches the IdP under the browser's issuer URL. It uses plain HTTP;
the guide says to add TLS. Example AAS data is not included; users upload an
AASX through Studio.

## Tests

- **Unit:**
  - `loadStudioConfig` for every new variable: base path normalization,
    the public URL path conflict, auth mode, toggles and colors.
  - YAML parse and validation with path-precise errors.
  - Reconcile: insert, update with the id kept, removal, duplicate keys.
  - Export round trip: export → import dry run → equal input, with stored
    secrets left out.
- **Integration** (`STUDIO_TESTENV=1`):
  - Reconcile against PostgreSQL.
  - Import and export through the API.
  - Writes to managed rows are rejected.
  - `STUDIO_READ_ONLY` blocks a submodel write.
- **E2E web** (Playwright): one project that runs the built server with
  `STUDIO_BASE_PATH=/studio` and `STUDIO_AUTH_MODE=none`. It opens a shell,
  downloads an export, shows a thumbnail, opens a file value, imports
  pasted YAML and copies one as YAML.
- **Image:** the CI smoke test (Phase G 3), plus a manual
  `docker compose up` of both examples on amd64 and arm64 (Apple Silicon).

## Order

A → B (needs the image to prove the base path) → D → E → C → F → G → H. C and F
are independent of D and E; G only needs A. If the PR gets too big, F's
branding and toggles are the first part to split off.

## Follow-ups (not in this PR)

- Helm chart `basyx-studio` in `eclipse-basyx/charts`: Deployment, Service,
  two Ingress hosts, PVC, Secret, ConfigMap for `infrastructures.yaml`, and
  optional PostgreSQL.
- Multiple replicas: check what's in process memory (SSE invalidation, OIDC
  client cache) before allowing more than one replica with PostgreSQL.
- Container isolation for third-party backend apps in hosted mode
  (app-platform.md).
- Reading the Web UI's `basyx-infra.yml` as an import source, if it's wanted
  later.
