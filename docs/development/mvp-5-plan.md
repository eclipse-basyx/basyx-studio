# MVP-5 plan: AAS and submodel editor

- Status: Implemented 2026-10-14 (see [implementation status](#implementation-status));
  decisions settled on 2026-10-14 (see [settled questions](#settled-questions))
- Date: 2026-10-14
- Depends on: [MVP-4](mvp-4-plan.md) (implemented), the MVP-2 write path
  ([ADR 0013](../adr/0013-revision-tokens-and-conditional-writes.md),
  [ADR 0014](../adr/0014-workspace-worker-and-package-engine.md)) and the
  generic edit area of MVP-4 (T3)
- Scope decision gate: Studio replaces the BaSyx AAS Web UI editor, so AAS
  content can be created and maintained in Studio on live targets and in AASX
  packages (PROD-001, PROD-004, DEP-004)

## Goal

Studio becomes the place where AAS content is authored, not only viewed and
tuned (PROD-001, PROD-004):

> a user switches to edit mode → creates a shell with the creation wizard
> (identity, asset, submodels from templates) or creates an instance from a
> type shell → adds, edits, reorders, copies and deletes submodels and
> elements of every type in the tree and the details drawer → sees findings
> from AAS Core before applying → applies, and a conflicting, forbidden or
> invalid change keeps the draft and explains why → on a desktop package,
> undoes and redoes changes and saves; on a live target, registries and
> discovery follow the change according to the sync setting

The Web UI defines the functional bar: what its editor can create and change
(AAS, submodels, every submodel element type, qualifiers, embedded data
specifications, JSON insert, copy and paste, instance conversion, the creation
wizard) must be possible in Studio. The interaction follows Studio's MVP-4
layout, not the Web UI's dialogs: the tree is the structure, the details
drawer is the form.

## Starting point

What MVP-2 and MVP-4 provide:

- **Write path:** `AasTarget.setElementValue` and `replaceAttachment` on live
  targets and workspaces, opaque revision tokens (`h.<hash>` of the element as
  read), `If-Match`, `revision_conflict` with the current value,
  `precondition_required`, `validation_failed` with AAS Core violations
  (`server/lib/aas/values.ts`).
- **UI:** the global View/Edit toggle (UX-006); `ElementEditArea.vue` chooses
  one editor per model type, today `ElementValueEditor.vue` for `Property` and
  `MultiLanguageProperty`; drafts per target, submodel and element in
  `app/stores/drafts.ts`; the unsaved state of workspaces (UX-005).
- **Structure changes that exist:** deleting a shell (with registry and
  discovery sync, `server/lib/aas/sync.ts`) and uploading an environment.
- **Workspaces:** `WorkspaceModel` holds the environment as JSON in the
  Workspace Worker; Save and Save As write the package; no new packages, no
  attachments beyond replacing File contents.
- **Apps:** `studio.aas.setElementValue` through the capability bridge.

What the BaSyx AAS Web UI editor offers (`src/components/EditorComponents`,
`src/pages/modules/AASCreationWizard`, `AasImporter.vue`, `main` of
2026-10-05):

| Area | Web UI |
| --- | --- |
| Shell | Create and edit: id (generated IRI or custom), idShort, display name, description, category, administrative information, `derivedFrom`, asset kind, global asset ID, specific asset IDs, asset type, default thumbnail, embedded data specifications; delete; download |
| Submodel | Create and edit: id, idShort, display name, description, category, kind, semantic ID, supplemental semantic IDs, administrative information, qualifiers, embedded data specifications; delete reference or submodel; insert from JSON; paste |
| Elements | Create and edit forms for Property, MultiLanguageProperty, Range, File, Blob, ReferenceElement, RelationshipElement, AnnotatedRelationshipElement, Entity, SubmodelElementCollection, SubmodelElementList; Operation variables via JSON and reordering; insert from JSON; copy (also as reference) and paste; delete |
| Instances | *Create instance from type* (a copy with an ID suffix, asset kind and submodel kind `Instance`); *Convert submodel to instance* (removes template qualifiers) |
| Wizard | Steps for asset information, Digital Nameplate, Technical Data and Handover Documentation from four bundled IDTA template files, with cardinality handling and file uploads |
| Importer | Copies a shell with its submodels and concept descriptions from one infrastructure to another |

## Decisions

Made on 2026-10-14; W5, W8, T1 and T3 and the scope were settled in the
[settled questions](#settled-questions).

### Editing surface

| # | Topic | Decision |
| --- | --- | --- |
| U1 | Where forms live | In the details drawer's edit area (MVP-4 T3), not in modal dialogs. Selecting a node in edit mode shows its form; the drawer can be widened for long forms. Dialogs only for confirmations, the creation wizard, JSON insert and instance creation. |
| U2 | Form structure | One form per model type, composed from shared sections: *Identity* (idShort, display name, description, category), *Semantics* (semantic ID, supplemental semantic IDs), *Value* (type-specific), *Qualifiers*, *Data specifications* (IEC 61360), *Extensions* (read-only in this MVP). Sections the type does not have are absent. Shared inputs (language strings, references, qualifiers, value types) are components of their own, reused by every form. |
| U3 | Tree actions | In edit mode only: a row menu with *Add element* (type picker filtered by what the parent may contain), *Insert from JSON*, *Copy*, *Paste*, *Duplicate*, *Move up/down* (lists and collections), *Delete*; on submodel roots also *Convert to instance*. The same actions in the ⌘K palette for the selected node. View mode shows none of them (UX-006). |
| U4 | New nodes | *Add element* creates a draft node in the tree, marked as unsaved, with its form open; it is written on *Apply* and disappears on *Discard*. Defaults: idShort derived from the type and unique among siblings; for list children, the list's `typeValueListElement` and `valueTypeListElement`. |
| U5 | Shell and submodel metadata | The shell header gets *Edit* in edit mode, which opens the shell form in the drawer; submodel roots open the submodel form. |
| U6 | Delete | Confirmation naming what is removed (UX-003). Removing a submodel from a shell asks whether to delete the submodel too (only that choice, as in the Web UI); deleting a shell keeps its submodels unless the user selects them. |

### Write model

| # | Topic | Decision |
| --- | --- | --- |
| W1 | Granularity | The Studio API writes whole resources, not field patches: a shell without submodel references, a submodel without elements, an element without its children. Containers keep their children; the BFF merges the current children into the write. Values keep their own route (`…/value`) for apps and the quick editor. |
| W2 | Structure revisions | Element writes use the element's revision as today. Structural changes (add, delete, reorder, rename) are based on a **structure revision** of the parent: a hash of its children's idShorts, model types and order, not their values. So a value edit elsewhere never blocks adding an element, while two users adding the same idShort or reordering the same list conflict. Amends ADR 0013 (new ADR). |
| W3 | Renaming | An idShort change is a structural change of the parent (W2) and changes the element's path. The BFF writes the element under the new idShort and removes the old one where the server cannot rename in place (phase 0 measures BaSyx Go); drafts, the selection and the URL follow the new path. Renaming list children is not possible (they have no idShort). |
| W4 | Multi-resource writes | Creating a shell with submodels, adding a submodel to a shell, instance creation and deleting with submodels touch several resources. Order: submodels first, then the shell or reference, then registries and discovery (MVP-4 I5). Each step reports its outcome as in uploads (`SyncStep`); a failure stops later steps and is never reported as atomic (as DATA-014). No automatic rollback on live targets. |
| W5 | Identifiers | New shells and submodels get a generated ID from the infrastructure's ID scheme, set by the administrator with the infrastructure: an IRI prefix (default `https://example.com/ids/`) plus type and UUID, as the Web UI's `generateIri`, or a `urn:uuid:`. Users may replace the generated ID with their own per resource; there is no per-user scheme. Workspaces use `urn:uuid:` unless the user types an ID. A collision is refused with `identifier_conflict` before anything is written. |
| W6 | Validation | AAS Core on the server is authoritative (ADR 0006, DATA-007): the element, and for structural changes the parent, are verified; violations come back with paths that the form maps to fields. The browser loads the same `aas-core3.1` package lazily in edit mode for field findings while typing; the bundle size is measured in phase 0, and if it is too large, only the server check remains. |
| W7 | Drafts | Form drafts stay per target and node in Pinia (ADR 0006), extended from values to whole nodes and draft nodes (U4). Navigating away keeps them; the rail and the shell list show that a target has drafts. Applying is per node; *Apply all* is not offered in this MVP. |
| W8 | Undo and redo | On workspaces, the Worker keeps an operation log with inverse operations; ⌘Z and ⇧⌘Z undo and redo applied changes until Save or Close. On live targets there is no undo after apply: other users may have changed the data, and an inverse write would hide that. Draft edits in forms have local undo through the form fields. |

### Templates, instances and the wizard

| # | Topic | Decision |
| --- | --- | --- |
| T1 | Template sources | Submodel templates come from (a) the four IDTA templates the Web UI bundles (Digital Nameplate, Technical Data, Handover Documentation, Contact Information), shipped with Studio and versioned with it, (b) submodels with `kind: Template` on the active target, and (c) a JSON or AASX file. A template registry or the IDTA repository online comes later. |
| T2 | Instantiation | Creating a submodel from a template copies it with a new ID, `kind: Instance`, template qualifiers removed (`SMT/Cardinality`, `SMT/Multiplicity` and the Web UI's set) and optional elements (cardinality `ZeroToOne`, `ZeroToMany`) left out unless selected. Ported from the Web UI's `SubmodelTemplateConversion` and `cardinalityUtils`, in `shared/aas/` so the BFF and the Worker share it. |
| T3 | Creation wizard | Core feature (MVP-3 classification), as a dialog from the shell list: *Shell and asset* (ID, idShort, display name, asset kind, global and specific asset IDs, thumbnail) → *Submodels* (pick templates, fill required elements in one generic form driven by the template's structure and cardinality, the same for every template) → *Review* (findings, IDs, what will be written) → create (W4). The Web UI's template-specific steps (Nameplate, Technical Data, Handover Documentation) are not ported; the bundled apps edit those submodels after creation. |
| T4 | Instance from type | *Create instance* on a shell with `assetKind: Type`: a new shell with `derivedFrom` pointing to the type, `assetKind: Instance`, the selected submodels copied with new IDs and `kind: Instance` (T2). The Web UI's ID suffix becomes a proper new ID (W5). |
| T5 | Convert to instance | On a submodel with `kind: Template`: removes template qualifiers in place, after confirmation (UX-003), as the Web UI does. |

### Clipboard and JSON

| # | Topic | Decision |
| --- | --- | --- |
| C1 | Copy and paste | Copy puts the node as AAS JSON on the system clipboard (`application/json` text) and in a Studio clipboard store; paste validates it with AAS Core and inserts it under the selected parent, renaming the idShort on collision (`_copy`, `_copy2`). Works across submodels, shells and targets, because the content is plain AAS JSON. File contents are not copied across targets in this MVP; the File keeps its path and the paste reports it. |
| C2 | Copy as reference | *Copy reference* puts a model reference to the node on the clipboard, for pasting into reference fields (as the Web UI's *copy as ref*). |
| C3 | Insert from JSON | A dialog with the code view of MVP-4 (Monaco), validating with AAS Core while typing; for submodels and elements. |

### Targets and packages

| # | Topic | Decision |
| --- | --- | --- |
| P1 | Capabilities | `write` splits into `writeValues` (today's ability) and `writeStructure` (this MVP). A target that refuses structural writes (permissions, or a server without the needed endpoints) still allows value edits. The shell rights of MVP-4 decide per shell. |
| P2 | Live targets | Through `basyx-typescript-sdk` for every write (`postSubmodelElement`, `putSubmodelElementByPath`, `deleteSubmodelElementByPath`, `postSubmodelReference`, `deleteSubmodelReferenceById`, `postAssetAdministrationShell`, `putAssetAdministrationShellById`, `postSubmodel`, `putSubmodelById`); gaps are reported upstream first, as for MVP-4. |
| P3 | Workspaces | The Worker implements the same operations on its model, checks the structure revision and writes in one step (`strong`). New attachments for File elements and thumbnails are added to the package (`/aasx/…`) with DATA-006 limits. |
| P4 | New package | *File → New package* on desktop creates an empty workspace, which Save turns into an AASX through Save As. Opening Studio with no package offers it next to *Open*. |
| P5 | Registry sync | Creating and deleting shells and submodels writes and removes descriptors and asset links according to I5 of MVP-4, with per-resource results. Changing a shell's global or specific asset IDs updates its asset links. |
| P6 | Apps | The bridge keeps `studio.aas.setElementValue` only. Structural writes for apps come with the Apps MVP, when a consumer needs them (ARCH-005). |

### Quality

| # | Topic | Decision |
| --- | --- | --- |
| Q1 | Quality bar | As MVP-4 Q1: hosted web and packaged Electron, AASX workspaces, lint, typecheck, unit, integration and e2e tests, at least one e2e test per feature, screenshots in the results. |
| Q2 | Round trip | Every element type of the fixtures can be created, edited, copied, pasted and deleted on a live target and in a workspace, and survives export and re-import unchanged (normalized JSON). |

## Design

### Edit mode layout

```text
┌ app bar: ··· target ▾ · View|[Edit] · ●2 drafts ············ account ┐
├────┬──────────────┬───────────────────────────────┬─────────────────────┤
│rail│ shell list   │ shell header        [Edit] ⋮  │ details drawer      │
│    │ [+ New shell]│ [Submodels|Overview|…]        │ Property · MaxTorque│
│    │              │ ┌ filter · ⊞ ⊟ · [+ Submodel]┐│ ▸ Identity          │
│    │              │ │ ▾ 📂 TechnicalData      ⋮   ││ ▸ Semantics         │
│    │              │ │    ⓟ MaxTorque  40 Nm ● ⋮  ││ ▾ Value             │
│    │              │ │    ⓟ NewProperty  (draft)   ││   valueType, value  │
│    │              │ │    + Add element            ││ ▸ Qualifiers        │
│    │              │ └─────────────────────────────┘│ ▸ Data specs        │
│    │              │                               │ findings            │
│    │              │                               │ [Discard] [Apply]   │
└────┴──────────────┴───────────────────────────────┴─────────────────────┘
```

`●` marks a node with a draft; *(draft)* marks a node that does not exist yet.

### Code structure

- `shared/aas/defaults.ts`: new nodes per model type (U4).
- `shared/aas/templates.ts`: template instantiation, cardinality, template
  qualifiers (T2), shared by the BFF and the Worker.
- `shared/aas/identifiers.ts`: ID generation (W5).
- `server/lib/aas/edits.ts`: the write operations on JSON nodes, merging
  children (W1), AAS Core verification (W6), structure revisions (W2);
  `values.ts` becomes part of it.
- `server/lib/targets/revision.ts`: structure revisions next to element
  revisions.
- `server/lib/workspaces/model.ts`: the same operations and the undo log (W8).
- `server/lib/templates/`: the bundled IDTA templates as server assets (T1).
- `app/components/editor/`: forms per model type and shared inputs (U2).
- `app/stores/drafts.ts`: whole-node drafts and draft nodes (W7);
  `app/stores/clipboard.ts` (C1).

## Studio API

Changes against MVP-4. Every write takes `If-Match` with the element or
structure revision it is based on and returns the new detail with `ETag`.

| Method and path | Purpose |
| --- | --- |
| `POST /targets/{id}/shells` | Create a shell, optionally with new submodels (wizard, W4); returns the steps |
| `PUT /targets/{id}/shells/{shellKey}` | Shell metadata and asset information (W1) |
| `POST /targets/{id}/shells/{shellKey}/instances` | Instance from type (T4) |
| `POST /targets/{id}/shells/{shellKey}/submodel-refs` | Add a new submodel (empty, from a template, or JSON) or reference an existing one |
| `DELETE /targets/{id}/shells/{shellKey}/submodel-refs/{submodelKey}?deleteSubmodel=` | Remove a reference, optionally with the submodel (U6) |
| `PUT /targets/{id}/submodels/{key}` | Submodel metadata (W1) |
| `POST /targets/{id}/submodels/{key}/instance-conversions` | Convert to instance (T5) |
| `POST /targets/{id}/submodels/{key}/elements` | Add an element at the top level or under `parent`, with `index` for lists; `If-Match` with the parent's structure revision |
| `PUT /targets/{id}/submodels/{key}/elements/{elementKey}` | Element metadata and value, including an idShort change (W3) |
| `DELETE /targets/{id}/submodels/{key}/elements/{elementKey}` | Delete an element |
| `POST /targets/{id}/submodels/{key}/elements/{elementKey}/moves` | Reorder within its parent (`index`) |
| `GET /targets/{id}/templates` | Submodel templates: bundled, on the target (T1) |
| `GET /submodel-templates/{templateId}` | A bundled template |
| `POST /workspaces` | Also `{ empty: true }` for a new package (P4) |
| `POST /workspaces/{id}/undos`, `/redos` | Workspace undo and redo (W8) |
| Element and submodel details | `structureRevision` next to `revision` |
| Capabilities | `writeValues`, `writeStructure` (P1), `undo` |
| Problems | `identifier_conflict`, `idshort_conflict`, `structure_conflict` (412 with the current children), `partial_write` (with steps), `template_invalid` |

`openapi.yaml` and `endpoints.md` are updated with the implementation.

## Definition of done

Run in hosted web (Chromium) and the packaged Electron app against the test
environment.

1. **Element forms.** Every submodel element type has a form with the
   sections of U2; editing each field of each type on the fixtures applies,
   reloads with the stored value, and shows AAS Core findings on the field
   (for example a `Range` with min above max, an invalid `valueType` value, a
   list child of the wrong type).
2. **Create and delete.** In edit mode, an element of every type is added
   under a submodel, a collection and a list (at an index), and deleted after
   confirmation; view mode shows none of it.
3. **Rename and reorder.** Renaming an element keeps its subtree, moves the
   selection and URL, and refuses a duplicate idShort; list and collection
   children move up and down.
4. **Shells and submodels.** Shell metadata, asset information and thumbnail,
   and submodel metadata are edited; a submodel is added (empty, from a
   template, from JSON) and removed with or without deleting it.
5. **Wizard.** A shell with Digital Nameplate and Technical Data from the
   bundled templates is created on the registry-based target, opens in the
   viewer, and its descriptors and asset links follow the sync setting.
6. **Instances.** An instance is created from a type shell with
   `derivedFrom` and new IDs; a template submodel is converted to an instance.
7. **Clipboard and JSON.** An element is copied and pasted into another
   submodel and into a workspace; a submodel and an element are inserted from
   JSON, invalid JSON is refused with findings; a reference is copied and
   pasted into a reference field.
8. **Conflicts.** Two sessions: a value edit in one does not block adding an
   element in the other; adding the same idShort or deleting an edited
   element conflicts and keeps the draft; a forbidden structural write
   explains why and keeps the draft.
9. **Partial writes.** When a step of a multi-resource write fails (forced in
   an integration test), the result lists what was written and what was not.
10. **Workspaces.** Criteria 1–4, 6 and 7 hold in a desktop workspace; undo
    and redo work until Save; a new package is created and
    saved; a File attachment is added and survives Save and reopen.
11. **Round trip.** Q2 on live targets and workspaces.
12. **Drafts.** Drafts survive navigation, are marked in the tree and the app
    bar, and a draft node disappears on discard.
13. **Parity list.** Every feature of the Web UI editor, wizard and importer
    is listed as done, later or dropped, with a reason.

## Phases

| Phase | Content | Exit |
| --- | --- | --- |
| 0. Measurements | BaSyx Go behaviour for renames, list inserts at an index, `PUT` on containers (do children survive?), ETags on `POST` and `DELETE`, identifier collisions; SDK coverage of P2 with upstream tickets for gaps; `aas-core3.1` browser bundle size (W6) | Recorded results; tickets |
| A. Write model | `server/lib/aas/edits.ts`, structure revisions, the new `AasTarget` and Worker operations, routes, capabilities, problems; new ADR amending 0013 | Integration tests for every operation on both target kinds |
| B. Forms | Shared inputs and one form per model type in the edit area; drafts for whole nodes | DoD 1, 12 |
| C. Structure | Tree actions, draft nodes, delete, rename, reorder, shell and submodel forms | DoD 2–4, 8 |
| D. Clipboard | Copy, paste, copy as reference, insert from JSON | DoD 7 |
| E. Templates and wizard | Bundled templates, instantiation, wizard, instance from type, convert to instance, registry sync | DoD 5, 6, 9 |
| F. Workspaces | Undo log, new package, attachments | DoD 10 |
| G. Wrap-up | Round-trip suite, e2e per feature, desktop e2e, screenshots, parity list, ADRs, requirements, design guidelines, `openapi.yaml` | DoD 11, 13 |

A needs 0; B and C need A; D needs C; E needs A and B; F needs A and C.

## ADRs to write

- Structure revisions and structural writes (W1–W4), amending
  [ADR 0013](../adr/0013-revision-tokens-and-conditional-writes.md).
- Identifier generation per infrastructure (W5).
- Submodel template sources and instantiation (T1, T2).
- Workspace undo log (W8).

## Known risks

| Risk | Mitigation |
| --- | --- |
| BaSyx Go cannot rename in place or insert into a list at an index, so W3 and list moves need delete-and-insert, which is not atomic on live targets | Measure in phase 0; write the new node before removing the old one; report steps; upstream tickets |
| `PUT` on a container replaces its children, so a metadata write could drop children added concurrently | Merge children from a fresh read under the structure revision (W1, W2); integration test with concurrent adds |
| Twelve forms with shared sections grow large and inconsistent | Shared section components first (phase B); one form per type stays thin; Web UI forms as the field checklist, not as code to copy |
| AAS Core in the browser is too large | Lazy load in edit mode only; fall back to server findings (W6) |
| Multi-resource writes leave half-created shells on live targets | Submodels first, shell last, steps reported, the user can delete leftovers from the result |
| IDTA templates change versions | Templates are versioned assets with their semantic IDs; a later template registry replaces bundling |
| Large submodels make the structure revision costly | The hash covers one parent's direct children only |

## Out of scope

Cross-target copy of whole shells (the Web UI's importer, DATA-012 to
DATA-015), which gets a Transfer MVP of its own; creating and editing concept
descriptions; editing extensions; structural writes for apps
(P6); collaborative editing and presence (DATA-010); live undo; file previews;
the ABAC editor; Catena-X descriptor editing; a template registry or the IDTA
repository online.

## Implementation status

Implemented 2026-10-14. ADRs [0027](../adr/0027-structure-revisions-and-structural-writes.md),
[0028](../adr/0028-identifier-generation-per-infrastructure.md),
[0029](../adr/0029-submodel-templates-and-instantiation.md) and
[0030](../adr/0030-workspace-undo-log.md) record the decisions.

Phase 0 measurements (BaSyx Go, test environment):

| Question | Result |
| --- | --- |
| Rename in place | `PUT` of the parent's children renames atomically and keeps the subtree (W3 uses this, not delete and insert). |
| Insert into a list at an index | A `PUT` of the list with the new item at the index keeps the order. |
| `PUT` on containers | The children in the body replace the stored ones; children added concurrently are protected by the structure revision and the `ETag`. |
| Order of named children | BaSyx Go returns them by name whatever order they were written in, so only list items can be moved (`orderedChildren` capability is false). |
| ETags on writes | `PUT` of a submodel or element honours `If-Match`; the 412 of an unrelated change is retried. |
| Identifier collision | `POST` of an existing shell or submodel answers 409, mapped to `identifier_conflict`; Studio checks first. |
| `aas-core3.1` in the browser | Not loaded: findings come from the server (`POST /validations` while typing in the JSON dialog, and on apply). |

| Plan item | Status |
| --- | --- |
| W1, W2, W3, W6 write model | Done on both target kinds (ADR 0027) |
| W4 multi-resource writes | Done: submodels, shell, registries; `partial_write` with steps; no rollback |
| W5 identifiers | Done per infrastructure (admin dialog), `urn:uuid:` for workspaces |
| W7 drafts | Whole-element, submodel and shell drafts; marked in the tree; count in the app bar; the new element is a draft row |
| W8 undo and redo | Workspaces: ⌘Z, ⇧⌘Z and buttons until Save or Close |
| U1–U6 editing surface | Done: forms in the drawer, row menu and palette actions, delete confirmations, shell and submodel forms |
| T1–T5 templates | Done: bundled IDTA templates, Template-kind submodels on the target, JSON; wizard, instance from type, convert to instance |
| C1–C3 clipboard and JSON | Done; the paste renames to `_copy`, `_copy1`, … |
| P1 capabilities | `writeStructure`, `createResources`, `orderedChildren`, `undo` |
| P3, P4 workspaces | Done: undo log, new package (*Save as* gives it a file), new File attachments, thumbnail |
| P5 registry sync | Done on create, add and remove; asset links follow shell edits |
| P6 apps | Unchanged: `studio.aas.setElementValue` only |

### Parity list (DoD 13)

Web UI editor, wizard and importer features:

| Web UI feature | Status |
| --- | --- |
| Create and edit shell: ID (generated or custom), idShort, display name, description, category, administration, `derivedFrom`, asset kind, global and specific asset IDs, asset type, thumbnail | Done |
| Shell embedded data specifications | Done in [MVP-6](mvp-6-plan.md) (shared IEC 61360 section) |
| Delete shell, download | Done earlier (MVP-4) |
| Create and edit submodel: ID, idShort, display name, description, category, kind, semantic ID | Done |
| Submodel supplemental semantic IDs, administration, qualifiers, embedded data specifications | Done; embedded data specifications in [MVP-6](mvp-6-plan.md) |
| Delete submodel reference or submodel; insert from JSON; paste | Done |
| Element forms for Property, MultiLanguageProperty, Range, File, Blob, ReferenceElement, (Annotated)RelationshipElement, Entity, SubmodelElementCollection, SubmodelElementList, BasicEventElement, Capability, Operation | Done (identity, semantics, value, qualifiers) |
| Operation variables via JSON and reordering | Later |
| Element supplemental semantic IDs, embedded data specifications, extensions | Supplemental semantic IDs and embedded data specifications done in [MVP-6](mvp-6-plan.md); extensions later (read-only by plan) |
| Insert element from JSON; copy, copy as reference, paste; delete | Done |
| Create instance from type; convert submodel to instance | Done |
| Creation wizard with template steps | Done as one generic form; the template-specific steps are dropped (T3) |
| File uploads in the wizard | Later: files are added to File elements after creation |
| Importer (copy a shell with submodels and concept descriptions between infrastructures) | Later: a Transfer MVP (settled question 2) |
| Concept description editing | Done in [MVP-6](mvp-6-plan.md) |

## Settled questions

Decided on 2026-10-14; each follows the plan's recommendation.

| # | Question | Decision |
| --- | --- | --- |
| 1 | Undo and redo | Workspaces only (W8): the Worker's operation log with ⌘Z and ⇧⌘Z until Save or Close; no undo after apply on live targets. |
| 2 | Importer and cross-target copy | A Transfer MVP of its own with the copy plan, collision policy and idempotent retry of DATA-012 to DATA-015. The parity list records the importer as *later*. |
| 3 | Template sources | The four IDTA templates bundled with Studio, Template-kind submodels on the target, and JSON or AASX files (T1). |
| 4 | Wizard steps | One generic form driven by the template; the Web UI's template-specific steps are not ported (T3). |
| 5 | ID scheme | Per infrastructure, set by the administrator; users may replace a generated ID per resource (W5). |
| 6 | Concept descriptions | Out of scope; read-only as in MVP-4. |

## After MVP-5

- Transfer MVP: cross-target copy of shells with their submodels, concept
  descriptions and attachments (DATA-012 to DATA-015), replacing the Web UI's
  importer.
- Concept description editing, including creating one from an element's
  semantic ID: done in [MVP-6](mvp-6-plan.md).
- Structural writes for apps (P6), when an app needs them.
