# Runtime-Installable App Platform

The app platform allows independent publishers to extend Studio at runtime without turning the trusted Studio process into a mutable Node.js host.

Canonical publication, installation, and capability-call sequences are in [mechanisms.md](mechanisms.md).

## Installation scope

- Hosted: an app version is installed for one Studio deployment. Visibility and execution authorization are evaluated per user/group.
- Desktop: an app version is installed for the current OS user/machine.
- Marketplace: catalogue and artifacts are central and independent from installations.

Installations pin immutable artifact digests, not mutable tags. App updates are independent from Studio binary updates but constrained by declared Studio API compatibility.

## App categories

### UI-only app

Runs in a sandboxed iframe on a separate or opaque origin. It has no access to host cookies, Pinia, Nuxt internals, DOM, tokens, or unrestricted browser APIs. It communicates using a versioned message protocol.

This is the default and lowest-trust category.

### Standard backend app

Runs TypeScript/JavaScript in a separate Deno runtime with deny-by-default file, network, environment, subprocess, native-addon, and FFI permissions. Hosted execution additionally uses one app/version per constrained container or pod.

Deno permissions reduce ambient authority but are not a complete hostile-code boundary. Hosted production deployments require OS/container isolation as well.

### Privileged/native app

Requires broad Node.js, native-addon, subprocess, device, or filesystem access. It is full-trust software and requires a verified publisher, explicit administrator confirmation, and a visibly stronger permission warning. A hosted deployment may disable this category entirely.

## Capability API

Apps use `@basyx/studio-sdk` capabilities rather than host implementation objects. Initial capability families are:

- `studio.aas`: query, mutate, invoke operations, observe active target
- `studio.files`: pick, open, save, and bounded streams
- `studio.http`: permission-controlled requests to declared origins
- `studio.ui`: notifications, commands, panels, and context
- `studio.semantic`: active semantic index and applicability information
- `studio.jobs`: start and observe bounded long-running app tasks
- `studio.views`: contribute widget types and interact with scoped view context

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
