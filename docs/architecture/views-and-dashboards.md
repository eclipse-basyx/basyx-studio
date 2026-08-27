# Graphical Views and Dashboards

Studio lets users build AAS-specific user interfaces graphically. A view can be
an operational dashboard, a product page, an inspection form, or another focused
presentation of AAS data. This capability is part of Studio and reuses the app
platform; it is not a separate low-code product or service.

Canonical authoring and runtime sequences are in
[mechanisms.md](mechanisms.md).

## Concepts

- **View definition:** versioned declarative document describing layout, widget
  instances, bindings, and presentation settings.
- **Widget type:** a built-in Studio widget or an installed app contribution with
  a stable type ID and versioned contract.
- **Widget instance:** one configured occurrence of a widget in a view.
- **Binding:** a declarative connection from a widget input/output to AAS data or
  an operation through the Studio capability API.
- **View context:** the active target plus the selected shell, submodel, or
  element against which reusable bindings are resolved.

View definitions contain data, not executable source. They do not contain
JavaScript, Vue templates, credentials, endpoint URLs, or serialized AAS values.

## Ownership and placement

The graphical builder and runtime renderer are modules of the existing Studio
UI. The Studio Service stores and authorizes definitions and resolves bindings
through the existing target router and capability broker.

- Hosted definitions use the Studio PostgreSQL database and normal owner/group
  authorization.
- Desktop definitions use the existing local SQLite database and may be exported
  with a project or as a standalone definition.
- Built-in widgets execute as trusted Studio UI components.
- App-provided widgets execute through the existing sandboxed app UI origin and
  RPC bridge.
- A separate dashboard backend, datastore, event bus, or scripting runtime is not
  part of the baseline.

This placement applies to all three primary deployment variants. Only the target
adapter and persistence implementation change.

## Declarative definition

The public definition is validated against a versioned JSON Schema. The exact
schema will be proven by a vertical slice before it is declared stable. A
representative shape is:

```json
{
  "schemaVersion": "1",
  "id": "machine-overview",
  "title": "Machine overview",
  "layout": {
    "type": "responsive-grid",
    "items": [
      { "widgetId": "temperature", "x": 0, "y": 0, "w": 4, "h": 2 }
    ]
  },
  "widgets": [
    {
      "id": "temperature",
      "type": "studio:value-card",
      "configuration": { "label": "Temperature", "unit": "°C" },
      "bindings": {
        "value": {
          "kind": "semantic-path",
          "context": "selected-shell",
          "semanticId": "urn:example:temperature",
          "path": ["CurrentValue"]
        }
      }
    }
  ]
}
```

The example is illustrative, not a frozen API. Migrations operate on the
definition schema version and preserve unknown app configuration where safe.

## AAS bindings

Studio supports two binding classes:

### Instance binding

Points to an exact model reference within a specific target or workspace. It is
appropriate for a dashboard tied to one concrete asset. The target is referenced
by an opaque Studio target ID, never by a service URL.

### Semantic binding

Describes required semantic IDs, relative element paths, expected value/data
types, qualifiers, and cardinality. Studio resolves it against the current view
context. This allows one definition to work with multiple shells that implement
the same semantic contract.

Resolution produces an explicit result per binding: resolved, ambiguous,
missing, incompatible, or unauthorized. The renderer shows useful diagnostics
instead of silently selecting a near match.

Bindings may declare these directions:

- read a value, file, collection, or operation state;
- write a value through an explicit user interaction;
- invoke an AAS operation with validated inputs;
- observe invalidation/progress through the existing event mechanism.

Opening a dashboard never grants authority. Every read, write, or invocation is
authorized for the current user, target, widget/app identity, and resource at the
time of the call. Writes and operations expose pending, success, conflict, and
failure states; safety-relevant actions may require confirmation.

## Widget contributions from apps

An app manifest may contribute one or more widget types. Each contribution
declares:

- globally unique type ID and display metadata;
- UI entry point and supported Studio SDK range;
- JSON Schema for editable widget configuration;
- named binding slots with direction, value type, cardinality, and semantic
  requirements;
- requested AAS, file, network, and Studio UI capabilities;
- preferred/minimum layout constraints and responsive behavior;
- a lightweight editor preview where available.

The builder palette filters contributions using installation visibility,
technical compatibility, semantic applicability, and the current user's rights.
Adding a widget to a view does not install its app or approve new permissions.

App widgets remain sandboxed when embedded in the builder or runtime view. They
communicate with the host through the versioned Studio SDK RPC bridge and receive
only scoped binding/capability handles. They cannot access the builder DOM,
Pinia stores, session cookies, raw target configuration, or another widget.

## Authoring and runtime

Authoring mode owns layout manipulation, widget configuration, binding
selection, preview, validation, undo/redo, and definition save. It uses the same
renderer and capability paths as runtime mode so preview does not become a
second implementation.

Runtime mode:

1. loads and migrates the authorized definition;
2. resolves installed widget types and permissions;
3. resolves every binding against the selected context;
4. renders trusted widgets and isolated app widgets;
5. reads or mutates AAS data only through Studio capabilities;
6. refreshes affected bindings through query invalidation, SSE, or bounded
   polling according to the target's available mechanisms.

Missing apps or bindings degrade the affected widget, not the complete view.

## Sharing and portability

Hosted views have an owner and independent view/edit access rules for users and
groups. Runtime AAS permissions are still evaluated separately. Desktop views
are private/local by default.

Import/export includes the declarative definition and required widget type IDs,
but not app binaries, secrets, or AAS values. On import, Studio reports missing
apps, incompatible schema versions, and unresolved bindings before activation.

## Pragmatic delivery

Build the feature in vertical slices:

1. one responsive layout, built-in value/text widgets, read-only instance
   bindings, save/load, and runtime rendering;
2. semantic bindings, write/operation actions, validation diagnostics, and
   sharing;
3. app-contributed widgets through the existing app sandbox and SDK.

Do not choose a large drag-and-drop or low-code framework solely from its feature
list. A candidate must prove keyboard accessibility, responsive layout,
serialization stability, Vue/Nuxt compatibility, bundle cost, maintenance, and
the amount of custom code it actually removes in the first vertical slice.
