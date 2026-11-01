# 0043: Published SDK and app kit

- Status: Proposed, amended by [ADR 0053](0053-one-version-for-studio-and-its-packages.md): Studio and the packages share one version, released by `release.yml` on a published GitHub release
- Date: 2026-10-20
- Deciders: BaSyx Studio maintainers
- Requirements: APP-001, APP-015, APP-020, APP-023

## Context

Studio's app platform works for the apps in this repository only
([external apps plan](../development/external-apps-plan.md)):

- `@basyx/studio-sdk` exports its TypeScript source and is consumed through
  workspace links; no workflow publishes it.
- `connect()` rejects outside a Studio frame, so an app cannot run in a
  plain dev server or in unit tests.
- The helpers every bundled app uses (`apps/shared`: `mountApp`, Vuetify
  defaults, theme sync, i18n, the Vite plugin that compiles Vuetify with
  Studio's Sass settings and patches embind) import files from `app/` and
  `shared/`.
- `@basyx/file-viewer`, which an app needs to show IFC and STEP models
  ([ADR 0039](0039-3d-viewer-libraries.md)), is private.
- `scripts/build-example-apps.mjs` packages this repository's apps; no tool
  packages an app elsewhere, and only Studio's upload checks a package
  ([ADR 0016](0016-app-manifest-and-packages.md)).

A team that keeps its app in its own repository needs all of this from a
registry, in versions that say which Studio they work with.

## Decision

- **P1, three packages** published from this repository, as built ESM with
  type declarations and source maps:
  - `@basyx/studio-sdk`: the client (`connect`, `StudioClient`, `Transport`),
    `./protocol`, `./backend` types, `./testing` and
    `./app-manifest.schema.json`. No runtime dependencies.
  - `@basyx/studio-app-kit`: what was `apps/shared` (`mountApp`, Studio's
    Vuetify defaults and aliases, theme sync, AAS reading helpers, i18n),
    `./vite` with the `studioApp()` preset, `./settings.scss`, the manifest
    and package checks and signatures (`./manifest`, `./package`,
    `./signature`), and the `studio-app` command. `@basyx/studio-sdk`, Vue,
    Vuetify, Vite and Sass are peer dependencies, so an app has one copy of
    each.
  - `@basyx/file-viewer`: the 3D viewer, made public. It ships Vite's
    `?url` and `?worker&url` imports for its WebAssembly files and worker,
    so apps that use it build with Vite, as the kit assumes anyway.
- **In the workspace, packages export their source.** `exports` names
  `src/*.ts`, and `publishConfig.exports` names `dist/`, which `pnpm pack`
  and `pnpm publish` apply. Studio, the bundled apps and the tests need no
  build of the packages; the tarballs export only the built output (with
  the source beside it for source maps).
  Relative imports carry the `.ts` extension, which `tsc` rewrites to `.js`
  (`rewriteRelativeImportExtensions`), so the same source also runs in Node.
- **P2, one source of Studio's look.** `apps/shared` moves to
  `packages/studio-app-kit`. The kit holds Studio's Vuetify Sass settings
  (`settings.scss`) and the defaults Studio and apps share
  (`vuetify-defaults.ts`). Studio's `vuetify.config.ts`, the Nuxt Vuetify
  module and `eslint.config.js` import them from the kit; the bundled apps
  import the kit by its package name like any external app. The plan's
  copy at build time is not needed: Studio depends on the kit instead.
- **P3, release.** `.github/workflows/sdk-release.yml` publishes on tags
  `sdk-v<version>`. It checks that the tag and the three package versions
  agree, runs the checks below, and publishes with `pnpm publish` through
  npm trusted publishing (OIDC, no stored token) with provenance. The
  packages are versioned together and independently of Studio, as `0.x`
  until the app API is stable: a new app API minor version (new methods)
  is a new package minor version. The SDK's README has a table of package
  version, app API version (`studioAppApiVersion`) and first Studio
  release.
- **P4, `studio-app` command** of the kit:
  - `studio-app pack [project]` packages `studio-app.json`, the files below
    `dist/` and the folders named with `--include` (e.g. `backend`) as
    `<id>-<version>.zip`.
  - `studio-app verify <package.zip>` runs the checks on an existing
    package, and the signature check when `--key` names a public key.
  - Both apply Studio's own checks: the manifest schema, the consistency
    and compatibility checks, the file types and the archive limits of
    ADR 0016. They live in `@basyx/studio-app-kit/manifest`, and
    `server/lib/apps/manifest.ts` and `package.ts` import them from there.
    The archive itself is inspected as Studio's upload does, before
    anything is decompressed.
  - `studio-app sign <package.zip> --key <private.pem>` writes
    `<package>.zip.sig`: an ECDSA P-256 signature with SHA-256 over the
    exact package bytes, DER-encoded and base64, as
    `cosign sign-blob --key --output-signature` writes it (U1 of the plan,
    [ADR 0044](0044-app-package-signatures-trust-store-and-updates.md)).
    `verify` also reads the Sigstore bundle that cosign 3 writes by default,
    as Studio does. Keys are PEM files (PKCS#8 or SEC1; an encrypted PKCS#8
    key takes its passphrase from `STUDIO_APP_KEY_PASSPHRASE`). Cosign's own
    encrypted key format is not read; teams that keep their key in cosign
    sign with cosign.
- **P5, transport and test transport** (MVP-7 D1 and D2):
  - `StudioClient` is built on a `Transport` (`call`, `onContext`,
    `close`). `connect()` is unchanged for apps and creates the
    MessagePort transport of `studio-sdk/0`.
  - `@basyx/studio-sdk/testing` provides
    `createTestStudio({ context, handlers, permissions })`: an in-memory
    transport with handlers typed by `Methods`. It answers the UI methods
    Studio's page answers (`getContext`, `setHeight`, `navigate`,
    `notify`), copies parameters and results as a MessagePort does, refuses
    methods without a handler with Studio's problem shape, and, given
    `permissions`, refuses undeclared ones as Studio does.
  - `mountApp(app, components, { client })` takes such a client, so an app
    runs its UI in a plain Vite dev server and in unit tests.
  - The protocol does not change, so the app API stays at 0.1.2.
- **P6, proof.** `examples/apps/starter` is not a workspace project. CI
  packs the three packages, installs them from the tarballs into a copy of
  the example outside the repository, and runs its unit tests, its build,
  `studio-app pack`, `sign` and `verify`, and its dev server in a browser
  on the test transport (`scripts/check-app-tarballs.mjs`). Anything that
  still reaches into this repository fails there.
- **P7, lint preset**, is deferred. The kit exports its defaults
  (`@basyx/studio-app-kit/defaults`), so `eslint.config.js`'s Vuetify rules
  can become `@basyx/studio-app-kit/eslint` when a team asks for it. Studio
  enforces nothing about an app's UI at runtime.

## Consequences

- An app is built outside this repository from npm packages only, and an
  app author gets the same findings from `studio-app pack` as from Studio's
  upload, from one implementation.
- Studio's look is defined in the kit; changing it changes the bundled apps
  at once and external apps with the next kit release.
- Studio's server imports the kit's manifest checks, so the kit's
  dependencies (Ajv, semver, fflate) stay the ones Studio uses.
- Packages and Studio are released separately; an app's `studioApi` range,
  not the package version, says which Studio runs it.
- The tarball check installs the example's registry dependencies without a
  lockfile, as a new repository would, with pnpm's release-age delay. It
  runs with read-only permissions and no secrets.
- Publishing needs the `@basyx` scope on npm and a trusted publisher for
  `sdk-release.yml`; until then the workflow fails at the publish step.
- `StudioClient`'s constructor takes a `Transport` instead of a
  `MessagePort`; apps that call `connect()` are unaffected.

## Alternatives considered

- **Copying Studio's Sass settings and defaults into the kit at build time
  (the plan's P2):** keeps the files in Studio, but the workspace kit would
  then import files outside its package or need a build before Studio and
  the apps run, and its type declarations would point outside the package.
- **`exports` to `dist/` everywhere:** Studio, the bundled apps and the
  tests would need a build of the packages before every lint, typecheck,
  test and dev server.
- **A bundler for the packages (tsup, unbuild):** a new dependency for what
  `tsc` does; the packages need no bundling, as apps bundle them.
- **Manifest checks in the SDK:** the SDK would carry Ajv and semver into
  every app's dependencies, though only build tools and Studio need them.
- **`npm publish`:** ADR 0010 makes pnpm the only package manager, and
  pnpm publishes with provenance and trusted publishing.
