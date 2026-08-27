# 0004: Runtime-installable apps

- Status: Accepted
- Date: 2026-08-24
- Deciders: BaSyx Studio maintainers
- Requirements: APP-001 through APP-015, SEC-004 through SEC-008

## Context

Third parties must be able to publish apps that users or deployment
administrators install without rebuilding Studio. Apps may provide UI, perform
AAS operations, call third-party services, use user-approved files, and reuse
stable Studio functionality. An npm-like arbitrary dependency model inside the
trusted Studio process would turn installation into remote code execution.

## Decision

Build a central marketplace with immutable signed artifacts, compatibility
metadata, automated checks, and a review path. Installation is deployment-scoped
for hosted Studio and user/machine-scoped for desktop. Visibility and activation
can additionally be restricted per user or role.

Support three explicit app classes:

1. UI apps in sandboxed cross-origin iframes, communicating through a versioned
   Studio SDK RPC bridge.
2. Standard backend apps in isolated runners with a constrained runtime and
   capability APIs. Deno is the preferred first evaluation because deny-by-
   default file/network permissions align with the model.
3. Privileged/native apps only through a higher-trust, administrator-approved
   path with stronger review and process/container isolation.

Apps declare capabilities, semantic requirements, compatible Studio/API ranges,
and dependencies in a JSON manifest. Validate the public manifest with JSON
Schema. Semantic applicability uses AAS semantic IDs and target capabilities;
it complements, but does not replace, security policy.

Apps may also declare graphical-builder widget contributions with configuration
schemas and typed AAS binding slots. These widgets reuse the same sandboxed UI
entry point and capability bridge; embedding them in a view never turns them into
trusted Studio components.

Do not allow arbitrary app dependencies to be installed into the Studio Service
at runtime. Marketplace builds lock, scan, and bundle dependencies into the
immutable app artifact. Shared Studio functions are exposed as versioned
capabilities instead of inherited in-process packages.

## Consequences

- Runtime installation does not mutate or restart the core Studio Service.
- Capability tokens provide least authority and an auditable app identity.
- UI apps need a separately hosted app origin in web deployment.
- Backend app isolation, resource quotas, network egress, lifecycle supervision,
  and compatibility testing become platform responsibilities.
- Apps requiring unrestricted Node native modules follow a visibly higher-trust
  path; they cannot silently opt out of isolation.
- Marketplace signing establishes provenance, not correctness, so runtime
  isolation remains mandatory.

## Alternatives considered

- **Nuxt/Vite module federation into the main page:** useful for trusted
  organization-owned modules, but not a security boundary for arbitrary
  publishers.
- **Node packages loaded in the Studio process:** rejected because dependency
  installation and module execution have the authority of the BFF.
- **WebAssembly only:** strong portability and isolation potential, but too
  restrictive as the sole initial ecosystem. It remains an optional future app
  runtime.
