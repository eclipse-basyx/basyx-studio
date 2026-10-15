# 0030: Workspace undo log

- Status: Accepted
- Date: 2026-10-14
- Deciders: BaSyx Studio maintainers
- Requirements: UX-005

## Context

Applied changes to an AASX workspace are in memory until Save. Users expect to
take them back. On a live infrastructure other users may have changed the data
since, and an inverse write would hide that.

## Decision

- The Workspace Worker keeps an undo and a redo log per workspace (at most 50
  entries). Each applied change is logged as the environment before it; undo
  and redo swap the environment and its revision, so undoing back to the saved
  state clears the unsaved marker.
- Revisions are monotonic: a new change after an undo never reuses the number
  of an undone state.
- The log ends with Save As or Close of the workspace; Save keeps it.
- Live targets have no undo after apply (`undo` capability is false). Edits in
  a form have the field's own undo, and drafts are discarded explicitly.
- Files added to the package by an undone change stay in it as unreferenced
  parts until the package is saved.

## Consequences

- Memory use grows with the environment size times the log length; the limit
  bounds it.
- Undo is whole-environment, not per resource.
