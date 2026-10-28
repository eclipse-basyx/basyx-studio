# @basyx/studio-sdk

Build apps for [BaSyx Studio](../../README.md): submodel views, modules and
backends that Studio installs at runtime and runs isolated from itself
([ADR 0004](../../docs/adr/0004-runtime-installable-apps.md)).

An app is a static web UI (any framework) plus an optional Deno backend,
packaged as a `.zip` with a `studio-app.json` manifest at its root. Studio runs
the UI in a sandboxed frame on a separate origin. The app reaches AAS data and
Studio functions only through this SDK, and only with the permissions it
declares, limited by the signed-in user's own rights.

```bash
pnpm add @basyx/studio-sdk
# Studio's look for Vue and Vuetify, a Vite preset, and `studio-app pack`:
pnpm add @basyx/studio-app-kit
```

[`@basyx/studio-app-kit`](../studio-app-kit/README.md) builds on this SDK
for Vue and Vuetify apps; [`examples/apps/starter`](../../examples/apps/starter)
is an app in its own repository that uses both
([ADR 0043](../../docs/adr/0043-published-sdk-and-app-kit.md)).

## Versions

The SDK, `@basyx/studio-app-kit` and `@basyx/file-viewer` are released
together, independently of Studio, and stay `0.x` until the app API is
stable. A package version provides one app API version
(`studioAppApiVersion`); a manifest's `studioApi` range says which Studio
runs the app, whatever the package version.

| Packages | App API (`studioAppApiVersion`) | First Studio release |
| --- | --- | --- |
| 0.1.0 | 0.1.2 | 0.1.0 |
| 0.1.1 | 0.1.3: `sandbox.frameOrigins`, `connectOrigins`, `imageOrigins`, `mediaOrigins`; module `layout` | next release |
| 0.1.2 | 0.1.4: `ui.openShell`; `timeseries.read` with `anchor: 'latest'` for LinkedSegments | next release |
| 0.1.3 | 0.1.5: structural writes (`aas.createShell`, `createSubmodel`, `putSubmodel`, `addElement`, `putElement`, `deleteElement`, `deleteSubmodel`, `deleteShell`), `aas.putAttachment`, `aas.getSubmodelSnapshot`, `structureRevision` on element snapshots; `memoryAas` in `testing` | next release |
| 0.1.4 | 0.1.6: `connections`, `studio.connections.call`, permission `studio.connections` | next release |
| 0.1.5 | 0.1.7: `ui.openFullscreen(state, { header: false })`, `ui.closeFullscreen` and `context.fullscreenOpen`; `<v-btn-toggle-icon>` in the app kit | next release |
| 0.1.6 | 0.1.8: `assetType` and `specificAssetIds` in `aas.listShells`; `ui.navigate(subPath, { history: 'push' })`; `navigations`, `back` and `forward` in `testing` | next release |
| 0.1.7 | 0.1.8 (unchanged): `createTestStudio({ manifest })` in `testing`; in the app kit, `provideI18n` with `baseLocale`, `formatLocale` and nested keys, `createStudioHistory` (`./router`), the layout defaults and `mountApp`'s `setup`; per-format parsers of the file viewer's 3D viewer (`./model/viewer/core`, `./model/vue/core`, `./model/ifc`, `./model/step`) | next release |
| 0.1.8 | 0.1.9: `settings` in the manifest, `context.settings` and `context.connections`, `settings` and `connections` in a backend's context; `checkSettingValue` and `checkSettingValues` in the app kit | next release |
| 0.1.9 | 0.1.10: `ui.openView`; `openedViews` in `testing` | next release |
| 0.1.10 | 0.1.11: `ui.embedView`, `context.embedded`; `connect()` of views embedded in other apps' pages; `embeddedViews` in `testing` | next release |
| 0.1.11 | 0.1.12: `ui.previewFile`, `context.fills`; `previewedFiles` in `testing`; in the file viewer, every kind of file (`./vue`, `./viewer`) and the 3D view in parts (`./model`) | next release |
| 0.1.12 | 0.1.13: `ui.setViewState`, which Studio's full-screen button on the Overview opens the view with, and `context.fullscreenControl`, where Studio shows that button; `viewState` in `testing` | next release |
| 0.1.13 | 0.1.14: `ui.saveFile` and permission `studio.ui.saveFiles`; `mailto:` and `tel:` in `ui.openExternal`; `savedFiles` in `testing`; in the app kit, `./contacts` for IDTA 02002 contact information (names, addresses, channels, vCard) | next release |
| 0.1.14 | 0.1.15: `aas.describeConcepts` (units, names and definitions from the target's concept descriptions); `conceptDescriptions` in `memoryAas`; in the app kit, `./editing` for changing values in place (`useFieldEditor`, also Ranges, and the row actions) | next release |

A new app API minor version (new methods) is a new minor version of the
packages; fixes are patch versions. While the app API is `0.x`, additions
that existing apps do not need (new optional methods or manifest fields) are
app API patch versions, so that a manifest's `^0.1.0` still matches a newer
Studio, and patch versions of the packages. A manifest that uses a newer
field declares the version that brought it, e.g. `^0.1.3`; `studio-app pack`
reports it otherwise. An app that calls a newer method declares its version
too, e.g. `^0.1.5` for structural writes: an older Studio refuses the call as
an unknown method.

## Manifest

```json
{
  "$schema": "https://eclipse.dev/basyx/studio/schemas/app-manifest-0.json",
  "manifestVersion": 0,
  "id": "org.example.nameplate",
  "version": "1.0.0",
  "publisher": { "name": "Example Inc." },
  "title": { "en": "Nameplate" },
  "studioApi": "^0.1.0",
  "runtimes": ["hosted", "desktop"],
  "permissions": ["studio.aas.read"],
  "contributes": {
    "submodelViews": [{
      "id": "nameplate",
      "title": { "en": "Nameplate" },
      "entry": "ui/index.html",
      "semanticIds": ["https://admin-shell.io/idta/nameplate/3/0/Nameplate"],
      "columns": { "md": 12, "lg": 6, "xxl": 4 }
    }]
  }
}
```

The schema is [`app-manifest.schema.json`](app-manifest.schema.json).

| Contribution | Offered | Context |
| --- | --- | --- |
| `submodelViews` | On a shell's *Overview* tab and in the details drawer's *Visualization* mode, for submodels whose semantic ID equals one of `semanticIds` | target, shell, submodel |
| `modules` with `context: global` | Always, in the navigation rail, at `/apps/<installation>/<route>` | — |
| `modules` with `context: target` | While a target is open, at `/targets/<target>/apps/<installation>/<route>` | target |
| `modules` with `context: shell` | While a shell is open | target, shell |

A module is shown in a card below a header with breadcrumbs. With
`"layout": "fullPage"` (Studio app API 0.1.3) it fills the page instead, from
the navigation rail to the window's edges, below Studio's app bar: no header,
card or padding. Studio's app bar keeps the target, the edit switch and the
user menu; show the target's name yourself if the page needs it.

A module with pages of its own keeps the page in its sub-path:
`ui.navigate(subPath)` changes it and replaces the URL's history entry, e.g.
for filter state. `ui.navigate(subPath, { history: 'push' })` adds an entry
instead (Studio app API 0.1.8), so the browser's back and forward buttons
move between the module's pages. The frame stays loaded; the new sub-path
reaches it as `context.subPath` with `onContext`, as with every change.

| Permission | Allows |
| --- | --- |
| `studio.aas.read` | `aas.listShells`, `getShell`, `listSubmodels`, `getSubmodel`, `getSubmodelSnapshot`, `getElement` on the active target; `aas.describeConcepts`: the unit, preferred name, short name, definition and data type of its concept descriptions for up to 500 semantic IDs (Studio app API 0.1.15); `ui.openFile` and `ui.readFile` for its File elements |
| `studio.aas.write` | `aas.setElementValue` (Property and MultiLanguageProperty values, with the revision read before); in edit mode, structural writes and attachments (Studio app API 0.1.5, see [Changing structure and files](#changing-structure-and-files)) |
| `studio.ui.notifications` | `ui.notify` |
| `studio.ui.navigation` | `ui.navigate`: change the module's own sub-path (nested routes); `ui.openTarget`, `ui.openExternal` and `ui.openShell`: open a target, a URL in the system browser (or an email address or phone number in the mail or phone app, Studio app API 0.1.14), or Studio's page of a shell; `ui.openView` and `ui.embedView`: show a submodel in another app's view, in Studio's dialog or in the app's page (Studio app API 0.1.10, 0.1.11) |
| `studio.backend` | `backend.call`: call the app's own Deno backend |
| `studio.ui.externalFiles` | `ui.readExternalFile`: files that elements name at other hosts, fetched by Studio's page; those hosts see the user's address |
| `studio.ui.saveFiles` | `ui.saveFile`: save text the app created, e.g. a vCard, as a file on the user's computer after a click (Studio app API 0.1.14) |
| `studio.timeseries.read` | `timeseries.read`: read a segment of an IDTA Time Series Data submodel of the active target, including LinkedSegments in a database that the infrastructure's connections reach (ADR 0040). Reserved for the apps shipped with Studio and for signed apps whose publisher the trust store grants it; Studio app API 0.1.2 |
| `studio.connections` | `connections.call`: call the declared operations of the app's `connections`, where an administrator binds them to a connection of the target's infrastructure ([ADR 0047](../../docs/adr/0047-http-connections-for-apps.md)); Studio app API 0.1.6 |

## UI

```ts
import { applyTheme, connect, StudioError } from '@basyx/studio-sdk'

const studio = await connect()
applyTheme(studio.context.theme) // --studio-color-primary, …
studio.onContext(context => applyTheme(context.theme))

const submodel = await studio.aas.getSubmodel(studio.context.submodel!.id)

const element = await studio.aas.getElement(studio.context.submodel!.id, 'SerialNumber')
try {
  await studio.aas.setElementValue({ submodelId: studio.context.submodel!.id, idShortPath: 'SerialNumber', value: 'SN-2', revision: element.revision })
} catch (error) {
  if (error instanceof StudioError && error.code === 'revision_conflict') {
    // someone else changed it: read again
  }
}
```

Build the UI with relative URLs (Vite: `base: './'`); it is served under
`/app/<installation>/`, on an origin of the installation's own or on one that
all apps share. The frame cannot use popups, forms or network requests
outside its own package and the origins it declares; with a shared apps
origin, it has no cookies or storage either. Without forms, handle buttons
with click handlers instead of `submit` events.

`studio.context.mode` is Studio's mode, `view` or `edit`. Show edit controls
only in `edit`, as Studio does; `onContext` reports when the user switches.
Views on the overview are sized to their content (`fitHeight`), so edit in
place rather than in dialogs. Measure the content itself: a root that is at
least as tall as the frame (Vuetify's `v-app`, `min-height: 100vh`) lets the
frame grow but never shrink. Studio draws the view's card, border and title,
so render the view flat, without a title of its own and with a transparent
background.

To show a File element's content in the app, e.g. an image or a 3D model,
read it with `ui.readFile(submodelId, idShortPath)` (Studio app API 0.1.1,
so declare `"studioApi": "^0.1.1"`): Studio's page loads it with the user's
rights and hands the bytes (`Uint8Array`, up to 200 MiB) and media type to
the frame. `ui.openFile` opens it in a new tab instead. A File element
without a value is refused with `target_resource_not_found` (404) before
Studio asks the AAS server for its content, on infrastructures as on AASX
files (Studio app API 0.1.8; before, infrastructures answered
`target_error`).

`aas.listShells` pages through the target's shells. Each summary has the
shell's `assetType` and its `specificAssetIds` (`{ name, value }`, as the
AAS server returns them to the user; Studio app API 0.1.8), so an app
selects the shells of an asset type and relates them through an ID from the
pages alone, without reading each shell. Studio does not filter by them.

A file that an element names by an http(s) address at another host (a File
whose value is such an address, or a Property such as IDTA 02026's
`ExternalUrl`) is read with `ui.readExternalFile(submodelId, idShortPath)`
(permission `studio.ui.externalFiles`, Studio app API 0.1.2). Studio reads
the address from the element itself and fetches the file in the user's
browser without credentials or referrer; the host must allow it (CORS).
Otherwise the call fails with `external_file_unavailable`.

`ui.openShell(shellId, { submodelId? })` opens Studio's page of a shell of
the active target in the same tab (permission `studio.ui.navigation`, Studio
app API 0.1.4). There, Studio's submodel views and those of the installed
apps show the shell's submodels, e.g. a bill of material or documents, so an
app does not need to build them again. With `submodelId`, a submodel the
shell references is selected and shown in its view, or in its details when
no view fits. Call it from a click (or key press) in the app, as
`openExternal`. Studio reads the shell as the user before it leaves the app:
a shell the user cannot read, or a submodel the shell does not reference, is
refused with Studio's problem, and the app stays. Going back in the history
returns to the app. It works the same in the desktop app, also for AASX
files.

`ui.openView(submodelId, { shellId?, appId?, viewId? })` shows a submodel of
the active target in the view of an installed app, in Studio's full-screen
dialog over the app, e.g. a bill of material, files or a time series
(permission `studio.ui.navigation`, Studio app API 0.1.10,
[ADR 0051](../../docs/adr/0051-views-of-other-apps.md)). The app's page
stays as it is underneath, and closing the dialog returns to it.

```ts
const bom = submodels.find(submodel => submodel.semanticId === 'https://admin-shell.io/idta/HierarchicalStructures/1/1/Submodel')
await client.ui.openView(bom.id, { shellId }) // from a click handler
```

- Studio reads the submodel as the user and picks the view the shell's
  Overview shows first for its semantic ID: the apps shipped with Studio,
  then installed ones. `appId` picks that app's view, and `viewId` one of its
  views by the ID in its manifest.
- With `shellId`, the shell must reference the submodel, and the view sees it
  as its shell; without, the view's `context.shell` is `null`.
- The view runs in its own frame, with its own permissions and the user's
  rights, as on the shell page, and in Studio's mode. Your app learns only
  that it opened: `context.fullscreenOpen` is `true` until the user closes
  the dialog, so reload what the view may have changed when it turns `false`.
- No view for the submodel's semantic ID, or none of `appId`, is refused with
  `unsupported_operation`; offer `ui.openShell` instead. A shell that does not
  reference the submodel is refused with `target_resource_not_found`, a
  submodel the user cannot read with the target's problem.
- Call it from a click or key press in the app, as `openShell`. Frames in a
  full-screen dialog cannot open further views.

`ui.embedView(submodelId, { shellId?, appId?, viewId? })` places the same
view in the app's own page instead (Studio app API 0.1.11). It answers with
the URL of the view's frame; the app creates the frame and gives it its size:

```ts
const { url } = await client.ui.embedView(timeSeries.id, { shellId })
```

```vue
<iframe v-if="url" class="w-100 border-0" height="480" :src="url" title="Time series" />
```

- It works only where each app has an origin of its own
  (`STUDIO_APPS_URL=https://{installation}.apps.example.org`, ADR 0045).
  With one shared apps origin, and in the desktop app for now, it is refused
  with `unsupported_operation`: use `openView` there.
- The view runs at its own installation's origin and connects to Studio's
  page itself, with the token in its URL; your app never holds its
  connection or permissions and cannot reach into its document. Keep the
  frame's origin: no `sandbox` attribute.
- An embedded view is read-only, because your page decides what lies over
  the frame: `context.embedded` is `true`, `mode` is always `view`, and it
  may call only reads (the `aas` reads, `timeseries.read`, `ui.readFile`,
  `ui.readExternalFile`) and `ui.notify`. Studio refuses everything else
  with `forbidden`, also its backend and its connections. Its full-screen
  button opens it in Studio's dialog, where it runs as usual, and its
  `context.fullscreenOpen` is `true` until that closes. Studio does not tell
  your app the view's content height.
- The view gets its own app's settings and connection status, not yours.
  When its app is updated, Studio loads it again with the new package.
- The URL is valid for an hour: ask for a new one each time you create the
  frame. Studio embeds the views shipped with it and views whose manifest
  declares `"studioApi": "^0.1.11"` or later, since only those were built
  with an SDK that connects from inside another app's page.
- No click is needed, as on the Overview.

`ui.openFullscreen(state?)` opens the view again in a full-screen dialog,
as a new frame. Pass what the user has selected as `state` (a string, up to
4,000 characters, e.g. JSON); the view there reads it from
`context.viewState` and `context.fullscreen` is `true` (Studio app API
0.1.1).

Studio's Overview cards have a full-screen button of their own. So that it
opens the view on what the user selected, too, report the selection with
`ui.setViewState(state)` whenever it changes; Studio keeps the last one and
opens the view with it as `openFullscreen(state)` would (Studio app API
0.1.13). `context.fullscreenControl` is `true` where Studio shows that
button; elsewhere, e.g. in the details pane or in another app's page, a view
that offers full screen shows its own button and calls `openFullscreen`.

`ui.openFullscreen(state, { header: false })` shows the new frame on its own
over the dimmed page, without Studio's header and close button, e.g. for a
file preview or an image viewer (Studio app API 0.1.7). The view draws its
own toolbar and closes the dialog with `ui.closeFullscreen()`, also on
Escape; Studio closes it on Escape only while its own page has the focus.
From inside a full-screen dialog, only such a header-less one opens, above
it.

Each full-screen dialog is a frame of its own, so what the view there
changes is not seen by the frame that opened it. `context.fullscreenOpen`
is `true` while that dialog is open; reload what the view shows when it
turns `false` again (Studio app API 0.1.7).

An app that parses files with WebAssembly, or off the page in a worker,
declares it in the manifest ([ADR 0038](../../docs/adr/0038-webassembly-workers-and-file-reads-for-apps.md)):

```json
"sandbox": { "webAssembly": true, "workers": true }
```

`webAssembly` allows compiling WebAssembly (`'wasm-unsafe-eval'`, not
JavaScript `eval`); `workers` allows dedicated workers started from `blob:`
URLs, since the frame's origin may be opaque: create a `blob:` module that
imports the bundled worker script by its absolute URL. Both still load and
fetch only the app's own files, and the Apps page shows them.

### Changing structure and files

With `studio.aas.write`, an app changes the structure of the active target
the way Studio's editor does (Studio app API 0.1.5, so declare
`"studioApi": "^0.1.5"`). Studio carries these out only in edit mode: its
server refuses them with `app_edit_mode_required` while `context.mode` is
`view`, whatever the app shows. A backend's calls count in the mode of the
frame call that started it.

| Method | Based on |
| --- | --- |
| `aas.createShell({ shell, submodels? })` | — (fails with `identifier_conflict` if an `id` exists) |
| `aas.createSubmodel({ submodel, shellId? })` | — (with `shellId`, the shell references the new submodel) |
| `aas.putSubmodel({ submodelId, submodel, revision })` | `revision` of `getSubmodelSnapshot` |
| `aas.addElement({ submodelId, parentPath?, element, index?, structureRevision })` | `structureRevision` of the parent: of `getElement` for a container, of `getSubmodelSnapshot` for the top level |
| `aas.putElement({ submodelId, idShortPath, element, revision })` | the element's `revision`; a new idShort renames it, a container keeps its children |
| `aas.deleteElement({ submodelId, idShortPath, revision })` | the element's `revision` |
| `aas.deleteSubmodel({ submodelId, removeReferences? })` | — |
| `aas.deleteShell({ shellId, deleteSubmodels? })` | — |
| `aas.putAttachment({ submodelId, idShortPath, fileName, contentType, data, revision })` | the File element's `revision`; up to 8 MiB (`putAttachmentMaxBytes`) |

- Shells and submodels without `id` get one by the infrastructure's
  identifier scheme. Submodels are written first, then the shell, then the
  registries and discovery where Studio keeps them in step; `steps` says
  what each step did, and a failure stops the later ones (`partial_write`
  lists them).
- Studio verifies the content with AAS Core. Findings fail the call with
  `validation_failed` and `violations`. A sibling with the same idShort is
  `idshort_conflict`; a changed parent is `structure_conflict`, a changed
  element or submodel `revision_conflict`: read again and retry or tell the
  user. An empty collection has no `value` (not `[]`).
- Element results carry `idShortPath`, the path after the write, and
  `structureRevision` for containers, so a series of writes needs no reads in
  between.
- `putAttachment` takes the bytes as an `ArrayBuffer` or typed array; Studio's
  page sends them, so the frame needs no network access. Studio's switch for
  uploads (`STUDIO_ALLOW_UPLOADS`) and its upload limit apply. To move a file,
  read it (`ui.readFile`), add the File element at the new place, put the
  content there and delete the old element: the content belongs to the
  element.
- Rename files and folders by their `displayName`, not their idShort. BaSyx
  Go keeps a File's content at its idShort path: changing the idShort of a
  File, or of a collection that contains one, drops the content
  ([basyx-go-components#772](https://github.com/eclipse-basyx/basyx-go-components/issues/772)).
- On a desktop workspace every write is an entry in the undo log; Studio
  refreshes its own views after each one. The audit log records the app, the
  method and what it changed, never the content.

```ts
const files = studio.context.submodel!.id
const top = await studio.aas.getSubmodelSnapshot(files)
const folder = await studio.aas.addElement({
  submodelId: files,
  element: { modelType: 'SubmodelElementCollection', idShort: 'Manuals' },
  structureRevision: top.structureRevision,
})
const file = await studio.aas.addElement({
  submodelId: files,
  parentPath: folder.idShortPath,
  element: { modelType: 'File', idShort: 'Guide', contentType: picked.type },
  structureRevision: folder.structureRevision!,
})
await studio.aas.putAttachment({
  submodelId: files,
  idShortPath: file.idShortPath,
  fileName: picked.name,
  contentType: picked.type,
  data: await picked.arrayBuffer(),
  revision: file.revision,
})
```

### Third-party origins

An app that embeds public pages, reads a keyless public API, or shows images
or media from elsewhere declares their origins (Studio app API 0.1.3,
[ADR 0045](../../docs/adr/0045-app-origins-embeds-and-full-page-modules.md)):

```json
"sandbox": {
  "frameOrigins": ["https://viewer.example.com"],
  "connectOrigins": ["https://api.weather.example"],
  "imageOrigins": ["https://*.tiles.example.com"],
  "mediaOrigins": []
}
```

| Field | Allows |
| --- | --- |
| `frameOrigins` | `<iframe>` of pages at these origins (`frame-src`) |
| `connectOrigins` | `fetch` and XHR to these origins (`connect-src`), for APIs that need no credentials |
| `imageOrigins` | images from these origins (`img-src`) |
| `mediaOrigins` | audio and video from these origins (`media-src`) |

- An entry is an origin in lower case, `https://host[:port]`, without a path.
  The host may start with one `*.` label followed by at least two labels
  (`https://*.example.com`), which matches subdomains at any depth. `http://`
  works for loopback hosts only (`localhost`, `*.localhost`, `127.0.0.1`),
  and hosted Studio accepts those in developer mode only. IPv6 literals such
  as `[::1]` are refused, because a Content Security Policy cannot name them;
  use `localhost`. Up to 16 per list.
- The Apps page lists the origins with a note: the user's browser contacts
  them directly, so they learn the user's address and what the user looks at,
  and the app can send them what it reads. Origins an update adds need the
  administrator's confirmation.
- Embedded pages get their own origin, cookies and storage where Studio gives
  each installation an origin of its own
  (`STUDIO_APPS_URL=https://{installation}.apps.example.org`). Where all apps
  share one apps origin, the app's frame is opaque, and so are the pages it
  embeds: many of them stay blank. Check `self.origin === 'null'` and offer
  a link with `ui.openExternal` instead. Pages that need the third party's
  sign-in, forms or popups do not work in either case.
- `connectOrigins` is for public data. The app has no secrets to send, and
  must not ship any: APIs with keys, endpoints that differ per deployment,
  and calls that must be audited go through connections.
- `connectOrigins` together with `webAssembly` or `workers` would let the
  app run code that is not in its package, e.g. WebAssembly a library fetches
  from a CDN. Studio installs such a package only if its publisher's trust
  store entry has `remoteCode: true`. Ship the binaries in the package
  instead.
- Studio refuses origins that cover its own origin or the apps origin.

### HTTP connections

An app that calls its own services, or APIs with keys, declares them as
`connections`, each with an OpenAPI document in the package and the
operations it calls (Studio app API 0.1.6,
[ADR 0047](../../docs/adr/0047-http-connections-for-apps.md)). Studio sends
the requests from its server, to the URL and with the credentials that an
administrator configures on an infrastructure. The browser and the app never
see either.

```json
"studioApi": "^0.1.6",
"permissions": ["studio.aas.read", "studio.connections"],
"connections": [{
  "id": "orders",
  "title": { "en": "Work-order service" },
  "api": "api/work-orders.openapi.json",
  "operations": ["listOrders", "createOrder", "getOrder", "updateOrder", "addPhoto"]
}]
```

```ts
const answer = await studio.connections.call({
  connection: 'orders',
  operation: 'listOrders',
  query: { asset: 'urn:example:asset:pump-1', status: ['open'] },
})
// { status: 200, contentType: 'application/json', etag: null, location: null, body: [ … ] }

const current = await studio.connections.call({ connection: 'orders', operation: 'getOrder', path: { orderId: '7' } })
await studio.connections.call({
  connection: 'orders',
  operation: 'updateOrder',
  path: { orderId: '7' },
  headers: { 'If-Match': current.etag! },
  body: { status: 'done' },
})
```

- `id` is 1 to 63 lowercase letters, digits and hyphens, starting with a
  letter or digit (`weather-api`, not `weatherApi`): the administrator binds
  the connection by this ID, and `studio-app pack` refuses any other.
  `connectionIdPattern` and `connectionIdRule` of
  `@basyx/studio-sdk/protocol` give the rule.
- `api` is an OpenAPI 3.0 or 3.1 document in JSON, in the package, with only
  local references (`#/…`); bundle documents that refer to other files.
  `servers` and `security` are ignored. `operations` lists the
  `operationId`s the app calls; the others stay unreachable.
- `studio-app pack` and `verify` check the document as Studio's upload does:
  the listed operations exist once, parameters are `path`, `query` or `header`
  parameters with primitive values or arrays of them in the default styles,
  no header Studio sets itself, no body with `GET`, and schemas that compile.
- `call({ connection, operation, path?, query?, headers?, contentType?, body? })`:
  Studio fills the path template one segment per value, sends declared query
  and header parameters only, validates them and JSON bodies against the
  document's schemas, and uses the operation's method. Array parameters take
  arrays. Properties marked `readOnly` are not required in request bodies.
- `body` is a JSON value for JSON media types, a string for text, `{ fields }`
  for `application/x-www-form-urlencoded`, `{ fields, files }` for
  `multipart/form-data` (`files: { file: { fileName, contentType, bytes } }`)
  and a `Uint8Array` for anything else. `contentType` picks one of the
  operation's request media types; the default is the first. Up to 8 MiB.
- The result has the service's `status`, `contentType`, `etag`, `location`
  and `body`: a JSON value, a string, a `Uint8Array`, or `null` when empty.
  Every status is a result, so show the service's problem details yourself.
  `location` is relative to the connection's URL, like the operations'
  paths (`/orders/7`), or `null` when the service points elsewhere.
- Studio refuses the call (`StudioError`) when the manifest does not declare
  the operation (`connection_operation_not_declared`), when no connection of
  the target's infrastructure binds the app's connection
  (`connection_not_bound`, also on desktop workspaces and outside a target),
  when the user cannot open the infrastructure, when a value does not match
  (`invalid_request` with `violations`), with four calls of the page to the
  connection in flight (`connection_busy`), on redirects
  (`connection_request_refused`) and when the service cannot be reached
  (`connection_unavailable`, without the service's address). Studio audits
  every call and every refusal.
- The install dialog lists the operations as method and path; an update that
  adds operations or changes their method or path asks again.
- `sandbox.connectOrigins` remains for keyless public data the browser reads
  itself; anything with a secret, a URL that differs per deployment, the
  user's identity or calls that must be audited is a connection.

- The app sees whether a connection is bound before it calls:
  `context.connections` maps each declared connection ID to
  `{ bound: boolean }` for the frame's target (Studio app API 0.1.9, see
  [Settings](#settings)). Show "not configured" instead of calling; a call
  still checks the binding.

### Settings

What differs between deployments, such as the asset types an app lists, the
semantic IDs or idShorts it reads, or the IDs it sends to a service, belongs
in `settings`, not in the build (Studio app API 0.1.9,
[ADR 0048](../../docs/adr/0048-app-settings-and-connection-status.md)). An
administrator sets the values; the app reads them from its context.

```json
"studioApi": "^0.1.9",
"settings": [
  { "key": "assetTypes", "type": "stringList", "scope": "infrastructure", "required": true, "title": { "en": "Asset types" } },
  { "key": "units", "type": "string", "enum": ["metric", "imperial"], "default": "metric", "title": { "en": "Units" } },
  { "key": "pageSize", "type": "number", "default": 25, "title": { "en": "Shells per page" } }
]
```

```ts
const { assetTypes, pageSize } = studio.context.settings ?? {}
if (!Array.isArray(assetTypes) || assetTypes.length === 0) {
  // show "not configured": an administrator sets the asset types
}
studio.onContext(context => reload(context.settings)) // another target, other values

if (studio.context.connections?.forecast?.bound === false) {
  // show "not configured" instead of calling studio.connections.call
}
```

- Up to 32 settings. `key` is an identifier (`assetTypes`), `type` is
  `string`, `number`, `boolean` or `stringList`; `enum` lists the allowed
  values of a `string` or of the items of a `stringList`; `default` has the
  setting's type. Strings have at most 2,000 characters, lists 100 items.
- `scope: "installation"` (the default) has one value per installation, set
  on the *Apps* page. `scope: "infrastructure"` may also have one per
  infrastructure, set in the infrastructure's dialog or in the deployment's
  declared YAML (`apps: [{ app, settings }]`), which wins over the
  installation's. Workspaces use the installation's values.
- `context.settings` has every declared key: the infrastructure's value,
  else the installation's, else the default, else `null`. `required: true`
  marks a setting in Studio's forms; the app still gets `null` until a value
  is set, so handle it.
- Studio refuses values of the wrong type when they are saved. An update
  drops installation values its settings no longer accept; the update dialog
  lists added, removed and changed settings. Settings are not permissions and
  need no consent.
- **Settings are not for secrets.** Administrators, exports and every
  browser that opens the app see them. Keys, tokens and passwords belong in
  [connections](#http-connections), whose credentials stay on Studio's
  server.
- `studio-app pack` and `verify` check the declarations: unique keys, `enum`
  only for texts, defaults that fit, and `^0.1.9`.
- Both fields are absent from the context of an older Studio.

With an origin of its own, the app's frame also has `localStorage`, IndexedDB
and cookies. They belong to the installation and the browser profile, not to
the user or the target, and Studio does not clear them on sign-out. Keep
preferences there if you like, never AAS content.

`columns` gives the view's default width as a widget on a shell's Overview,
in columns of 12, per breakpoint of the Overview's width (Vuetify's names, as
in `v-col`): a breakpoint without a value uses the nearest smaller one, and
without any the view starts full width, half wide from `lg`. Widgets in a
row share its width and height, so the widths are a starting point; users
arrange each breakpoint themselves.

## Without Studio: the test transport

`connect()` needs Studio's frame. In a plain dev server and in unit tests,
`@basyx/studio-sdk/testing` provides a Studio in memory, with your fixtures
as its data:

```ts
import { createTestStudio, studioError, testTheme } from '@basyx/studio-sdk/testing'

import manifest from '../studio-app.json'

const studio = createTestStudio({
  manifest, // optional: refuse what the manifest does not declare, as Studio does
  context: { locale: 'de', submodel: { id: 'urn:example:sm:1', semanticId: null } },
  handlers: {
    'studio.aas.getSubmodel': ({ submodelId }) => {
      const submodel = submodels[submodelId]
      if (!submodel) {
        throw studioError('target_resource_not_found', 'No such submodel.', 404)
      }
      return submodel
    },
  },
})

const submodel = await studio.client.aas.getSubmodel('urn:example:sm:1')
studio.setContext({ theme: testTheme(true) }) // as when the user switches to dark mode
studio.calls // every call the app made
```

- `context` replaces parts of `testContext()`: a module on a writable target
  named "Test target", in view mode, English and Studio's light theme.
- `manifest` is the app's `studio-app.json` as imported, without a cast.
  Calls are refused as Studio refuses them: a method whose permission the
  manifest does not declare (`app_permission_not_declared`), and a
  connection or operation it does not declare (`connection_operation_not_declared`),
  before any handler. The context names the manifest's ID and its first
  module, else its first submodel view; its settings have their defaults,
  and its connections are bound. A permission Studio does not know
  fails `createTestStudio`, as it fails Studio's upload. `permissions`
  narrows the manifest's, e.g. to test the app without one; without a
  manifest, it is the list the calls are checked against.
- Studio's UI methods are answered: `getContext`, `setHeight`, `navigate`
  (moves `context.subPath`, sends the new context and is recorded in
  `studio.navigations`), `notify` (recorded in `studio.notifications`),
  `openShell` (recorded in `studio.openedShells`), `openView` (recorded in
  `studio.openedViews`; it sets `context.fullscreenOpen`, and
  `setContext({ fullscreenOpen: false })` is the user closing the dialog)
  and `embedView` (recorded in `studio.embeddedViews`, with a URL that
  shows nothing). Handlers replace them. `studio.back()` and
  `studio.forward()` move through the sub-paths that `navigate` pushed, as
  the browser's buttons do.
- Parameters and results are copied as a MessagePort copies them, a method
  without a handler is refused (`unsupported_operation`), and an error a
  handler throws reaches the app as a `StudioError`.
- Structural writes and attachments are refused outside edit mode
  (`app_edit_mode_required`), and attachments above 8 MiB, as Studio refuses
  them; `setContext({ mode: 'edit' })` switches.
- `connectionsHandler({ orders: { listOrders: ({ query }) => ({ body: [] }) } })`
  answers `studio.connections.call` with functions per connection and
  operation, as the manifest declares them. A function returns the parts of
  the answer that differ from `{ status: 200, etag: null, location: null }`
  and the body's media type; other connections are refused as unbound, other
  operations as undeclared. So is a connection that the context marks
  `{ bound: false }`.
- Without `manifest`, `testContext()` has no settings and no connections; pass them, or other values, as
  `context: { settings: { assetTypes: ['urn:example:type:pump'] }, connections: { forecast: { bound: false } } }`.

`memoryAas({ shells, submodels, conceptDescriptions })` keeps AAS content in
memory and provides handlers for the reads, `describeConcepts`,
`setElementValue`, the structural writes, `putAttachment` and `ui.readFile`,
with revisions and the conflicts Studio reports. It does not verify content with AAS Core or keep registries.

```ts
const aas = memoryAas({ submodels: [fileSystem] })
const studio = createTestStudio({ handlers: { ...aas.handlers }, context: { mode: 'edit', submodel: { id: fileSystem.id, semanticId: null } } })
aas.setFile(fileSystem.id, 'Manual', { bytes, contentType: 'application/pdf' })
aas.submodels // the content after the app's writes
```

`StudioClient` sits on a `Transport` (`call`, `onContext`, `close`):
`connect()` creates the MessagePort transport of `studio-sdk/0`
(`portTransport`), the test Studio an in-memory one. Neither changes the
protocol.

To run an app's UI in a dev server, hand the test client to it when the
page is not in a frame:

```ts
const client = import.meta.env.DEV && window.parent === window
  ? (await import('./dev-studio')).createDevStudio().client
  : await connect()
```

## Backend

Declare `"backend": { "runtime": "deno", "entry": "backend/main.js" }` and the
`studio.backend` permission. Export one function per method:

```js
/** @type {import('@basyx/studio-sdk/backend').BackendHandler} */
export async function summarize (params, { studio, settings }) {
  const page = await studio.call('studio.aas.listShells', { limit: settings.pageSize ?? 100 })
  return { shells: page.items.length }
}
```

`settings` and `connections` are those of the call's target, as in the UI's
context (Studio app API 0.1.9).

The UI calls it with `studio.backend.call('summarize', params)`. The backend
runs in Deno with no file, environment, subprocess or network access other
than Studio's capability endpoint, with the rights of the user who made the
call. It reaches the app's services through its connections, with the same
target and user (`studio.call('studio.connections.call', { … })`, bodies as
`Uint8Array` as in the UI).

## Examples

See [`examples/apps`](../../examples/apps); [`starter`](../../examples/apps/starter)
is built from the published packages.

## Desktop container capability

`studio.containers` is reserved for bundled desktop apps. Uploaded apps
requesting it are rejected; backend apps cannot call these methods. The
service uses a fixed BaSyx catalogue and local Docker/Podman sockets.

- Engines: `listEngines()`, `selectEngine(host | null)` (Unix socket or Windows pipe).
- Planning and lifecycle: `listStacks()`, `getStack(id)`, `planStack(spec, id?)`,
  `createStack({ spec, aasxFiles?, importId? })`, `changeStack({ stackId, spec, aasxFiles? })`,
  `startStack(id)`, `stopStack(id)`, `updateStack(id)`, `removeStack({ stackId, deleteData, removeInfrastructure })`.
- Progress and inspection: `getJob(id)`, `getLogs(id, component, tail?)`,
  `saveLogs(id, component)`, `getSignIn(id)`. Sign-in details contain passwords.
- Files: `pickFiles(kind, suggestedName?)` and its shortcut `pickAasxFiles()`;
  `exportStack(id, suggestedName?)`, `importStack()` and `saveLogs(id, component)`
  first pick a file, then call the method with its handle. Studio authorizes
  every pick before the host opens a native dialog; the app only receives
  single-use handles, which expire after five minutes. Cancelling returns `null`.

Mutations return jobs; poll `getJob` until it succeeds or fails. Export
includes current database data, generated credentials and exact image digests.
Show a password/data warning before calling it. Imports restore the database
before service startup; edited compose files are ignored. A bare JSON spec
imports settings without data. Keeping data on removal retains a recoverable
entry and its encrypted credentials.

Calls travel through `/app-calls`, never directly to the engine.
`ui.openTarget(id)` and `ui.openExternal(url)` require `studio.ui.navigation`;
`openExternal` accepts https, and http only to this computer, in the system
browser, and `mailto:` and `tel:` in the system's mail or phone app (Studio
app API 0.1.14). `ui.copyText(text)` requires `studio.ui.clipboard`.
`ui.saveFile(fileName, text, contentType)` requires `studio.ui.saveFiles` and
saves up to 1 MiB of text the app created, e.g. a contact as vCard, through
the browser's download or the desktop app's save dialog: frames cannot
download themselves (Studio app API 0.1.14). `openExternal`, `copyText` and
`saveFile` must be called from a click (or key press) in the app: the host
refuses them without a recent user activation. `presetSpec(preset, name)`
returns the defaults the wizard starts from.
