# BaSyx Studio

BaSyx Studio is the next-generation user interface and authoring environment for Asset Administration Shells (AAS). It is intended to replace both the BaSyx AAS Web UI and traditional desktop package-explorer workflows with one understandable product for end users, AAS authors, and operators of live Type 2 shells.

The product has three primary runtime/data variants. A fourth possibility remains
visible only as a deliberately deferred option:

| | Live AAS infrastructure | AASX workspace |
| --- | --- | --- |
| Hosted web deployment | **Primary:** browser users work with remote BaSyx infrastructures through the Studio BFF | **Very low priority:** Studio does not initially implement hosted AASX workspaces. Deploy an existing tool such as the open-source [Meta-Level AAS Suite Community / AAS Designer](https://github.com/meta-level-public/aas-suite-community) separately and reassess Studio integration only if a concrete need remains. |
| Installed desktop deployment | Electron connects through its local BFF to an Internet or localhost/Docker AAS infrastructure | Electron opens, edits, and saves AASX packages on the user's computer |

BaSyx Studio also introduces runtime-installable apps and a graphical builder for AAS-specific views and dashboards. Users compose built-in and app-provided widgets, bind them to instance-specific or semantically compatible AAS data, and reuse the resulting declarative views without writing frontend code. A BaSyx app store adds technical and AAS-semantic compatibility checks that conventional app stores cannot provide.

## Status

This repository is an early implementation and architecture-validation project. The checked-in UI demonstrates selected workflows, but not every documented target component exists yet. In particular, mock data, demo WebSockets, the current persistence configuration, and current Electron process management must not be treated as final architecture.

## Documentation

The central documentation index is [docs/README.md](docs/README.md).

Start with:

- [Product requirements](docs/requirements.md)
- [Architecture overview](docs/architecture/overview.md)
- [Technology stack](docs/architecture/technology-stack.md)
- [Three primary deployment variants](docs/architecture/deployment-variants.md)
- [Important mechanism sequences](docs/architecture/mechanisms.md)
- [Runtime-installable app platform](docs/architecture/app-platform.md)
- [Graphical views and dashboards](docs/architecture/views-and-dashboards.md)
- [Architecture decision records](docs/adr/README.md)
- [Development setup](setup.md)

Coding agents and LLM-based development tools must also follow [AGENTS.md](AGENTS.md).

## Technology direction

- Vue 3, Nuxt 4, Vuetify, TypeScript, and Node.js
- Nitro as the Studio backend-for-frontend (BFF)
- Electron for the installed desktop product
- `basyx-typescript-sdk` for live AAS client operations
- PostgreSQL for hosted Studio persistence and SQLite for desktop metadata
- OpenTelemetry and the existing BaSyx Grafana observability stack
- Pinia for client/editor state; Pinia Colada only for complex shared remote state
- Zod for Studio-owned TypeScript trust boundaries; AAS Core verification for AAS models

These are summarized here for orientation. Accepted decisions and their consequences are recorded under [docs/adr](docs/adr).

## Development

The project uses PNPM exclusively. Other package managers and lockfiles are not
supported:

```sh
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm dev
```

Run the current checks with:

```sh
pnpm lint
pnpm typecheck
```

Desktop, container, PNPM, and supply-chain workflows are documented in
[setup.md](setup.md).
