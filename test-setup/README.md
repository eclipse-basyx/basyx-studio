# Studio test environment

A local, disposable environment to develop and test Studio against every
supported target type and authentication mode. The same environment serves the
dev server, a production build, and the packaged Electron app.

All credentials in this folder are **test-only values**. Never reuse them, and
never configure the `test-cli` password-grant client in a real IdP.

```sh
pnpm testenv:up      # start and wait until healthy (about 30 s)
pnpm testenv:smoke   # verify targets, IdP configuration and access rules
pnpm testenv:large   # optional: add the "large" target for performance checks
pnpm testenv:down    # stop and discard all data
```

## Services

| Service | URL on the host | Purpose |
| --- | --- | --- |
| `keycloak` | <http://keycloak.localhost:18080> (admin console: `admin` / `admin`) | OIDC provider, realm `basyx-studio` |
| `basyx-open` | <http://localhost:18081> | Unsecured BaSyx Go AAS environment: repositories, registries (kept in sync with the repositories), discovery, history and event feed |
| `basyx-secured` | <http://localhost:18082> | BaSyx Go AAS environment with OIDC and ABAC, history and event feed; shells are listed from the repository |
| `basyx-large` | <http://localhost:18083> | Optional (`pnpm testenv:large`, compose profile `large`): unsecured BaSyx Go AAS environment with the `large` profile, registries in sync |
| `postgres` | `localhost:15432` | Database `studio` (user `studio` / `studio`) for hosted Studio metadata, plus the BaSyx databases |

BaSyx Go runs the `SNAPSHOT` images of `main`, pulled on every start
(`pull_policy: always`), so Studio is tested against upstream changes as they
land, as the BaSyx TypeScript SDK's integration tests are. Keycloak (`26.8.0`)
and PostgreSQL (`18`) are pinned.

The issuer is `http://keycloak.localhost:18080/realms/basyx-studio`. It must be
byte-identical for the browser, the Studio BFF and BaSyx Go. `*.localhost`
resolves to loopback in browsers, on macOS and on most Linux systems, and the
BaSyx containers map it to the Docker host gateway. If it doesn't resolve on
your machine, add `127.0.0.1 keycloak.localhost` to `/etc/hosts`.

## Targets for Studio

The secured infrastructure is deliberately registered twice, once per
authentication mode. This also exercises multiple independently authenticated
targets within one Studio session.

| Target | Endpoints (all roles) | `securityMode` | Credentials |
| --- | --- | --- | --- |
| Open | `http://localhost:18081` | `unsecured` | none |
| Secured (as user) | `http://localhost:18082` | `delegated_user` | Login of the Studio user; scope `openid basyx-api` |
| Secured (as Studio) | `http://localhost:18082` | `deployment_client_credentials` | client `studio-service`, secret `studio-service-test-secret` |

The AAS environment serves `/shells`, `/submodels` and `/concept-descriptions`
from one base URL, and, on the same URL, the registries (`/shell-descriptors`,
`/submodel-descriptors`) and discovery (`/lookup/shells`). Both targets record
history (`$history`) and serve the event feed (`/events`), and announce them in
`/description`, so Studio detects them as it would on any server. Only `open`
keeps its registries filled (registry sync); `secured` tests the
repository-only path.

Register them in Studio under *Infrastructures* (signed in as `studio-admin`),
always with *Allow loopback and private-network addresses* enabled:

| Target | Access mode | Issuer | Client ID | Scopes | Client secret |
| --- | --- | --- | --- | --- | --- |
| Open | Unsecured | – | – | – | – |
| Secured (as user), hosted/dev | Your account | `http://keycloak.localhost:18080/realms/basyx-studio` | `studio-web` | `openid basyx-api` | `env:STUDIO_OIDC_CLIENT_SECRET` |
| Secured (as user), desktop | Your account | same | `studio-desktop` | `openid basyx-api` | none (public client), loopback host `127.0.0.1` |
| Secured (as Studio) | Studio service account | same | `studio-service` | `basyx-api` | `env:STUDIO_TESTENV_SERVICE_SECRET` (hosted) or the secret value (desktop) |

`.env.example` in the repository root provides the matching Studio
configuration and the environment variables these secret references point to.

### Test data

| Target | Content |
| --- | --- |
| Open | `IESEDriveMotorDM3000.aasx` (realistic nameplate, technical data, documentation) |
| Open | `EdgeCasesShell`: every submodel element kind, collections nested 5 levels deep, list of collections, list of lists (`NestedLists[1][0]`), an operation with in/out/inout variables, a hyphenated idShort, an empty value, a 300-element submodel, and a dangling submodel reference that returns 404 |
| Open | 60 `PagingShell…` shells for cursor paging |
| Open | `studio-3d-models.aasx`: `Models3DDemo` with `Files3D` (an L bracket as STL, OBJ, glTF, GLB and STEP, a glTF with its geometry and one with its texture in a missing file, and a small IFC building) and an IDTA 02026 `Models3D` submodel (two versions, an external-only model, a JT model the viewer does not read) |
| Open | `studio-file-previews.aasx`: `FilePreviewsDemo` for the file viewer, with the `Models3D` submodel above, an IDTA 02004 2.0 `HandoverDocumentation` (PDFs of one and five pages, a drawing as PNG and SVG, a BMP photo, Markdown release notes, preview images, and external PDFs at hosts with and without CORS), a `FileSystem` submodel for the *Files* app, and `FileFormats`: text formats (Markdown, JSON valid and broken, XML, YAML, CSV with commas and semicolons, TSV, HTML, code and configuration files), images (an SVG with a script that must not run), PDFs, misleading content types (Markdown as `application/octet-stream`, text as `image/png`, binary as `text/plain`), Latin-1 and UTF-16 text, an 11 MiB log above the text limit, a File without a value and one whose file the server does not have, external links (with and without CORS, a redirect, an unreachable host), Blobs (text, JSON, Markdown, CSV, PNG, SVG, PDF, STL), a WAV tone and a file without a preview. BaSyx Go drops the `charset` parameter of the Latin-1 file's content type |
| Open | `studio-handover-documentation.aasx`: `HandoverDocumentationDemo` for the *Documents* app, a gear motor's documents twice: as IDTA 02004 Handover Documentation 2.0 (nine documents in nine VDI 2770 classes and a manufacturer's own; a manual with two versions, the newer one in English and German with two PDFs, and its German translation as a document of its own; a drawing as PNG and SVG; maintenance instructions whose latest version is in review; a CSV parts list, Markdown safety instructions, an external data sheet and a document without a file; relations between documents, an `Entities` list and a reference to another shell) and as 1.2 (numbered collections: three of these documents). |
| Open | `studio-nameplate.aasx`: `NameplateDemo` for the *Digital Nameplate* and *Contacts* apps, a gear motor with an IDTA 02006 Digital Nameplate 3.0 (logo, the manufacturer's address with phone, fax, email and link, hardware, firmware and software versions, four markings with images, certificates and dates, one expired, and asset specific properties of two guidelines and a rating plate photo) and IDTA 02002 Contact Information 1.0 (four contacts: a technical contact with name, titles, two languages, mobile phone, email with public key and a video call link; a commercial contact without a person, with fax; a hazardous goods contact at a PO box; and a US service hotline whose role is given by name), and `NameplateDemo20` and `NameplateDemo10` with the nameplate as 2.0 (`ContactInformation`, ECLASS semantic IDs, numbered markings) and as 1.0 (`Address`) |
| Open | `studio-technical-data.aasx`: `TechnicalDataDemo` for the *Technical Data* app, a servo drive with IDTA 02003 Technical Data 2.0 (logo, three product images with notes, an ECLASS class that refers to its area and an IEC CDD class, two areas of technical properties with nested sections, ranges, one open-ended, booleans, a date, a text in two languages and a dimension drawing, some with descriptions of their own, specific descriptions, further information) and concept descriptions with units, names and definitions in English and German, two of them under the `api.eclass-cdp.com` spelling of their ID and one named by a supplemental semantic ID only; and `TechnicalDataDemo12` with the product as ZVEI Technical Data 1.2 (`MainSection`, `SubSection`, `SemanticIdNotAvailable`, numbered images, and the template's ValidDate with ManufacturerOrderCode's semantic ID). 70 shells in total |
| Secured | `SecuredPublicShell` (with `Nameplate`, which has the Digital Nameplate 3.0 semantic ID, and the restricted `Costs` submodel) and `SecuredInternalShell` |
| Large | 2,000 shells `LargeShell0001`… (every fifth a type, all with the shared `Nameplate`), and `LargeTree` on `LargeShell0001`: a list of 1,000 collections (about 5,000 elements), `Deep.Level1.Level2.Level3.Leaf` and 50 numeric readings |

The JSON fixtures are generated and checked with AAS Core 3.1 by
`fixtures/generate-fixtures.mjs`, the 3D models and their AASX by
`fixtures/generate-models3d.mjs`, the file previews and the handover
documentation demo (whose submodels the unit tests read from
`fixtures/handover-documentation/`) by `fixtures/generate-file-previews.mjs`,
and the nameplate demo (read by the unit tests from `fixtures/nameplate/`) by
`fixtures/generate-nameplate.mjs` (all `pnpm testenv:fixtures`). The `large`
profile is generated on demand by `pnpm testenv:large` into `fixtures/large/`,
which is not checked in; register it in Studio like *Open*, with the URL
`http://localhost:18083`. BaSyx loads them at
startup through `GENERAL_AAS_PRECONFIG_PATHS`.

### Users and expected access on the secured target

| User (password = user name) | Roles | Studio | Secured target |
| --- | --- | --- | --- |
| `studio-admin` | `studio-admin`, `basyx-admin` | admin | full access |
| `alice` | `basyx-reader` | user | reads both shells and all submodels |
| `dave` | `basyx-editor` | user | reads everything and may update existing resources (no create or delete) |
| `carol` | `basyx-limited` | user | sees only `SecuredPublicShell`; sees both of its submodel references but gets **403** on `Costs` (partial access) |
| `bob` | none | user | **403** on everything |
| service account `studio-service` | `basyx-editor` | n/a | reads both shells and may update existing resources |

BaSyx Go behaviours that Studio must handle (all checked by the smoke test):

- **No token gives 403, not 401.** Studio can't detect "target login required"
  from a 401. It must use its own state: no credential held for this target
  results in the typed `409` target-authentication state.
- **Invalid token or wrong audience gives 401.**
- **List indexes in idShortPaths must be URL-encoded** (`Items%5B1%5D`), and
  this works.
- **Conditional requests (RFC 9110).** Reads of single resources return a
  strong `ETag`; writes evaluate `If-Match` and answer `412` when it is stale.
  A submodel element shares the revision of its submodel, and a `412` carries
  no current `ETag`.

## IdP configuration per Studio runtime

| Runtime | How it is started | Studio base URL | OIDC client | Redirect URI |
| --- | --- | --- | --- | --- |
| Dev server | `pnpm dev` | `http://localhost:3000` | `studio-web` (confidential) | `http://localhost:3000/api/studio/v1/auth/callback` |
| Production build | `pnpm build && node .output/server/index.mjs` | `http://localhost:3000` | `studio-web` (confidential) | same |
| Electron dev | `pnpm dev:electron` (uses the dev server's BFF) | `http://localhost:3000` | `studio-web` | same |
| Electron packaged | installed app, local BFF on a random loopback port | `http://127.0.0.1:<random>` | `studio-desktop` (**public**, no secret) | `http://127.0.0.1:<random>/api/studio/v1/auth/callback` |

One callback path serves both Studio login and per-target authorization. The
`studio-web` secret is `studio-web-test-secret`. PKCE (`S256`) is mandatory for
both interactive clients.

A desktop app can't keep a client secret, so the packaged app uses a public
client and an RFC 8252 loopback redirect. Keycloak 26 accepts **any port** for
a registered `http://127.0.0.1/<path>` redirect, but not for `localhost`.

## IdP-agnostic rules for Studio

The test realm intentionally issues tokens shaped like Microsoft Entra ID
tokens, so Keycloak-specific assumptions fail early:

1. **Configure by discovery only.** Studio needs the issuer URL, client ID, the
   client secret reference (confidential clients only) and scopes. It must never
   construct realm or tenant URLs.
2. **Roles come from a configurable claim** (default `roles`, a flat string
   array). The realm doesn't emit Keycloak's `realm_access`.
3. **The Studio login token is not a BaSyx token.** Its audience is the Studio
   client. A target needs its own access token, obtained with target-specific
   scopes:
   - here `basyx-api`;
   - in Entra `api://<basyx-api>/access_as_user`, or `api://<basyx-api>/.default`
     for client credentials.

   Entra issues one resource per access token, so per-target token acquisition
   is required, not optional.
4. **Validate `state`, `nonce` and PKCE in the callback**, and also the `iss`
   authorization-response parameter (RFC 9207), which Keycloak and Entra send.
5. **The desktop loopback host is configurable**:
   - `127.0.0.1` for Keycloak and RFC 8252 providers;
   - `localhost` for Entra, which ignores the port only for `localhost`
     redirect URIs (an `http://127.0.0.1` redirect can only be added through the
     app manifest).
6. **Assume an access-token lifetime of 300 s.** Expect refresh during
   ordinary use; the realm rotates refresh tokens.

## Mapping to Microsoft Entra ID

| Test realm | Entra ID equivalent |
| --- | --- |
| Issuer `…/realms/basyx-studio` | `https://login.microsoftonline.com/<tenant-id>/v2.0` |
| Client scope `basyx-api` (adds audience `basyx-api`) | App registration **BaSyx API**:<br>• *Expose an API* with scope `access_as_user`<br>• manifest `"requestedAccessTokenVersion": 2`, so `aud` is the API's client ID |
| Realm roles `basyx-reader`, `basyx-limited`, `basyx-admin` | App roles on **BaSyx API**, allowed for users/groups and applications |
| Realm role `studio-admin` | App role on the **Studio** app registration (appears in the ID token's `roles`) |
| Client `studio-web` | App registration **Studio**:<br>• platform *Web*, redirect `https://<studio-host>/api/studio/v1/auth/callback`<br>• client secret or certificate<br>• delegated permission `access_as_user` on BaSyx API<br>• use a separate registration for `http://localhost:3000` development |
| Client `studio-desktop` | Public app registration:<br>• platform *Mobile and desktop applications*<br>• redirect `http://localhost/api/studio/v1/auth/callback` (port ignored)<br>• delegated permission `access_as_user` |
| Client `studio-service` (client credentials) | Studio's own registration or a separate one:<br>• *application* permission `basyx-editor` on BaSyx API, with admin consent<br>• token scope `api://<basyx-api>/.default` |
| BaSyx trustlist `audience: basyx-api` | `audience: <basyx-api-client-id>` |

For BaSyx Go with Entra, see
[`examples/BaSyxEntraIDExample`](https://github.com/eclipse-basyx/basyx-go-components/tree/main/examples/BaSyxEntraIDExample).
Delegated tokens carry `scp`; app-only tokens carry only `roles`. Rules that must
accept both should use `{"CLAIMPATH": "/roles"}` with `$contains`, as this
environment's `basyx/secured/access-rules.json` does, and not require scopes.
Prefer app roles over the `groups` claim: Entra replaces groups with an overage
indicator above 200 groups.

Other providers (Ory Hydra, Authentik, Auth0, …) need the same building blocks:
- OIDC discovery;
- authorization code with PKCE;
- confidential and public clients;
- a client-credentials client;
- an audience or resource mechanism for the BaSyx API;
- a flat roles claim (or a BaSyx `claimMappings` entry).

`basyx-go-components/examples/BaSyxOryHydraExample` shows Ory.

## Files

| Path | Content |
| --- | --- |
| `docker-compose.yaml` | All services (compose project `basyx-studio-testenv`) |
| `keycloak/realm-basyx-studio.json` | Realm, clients, scopes, roles and users (imported on start) |
| `basyx/secured/trustlist.json` | Accepted issuer and audience for BaSyx Go |
| `basyx/secured/access-rules.json` | ABAC rules (re-imported on every start) |
| `postgres/init.sql` | Studio and BaSyx databases and users |
| `fixtures/` | Preloaded AAS data and its generator |
| `smoke-test.mjs` | Executable specification of everything above |

## Troubleshooting

- **Port already in use.** Change the host port in `docker-compose.yaml`. If you
  change Keycloak's port, also update `KC_HOSTNAME`, `basyx/secured/trustlist.json`
  and `smoke-test.mjs`, because the issuer contains the port.
- **`basyx-secured` restarts.** It needs Keycloak's discovery document at
  startup; it waits for Keycloak's health check and retries automatically.
- **Changed fixtures, rules or realm** take effect after
  `pnpm testenv:down && pnpm testenv:up`.
