# MVP-6 plan: concept descriptions and data specifications

- Status: Implemented 2026-10-15 (see [implementation status](#implementation-status))
- Date: 2026-10-15
- Depends on: [MVP-5](mvp-5-plan.md) (implemented): its form pattern
  (`*Fields` and `*Form` components, `FormSection`, drafts, `FormActions`),
  its write model ([ADR 0027](../adr/0027-structure-revisions-and-structural-writes.md)),
  identifier generation ([ADR 0028](../adr/0028-identifier-generation-per-infrastructure.md))
  and the workspace undo log ([ADR 0030](../adr/0030-workspace-undo-log.md))
- Scope decision gate: concept descriptions are created and maintained in
  Studio as submodels are, and one IEC 61360 data specification form serves
  concept descriptions, shells, submodels and elements

## Goal

Close the two gaps MVP-5 left in its parity list: concept description
editing (settled question 6) and embedded data specifications on shells,
submodels and elements.

> in edit mode, a user opens the *Concepts* page → selects a concept
> description in the table, and the details drawer shows it (*Details*,
> *JSON*, *XML*) with its form → edits names, definition, unit and data type
> in the IEC 61360 section and applies; or creates a new one, empty or from
> JSON → from an element whose semantic ID has no concept description,
> creates one prefilled from the element → sees the resolved concept
> description in every Semantics section and opens it from there → adds the
> same IEC 61360 data specification to a shell, submodel or element with the
> same section

## Starting point

- **Concepts page** (`app/pages/targets/[targetId]/concepts.vue`): a
  read-only table of up to 1,000 concept descriptions with search, source
  chips (ECLASS, IEC CDD, IDTA), hidden empty columns (MVP-4 D18) and an
  expandable definition. Data comes from `GET …/concept-descriptions`
  (`ConceptDescriptionSummary`); there is no route for one concept
  description, no details drawer and no deep link.
- **Targets:** `AasTarget.conceptDescriptions` lists them; the live target
  uses the SDK's `ConceptDescriptionRepositoryClient`, which also offers
  `getConceptDescriptionById`, `postConceptDescription`,
  `putConceptDescriptionById` and `deleteConceptDescriptionById`. Workspaces
  hold them in `environment.conceptDescriptions`. Capability:
  `conceptDescriptions` (read).
- **Forms (MVP-5):** `ShellFields`, `SubmodelFields` and `ElementForm` are
  built from `FormSection` groups inside `<v-form-fields>`; shared inputs are
  `LangStringsInput`, `ReferenceInput` and `QualifiersInput`. The `*Fields`
  component takes a JSON `v-model` and is used for creating (dialogs, wizard)
  and editing; the `*Form` component wraps it with drafts, apply, conflict
  handling, findings and `FormActions`. None of them has a data
  specification section; the parity list records embedded data
  specifications as *later* for shells, submodels and elements.
- **Web UI:** `EmbeddedDataSpecificationInput.vue` edits IEC 61360 content
  (preferred and short name, unit and unit ID, source of definition, symbol,
  data type, definition, value format, value or value list, level type); the
  Web UI has no concept description editor.

## Decisions

Made on 2026-10-15.

### Layout and interaction

| # | Topic | Decision |
| --- | --- | --- |
| L1 | Concepts page | The table stays the catalogue (search, source chips, columns only where the data has them). Selecting a row opens a details drawer on the right, as the tree does on the shell page: beside the table from 1145 px, temporary below. The expandable definition row is removed; the drawer shows it. |
| L2 | Drawer modes | *Details*, *JSON* and *XML*, with the panels of MVP-4 (`JsonPanel`, `ElementXmlPanel` generalized to any resource); *UML* is not offered. View mode shows a read-only details view; edit mode shows the form (MVP-5 U1). The drawer can be widened like the element drawer. |
| L3 | Deep links | `?cd=<key>&mode=<mode>` on `/targets/{targetId}/concepts` selects the row and opens the drawer; the page scrolls to the row and pins it when it is beyond the loaded 1,000. |
| L4 | Create | In edit mode, the page toolbar gets *New concept description*, which opens a dialog with the same `ConceptDescriptionFields` (as *Add submodel* uses `SubmodelFields`): empty, or from JSON through the JSON insert dialog (MVP-5 C3). The ID comes from the infrastructure's scheme (W5 of MVP-5) and can be replaced; IRDIs are accepted as typed. |
| L5 | Delete | A row menu and the drawer offer *Delete* in edit mode, with a confirmation naming the concept description (UX-003). Where the target supports element search by semantic ID (query support), the confirmation says how many submodels and elements reference it; otherwise it says that usages cannot be checked. Deleting never changes the referencing elements. |
| L6 | Palette | ⌘K gets *New concept description* (edit mode) and finds concept descriptions by name and ID on the loaded page, opening them in the drawer. |
| L7 | Empty and absent states | Without a concept description repository the page and the Semantics card are absent (capability `conceptDescriptions`, as today); without write rights the edit controls are absent and the drawer is read-only. |
| S1 | Search and paging | The Concepts page and the link picker share one search (`useConceptDescriptionSearch`, `ConceptDescriptionSearchBar`, `CursorPager`): the search bar of the record lists (`ListFilterBar`, as on the infrastructures page) with *Source* in its filter menu and the advanced query beside it. The text (also `id:`/`idShort:` filters typed into it) becomes an AAS Query Language query on `/query/concept-descriptions` (`$cd#id`, `$cd#idShort`, the only concept description fields of the grammar); sources become `$starts-with`/`$contains` conditions on `$cd#id`; raw queries are checked against the `$cd` root. Results come one page at a time with the API's cursors (10, 25, 50 or 100 rows, previous and next; no total count exists), in the server's order, so columns do not sort. Capability `conceptDescriptionSearch`: `query` where the repository announces the IDTA query profile (SSP-003) or BaSyx 3.2+, `expression` on workspaces (Studio evaluates text and sources), else `filter`, where text and sources narrow the page shown, with a note. Names, definitions and data types are not searched on the server: the grammar has no field for them. Added on 2026-10-15 at the user's request. |

### Forms

| # | Topic | Decision |
| --- | --- | --- |
| F1 | Concept description form | `ConceptDescriptionFields` (JSON `v-model`, for creating and editing) and `ConceptDescriptionForm` (drafts, apply, conflict, findings, `FormActions`), following `SubmodelFields` and `SubmodelForm`. Sections: *Basics* (idShort, ID when creating), *Names* (display name, description, category), *Data specifications* (F2), *Is case of* (a list of `ReferenceInput`s), *Administration* (version, revision). |
| F2 | Shared data specification section | `DataSpecificationsInput`: a `FormSection` titled *Data specifications* with a count badge, listing the embedded data specifications; each IEC 61360 entry is edited by `Iec61360Fields`, every other content type is shown read-only with its JSON. *Add IEC 61360* sets the data specification reference to `https://admin-shell.io/DataSpecificationTemplates/DataSpecificationIEC61360/3/0` and a preferred name in the user's content language. AAS 3.1 (`aas-core3.1`) defines no other content type, so nothing else can be added. |
| F3 | IEC 61360 fields | Grouped flat, without nested cards: *Names* (preferred name, short name, symbol; `LangStringsInput`), *Definition* (definition, source of definition), *Type and unit* (data type as a select of `DataTypeIec61360`, unit, unit ID as `ReferenceInput`, value format), *Values* (either a value or a value list, toggled; `ValueListInput` for value and value ID pairs), *Level type* (min, nom, typ, max as chips). Fields that are empty stay closed but show a badge when filled (`FormSection` convention). |
| F4 | Reuse | The same `DataSpecificationsInput` goes into `ShellFields`, `SubmodelFields` and `ElementForm` (all element types; all are `HasDataSpecification`), after *Semantics*, and into `ConceptDescriptionFields`. This closes the parity rows *shell embedded data specifications*, *submodel … embedded data specifications* and *element … embedded data specifications*. Supplemental semantic IDs of elements, still *later* in MVP-5, are added to `ElementForm` with the same input as in `SubmodelFields`. |
| F5 | Findings | AAS Core on the server stays authoritative (MVP-5 W6). Its IEC 61360 constraints (for example a preferred name in English, a value or a value list but not both) come back with paths into `embeddedDataSpecifications[i].dataSpecificationContent…`; `errorsFor` maps them to the fields of entry `i`, and the rest goes to the form's findings list. |
| F6 | Look | Only Vuetify components, props and utility classes; `<v-form-fields>`, `FormSection`, `v-btn-primary` and `v-btn-secondary` as in MVP-5. New recurring roles get an alias or a default in `vuetify.config.ts`, never a restated prop or custom CSS. New strings go into all seven locales (ADR 0026). |

### Concept descriptions from elements

| # | Topic | Decision |
| --- | --- | --- |
| E1 | Semantics card | The details drawer of elements and submodels shows, in a *Concept description* panel below the description (in view and edit mode), the concept description it resolves to on the same target: preferred name, definition, data type and unit, with *Open*, which opens it in the Concepts page's drawer (L3). Resolution uses the first key value of the semantic ID as the concept description ID and is cached per target like other reads. This replaces MVP-4's *per-element concept descriptions later*. |
| E2 | Not found | If no concept description exists, the card says so; in edit mode, for a semantic ID with a single key, it offers *Create concept description*. |
| E3 | Prefill | The create dialog (L4) is prefilled: ID from the semantic ID, idShort from the element, an IEC 61360 entry with the preferred name from the element's display name or idShort, the definition from its description, the data type derived from the `valueType` (for example `xs:string` → `STRING`, `xs:int` → `INTEGER_COUNT`, `xs:double` → `REAL_MEASURE`, `xs:boolean` → `BOOLEAN`, `xs:date` → `DATE`), and the unit from the element's own IEC 61360 entry if it has one. The mapping lives in `shared/aas/iec61360.ts`. |
| E4 | Edit from the element | The card's *Open* leaves the element; editing a concept description happens only in its own drawer, so one resource has one form. |
| E5 | Link from the element | The element form's *Semantics* section has *Link concept description* in its header (edit mode, targets with concept descriptions). It opens a picker of the target's concept descriptions, searched by name, idShort and ID; picking sets the semantic ID to a global reference with the concept description's ID, as a draft to apply. Added on 2026-10-15 at the user's request. |
| E6 | Units beside values | Where an element's semantic ID names a concept description with a unit, the unit is shown beside the value: in the tree, in the drawer's value card (Property and Range) and on the Overview's live value cards. The element's own IEC 61360 unit takes precedence in the drawer. The summaries come from one cached list per target (up to 1,000), shared with the link picker and refreshed after concept description writes. Added on 2026-10-15 at the user's request. |

### Write model and targets

| # | Topic | Decision |
| --- | --- | --- |
| W1 | Revisions | A concept description is one resource without children: its revision is the hash of it as read (ADR 0013), checked with `If-Match`; on live targets the downstream `ETag` is used as for submodels. No structure revision is needed. |
| W2 | Operations | `AasTarget` and the Workspace Worker get `conceptDescription`, `createConceptDescription`, `updateConceptDescription` and `deleteConceptDescription`, verified with AAS Core (`server/lib/aas/edits.ts`). A collision is refused with `identifier_conflict` before writing (MVP-5 W5). |
| W3 | Workspaces | The operations change the Worker's model and join the undo log (ADR 0030); Save writes them to the package. |
| W4 | Capabilities | No new capability: writing concept descriptions needs `conceptDescriptions` (a repository is configured, or the workspace) together with `writeStructure` and `createResources`, as creating submodels does. Shells, submodels and elements need nothing new for data specifications; their existing writes carry them. |
| W5 | Drafts | Concept description drafts live in the drafts store under the target and the concept description key (slot `concept-description`), count in the app bar and survive navigation, as submodel drafts do. |
| W6 | Registries | Concept descriptions have no registry; no sync steps. |

## Design

### Concepts page in edit mode

```text
┌ app bar: ··· target ▾ · View|[Edit] · ●1 draft ················· account ┐
├────┬───────────────────────────────────────────┬─────────────────────────┤
│rail│ Concepts                                   │ details drawer          │
│    │ [search…]   ECLASS · IEC CDD · IDTA  [+ New]│ Torque · 0173-1#02-…  ⋮ │
│    │ ┌ concept ───────── data type ── unit ─ ⋮ ┐ │ [Details|JSON|XML]      │
│    │ │ Torque ●          REAL_MEASURE  Nm   ⋮  │ │ ▸ Basics                │
│    │ │ Rated voltage     REAL_MEASURE  V    ⋮  │ │ ▸ Names                 │
│    │ │ Serial number     STRING             ⋮  │ │ ▾ Data specifications 1 │
│    │ └─────────────────────────────────────────┘ │   IEC 61360: names, …   │
│    │                                           │ ▸ Is case of            │
│    │                                           │ [Discard] [Apply]       │
└────┴───────────────────────────────────────────┴─────────────────────────┘
```

### Concept description panel in the element drawer

```text
▾ Concept description
  Torque                                                    [Open →]
  <> REAL_MEASURE   📏 Nm
  Turning force about an axis …
  (or: No concept description for this semantic ID on this target.
       [+ Create concept description])
```

### Code structure

- `app/components/DataSpecificationsInput.vue`, `Iec61360Fields.vue`,
  `ValueListInput.vue`: the shared section (F2, F3).
- `app/components/ConceptDescriptionFields.vue`, `ConceptDescriptionForm.vue`,
  `ConceptDescriptionAddDialog.vue`, `ConceptDescriptionDrawer.vue`,
  `ConceptDescriptionCard.vue` (E1), `ConceptDescriptionPickerDialog.vue` (E5).
- `app/stores/drafts.ts`: `conceptDescriptionDraftSlot` (W5).
- `app/composables/useConceptDescriptions.ts`: the cached summaries and the unit lookup (E5, E6).
- `shared/aas/iec61360.ts`: the data specification IRI, defaults, the
  `valueType` mapping (E3).
- `server/lib/aas/edits.ts`, `server/lib/targets/live-target.ts`,
  `server/lib/workspaces/model.ts`: the operations of W2.
- `app/pages/targets/[targetId]/concepts.vue`: table with selection, drawer,
  deep link and edit-mode actions.

## Studio API

Changes against MVP-5.

| Method and path | Purpose |
| --- | --- |
| `GET /targets/{id}/concept-descriptions/{cdKey}` | One concept description with `revision` (`ETag`); `?format=xml` for the XML mode |
| `POST /targets/{id}/concept-descriptions` | Create; `identifier_conflict` on collision |
| `PUT /targets/{id}/concept-descriptions/{cdKey}` | Replace, with `If-Match`; `revision_conflict` keeps the draft |
| `DELETE /targets/{id}/concept-descriptions/{cdKey}` | Delete, with `If-Match` |
| `GET /targets/{id}/concept-descriptions/{cdKey}/usages` | Number of submodels and elements whose semantic ID references it, where the target can query (L5) |
| `GET /targets/{id}/concept-descriptions` | Moved from `concept-descriptions.get.ts` into the `concept-descriptions/` directory; unchanged |
| `POST /targets/{id}/validations` | Also accepts a concept description (JSON insert, L4) |
| Shell, submodel and element writes | Accept `embeddedDataSpecifications` (they are part of the whole-resource writes of MVP-5 W1 already; the forms now send them) |

`openapi.yaml` and `endpoints.md` are updated with the implementation.

## Definition of done

Run in hosted web (Chromium) and the packaged Electron app against the test
environment.

1. **Read.** Selecting a row opens the drawer with *Details*, *JSON* and
   *XML*; a deep link with `cd` and `mode` reproduces it; the layout holds at
   1440, 768 and 375 px in light and dark.
2. **Edit.** Every IEC 61360 field of a concept description is changed,
   applied and reloaded with the stored value; AAS Core findings appear on
   the field (missing English preferred name, value and value list together);
   view mode shows no edit controls.
3. **Create and delete.** A concept description is created empty and from
   JSON, an ID collision is refused, and one is deleted after a confirmation
   that names its usages where the target can count them.
4. **Conflicts.** Two sessions editing one concept description: the second
   apply conflicts and keeps its draft; *Overwrite* and *Discard* work as in
   MVP-5.
5. **Data specifications everywhere.** An IEC 61360 data specification is
   added to, edited on and removed from a shell, a submodel and an element of
   each kind, with the same section; supplemental semantic IDs on elements.
6. **From elements.** The Semantics card shows the resolved concept
   description in view and edit mode and opens it; for an unresolved
   semantic ID, *Create concept description* creates one prefilled per E3,
   and the card then shows it.
7. **Workspaces.** Criteria 1–6 in a desktop workspace, including undo and
   redo of concept description changes and their survival of Save and reopen.
8. **Round trip.** Concept descriptions and data specifications survive
   export and re-import unchanged (normalized JSON), on live targets and in
   workspaces.
9. **Parity.** The MVP-5 parity rows for concept descriptions and embedded
   data specifications are updated to *done*.

## Phases

| Phase | Content | Exit |
| --- | --- | --- |
| 0. Measurements | BaSyx Go concept description repository: `ETag` and `If-Match` on `PUT` and `DELETE`, 409 on collision, how IEC 61360 content round-trips; query support for semantic-ID usages (L5) | Recorded results; upstream tickets for gaps |
| A. Write path | Routes, `AasTarget` and Worker operations, capability, validation, undo log entries | Integration tests on both target kinds |
| B. Shared section | `DataSpecificationsInput`, `Iec61360Fields`, `ValueListInput`; added to `ShellFields`, `SubmodelFields`, `ElementForm`; element supplemental semantic IDs | DoD 5 |
| C. Concepts page | Selection, drawer with modes, deep link, form, create dialog, delete with usages, palette | DoD 1–4 |
| D. Element link | Semantics card, *Create concept description* with prefill | DoD 6 |
| E. Wrap-up | Workspace and round-trip runs, e2e per criterion, screenshots, parity rows, `openapi.yaml`, i18n checks | DoD 7–9 |

B and C can run in parallel after A; D needs B and C.

## Implementation status

Implemented on 2026-10-15 on `friedjannik-2` and checked against the test
environment (BaSyx Go `SNAPSHOT`, `basyx-open`) in the dev server at 1440 px
and 800 px.

Phase 0 measurements (BaSyx Go, `live-target-concept-descriptions.test.ts`):

| Question | Result |
| --- | --- |
| `ETag` and `If-Match` on `PUT` and `DELETE` | Honoured; a stale revision is refused with `revision_conflict` before anything is written |
| Collision on `POST` | 409, mapped to `identifier_conflict` |
| IEC 61360 round trip | Content comes back as written |
| Usages through queries | `$sm#semanticId` and `$sme#semanticId` with `$eq` on `/query/submodels` find the referencing submodels; Studio counts the elements in the returned submodels |
| AAS Core rules that shape the forms | AASc-3a-002 (preferred name in English), AASc-3a-008 (a concept description needs an English definition unless it describes a value), AASc-3a-009 (measures and currencies need a unit or unit ID), AASc-3a-010 (value or value list) |

| Definition of done | Status | Evidence |
| --- | --- | --- |
| 1. Read | Done | Drawer with *Details*, *JSON*, *XML* beside the table at 1440 px and temporary at 800 px; `?cd=` and `mode=` deep links (browser) |
| 2. Edit | Done | Unit changed, applied and reverted in the browser; the row updates in place; AAS Core findings on fields and in the section (browser, unit tests) |
| 3. Create and delete | Done | Created from an element and deleted with the usage count in the browser; `identifier_conflict` and generated IDs in integration and unit tests. *From JSON* uses the MVP-5 insert dialog; not run in the browser |
| 4. Conflicts | Partly | `revision_conflict` for stale revisions on both target kinds (integration and unit tests); the two-session browser run was not done |
| 5. Data specifications everywhere | Partly | Added to an element in the browser, AASc-3a-009 shown and fixed, applied; shells and submodels use the same section, checked by typecheck only |
| 6. From elements | Done | Panel resolves IEC CDD concept descriptions on the DM3000 nameplate; *Create concept description* prefilled from a property (ID, idShort, names, definition, `REAL_COUNT`) and created (browser) |
| 7. Workspaces | Partly | Workspace operations, undo and usage counts in unit tests; not run in the packaged app |
| 8. Round trip | Partly | Live round trip in the integration test; export and re-import not run |
| 9. Parity | Done | MVP-5 parity rows updated |
| E5. Link | Done | *Link concept description* on a property without semantic ID: searched "manufacturer name", picked, applied; the drawer's panel then resolved it (browser) |
| E6. Units | Done | A property linked to a concept description with unit `1/min` shows `3000 1/min` in the tree and the value card (browser); `ownUnit` unit-tested. The Overview's live cards were checked by typecheck only |
| S1. Search | Done | `idShort:Manufacturer` and a raw `$cd#idShort` query return 11 of 84 through `/searches` in the browser; a `$aas` field is refused with a finding; unit tests for query building, local matching, profile detection and the request schema; integration test on BaSyx Go |

Automated checks: `pnpm typecheck`, ESLint on the changed files,
`pnpm test` (226 tests, including `test/aas/iec61360.test.ts` and
`test/workspaces/concept-descriptions.test.ts`) and
`test/integration/live-target-concept-descriptions.test.ts` (3) against the
test environment. No e2e test covers the Concepts page yet.

Deviations from the decisions above:

- **W4:** no `writeConceptDescriptions` capability; the existing ones suffice.
- **E1:** the resolved concept description is a panel of the details drawer,
  not part of the forms' *Semantics* section, so view and edit mode show it in
  the same place.
- **L3:** a deep link opens the drawer but does not scroll the table to its
  row or pin it when it is on another page of the table.
- **L6:** the palette offers *New concept description*, *From JSON* and
  *Delete* in edit mode; it does not search concept descriptions.
- **F3:** short name, source of definition, value format, value or value list
  and level type are folded under *More attributes* instead of separate
  groups.
- **AASc-3a-008:** a new concept description starts without a definition, so
  creating one needs the user to write it; the field says so.
- **Findings without a field:** AASc-3a-009 comes back for the content as a
  whole and is shown at the end of the *Data specifications* section, not at
  the unit field.
- **Form actions:** Apply and Discard of every form in the details drawers
  (elements, submodels, shells, concept descriptions) sit in the drawer's
  fixed footer (`v-navigation-drawer` `append` slot, reached through a
  teleport from `FormActions`), so they stay in view while the form and the
  metadata below it scroll, and field labels no longer show through them.
  Changed on 2026-10-15 at the user's request.

## Known risks

| Risk | Mitigation |
| --- | --- |
| The IEC 61360 form is long and pushes the rest of the element form down | Closed by default unless filled, with a badge (F3); the drawer can be widened |
| Semantic IDs with several keys or model references do not map to one concept description ID | Resolve the first key value only; the card says when it found nothing, and creating is offered only for a single global key |
| Resolving a concept description per selected element adds a request | Cached per target and concept description key; skipped where the capability is absent |
| Usage counts are expensive or unsupported | Only where the query capability exists; otherwise the confirmation says that usages cannot be checked (L5) |
| Deleting a concept description leaves dangling semantic IDs | Intended: semantic IDs are references, not ownership; the confirmation names the usages |

## Out of scope

Concept description history and change events; adding a template's concept
descriptions when a submodel is created from a bundled template; copying
concept descriptions between targets (Transfer MVP); concept description
lookup in external dictionaries (ECLASS, IEC CDD); data specification content
types other than IEC 61360; editing extensions.
