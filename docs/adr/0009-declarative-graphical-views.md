# 0009: Declarative graphical views and app widgets

- Status: Accepted
- Date: 2026-08-25
- Deciders: BaSyx Studio maintainers
- Requirements: PROD-006, VIEW-001 through VIEW-012, APP-016

## Context

Users need to build AAS-specific dashboards and focused user interfaces without
writing frontend code. Widgets must bind to live or package-backed AAS data and
installed apps must be able to contribute reusable visual components. Generated
source code or arbitrary scripting would be difficult to validate, migrate,
authorize, and safely combine with third-party apps.

## Decision

Implement the builder and renderer as Studio UI modules backed by the existing
Studio Service. Persist a versioned declarative JSON view definition containing
layout, widget instances, configuration, and AAS binding descriptors. Validate
portable definitions and app contribution schemas with JSON Schema/Ajv.

Support exact instance bindings and semantic context-relative bindings. Resolve
all bindings through the existing target router and AAS capability API. Reads,
writes, and operation invocations remain subject to current user permissions and
do not inherit authority from the definition.

Built-in widgets are trusted Studio components. Apps contribute widget types in
their existing signed manifest and execute those widgets through the ordinary
cross-origin app sandbox and Studio SDK RPC bridge. Embedding a widget does not
install the app, approve permissions, or weaken isolation.

Use the same renderer for authoring preview and runtime. Store hosted definitions
in PostgreSQL and desktop definitions in SQLite. Do not add a dashboard service,
another datastore, arbitrary scripting runtime, or separate event system.

## Consequences

- Definitions can be validated, migrated, shared, imported, and inspected
  without executing author code.
- Semantic bindings allow later reusable templates without making them an MVP
  prerequisite.
- App widgets reuse the marketplace, compatibility, permissions, and sandbox
  architecture.
- Missing apps or bindings can degrade individual widgets with diagnostics.
- The first vertical slice must prove the definition schema before a public
  `@basyx/studio-view-schema` package is extracted.
- A layout/drag-and-drop library remains a qualified implementation choice, not
  an architectural dependency.

## Alternatives considered

- **Generate Vue source:** rejected because round-trip visual editing, migrations,
  security review, and compatibility would become source-transformation problems.
- **Store arbitrary JavaScript expressions:** rejected because they create an
  additional untrusted execution platform and obscure data access.
- **Run app widgets as ordinary core components:** rejected because it would
  bypass the app isolation boundary.
- **Deploy a separate dashboard/low-code platform:** rejected because the feature
  can reuse existing Studio UI, persistence, targets, and app capabilities.
