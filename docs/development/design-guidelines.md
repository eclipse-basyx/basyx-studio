# Design Guidelines

These guidelines consolidate interaction decisions from the first Studio
prototypes. They apply to both live infrastructure and package workflows unless
a platform restriction is stated explicitly.

## Product character

- Favor a calm productivity interface over a marketing-style presentation.
- Use plain AAS language and progressively reveal implementation detail.
- Make the active target, environment, and unsaved state continuously visible.
- Keep primary actions contextual to the object they affect.
- Use dialogs for short blocking choices, confirmation, or secondary setup—not
  as the default workspace.
- Keep web and desktop interaction patterns aligned even when their storage and
  security mechanisms differ.

## Picker pattern

Use an inline master-detail picker when choosing an infrastructure or project is
the page's primary task:

- left: selectable rows for projects or infrastructures;
- right: details, capabilities/endpoints, and the contextual open/connect action;
- top: refresh, choose workspace, or create/add actions;
- narrow screens: stack the list and detail panels vertically;
- disable the primary action until a valid selection exists;
- make the selected row unmistakable and retain it while details load.

Rows should expose the few properties needed for comparison, not every stored
field. Use explicit action menus for secondary row operations and confirmation
for destructive actions.

## Desktop local projects

Desktop project selection uses Electron's native file or directory dialog. The
renderer must not receive unrestricted filesystem access.

The current prototype models a workspace folder containing project directories:

```text
workspace/
└── project-id/
    ├── project.json
    └── project.aasx
```

`project.json` may contain the project name, Studio project format version, AAS
metamodel version, template ID, author, and description. The final on-disk
format remains an implementation decision and must support atomic writes,
recovery, and migration. Do not make the prototype layout a public compatibility
promise yet.

The picker should:

- show the selected workspace and number of valid projects;
- show loading, empty, invalid, and permission-denied states;
- default to a sensible recent project without opening it automatically;
- offer open, edit metadata, duplicate, and delete actions;
- keep the selected project's version, metamodel, author, package, and
  description visible.

Native file and directory workflows are desktop-only. The hosted Studio UI must
not receive filesystem paths or emulate unrestricted native file access.

## Live infrastructure picker

Users select a Studio-managed infrastructure rather than entering service URLs
for each connection. Infrastructure persistence, endpoint normalization,
credentials, and health checks are backend responsibilities.

The list should show name, short environment description, shell/service counts,
health, and security mode. The details panel should show the known services and
capabilities while avoiding disclosure of credentials or sensitive internal
network information.

Administrative creation and editing can be a separate flow with explicit
validation. End users see only infrastructures they are authorized to use.

Switching the active infrastructure must preserve the state of other configured
connections without displaying their cached AAS data in the new context. Show
authentication-required, connected, unavailable, and insufficient-permission
states per infrastructure.

Cross-infrastructure copy is an explicit source-plan-destination workflow. Keep
both infrastructure identities visible throughout preflight and execution. Show
the dependency closure, collisions, selected policy, partial failures, and retry
state; do not present it as drag-and-drop that hides consequential destination
writes.

## Electron welcome

- Treat the welcome screen as a compact tool entry point.
- Present the valid entry paths—live infrastructure and local AASX project—as
  functional rows with one short explanatory sentence.
- Show product and environment information compactly.
- Use a small hierarchy illustration only when it helps explain project/package
  structure.
- Use explicit application links for navigable panels.

## Visual conventions

- Prefer bordered sheets and functional lists over nested decorative cards.
- Use restrained typography and spacing; reserve large headings for true page
  hierarchy.
- Use icons to improve recognition, especially for folders, packages, servers,
  shells, and open/connect actions.
- Preserve readable button labels rather than forcing uppercase.
- Build reusable payload-driven context menus for projects, infrastructures,
  shells, and similar lists.
- Use skeletons for predictable loading layouts and explicit empty/error states.

## Viewer (MVP-4)

- Layout: app bar, navigation rail, the shell list drawer, the shell's header
  card with tabs (*Submodels*, *Overview*, *Changes*, *JSON*), the element tree
  with inline values, and the details drawer on the right. From 1145 px the
  details drawer sits beside the tree; below, it is temporary. Phones get the
  bottom navigation, temporary drawers and a full-screen palette.
- Look: Studio's colours, small radii (at most 8 px), outlined fields, borders
  instead of shadows. All of it lives in `vuetify.config.ts` defaults and
  aliases.
- Appearance settings: users choose each part on its own, as in Slack: the
  mode (light, dark or system), an accent colour (BaSyx by default, six more
  presets, or any colour from a simple picker), a background (*Neutral*,
  Vuetify's own surfaces, plus *Slate*, *Warm*, *Midnight* and *High
  contrast*) and a shape (*Normal*, the small radii above, or *More rounded*:
  24 px surfaces and fields, pill-shaped buttons and chips). Every accent and
  background has a light and a dark shade; preset accents reach 4.5:1 on every
  background of their mode, and a custom accent is darkened or lightened until
  it does. All of it is defined in `shared/appearance.ts`: `vuetify.config.ts`
  builds the light and dark themes from the defaults, and `app.vue` lays the
  user's accent and background over both. The rounded shape is a defaults
  provider in `app.vue` that changes radii only. New components set radii
  through defaults, never in templates, so both shapes follow.
- The details drawer shows the selection in modes: *Details*, *Visualization*
  (app views), *JSON*, *XML* and *UML*. The mode and the selection are in the
  URL, so links reproduce what the user saw.
- Edit controls appear only in edit mode, in Studio and in apps; view mode
  never offers a change.
- Long lists stay responsive: the shell list is virtual, tree levels show 200
  children and a *Show more* row, and closed tree groups are not rendered.
- Search uses the BaSyx Web UI's syntax, shows its filters as chips and says
  when it only filters the loaded rows.
- Say what a server does not provide instead of leaving gaps: a feature that
  is not announced is absent, empty columns are hidden, and limits of the data
  (for example, an event feed without authors) are stated once.

## Graphical view builder

- Keep authoring and runtime modes visually distinct.
- Use one renderer for preview and runtime so bindings and app isolation behave
  identically.
- Provide an accessible widget palette, canvas/layout outline, property editor,
  and binding inspector without hiding the active target and shell context.
- Make exact instance bindings and reusable semantic bindings visually distinct.
- Show resolved, ambiguous, missing, incompatible, and unauthorized binding
  states directly on the affected widget.
- Preserve undo/redo for layout and configuration drafts; save creates a
  versioned declarative definition.
- Preview write bindings and operation invocations without executing them
  accidentally in authoring mode.
- App widgets must look integrated while retaining an explicit publisher/app
  identity and their sandbox boundary.

The current implementations in `app/pages/project-manager.vue` and
`app/pages/connect-server.vue` are interaction drafts. Preserve their useful
master-detail structure, but replace mock data and renderer-side trust with the
target service boundaries.

## Editing (MVP-5)

- Forms live in the details drawer, never in a dialog: one form per model type
  with the sections *Identity*, *Semantics*, *Value* and *Qualifiers*, and
  forms for the shell and the submodel. Dialogs are for confirmations, the
  creation wizard, adding submodels, *Insert from JSON* and *Create instance*.
- The creation wizard has three steps: shell and asset, submodels from
  templates, review. The review lists what is written, in order; a partial
  write lists what was written and what was not.
- On workspaces, ⌘Z and ⇧⌘Z undo and redo applied changes until Save or Close;
  live targets offer no undo after apply.
- Structure actions (add, copy, paste, duplicate, move, delete) sit in the tree
  row's menu in edit mode, and appear nowhere in view mode.
- A new element's form takes the drawer and is written on *Create*;
  *Cancel* leaves nothing behind. Applying is per element; a failed apply keeps
  the draft, names the findings of AAS Core and says what conflicted.
- A tree row with an unapplied draft carries a marker.
