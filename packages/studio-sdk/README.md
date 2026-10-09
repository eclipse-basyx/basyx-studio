# @basyx/studio-sdk

Build apps for [BaSyx Studio](../../README.md): submodel views, modules and
backends that Studio installs at runtime and runs isolated from itself
([ADR 0004](../../docs/adr/0004-runtime-installable-apps.md)).

An app is a static web UI (any framework) plus an optional Deno backend,
packaged as a `.zip` with a `studio-app.json` manifest at its root. Studio runs
the UI in a sandboxed frame on a separate origin. The app reaches AAS data and
Studio functions only through this SDK, and only with the permissions it
declares, limited by the signed-in user's own rights.

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
      "semanticIds": ["https://admin-shell.io/idta/nameplate/3/0/Nameplate"]
    }]
  }
}
```

The schema is [`app-manifest.schema.json`](app-manifest.schema.json).

| Contribution | Offered | Context |
| --- | --- | --- |
| `submodelViews` | As a tab next to Studio's element tree, for submodels whose semantic ID equals one of `semanticIds` | target, shell, submodel |
| `modules` with `context: global` | Always, in the *App modules* menu, at `/apps/<installation>/<route>` | — |
| `modules` with `context: target` | While a target is open, at `/targets/<target>/apps/<installation>/<route>` | target |
| `modules` with `context: shell` | While a shell is open | target, shell |

| Permission | Allows |
| --- | --- |
| `studio.aas.read` | `aas.listShells`, `getShell`, `listSubmodels`, `getSubmodel`, `getElement` on the active target |
| `studio.aas.write` | `aas.setElementValue` (Property and MultiLanguageProperty values, with the revision read before) |
| `studio.ui.notifications` | `ui.notify` |
| `studio.ui.navigation` | `ui.navigate`: change the module's own sub-path (nested routes) |
| `studio.backend` | `backend.call`: call the app's own Deno backend |

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
`/app/<installation>/`. The frame cannot use cookies, storage, popups, forms or
network requests outside its own package.

## Backend

Declare `"backend": { "runtime": "deno", "entry": "backend/main.js" }` and the
`studio.backend` permission. Export one function per method:

```js
/** @type {import('@basyx/studio-sdk/backend').BackendHandler} */
export async function summarize (params, { studio }) {
  const page = await studio.call('studio.aas.listShells', { limit: 100 })
  return { shells: page.items.length }
}
```

The UI calls it with `studio.backend.call('summarize', params)`. The backend
runs in Deno with no file, environment, subprocess or network access other
than Studio's capability endpoint, with the rights of the user who made the
call.

## Examples

See [`examples/apps`](../../examples/apps).
