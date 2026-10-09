# 0016: App manifest and packages

- Status: Accepted
- Date: 2026-10-09
- Deciders: BaSyx Studio maintainers
- Requirements: APP-003, APP-011, APP-015

## Context

Apps are installed at runtime from packages that Studio did not build
([ADR 0004](0004-runtime-installable-apps.md)). Before the marketplace exists,
administrators install them in developer mode from a `.zip` file. Studio must
reject a broken or hostile package completely before it stores anything, and
the manifest must stay language-neutral so that the marketplace and other
tools can validate it too.

## Decision

- A package is a ZIP file with `studio-app.json` at its root (a single
  top-level folder is accepted and stripped). Archive litter (`__MACOSX/`,
  `.DS_Store`) is skipped.
- The manifest is versioned (`manifestVersion: 0`) and validated with a public
  JSON Schema (draft 2020-12) through Ajv, as
  [ADR 0006](0006-frontend-state-and-validation.md) requires for public
  formats. The schema is part of `@basyx/studio-sdk`
  (`app-manifest.schema.json`). It holds the reverse-DNS app ID, semantic
  version, publisher, localized title and description, `studioApi` (a
  semantic version range of the Studio app API, now `0.1.0`), runtimes,
  permissions, an optional Deno backend, and the contributions
  (`submodelViews`, `modules`).
- Checks that JSON Schema cannot express run in code: contribution IDs and
  module routes are unique, every entry exists in the package, and
  `studio.backend` is declared exactly when there is a backend.
- Packages are limited to 20 MiB compressed, 50 MiB expanded and 2 000 entries,
  with the archive checks of the Workspace Worker (entry names, declared sizes,
  compression ratio) applied before anything is decompressed. Only web file
  types from an allow-list are accepted; content types come from the
  extension and are never sniffed.
- Findings are returned as `violations` (`path`, `message`) of
  `app_package_rejected`; an incompatible API range or runtime is
  `app_incompatible`. Nothing is stored unless every check passes.
- Studio stores the package digest and every file's SHA-256 digest; file
  contents live content-addressed in the database (`app_blobs`) and are
  verified when served. One version per app ID can be installed; updates come
  with the marketplace.
- Unsigned (developer-mode) installs are allowed only when
  `STUDIO_APPS_ALLOW_UNSIGNED` is true. It defaults to false for hosted
  deployments and to true on desktop; installations are labelled unsigned.

## Consequences

- Hosted replicas and desktop use the same storage, without a file store.
- App authors get findings with JSON paths, the same as from a JSON Schema
  validator in their editor.
- Large media do not belong in app packages; apps read AAS data instead.

## Alternatives considered

- **Zod for the manifest:** Studio-internal; third parties and the marketplace
  could not validate manifests with the same definition.
- **Files on disk:** needs a shared volume for hosted replicas and a second
  integrity mechanism.
