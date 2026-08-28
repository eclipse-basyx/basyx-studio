# BaSyx Studio Documentation

This directory is the central source of product, architecture, decision, and development documentation for BaSyx Studio.

## Recommended reading order

1. [Product requirements](requirements.md)
2. [Architecture overview](architecture/overview.md)
3. [Deployment variants](architecture/deployment-variants.md)
4. [Important mechanism sequences](architecture/mechanisms.md)
5. Relevant architecture topic
6. [Architecture decision records](adr/README.md)

## Product

- [Requirements](requirements.md): traceable product capabilities, priorities, and non-goals

## Architecture

- [Overview](architecture/overview.md): system context, boundaries, shared abstractions, and current gaps
- [Technology stack](architecture/technology-stack.md): pragmatic implementation defaults and qualification gates
- [Deployment variants](architecture/deployment-variants.md): the three primary runtime/data-location combinations
- [Mechanisms](architecture/mechanisms.md): canonical sequence diagrams for authentication, AAS access/copy, packages, views, apps, target switching, and updates
- [Data sources and workspaces](architecture/data-and-workspaces.md): live servers, multiple authenticated targets, and desktop-local AASX behavior
- [Graphical views and dashboards](architecture/views-and-dashboards.md): declarative UI building, AAS bindings, and app widgets
- [Runtime-installable app platform](architecture/app-platform.md): app store, manifests, semantic matching, permissions, and isolation
- [Security](architecture/security.md): BFF, OAuth/OIDC, app capabilities, Electron, and network boundaries
- [Observability](architecture/observability.md): reuse of the BaSyx Go OpenTelemetry/Grafana stack
- [Studio frontend API](api/README.md): OpenAPI 3.1 draft for the versioned UI-to-BFF HTTP/SSE contract
  - [Endpoint overview](api/endpoints.md): focused explanation of the API surface

## Decisions

- [ADR index](adr/README.md): accepted architectural decisions and their consequences

ADRs are normative for architecture. If a later decision changes an accepted ADR, add a superseding ADR instead of rewriting history.

## Development and design

- [Setup guide](../setup.md): PNPM-only bootstrap, dependencies, web, Docker,
  Electron, app-platform, and supply-chain setup
- [Design guidelines](development/design-guidelines.md): interaction and visual conventions established by the current prototypes

## Document authority

The documents have different roles:

- **Requirements** say what the product must achieve.
- **ADRs** say which cross-cutting choices are accepted and why.
- **Architecture documents** explain how the accepted decisions fit together.
- **Development documents** explain how to work with the current repository.
- **Source code** shows current implementation progress, which may lag behind the target architecture.

When documents disagree, use the order above and open a documentation correction with the implementation change.
