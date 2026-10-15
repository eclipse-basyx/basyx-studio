# 0028: Identifier generation per infrastructure

- Status: Accepted
- Date: 2026-10-14
- Deciders: BaSyx Studio maintainers
- Requirements: PROD-004, DATA-007

## Context

Creating shells, submodels and instances needs identifiers. The BaSyx Web UI
generates IRIs from a fixed prefix. An organisation wants its own scheme, and a
user working in an AASX package has no infrastructure to name one.

## Decision

- The administrator sets the scheme with the infrastructure (`sync.idScheme`,
  `sync.idPrefix`): an IRI `<prefix><kind>/<uuid>` with the kind `aas`, `sm` or
  `asset`, or `urn:uuid:<uuid>`. The default prefix is
  `https://example.com/ids/`.
- Workspaces use `urn:uuid:` unless the user types an ID.
- A user may replace a generated ID per resource (the wizard's ID field, the
  JSON of an inserted submodel). There is no per-user scheme.
- A new shell or submodel is checked against the target before the first
  write; a collision is `identifier_conflict` and nothing is written. A
  create call that answers 409 is mapped the same way.
- Generation lives in `shared/aas/identifiers.ts`, so the BFF and the
  Workspace Worker use the same code.

## Consequences

- IDs are unique in practice by UUID; the check protects against typed IDs.
- Changing the scheme affects only resources created afterwards.
