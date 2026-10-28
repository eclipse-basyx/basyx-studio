# @basyx/studio-app-kit

Build [BaSyx Studio](../../README.md) apps with Vue and Vuetify that look like
Studio, and package them with Studio's own checks
([ADR 0043](../../docs/adr/0043-published-sdk-and-app-kit.md)). Studio's
bundled apps use the kit as an app from another repository does.

```bash
pnpm add @basyx/studio-sdk @basyx/studio-app-kit vue vuetify
pnpm add -D vite @vitejs/plugin-vue sass
```

[`examples/apps/starter`](../../examples/apps/starter) is a complete app in
its own repository.

## Mounting an app

```ts
import { mountApp } from '@basyx/studio-app-kit'
import { VApp } from 'vuetify/components/VApp'
import { VList, VListItem } from 'vuetify/components/VList'
import App from './App.vue'

await mountApp(App, { VApp, VList, VListItem })
```

`mountApp` connects to Studio, creates Vuetify with Studio's defaults,
aliases (`<v-btn-primary>`, `<v-btn-link>` for values that open something,
`<v-table-details>` for label and value rows, `<v-table-sheet>` for a table
with column headers and group rows such as a data sheet, `<v-text-field-search>`
for a search over what a view shows, as Studio's shell list search, `<v-card-header>` for the
tinted header of a dialog's or section's card, `<v-card-section>` for a part
of a view in a card of its own, `<v-btn-toggle-icon>` for icon-only choices in a
`<v-btn-toggle>`, `<v-card-fullscreen>` for a view that fills the window,
`<v-view-card>`), the `v-tooltip` directive and icons, follows Studio's
theme, mounts `App` into `#app` with the client as its `client` prop, and
sizes the frame to the content. Pass `{ client }` to run on another client,
e.g. the test Studio of `@basyx/studio-sdk/testing` in a dev server, and
`{ setup: (app, client) => … }` to install plugins, e.g. a router, before
the app mounts.

| Entry | What |
| --- | --- |
| `@basyx/studio-app-kit` | `mountApp`, `loadSubmodel`, and the AAS helpers below |
| `@basyx/studio-app-kit/aas` | Reading AAS JSON without Vue: `childrenOf`, `child`, `langText`, `textOf`, `humanize`, `fileRef`; elements of a template across its versions by idShort or semantic ID (`ElementSpec`, `childrenMatching`, `childMatching`, `matchesSpec`, `hasSpecName`, `conceptOf`; an idShort wins over a semantic ID) and `TextField`s and `RangeField`s to show and change (`textFieldOf`, `rangeFieldOf`, `fieldText`) |
| `@basyx/studio-app-kit/contacts` | IDTA 02002 contact information without Vue: `parseContactInformations`, `parseContactInformation` (also a nameplate's address), `contactName`, `addressLines`, `contactRows` in Studio's seven locales, value lists (`contactRole`, `channelType`), `telUrl`, `mailtoUrl`, `mapUrl`, `contactVCard` ([Contacts](#contacts)) |
| `@basyx/studio-app-kit/editing` | Changing values in place in Studio's edit mode, with Vue: `useFieldEditor` for Properties, MultiLanguageProperties (in the language shown) and Ranges, and `provideRowActions` / `useRowActions` for what rows do ([Editing values](#editing-values)) |
| `@basyx/studio-app-kit/i18n` | `provideI18n(client, base, translations, { baseLocale })` and `useI18n()`: texts that follow Studio's locale, the base catalog as fallback ([Texts](#texts)) |
| `@basyx/studio-app-kit/router` | `createStudioHistory(client, { history })`: a Vue Router history over a module's sub-path ([Modules with pages](#modules-with-pages)) |
| `@basyx/studio-app-kit/defaults` | The Vuetify defaults of `mountApp`, e.g. for lint rules |
| `@basyx/studio-app-kit/vuetify-defaults` | The defaults Studio and its apps share (fields, button groups, menus, the app bar, drawers, toolbars and tabs) |
| `@basyx/studio-app-kit/settings.scss` | Studio's Vuetify Sass settings |
| `@basyx/studio-app-kit/vite` | The `studioApp()` Vite preset |
| `@basyx/studio-app-kit/manifest`, `/package`, `/signature` | The checks, packing and signatures of `studio-app`, for Node; `manifest` also indexes and compiles the OpenAPI documents of `connections` (`checkConnectionApis`) |

Views render flat inside the card Studio draws; build the UI from Vuetify
components and utility classes, as Studio does.

## Texts

```ts
import { provideI18n, useI18n } from '@basyx/studio-app-kit/i18n'
import de from './locales/de.json'
import en from './locales/en.json'

// In the root component; `useI18n()` in the others.
const { t, locale, formatLocale } = provideI18n(client, en, { de })
t('shells.counts.instances') // nested keys, at any depth
new Intl.NumberFormat(formatLocale.value).format(1234.5)
```

- The texts follow Studio's locale (`locale`): its catalog, then its
  language's (Studio's German dialects such as `de-saar` use `de`), then the
  base catalog. A missing key shows as the key.
- The base catalog is English unless `{ baseLocale }` says otherwise: an app
  whose first language is German passes
  `provideI18n(client, de, { en }, { baseLocale: 'de' })`, and its texts fall
  back to German.
- `formatLocale` is the locale of the catalog the texts come from, as a BCP
  47 tag (`de-saar` → `de`): format numbers and dates with it, with `Intl` or
  Vuetify's locale, so they match the texts and not a language the app has no
  texts in.
- Catalogs nest to any depth (`section.group.key`); a translation has the
  base catalog's keys, any of them missing (`PartialCatalog`). Two-level
  catalogs stay valid.

## Contacts

`@basyx/studio-app-kit/contacts` reads the contacts of IDTA 02002 Contact
Information 1.0 and the manufacturer's address of the Digital Nameplate
(`AddressInformation` in 3.0, `ContactInformation` in 2.0, `Address` in 1.0)
by idShort or semantic ID, numbered or in lists, as Studio's Contacts and
Digital Nameplate apps do:

```ts
import { contactName, contactRows, contactVCard, parseContactInformations, vCardFileName } from '@basyx/studio-app-kit/contacts'

for (const contact of parseContactInformations(submodel)) {
  contactName(contact, locale) // "Dr. Jane Doe"
  contactRows(contact, locale) // role, company, address with map link, phone with tel: URL, …
  await client.ui.saveFile(vCardFileName(contact, locale), contactVCard(contact, locale), 'text/vcard')
}
```

Rows are labelled in Studio's seven UI locales, with the role and the
types of phone, fax and email from their ECLASS value lists, countries and
languages from `Intl`. `contactRows(contact, locale, { edit: true })` gives
one row per element instead, each with the `TextField` to change through
`aas.setElementValue`. The vCard is version 3.0 (RFC 2426); saving it needs
`studio.ui.saveFiles`, opening `mailto:` and `tel:` URLs
`studio.ui.navigation` (Studio app API 0.1.14).

## Editing values

`@basyx/studio-app-kit/editing` changes values in place in Studio's edit
mode, as the Digital Nameplate, Contacts and Technical Data apps do:

```ts
import { textFieldOf, rangeFieldOf } from '@basyx/studio-app-kit/aas'
import { provideRowActions, useFieldEditor } from '@basyx/studio-app-kit/editing'

const editor = useFieldEditor({ client, t, locale: () => formatLocale.value, submodelId: () => submodelId, onSaved: async () => reload() })
await editor.start(textFieldOf(node) ?? rangeFieldOf(node)!, 'Rated power')
editor.draft.value!.value = '3.2' // a Range's lower bound; `max` its upper one
await editor.save()
```

- `start` reads the element again for its revision, and `save` writes based
  on it, so a change made in the meantime is a conflict (`edit.conflict` of
  the app's catalog), not overwritten; `edit.forbidden` is shown where the
  user may not change it.
- A MultiLanguageProperty changes in the language the view shows, else
  English, else the first; its other languages stay.
- A Property and a MultiLanguageProperty are written with
  `aas.setElementValue`, a Range with `aas.putElement`, which needs Studio's
  edit mode (Studio app API 0.1.15). An empty bound is left out.
- `provideRowActions({ canEdit, editor, open, copy, preview })` in the root
  component hands every row what it can do; `useRowActions()` takes it.

## Dialogs

Dialogs look and close as Studio's own (`app/components/DialogCard.vue` in
Studio): a `<v-card>` with a `<v-card-header>` that holds the title only, a
`<v-divider>`, the body in `<v-card-text class="pa-4">`, another divider, and
`<v-card-actions>` with further actions on the left (`<v-btn-secondary>`), a
`<v-spacer>`, and *Close* or *Cancel* and the main action on the right. They
close from their actions, Esc or a click outside, not from an icon in the
header. The buttons in `<v-card-actions>` are as tall as Studio's; elsewhere
in a view they are comfortable, so the view stays compact.

A view whose frame is only as tall as its content, such as a widget on a
shell's Overview, shows a dialog with the window's size by opening itself
again without Studio's header (`client.ui.openFullscreen(state, { header:
false })`): there it renders the `<v-dialog>` with `:scrim="false"`, as
Studio dims the page, and calls `client.ui.closeFullscreen()` when it closes.

## Modules with pages

A full-page module (`"layout": "fullPage"`,
[ADR 0045](../../docs/adr/0045-app-origins-embeds-and-full-page-modules.md))
fills the page below Studio's app bar and beside its rail. One with pages of
its own uses Vue Router (`pnpm add vue-router`) on the module's sub-path:

```ts
import { mountApp } from '@basyx/studio-app-kit'
import { createStudioHistory } from '@basyx/studio-app-kit/router'
import { createRouter } from 'vue-router'

await mountApp(App, components, {
  setup: (app, client) => {
    app.use(createRouter({
      history: createStudioHistory(client, { history: 'push' }),
      routes: [
        { path: '/', component: OverviewPage },
        { path: '/shells', component: ShellsPage },
        { path: '/shells/:shell', component: ShellPage, props: true },
      ],
    }))
  },
})
```

- Route changes call `client.ui.navigate` (permission
  `studio.ui.navigation`) with the route's path as the sub-path, so Studio's
  URL names the page (`…/inventory/shells/<key>`) and a link to it opens it.
  A sub-path Studio changes, e.g. a link opened in Studio, moves the router.
  Studio gets one move at a time: of rapid route changes, it gets the
  latest page once it reached the previous one.
- Sub-paths are path segments of letters, digits and `-._~`: encode IDs in
  routes, e.g. as base64url. Query and hash stay in the frame. Studio
  refuses other sub-paths; the history logs the refusal.
- With `{ history: 'push' }`, each new page is an entry in the browser's
  history: back and forward move between the module's pages, and the
  router follows. It needs Studio app API 0.1.8, so the manifest declares
  `"studioApi": "^0.1.8"`. Without it, Studio replaces its entry, so back
  leaves the module, as on older Studios.
- A sandboxed frame cannot move the browser's history itself:
  `router.back()` and `router.go()` move through the pages the module
  visited and replace Studio's entry with that page.
- Lay the module out with Vuetify's layout components and the kit's
  defaults, which match Studio's (`layoutDefaults` in `./vuetify-defaults`):
  a `<v-toolbar>` with the module's title and its pages as `<v-tabs>`, or a
  `<v-navigation-drawer>` of its pages, in `<v-main>`. Do not add a second
  `<v-app-bar>` or rail: Studio's stay above and beside the frame. Studio
  shows no breadcrumbs above a full-page module, so show the target's name
  where the app needs it (`context.target.name`).
- The kit's defaults style these components (a flat, bordered app bar and
  drawer; compact, transparent toolbars; tabs in the primary color); state
  none of these props in a template. Studio's ESLint rules refuse restated
  defaults in the apps it lints, e.g. with `restatedDefaults(appDefaults)`
  of its `eslint.config.js`.

[`examples/apps/inventory`](../../examples/apps/inventory) is a full-page
module with three pages built this way.

## Vite

```ts
import { studioApp } from '@basyx/studio-app-kit/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({ plugins: [vue(), studioApp()] })
```

The preset builds `ui/index.html` to `dist/ui/` with relative URLs, as
Studio serves an app under `/app/<installation>/ui/`, and compiles Vuetify's
Sass with Studio's settings, in the dev server too. Workers are ES modules,
and occt-import-js (STEP in `@basyx/file-viewer`) is built without
`new Function`, which app frames forbid. `studioApp({ root: 'web' })` uses
another folder.

## The `studio-app` command

```bash
studio-app pack [project] [--dist dist] [--include backend] [--include api] [--out <file or folder>]
studio-app sign <package.zip> --key signing.pem [--out <file>]
studio-app verify <package.zip> [--key signing.pub] [--signature <file>]
```

- `pack` packages `studio-app.json`, the files below `dist/` at their paths
  there, and each `--include` folder at its own path, as
  `<id>-<version>.zip`. The same files always give the same bytes.
- `pack` and `verify` run the checks of Studio's upload (ADR 0016): the
  manifest schema, unique contribution IDs and routes, entries that exist,
  the backend permission, the format of `sandbox` origins, an app API range
  that includes every field the manifest uses (`^0.1.3` for origins and
  `layout`, `^0.1.6` for `connections`, `^0.1.9` for `settings`), the app API range against the
  installed `@basyx/studio-sdk`, file types and archive limits (20 MiB,
  50 MiB expanded, 2,000 entries).
- For `connections` ([ADR 0047](../../docs/adr/0047-http-connections-for-apps.md)),
  they also check each OpenAPI document as Studio's upload does: JSON,
  OpenAPI 3.0 or 3.1, at most 4 MiB, only local `$ref`s, every listed
  `operationId` exactly once, parameters Studio can send, no body with `GET`
  or `HEAD`, and schemas that compile. A finding names the document and a
  JSON pointer into it, e.g. `api/orders.json#/paths/~1orders/get/parameters/2`.
  Keep the document outside `dist/` and pack it with `--include api`, or put
  it in Vite's `public` folder; `api` names its package path. `pack` and
  `verify` print a note that the connections need an administrator's
  binding.
- For `settings` ([ADR 0048](../../docs/adr/0048-app-settings-and-connection-status.md)),
  they check unique keys, `enum` only on `string` and `stringList`, and
  defaults the setting accepts, and note required settings without a
  default. `checkSettingValue(setting, value)` and
  `checkSettingValues(manifest, values, { path, scope })` of
  `@basyx/studio-app-kit/manifest` are the checks Studio applies to every
  value it stores.
  Studio's server imports the same code. The runtime, origins that cover the
  deployment's own, and the trust store's `remoteCode` grant for
  `connectOrigins` with `webAssembly` or `workers` are checked at install
  ([ADR 0045](../../docs/adr/0045-app-origins-embeds-and-full-page-modules.md));
  `pack` and `verify` print a note when a package needs that grant.
- `sign` writes `<package.zip>.sig`: ECDSA P-256 with SHA-256 over the exact
  package bytes, DER-encoded, in base64. That is what
  `cosign sign-blob --key --output-signature` writes, so
  `cosign verify-blob --key signing.pub` checks it. `verify` also reads the
  Sigstore bundle that cosign 3 writes by default, as Studio does
  ([ADR 0044](../../docs/adr/0044-app-package-signatures-trust-store-and-updates.md)).
  The key is PEM (PKCS#8 or SEC1); an encrypted PKCS#8 key takes its
  passphrase from `STUDIO_APP_KEY_PASSPHRASE`. Cosign's own encrypted key
  files are not read; sign with cosign if your key is one.
- `verify --key` also checks the signature and prints the key's
  fingerprint (`sha256:` of its public key).

A key pair:

```bash
openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt -out signing.pem
openssl ec -in signing.pem -pubout -out signing.pub
```

Keep `signing.pem` in your CI's secrets; give `signing.pub` to the operators
of the Studio deployments that install your app.

Versions follow `@basyx/studio-sdk` ([version table](../studio-sdk/README.md#versions)).
