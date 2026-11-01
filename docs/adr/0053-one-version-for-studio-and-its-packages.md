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
- **V3, one release workflow, run with a version.** A maintainer runs
  `.github/workflows/release.yml` from the Actions tab on `main` with the
  release tag, e.g. `v0.2.1`, or `v0.2.1-rc.1` for a prerelease, as in the
  other BaSyx repositories (a version without `v` is accepted too). Its jobs:
  - `prepare`: sets the version as V4 does, commits "Release <version>" to
    `main` as `github-actions[bot]`, tags it `v<version>` and creates a
    draft release: `.github/release-notes.md` with the version and app API,
    then GitHub's generated list of changes. It refuses a version that is not
    newer than every release tag, and stops when `main` moved on meanwhile.
  - `check`, on the tag: the version check of V4, lint, typecheck, unit
    tests and the tarball check of ADR 0043 (P6).
  - `binaries`: builds the desktop binaries for Linux, macOS and Windows and
    attaches them to the draft.
  - `image`: runs `docker-release.yml` (ADR 0035) on the tag and waits for
    it. Run on the tag, the image's cosign identity stays
    `docker-release.yml@refs/tags/v<version>`; a `workflow_dispatch` is the
    one event a workflow's token can start another workflow with.
  - `npm`, once the binaries and the image are done: publishes the packages
    with `pnpm publish` through npm trusted publishing with provenance, from
    `eclipse-basyx/basyx-studio` only. A prerelease is published with the
    dist-tag `next`, so `latest` stays on the last release.
  - `publish`: publishes the draft release, as latest unless it is a
    prerelease.

  Until `publish`, the release is a draft, and npm is the last step that
  cannot be undone. A re-run finds the tag, the draft and a built image, and
  continues. `sdk-release.yml` and `release-binaries.yml` are removed, and
  `docker-release.yml` no longer runs on published releases. npm's trusted
  publisher for the three packages names `release.yml`.
- **V4, setting and checking the version.** `scripts/release-version.mjs
  <version>` sets the version in the four `package.json` files, the starter
  example's ranges on the packages, and the row of the SDK README's release
  table with the current `studioAppApiVersion`. With `--check` it fails
  unless all of them match; the release jobs run it on the tag without the
  `v`. A prerelease such as 0.2.1-rc.1 has the row of 0.2.1.
- **V5, the README.** The SDK's release table has a row per release with
  its app API version. What each app API version added is listed by app
  API version, as manifests declare it, and is written with the change.
- **V6, the first publish.** Each package is published once by a
  maintainer, by hand and without provenance, at 0.1.10, so that its
  trusted publisher can be set up. 0.2.0 is then the first release from
  `release.yml`, and 0.1.10 is deprecated in favour of it.

## Consequences

- One number says which Studio, which packages and which binaries belong
  together. A release is one run with one input, and the binaries carry the
  version that `package.json` has instead of setting it from the tag.
- A release with Studio changes only publishes packages that equal the ones
  before. A new minor version of Studio is a new minor version of the
  packages, which a `^0.2.0` range does not match: app authors update their
  range when they want the newer packages, not to keep their app running.
- A fix in a package needs a Studio release, and is one.
- `main` carries the version of the last release, committed by the
  release workflow; pull requests do not change it. The workflow pushes to
  `main` with its own token, which needs `main` to accept that push (it has
  no branch protection, as in BaSyx Go's repositories).
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
- **Separate workflows on a published release:** a failing check would not
  stop the others, and the release would be public before its binaries,
  image and packages exist.
- **The version set in a pull request** (`pnpm release:version`, then a
  release published by hand): the first version of this ADR. Every release
  took a pull request, a README row and the release form, in that order.
- **`docker-release.yml` as a reusable workflow,** as BaSyx Go calls its
  image build: the image's cosign identity would become the caller's ref on
  `main`, which `docs/deployment` and existing verifications do not
  expect.
