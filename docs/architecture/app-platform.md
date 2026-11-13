# Runtime-Installable App Platform

The app platform allows independent publishers to extend Studio at runtime without turning the trusted Studio process into a mutable Node.js host.

Canonical publication, installation, and capability-call sequences are in [mechanisms.md](mechanisms.md).

[MVP-3](../development/mvp-3-plan.md) implements developer-mode installation,
UI apps (submodel views and modules) and Deno backend apps. Its decisions are
[ADR 0016](../adr/0016-app-manifest-and-packages.md) (manifest and packages),
[ADR 0017](../adr/0017-app-origin-and-content-security-policy.md) (app origin and CSP),
[ADR 0018](../adr/0018-capability-bridge-and-authorization.md) (capability bridge) and
[ADR 0019](../adr/0019-backend-app-runner.md) (backend runner). App authors use
[`@basyx/studio-sdk`](../../packages/studio-sdk/README.md) and
[`@basyx/studio-app-kit`](../../packages/studio-app-kit/README.md), which are
published with [`@basyx/file-viewer`](../../packages/file-viewer/README.md), the file and 3D viewer,
so apps can be built outside this repository
([ADR 0043](../adr/0043-published-sdk-and-app-kit.md)).

## Installation scope

- Hosted: an app version is installed for one Studio deployment. Visibility and execution authorization are evaluated per user/group.
- Desktop: an app version is installed for the current OS user/machine.
- Marketplace: catalogue and artifacts are central and independent from installations.

Installations pin immutable artifact digests, not mutable tags. App updates are independent from Studio binary updates but constrained by declared Studio API compatibility.

## Signed packages and updates

Until the marketplace exists, deployments install signed packages directly
([ADR 0044](../adr/0044-app-package-signatures-trust-store-and-updates.md)):

- A package carries a detached signature over its bytes, as
  `cosign sign-blob --key` writes it. The deployment's trust store
  (`STUDIO_APPS_TRUSTED_PUBLISHERS`) lists publishers, their public keys and
  the app IDs each may sign. Signed packages install without developer mode.
- Every installation records its trust: `bundled`, `signed` (with the trust
  store's publisher name and the key fingerprint), `managed` (mounted by the
  operator through `STUDIO_APP_PACKAGES`) or `unsigned` (developer mode).
- Uploads are inspected first; the administrator confirms the verified
  publisher and the requested permissions, and, for an update, what changes.
- An update replaces the files of the installation in place and keeps its ID.
  It needs the same publisher's signature and a higher version; managed
  packages may also go back.
- A trust store entry may grant reserved permissions (`studio.timeseries.read`)
  to its publisher's apps.
- Removing a key revokes the apps it signed at the next start.

## App categories

### UI-only app

Runs in a sandboxed iframe on a separate origin: its installation's own origin, or an opaque one when all apps share one apps origin ([ADR 0045](../adr/0045-app-origins-embeds-and-full-page-modules.md)). It has no access to host cookies, Pinia, Nuxt internals, DOM, tokens, or unrestricted browser APIs. It communicates using a versioned message protocol.

Its manifest may declare third-party origins in `sandbox`: pages it embeds (`frameOrigins`), keyless public APIs it reads (`connectOrigins`), and images and media (`imageOrigins`, `mediaOrigins`). Each extends one directive of the frame's Content Security Policy, and the install dialog lists them with a data-egress note. Services with secrets or per-deployment endpoints stay with connections: the manifest's `connections` name OpenAPI documents in the package and the operations the app calls, an administrator binds them to an `http` connection of an infrastructure, and Studio's server sends the calls ([ADR 0047](../adr/0047-http-connections-for-apps.md)). A module may set `layout: fullPage` to fill the page without Studio's header and card. What differs between deployments, such as asset types or external IDs, the manifest declares as `settings`: an administrator sets their values per installation and, for `infrastructure` settings, per infrastructure in the dialog or the declared YAML, and the app reads them from its context together with whether each of its connections is bound ([ADR 0048](../adr/0048-app-settings-and-connection-status.md)). Settings are not for secrets.

This is the default and lowest-trust category.

### Standard backend app

Runs TypeScript/JavaScript in a separate Deno runtime with deny-by-default file, network, environment, subprocess, native-addon, and FFI permissions. Hosted execution additionally uses one app/version per constrained container or pod.

Deno permissions reduce ambient authority but are not a complete hostile-code boundary. Hosted production deployments require OS/container isolation as well.

### Privileged/native app

Requires broad Node.js, native-addon, subprocess, device, or filesystem access. It is full-trust software and requires a verified publisher, explicit administrator confirmation, and a visibly stronger permission warning. A hosted deployment may disable this category entirely.

## App Builder (desktop)

The desktop app can also build apps
([ADR 0054](../adr/0054-app-builder-with-coding-agents.md),
[plan](../development/app-builder-plan.md), [user guide](../app-builder.md)).
Its chat runs a coding agent (Claude Code, Codex or opencode, over the Agent
Client Protocol) in a project folder on the user's computer; the agent is
full-trust local software the user chose, outside this platform's isolation.
What it builds is not: Studio builds the folder itself, installs the result
as a project-owned preview (`local.preview.p<projectId>`, with UUID hyphens
removed, flagged and shown only in the App Builder),
and installs a release through the same inspect, consent and install path as
an upload, unsigned in developer mode or signed. The App Builder's machine
key is a trust store publisher (*This computer*) for `local.*` app IDs only,
with no reserved permissions and no remote code.

## Capability API

Apps use `@basyx/studio-sdk` capabilities rather than host implementation objects. Initial capability families are:

- `studio.aas`: query, mutate, invoke operations, observe active target; structural writes and attachment uploads run the editor's code paths and only in Studio's edit mode, which Studio's server checks ([ADR 0049](../adr/0049-structural-writes-and-attachments-for-apps.md))
- `studio.files`: pick, open, save, and bounded streams
- `studio.connections`: calls of declared OpenAPI operations through HTTP connections an administrator bound to the app; the URL and the credentials stay with Studio ([ADR 0047](../adr/0047-http-connections-for-apps.md)). It replaces the planned `studio.http` with free requests to declared origins
- `studio.ui`: notifications, commands, panels, and context; other apps' submodel views in Studio's dialog (`openView`) or, read-only, in the app's page where each installation has its own origin (`embedView`); they keep their own frame, permissions and origin, and connect to Studio's page directly ([ADR 0051](../adr/0051-views-of-other-apps.md))
- `studio.semantic`: active semantic index and applicability information
- `studio.jobs`: start and observe bounded long-running app tasks
- `studio.views`: contribute widget types and interact with scoped view context
- `studio.timeseries`: read a segment of an IDTA Time Series Data submodel; Studio reads the submodel and the database behind it ([ADR 0040](../adr/0040-connections-on-infrastructures.md))

Capabilities are versioned, validated, authorized per call, and audited. The app receives a short-lived internal capability token, never an infrastructure OAuth token.

File access should normally use host-mediated file handles/streams. Arbitrary paths are available only to explicitly privileged desktop apps. Network and AAS-read permissions shown together must warn that the combination can transmit AAS data externally.

## Graphical-builder widgets

An app can contribute sandboxed widget types to the graphical view builder. A
widget contribution declares configuration JSON Schema, named data/action
binding slots, semantic applicability, layout constraints, SDK compatibility,
and capabilities in the normal app manifest.

The widget uses the same isolated UI entry point and Studio SDK RPC bridge as the
rest of the app. Embedding it in a user-built dashboard does not move it into the
core renderer, grant access to Pinia or cookies, install the app, approve
permissions, or bypass per-call user/target authorization. The builder provides
scoped binding handles rather than raw AAS endpoints or credentials.

The core Studio widgets and app widgets share the declarative view schema but not
the same trust level. Details are defined in
[views-and-dashboards.md](views-and-dashboards.md).

## Manifest

The public manifest is a language-neutral JSON document validated against a versioned JSON Schema. It includes:

- app ID, publisher, version, and artifact digest
- display metadata and entry points
- supported targets: hosted, desktop, or both
- Studio API/runtime version ranges
- supported AAS metamodel versions
- UI and backend runtime category
- requested capabilities and network origins
- semantic applicability requirements
- graphical-builder widget contributions and their configuration/binding schemas
- dependency/build metadata and SBOM reference

The manifest never contains executable compatibility predicates.

## Semantic applicability

Technical compatibility and semantic applicability are separate results.

Technical compatibility covers Studio API version, runtime, operating system, deployment target, and AAS metamodel version.

Semantic applicability covers:

- shell, submodel, or element context
- exact or version-compatible semantic IDs
- required semantic element paths
- qualifiers and cardinality
- `all`, `any`, and optional requirements

Studio builds a semantic index for the active target and evaluates manifests declaratively. The UI explains why an app is applicable, unavailable, or only partially matched. Marketplace search can use the same semantic metadata before installation.

## Publication pipeline

App authors may choose packages from the npm ecosystem, but PNPM is the only
package manager used to lock and build them before publication:

```text
source and manifest
  -> isolated reproducible build
  -> tests and manifest validation
  -> dependency and vulnerability scan
  -> secret/malware policy checks
  -> SBOM and provenance
  -> immutable OCI artifact
  -> publisher signature and review status
  -> catalogue publication
```

Runtime dependency installation into an existing installation is prohibited. If
a user changes dependencies, that creates a new local/forked app version that
must be rebuilt with PNPM and re-evaluated.

## Marketplace services

- Catalogue API and PostgreSQL: search, metadata, publishers, reviews, semantic requirements, revocations
- OCI registry: immutable UI/backend artifact layers
- Build workers: isolated dependency installation and bundling
- Signing/attestation: Sigstore/Cosign-compatible signatures, provenance, and SBOM
- Policy/scanning: compatibility, vulnerability, and review decisions

Installation verifies digest, signature, compatibility, revocation status, and permission approval before atomic activation. The previous version remains available for rollback.

## Isolation rules

- Module Federation or dynamic ESM loading may distribute code but is never considered a security boundary.
- Backend apps never share the Studio Service Node.js process.
- Desktop utility processes provide lifecycle/crash isolation; untrusted permissions still need runtime and OS enforcement.
- Hosted backend apps run non-root with read-only root filesystems, resource limits, no platform service-account token, constrained network policy, and a hardened runtime class where required.
- App logs are untrusted, rate-limited, tagged with bounded app/version identifiers, and separated from trusted audit records.
