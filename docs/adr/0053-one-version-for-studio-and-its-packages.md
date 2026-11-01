# 0053: One version for Studio and its packages

- Status: Proposed
- Date: 2026-11-01
- Deciders: BaSyx Studio maintainers
- Amends: the release (P3) of
  [ADR 0043](0043-published-sdk-and-app-kit.md), which versioned the
  packages independently of Studio and released them on `sdk-v*` tags
- Requirements: APP-001, APP-023

## Context

ADR 0043 releases `@basyx/studio-sdk`, `@basyx/studio-app-kit` and
`@basyx/file-viewer` with `sdk-release.yml` on tags `sdk-v<version>`,
versioned together and independently of Studio. Studio's desktop binaries
are built by `release-binaries.yml`, and its image by `docker-release.yml`,
on a published GitHub release.

Neither has been released yet, and the numbers have drifted apart: Studio is
at 0.1.0, the packages at 0.1.10, the SDK's README lists package versions up
to 0.1.14, and the app API (`studioAppApiVersion`) is at 0.1.15. Every
package change so far came with a Studio change in the same pull request,
and Studio depends on the kit itself, so a package release without a Studio
release, or the other way round, has not happened.

The `@basyx` scope now exists on npm (Eclipse Foundation help desk issue
7988). npm enables trusted publishing only for a package that exists, and
only for the workflow file it names, so the release workflow's file name is
fixed once the Eclipse Foundation sets it up.

## Decision

- **V1, one version.** Studio (the root `package.json`) and the three
  packages always have the same version, `0.x` while the app API is.
  The first release is 0.2.0, above every version so far. Studio's changes
  set it: new features are a new minor version, fixes a patch version. A
  release publishes all three packages, also when they have not changed.
- **V2, the app API stays separate.** `studioAppApiVersion` keeps its own
  version and its rules in the SDK's README (additions are patch versions
  while it is `0.x`). An app's `studioApi` range, not the package version,
  says which Studio runs it; an app built with the 0.2 packages runs on any
  later Studio whose app API its range matches.
- **V3, one release workflow.** Publishing a GitHub release `v<version>`
  runs `.github/workflows/release.yml`:
  - `check`: the version check of V4, lint, typecheck, unit tests and the
    tarball check of ADR 0043 (P6).
  - `npm`: publishes the packages with `pnpm publish` through npm trusted
    publishing with provenance, from `eclipse-basyx/basyx-studio` only. A
    prerelease is published with the dist-tag `next`, so `latest` stays on
    the last release.
  - `binaries`: builds the desktop binaries for Linux, macOS and Windows and
    attaches them to the release.

  `npm` and `binaries` start once `check` passes. `sdk-release.yml` and
  `release-binaries.yml` are removed; `docker-release.yml` (ADR 0035) stays
  a workflow of its own and runs the same version check before it builds.
  npm's trusted publisher for the three packages names `release.yml`.
- **V4, setting and checking the version.**
  `pnpm release:version <version>` (`scripts/release-version.mjs`) sets the
  version in the four `package.json` files and the starter example's ranges
  on the packages. With `--check` it fails unless all of them match, and
  the SDK's README maps the version to the current `studioAppApiVersion`;
  the release workflows run it on the release's tag without the `v`. A
  prerelease such as 0.2.0-rc.1 needs the row of 0.2.0.
- **V5, the README.** The SDK's version table has a row per release with
  its app API version. What each app API version added is listed by app
  API version, as manifests declare it.
- **V6, the first publish.** Each package is published once by a
  maintainer, by hand and without provenance, at 0.1.10, so that its
  trusted publisher can be set up. 0.2.0 is then the first release from
  `release.yml`, and 0.1.10 is deprecated in favour of it.

## Consequences

- One number says which Studio, which packages and which binaries belong
  together; a release is one step, and the binaries carry the version that
  `package.json` already has instead of setting it from the tag.
- A release with Studio changes only publishes packages that equal the ones
  before. A new minor version of Studio is a new minor version of the
  packages, which a `^0.2.0` range does not match: app authors update their
  range when they want the newer packages, not to keep their app running.
- A fix in a package needs a Studio release, and is one.
- The release check fails when a version or the README row is missing, so
  `pnpm release:version` and the README row belong in the pull request that
  prepares a release.
- Renaming `release.yml` later needs the trusted publishers changed on
  npm by the Eclipse Foundation.

## Alternatives considered

- **Packages versioned independently of Studio (ADR 0043):** lets a package
  fix ship without a Studio release, but no change so far was a package
  change alone, and it keeps three version numbers that already drifted.
- **One version for Studio, the packages and the app API:** the app API
  version says what a manifest needs and changes only with the protocol;
  tying it to Studio's features would make every Studio feature release a
  new app API.
- **The version set from the release tag in the workflow**, as
  `release-binaries.yml` did: the tag is not in the repository, so the
  sources of a release would not say which version they are, and the
  packages could not be checked before they are published.
- **Separate workflows on the same release:** a failing check would not stop
  the others, and a release made by a workflow with `GITHUB_TOKEN` does not
  start further workflows, so they could not be chained.
