# 0010: PNPM-only package management and supply-chain controls

- Status: Accepted
- Date: 2026-08-26
- Deciders: BaSyx Studio maintainers
- Requirements: APP-011 through APP-013, ARCH-002, ARCH-003, ARCH-008, ARCH-009

## Context

Studio, Electron, the Studio SDK, isolated app builds, and the marketplace use a
large JavaScript/TypeScript dependency graph. A newly compromised dependency can
execute code during installation, enter CI or release images through an
unexpected resolution, or evade review through an uncommitted lockfile change.
Using more than one package manager also produces different dependency graphs,
lockfiles, lifecycle-script behavior, and cache semantics.

The predecessor `basyx-aas-web-ui` already applies a PNPM supply-chain pattern:
an integrity-pinned `packageManager` field, the same exact PNPM version as a
development dependency, Corepack activation plus version verification,
`pnpm-lock.yaml`, frozen CI/container installs, a 24-hour minimum release age,
and an explicit dependency-build allowlist. Its release workflows additionally
pin GitHub Actions, generate provenance/SBOMs, scan artifacts, and sign immutable
image digests.

## Decision

Use PNPM as the only package manager for Studio development, scripts, CI,
containers, release builds, workspaces, and isolated JavaScript/TypeScript app
builds. npm, Yarn, Bun, and other package managers are not supported fallbacks.

Apply these controls:

1. Commit only `pnpm-lock.yaml`. Reject `package-lock.json`, `yarn.lock`,
   `bun.lock`, and other package-manager lockfiles in review and CI.
2. Pin one exact PNPM version both as a development dependency and in the
   `packageManager` field. The `packageManager` value includes the PNPM
   distribution's SHA-512 integrity hash.
3. Enable PNPM through Corepack. A shared setup check reads `packageManager`,
   verifies that it starts with `pnpm@`, extracts the exact version, and fails if
   the running PNPM version differs.
4. Use `pnpm install --frozen-lockfile` in CI, Docker/OCI builds, and release
   builds. An integrity mismatch or manifest/lockfile mismatch is a hard failure;
   it is never repaired automatically in those environments.
5. Configure supply-chain policy in committed `pnpm-workspace.yaml`:
   `minimumReleaseAge: 1440`, `minimumReleaseAgeStrict: true`,
   `strictDepBuilds: true`, `blockExoticSubdeps: true`, `trustLockfile: false`,
   and an explicit `allowBuilds` map. Packages not reviewed for lifecycle/build
   scripts remain denied. `dangerouslyAllowAllBuilds` is prohibited.
6. Review dependency-build approvals like code. An allow entry records the
   package/version or immutable source, the required build behavior, risk, and
   reviewer. Do not approve every pending build script as a batch.
7. Keep registry credentials out of committed configuration. Use named registry
   aliases when more than one registry is required so package origin is pinned
   in the lockfile.
8. Dependency update automation updates the exact PNPM development dependency,
   integrity-pinned `packageManager` field, lockfile, and affected allowlist in a
   reviewable change. CI verifies all four stay consistent.
9. SBOM and vulnerability tooling must understand the complete PNPM lockfile.
   Release pipelines pin third-party actions to immutable commits and produce
   verifiable provenance, SPDX/CycloneDX SBOMs, vulnerability results, and
   signatures for immutable artifacts.

The initial project bootstrap selects a reviewed current PNPM release and pins
it. This ADR fixes the control model, not a PNPM major version forever.

## Consequences

- Local, CI, container, and release dependency graphs are derived from one
  committed lockfile and one verified PNPM binary.
- Newly published compromised versions have a detection/removal window before
  they can be resolved, and newly introduced install scripts cannot silently run.
- Dependency and PNPM upgrades require explicit lockfile, integrity, and
  build-allowlist review.
- Some dependencies with legitimate native/build steps need explicit approval,
  including Electron-related packages where applicable.
- Contributors cannot use another package manager when PNPM reports peer,
  lifecycle-script, integrity, or lockfile failures; the underlying issue must be
  resolved within the PNPM policy.
- Corepack/bootstrap availability and PNPM-version synchronization become
  first-class CI and container concerns.

## Alternatives considered

- **Yarn:** rejected because the project standardizes on the hardened PNPM model
  already exercised by `basyx-aas-web-ui` and must avoid multiple lockfile and
  lifecycle-script policies.
- **npm:** rejected because it would introduce another dependency graph and does
  not implement the selected PNPM workflow controls in the same form.
- **Allow each package its own manager:** rejected because local, CI, app-build,
  and release results could diverge and auditing would require multiple policies.
- **Disable all install scripts globally:** stronger in isolation, but currently
  impractical for reviewed dependencies that legitimately build native or
  generated artifacts. Explicit `allowBuilds` preserves deny-by-default behavior.
