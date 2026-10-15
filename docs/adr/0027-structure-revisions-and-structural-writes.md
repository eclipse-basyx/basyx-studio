# 0027: Structure revisions and structural writes

- Status: Accepted
- Date: 2026-10-14
- Deciders: BaSyx Studio maintainers
- Amends: [ADR 0013](0013-revision-tokens-and-conditional-writes.md)
- Requirements: PROD-004, DATA-007, DATA-009, UX-005, UX-006

## Context

ADR 0013 bases a write on the revision of one element. Adding, deleting,
moving and renaming elements change the children of a parent, which no single
element revision describes. An element revision would also make two users
conflict whenever one of them edits a value next to the other's insert.

## Decision

- Adding and moving an element are based on the **structure revision** of the
  parent (`s.<hash>`): a hash of its children's idShorts, model types and
  order, not their values. List items have no idShort and share one model
  type, so their content stands in for their identity: a reorder or an
  edited item changes the list's revision. The Studio API returns it as `structureRevision`
  with a container's detail and with every tree level, and takes it as
  `If-Match`.
- Replacing (including a rename) and deleting an element are based on the
  element's own revision (`h.<hash>`), so deleting an element that someone
  else edited conflicts.
- Studio writes whole resources. A form edits an element; a container keeps the
  children it has at write time.
- A live target changes the children of a parent by replacing them in one
  conditional write (`PUT` of the submodel or the container with the `ETag` of
  the read). That keeps an insert at an index, a reorder and a rename atomic
  where the AAS API only appends and deletes. A 412 from an unrelated change
  in the submodel is retried with a fresh read, as in ADR 0013.
- Workspaces check and write in one worker call (`strong`).
- AAS Core verifies the new element on the server. Findings return as
  `validation_failed` with `violations`; a sibling with the same idShort is
  `idshort_conflict`; a changed parent is `structure_conflict`.
- `write` stays the capability for value edits; structural edits need
  `writeStructure`, so a target that refuses them still allows value edits.

## Consequences

- Concurrent adds under one parent conflict only when both ran against the
  same children; a value edit never blocks them.
- A live structural write sends the parent's whole child list. Large containers
  cost more than an append would; measuring BaSyx Go's native insert and
  rename behaviour can replace this per operation without an API change.
- Multi-resource writes (shell with new submodels, instances, deleting with
  submodels) are not part of this decision and remain with the creation wizard.

## Alternatives considered

- Element revision for every structural change: simple, but blocks unrelated
  edits and cannot detect a concurrent insert.
- Native `POST` and `DELETE` per element for live targets: no order control and
  no atomic rename; kept as a later optimization for appends.
