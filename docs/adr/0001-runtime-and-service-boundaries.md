# 0001: Runtime and service boundaries

- Status: Accepted
- Date: 2026-08-24
- Deciders: BaSyx Studio maintainers
- Requirements: DEP-001, DEP-003 through DEP-008, OPS-004

## Context

Studio must use the same product experience in hosted web and installable
desktop deployments. It also needs server rendering and a trusted backend for
credentials, package processing, app management, and privileged capabilities.
Electron is already validated by the prototype and the team is experienced with
Vue, Nuxt, TypeScript, and Node.js.

## Decision

Use Vue, Nuxt, TypeScript, and Node.js. Treat the Nuxt/Nitro application as one
**Studio Service** deployable containing SSR, the core UI delivery path, the BFF,
sessions, target routing, app management, and the capability broker.

For hosted deployment, run the Studio Service as a containerized Node.js
service. For desktop, package Electron as the signed native host and supervise a
loopback-only local Studio Service. Use dynamic ports and a per-launch secret;
do not expose a fixed unauthenticated local endpoint.

Keep justified resource and trust boundaries as separately deployable or
supervised processes:

- local Workspace Worker for desktop AASX editing;
- isolated app asset origin and app runners for installed apps;
- central marketplace services;
- existing live AAS infrastructures such as BaSyx Go.

## Consequences

- Web and desktop reuse the same UI, APIs, contracts, and most business logic.
- SSR and client-credentials flows are available in both product development and
  hosted operation.
- Electron remains a thin native host rather than a second application.
- Package and app failures are isolated from the core Studio Service.
- Deployment diagrams must distinguish these processes; a monolithic repository
  does not imply one runtime process.
- Desktop packaging, process supervision, signing, and migration tests become
  first-class release work.

## Alternatives considered

- **Static SPA only:** rejected because it cannot safely own downstream
  credentials and weakens SSR and app management.
- **Separate web and desktop applications:** rejected because it duplicates the
  product surface and long-term maintenance.
- **Tauri now:** attractive for a smaller host, but it would introduce Rust and a
  second backend ecosystem while the required app model already needs Node or
  another server runtime. It can be reconsidered if measured Electron footprint
  or security constraints justify the migration.
