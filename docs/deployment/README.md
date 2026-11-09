# Deploying BaSyx Studio

The hosted Studio Service ships as one container image,
`eclipsebasyx/basyx-studio`, for `linux/amd64` and `linux/arm64`
([ADR 0035](../adr/0035-container-image-and-base-path.md)). It is configured
by environment variables only, so it runs the same with `docker run`, Docker
Compose and Kubernetes.

- [Quick start](#quick-start)
- [Image tags and verification](#image-tags-and-verification)
- [Configuration reference](#configuration-reference)
- [Base path and reverse proxy](#base-path-and-reverse-proxy)
- [Declared infrastructures](#declared-infrastructures)
- [Without login](#without-login)
- [Kubernetes notes](#kubernetes-notes)

## Quick start

```bash
docker run -p 127.0.0.1:3000:3000 \
  -e STUDIO_PUBLIC_URL=http://localhost:3000 \
  -e STUDIO_DATA_KEY="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')" \
  -e STUDIO_AUTH_MODE=none -e STUDIO_ANONYMOUS_ROLES=studio-admin \
  -v studio-data:/data \
  eclipsebasyx/basyx-studio:SNAPSHOT
```

This starts Studio without login on your machine, published on loopback only
because every visitor is an administrator, with an embedded database in the
`studio-data` volume. Keep the data key: it encrypts stored tokens and
secrets, and a new key cannot read them.

Five Compose examples go further:

- [`examples/deployment/quickstart`](../../examples/deployment/quickstart):
  Studio without login and a BaSyx Go AAS environment, declared as a managed
  infrastructure.
- [`examples/deployment/production-like`](../../examples/deployment/production-like):
  Studio under `/studio/` behind Caddy with a separate apps origin, Keycloak
  login, PostgreSQL, the data key as a Docker secret, a read-only root file
  system, and BaSyx Go.
- [`examples/deployment/time-series`](../../examples/deployment/time-series):
  the quick start plus InfluxDB 2.7 with a simulated climate sensor, a Time
  Series Data submodel, and an `influxdb2` connection with a read-only token
  (see [Connections and time series](#connections-and-time-series)). Its
  `smoke-test.mjs` checks the stack end to end and runs in CI.
- [`examples/deployment/signed-app`](../../examples/deployment/signed-app):
  a trust store, a directory of managed packages, and a guide for signing apps
  with cosign in another repository's CI (see [Signed apps](#signed-apps)).
- [`examples/deployment/http-connections`](../../examples/deployment/http-connections):
  Keycloak login with token exchange, a mock work-order service, and the
  work-orders example app calling it with a static token and as the signed-in
  user (see [HTTP connections for apps](#http-connections-for-apps)).

## Image tags and verification

| Tag | Published | Use |
| --- | --- | --- |
| `SNAPSHOT` | every merge to `main` | trying the latest state |
| `SNAPSHOT-<yyyymmdd-hhmmss>-<sha>`, `<sha>` | every merge to `main` | pinning a snapshot |
| `<version>` (for example `0.2.0`) | every GitHub release | production |
| `latest` | every release that is not a prerelease | the newest release |

Images are signed keyless with cosign and carry SLSA provenance and an SPDX
SBOM. Releases also attach SPDX and CycloneDX files to the GitHub release.

```bash
cosign verify eclipsebasyx/basyx-studio:SNAPSHOT \
  --certificate-identity https://github.com/eclipse-basyx/basyx-studio/.github/workflows/docker-snapshot.yml@refs/heads/main \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

For a release, use `docker-release.yml@refs/tags/<tag>` as the identity.

## Configuration reference

Variables marked *file* also accept `<NAME>_FILE` with a path to a file that
holds the value (for Docker and Kubernetes secrets); set one or the other.

### Required

| Variable | Description |
| --- | --- |
| `STUDIO_PUBLIC_URL` | URL under which users reach Studio, e.g. `https://example.org/studio`. Used for redirects and Origin checks. Its path, if any, must equal the base path. |
| `STUDIO_DATA_KEY` (*file*) | 32 random bytes, base64url. Encrypts tokens and stored secrets at rest. |
| `STUDIO_OIDC_ISSUER`, `STUDIO_OIDC_CLIENT_ID` | The Studio login (OIDC authorization code with PKCE). Not needed with `STUDIO_AUTH_MODE=none`. |

### Service

| Variable | Default | Description |
| --- | --- | --- |
| `STUDIO_BASE_PATH` | `/` | Path Studio is served under, e.g. `/studio`. The image's launcher turns it into Nuxt's `NUXT_APP_BASE_URL`; set that one when running `.output/server/index.mjs` yourself. |
| `NITRO_PORT` / `PORT` | `3000` | Listening port. |
| `STUDIO_DATABASE_URL` | none | PostgreSQL for metadata, e.g. `postgres://studio:…@db:5432/studio`. Without it, Studio embeds PGlite in `STUDIO_DATA_DIR` (one replica only). |
| `STUDIO_DATA_DIR` | `/data` in the image | PGlite database and backend app files. |
| `STUDIO_SESSION_TTL_HOURS` | `12` | Lifetime of a Studio session. |
| `STUDIO_UPLOAD_MAX_BYTES` | 100 MiB | Largest AASX, JSON or XML file users may upload. |
| `STUDIO_PRIVATE_NETWORK_TARGETS` | `deny` | `allow` lets infrastructures on private or loopback addresses be used (each also needs `allowPrivateNetwork`). Needed for services on the same Compose or cluster network. |
| `STUDIO_EXTERNAL_FILE_ORIGINS` | none (desktop: `*`) | Origins, comma-separated, whose files Studio's server fetches when AAS content names a file there and the browser may not read it (no CORS headers), e.g. `https://c1.api.wago.com`. `*` allows any public HTTPS origin, never private addresses. See [ADR 0042](../adr/0042-external-files-through-studio.md). |
| `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` | none | Proxy for Studio's outbound requests, also in lower case, which takes precedence ([below](#outbound-proxy)). |

### Login

| Variable | Default | Description |
| --- | --- | --- |
| `STUDIO_AUTH_MODE` | `oidc` | `none` turns the login off ([below](#without-login)). |
| `STUDIO_ANONYMOUS_ROLES` | none | Roles of the anonymous user (comma-separated) with `STUDIO_AUTH_MODE=none`. |
| `STUDIO_OIDC_CLIENT_SECRET` (*file*) | none | Secret of a confidential client. |
| `STUDIO_OIDC_SCOPES` | `openid profile email` | Scopes requested at login. |
| `STUDIO_OIDC_ROLES_CLAIM` | `roles` | Claim with the user's roles; a JSON pointer such as `/realm_access/roles` for nested claims. |
| `STUDIO_ADMIN_ROLE` | `studio-admin` | Role that may manage infrastructures and apps. |

Register `<public URL>/api/studio/v1/auth/callback` as redirect URI and
`<public URL>/` as post-logout redirect URI at the IdP.

### Infrastructures

| Variable | Default | Description |
| --- | --- | --- |
| `STUDIO_INFRASTRUCTURES_FILE` | none | YAML file with declared infrastructures ([below](#declared-infrastructures)). |
| `STUDIO_INFRASTRUCTURES` | none | The same YAML inline, e.g. from Helm values. |
| `STUDIO_INFRASTRUCTURES_EDITABLE` | `true` | `false` keeps administrators from adding, changing, removing or importing infrastructures. |

### Apps

| Variable | Default | Description |
| --- | --- | --- |
| `STUDIO_APPS_URL` | none | Origin app files are served from, routed to the same service: one origin per installation with `{installation}` as the first label, e.g. `https://{installation}.apps.example.org`, or one shared origin, e.g. `https://apps.example.org` ([below](#apps-origins)). Without it, apps are off. |
| `STUDIO_APPS_TRUSTED_PUBLISHERS` | none | YAML file with the publishers whose keys may sign app packages ([below](#signed-apps)). Signed packages install without developer mode. |
| `STUDIO_APPS_ALLOW_UNSIGNED` | `false` | Developer-mode installs of unsigned packages. A signature that is present must still verify. |
| `STUDIO_APPS_ALLOW_INSTALL` | `true` | `false` keeps administrators from installing, updating or removing apps; bundled and managed apps stay. |
| `STUDIO_APP_PACKAGES` | none | Comma-separated `.zip` files or directories of them, installed and updated at startup ([below](#managed-packages)). |
| `STUDIO_APP_PROJECTS_DIR` | `~/Documents/BaSyx Studio/Apps` | Desktop app only: where the App Builder creates new projects ([ADR 0054](../adr/0054-app-builder-with-coding-agents.md)). |

### Branding, legal links and switches

| Variable | Default | Description |
| --- | --- | --- |
| `STUDIO_PRODUCT_NAME` | `BaSyx Studio` | Window title and app bar. |
| `STUDIO_LOGO`, `STUDIO_LOGO_LIGHT`, `STUDIO_LOGO_DARK` | BaSyx logo | An `http(s)` URL, or an absolute path to a mounted SVG, PNG, WebP or JPEG file that Studio serves at `<base>/branding/logo-light` and `-dark`. |
| `STUDIO_PRIMARY_COLOR`, `…_LIGHT`, `…_DARK` | BaSyx blue | Default accent as `#RRGGBB` for users who keep the default; Studio picks a readable shade per theme. |
| `STUDIO_COPYRIGHT_NAME` | none | Shown in Settings → About. |
| `STUDIO_LEGAL_NOTICE_URL`, `STUDIO_PRIVACY_POLICY_URL` | none | Links on the sign-in page and in Settings → About. |
| `STUDIO_READ_ONLY` | `false` | `true` refuses every change to any target and hides editing. |
| `STUDIO_ALLOW_UPLOADS` | `true` | `false` turns off file uploads to targets. |

Switches only narrow what roles allow; they never grant anything.

## Base path and reverse proxy

With `STUDIO_BASE_PATH=/studio`, pages, assets, the API, the OIDC callback,
health probes and app files are all served under `/studio/`. The proxy
forwards the path unchanged, without stripping the prefix:

```caddyfile
http://example.org {
	handle /studio* {
		reverse_proxy studio:3000
	}
}
```

The proxy must keep the original `Host` header. On the apps origins it must
not add `X-Frame-Options` or a `Content-Security-Policy`, and must keep the
CORS headers Studio sets ([deployment variants](../architecture/deployment-variants.md#apps-origin-and-backend-runtime-mvp-3)).
Two Studios under different paths of one origin keep separate session
cookies.

## Outbound proxy

Where pods reach external hosts only through an HTTP proxy, set the
conventional variables; Studio reads them at startup
([ADR 0052](../adr/0052-outbound-http-proxy.md)):

| Variable | Description |
| --- | --- |
| `HTTPS_PROXY` | Proxy for https targets, e.g. `http://proxy.example.org:3128`; CONNECT tunnels keep TLS end to end with the target. Without it, `HTTP_PROXY` serves https targets too. |
| `HTTP_PROXY` | Proxy for plain http targets. |
| `NO_PROXY` | Targets that go direct, separated by commas: hosts with their subdomains (`example.org`, `.svc`), subdomains only (`*.example.org`), IP addresses, CIDR ranges for IP targets (`10.0.0.0/8`), each optionally with a port (`aas.example.org:8443`), or `*` for all. |

They cover every request of Studio's server: infrastructures and their
registries, the login and token exchange at the IdP, connections and
external files. Loopback always goes direct. The browser uses its own proxy
settings. The proxy URL may contain credentials
(`http://user:password@proxy:3128`); Studio logs it as `http://***@proxy:3128`.
Lower-case variants (`https_proxy`) win over upper-case ones.

List every in-cluster target in `NO_PROXY`, or its requests go to the proxy:

```sh
HTTPS_PROXY=http://proxy.example.org:3128
HTTP_PROXY=http://proxy.example.org:3128
NO_PROXY=.svc,.cluster.local,aas-env,keycloak,10.0.0.0/8
```

Short service names such as `aas-env` contain no dot and must be listed
exactly. The allowlists, the private-network policy, redirect checks,
timeouts and size limits apply to the target as before; the proxy's own
address is not checked against `STUDIO_PRIVATE_NETWORK_TARGETS`. Studio
still resolves a proxied name to check its addresses, and refuses IP
addresses in forbidden or private ranges before it contacts the proxy. As
the proxy connects to the target, Studio cannot check the address again at
connect time. Where the pod cannot resolve external names, https requests
go on and the proxy resolves them, so restrict the proxy to external
destinations; plain http targets must resolve in the pod.

## Apps origins

App files are never served from Studio's own origin. `STUDIO_APPS_URL` has two
forms ([ADR 0045](../adr/0045-app-origins-embeds-and-full-page-modules.md)):

- **One origin per installation:** `https://{installation}.apps.example.org`.
  Each installation is served at its own host, e.g.
  `https://app-0123456789abcdef.apps.example.org`, and nowhere else. App
  frames keep that origin (`allow-same-origin`), so pages that apps embed
  (`sandbox.frameOrigins`) get their own origin, cookies and storage. Use
  this form for apps that embed pages.
- **One shared origin:** `https://apps.example.org`. Every frame runs in an
  opaque origin, as before. Embedded pages run without cookies or storage
  there, and many of them stay blank; the *Apps* page says so.

Locally, `*.localhost` needs no DNS: Chromium resolves every name below
`.localhost` to loopback, also `app-0123456789abcdef.apps.localhost`. A
Compose setup with Studio on port 3000 sets:

```yaml
STUDIO_PUBLIC_URL: http://localhost:3000
STUDIO_APPS_URL: http://{installation}.apps.localhost:3000
```

Other programs may not resolve these names (Node.js, curl, container DNS);
only the browser has to. Hosted, the apps domain needs:

- a wildcard DNS record, e.g. `*.apps.example.org`, to the proxy;
- a wildcard TLS certificate for it; ACME issues those with the DNS-01
  challenge only (with Caddy, a build with your DNS provider's module);
- a proxy rule for the wildcard host that keeps the `Host` header:

  ```caddyfile
  *.apps.example.org {
  	tls {
  		dns <provider> <credentials>
  	}
  	reverse_proxy studio:3000
  }
  ```

Prefer a registrable domain of its own for apps, e.g.
`*.example-apps.net`: script on a subdomain of Studio's domain can set cookies
for the parent domain. Studio's session cookie has the `__Host-` prefix on
https, so apps cannot overwrite it, but other services of that domain may be
less careful. `examples/deployment/production-like` routes
`*.apps.studio.localhost` through Caddy.

Apps declare the third-party origins they reach in the manifest's `sandbox`:
pages they embed, keyless public APIs, images and media. The *Apps* page
shows them, with the note that the user's browser contacts them directly.
Studio refuses origins that cover its own origin or an apps origin, and
loopback origins (`http://localhost:…`) unless developer mode is on.

## Declared infrastructures

Infrastructures in `STUDIO_INFRASTRUCTURES_FILE` or `STUDIO_INFRASTRUCTURES`
are applied at every start: created, updated in place, and removed when they
leave the file. They are read-only in Studio
([ADR 0037](../adr/0037-declared-infrastructures-export-and-import.md)).
Each entry has the fields of the infrastructure API plus a stable `key`:

```yaml
version: 1
infrastructures:
  - key: factory-a
    name: Factory A
    template: full
    endpoints:
      - { type: aasRegistry, url: https://basyx.example.org/aas-registry }
      - { type: submodelRegistry, url: https://basyx.example.org/sm-registry }
      - { type: aasDiscovery, url: https://basyx.example.org/discovery }
      - { type: aasRepository, url: https://basyx.example.org/aas-repo }
      - { type: submodelRepository, url: https://basyx.example.org/sm-repo }
    listSource: registry
    security:
      mode: deployment_client_credentials
      issuer: https://id.example.org/realms/basyx
      clientId: studio
      scopes: [openid]
      clientSecret: { ref: env:FACTORY_A_CLIENT_SECRET }
    allowPrivateNetwork: false
```

- `template`: `full`, `mono-all`, `mono-repo` or `identifiable`; it decides
  which endpoint types are allowed and required.
- `security.mode`: `unsecured`, `deployment_client_credentials` or
  `delegated_user` (the signed-in user's token).
- Secrets are references only: `{ ref: env:NAME }` or
  `{ ref: file:/run/secrets/name }`; client certificates as
  `{ ref: file:/path.p12, passphraseRef: env:NAME }`.
- An invalid entry stops the start with a message naming the entry and
  field, and nothing is changed.

Administrators export infrastructures in this format (Infrastructures →
*Export all* or *Copy as YAML*) and import them by pasting or dropping a file.
Secrets stored in a Studio are left out of exports.

## Connections and time series

AAS content can refer to services that are not AAS services. The IDTA *Time
Series Data* submodel's LinkedSegment, for example, names an InfluxDB query
endpoint and a Flux query. An infrastructure declares such services as
`connections`, and Studio uses their credentials only in the Studio Service
([ADR 0040](../adr/0040-connections-on-infrastructures.md)):

```yaml
infrastructures:
  - key: plant
    # name, template, endpoints and security as above
    connections:
      - key: influx
        type: influxdb2
        url: http://influxdb:8086          # how Studio reaches the database
        aliases: [http://localhost:8086]   # how submodels name it
        auth: { scheme: token, token: { ref: env:STUDIO_PLANT_INFLUX_TOKEN } }
        settings: { organization: basyx }
        allowPrivateNetwork: true
        timeoutSeconds: 15                 # optional, 1 to 120
```

- The bundled *Time Series Data* app shows submodels with the semantic ID
  `https://admin-shell.io/idta/TimeSeries/1/1` in the details pane and on the
  Overview. It reads InternalSegments from the submodel, ExternalSegments
  from the File's attachment, and LinkedSegments from InfluxDB 2.
- A LinkedSegment's `Endpoint` selects the connection by origin: it must be
  the origin of `url` or of one of the `aliases` of a connection of the same
  infrastructure. Studio then sends the query to `url`, never to the
  address in the submodel, and keeps only the `org`/`orgID` of the endpoint
  (`settings.organization` replaces it). An endpoint that no connection names
  shows *Time series database not configured for …*.
- Give Studio a **read-only token for the needed buckets**. That is the
  boundary; Studio's check of the Flux query (imports of `strings`, `math`,
  `date`, `array` and `experimental/aggregate` only, no `to()`) is defence in
  depth.
- `auth.scheme` is `none`, `token`, `bearer`, `header`, `basic`,
  `oauth2ClientCredentials` or `delegatedUser`; each type accepts some of
  them (`influxdb2`: `token`). Secrets are references (`env:`, `file:`) in
  hosted Studio, as for infrastructures. The admin dialog's *Test connection*
  checks the connection without showing the secret.
- Private and loopback addresses need the entry's `allowPrivateNetwork` and
  `STUDIO_PRIVATE_NETWORK_TARGETS=allow`.
- Every query is audited (`timeseries.read`) with the user, the app, the
  infrastructure, the connection and a digest of the query, never its text
  or the answer.

### Coming from the BaSyx AAS Web UI

The Web UI has one `INFLUXDB_TOKEN` for the whole deployment, written into
its JavaScript bundle and readable by every user. Studio has no such
variable. Move the token to the infrastructure whose submodels name the
database:

1. Create a read-only token in InfluxDB (*Load Data → API Tokens → Custom
   API Token*, read access to the bucket), or keep the Web UI's token if you
   cannot.
2. Pass it to Studio as a secret, e.g. `STUDIO_PLANT_INFLUX_TOKEN` or a file
   under `/run/secrets`.
3. Add an `influxdb2` connection to that infrastructure, with `url` as
   Studio reaches InfluxDB and the address in the submodels' `Endpoint` (for
   example `http://localhost:8086`) under `aliases`.

## HTTP connections for apps

Apps that call their own services, or APIs with keys, declare them in their
manifest as `connections`, each with an OpenAPI document and the operations
the app calls. An administrator binds them to an `http` connection of an
infrastructure, which holds the URL and the credentials
([ADR 0047](../adr/0047-http-connections-for-apps.md)). Studio sends the
requests from its server; the browser never sees the URL or the credential.

```yaml
infrastructures:
  - key: plant
    # name, template, endpoints and security as above
    connections:
      - key: work-orders
        type: http
        url: http://work-orders:8080/api/v1   # replaces the document's servers
        auth: { scheme: bearer, token: { ref: env:STUDIO_PLANT_WORK_ORDERS_TOKEN } }
        allowPrivateNetwork: true
        timeoutSeconds: 30                    # default 30, up to 120
        apps:                                 # the app connections that may call it
          - { app: org.eclipse.basyx.examples.work-orders, connection: orders }
```

- `apps` binds an app connection (the app ID and the `id` of a connection in
  its manifest) to this connection. An app connection is bound at most once
  per infrastructure; apps call the connection of the infrastructure they run
  on. Calls of an app connection that no connection binds are refused with
  `connection_not_bound`. The binding names the app ID, so it survives
  updates and may be written before the app is installed. Connection IDs are
  1 to 63 lowercase letters, digits and hyphens, as manifests must declare
  them; a binding with another ID fails the start like any invalid entry, and
  the message names the app and the connection.
- The app reaches only the operations it declares, as method and path of its
  OpenAPI document, below `url`. The *Apps* page and the infrastructure
  dialog list them. An update that adds operations, or moves one to another
  method or path, asks for confirmation again; the binding then covers it.
- `auth.scheme` may be any scheme: `none` for a keyless API that Studio
  should call instead of the browser, `bearer`, `token`, `header` or `basic`
  with a secret reference, `oauth2ClientCredentials`, or `delegatedUser` for
  the signed-in user (below). Before using any of them, Studio checks that
  the user may open the infrastructure.
- Studio validates parameters and JSON bodies against the document, sends up
  to 8 MiB, reads up to 20 MiB, allows four calls per session and connection
  at a time, and never follows redirects. Every call is audited
  (`connection.call`) with the user, the app, the infrastructure, the
  connection, the operation, the status and the duration, never with
  parameters or bodies.
- *Test connection* obtains the credentials and sends `GET` to `url`. Any
  answer other than `401`, `403` or `5xx` passes.

### The signed-in user's identity

With `scheme: delegatedUser`, on an infrastructure whose users sign in
(`security.mode: delegated_user`), the service receives a token for the
signed-in user:

```yaml
        auth:
          scheme: delegatedUser
          audience: work-orders        # the service's audience
          scopes: [work-orders]        # a scope the IdP maps to that audience
```

- Studio exchanges the user's token for this infrastructure at the issuer's
  token endpoint for one issued to `audience` (OAuth 2.0 Token Exchange,
  RFC 8693), as the infrastructure's client, and caches it per session until
  it expires. *Test connection* performs the exchange.
- Keycloak 26.2 or later: enable *Standard token exchange* on the
  infrastructure's client (`standard.token.exchange.enabled`), create a client
  for the service (bearer-only is enough) and a client scope with an audience
  mapper for it, add that scope to the infrastructure's client as optional,
  and list it in `scopes`.
  [`examples/deployment/http-connections/keycloak`](../../examples/deployment/http-connections/keycloak)
  has such a realm.
- Where the IdP cannot exchange tokens, `forwardUserToken: true` forwards the
  user's token unchanged, but only if its `aud` already contains `audience`.
  The service could then replay it against the AAS server; prefer the
  exchange. The audit says which of the two was used.

### Connections or `connectOrigins`

`sandbox.connectOrigins` ([ADR 0045](../adr/0045-app-origins-embeds-and-full-page-modules.md))
lets an app's frame read a keyless public API directly, from the user's
browser, at an origin the publisher fixes. Use an `http` connection instead
when the API needs a credential or the user's identity, when its URL differs
per deployment or is only reachable from Studio's network, or when calls must
be audited.

## App settings

Apps may declare settings: values such as the asset types they list or the
IDs they send to a service, which differ between deployments and
infrastructures ([ADR 0048](../adr/0048-app-settings-and-connection-status.md)).
One signed package then serves all of them without a rebuild.

- **Per installation:** *Apps* → the app's *Settings* button. The values apply
  wherever the app runs, also on desktop workspaces.
- **Per infrastructure:** for settings the app declares with
  `scope: infrastructure`, in the infrastructure's dialog under *App settings*,
  or in the declared file next to the connections:

  ```yaml
  infrastructures:
    - key: plant-north
      name: Plant North
      # endpoints, security, connections as above
      apps:
        - app: org.example.asset-board
          settings:
            assetTypes: [https://example.org/types/pump, https://example.org/types/valve]
            serialIdName: plantSerial
  ```

  An infrastructure's value wins over the installation's, which wins over the
  app's default. Up to 50 apps per infrastructure, each once; the entry may
  name an app that is not installed yet.
- Studio checks the values against the installed app's manifest: undeclared
  keys, keys of `installation` settings and values of the wrong type are
  refused when saved, in the dialog, on import and in the declared file. The
  managed and bundled apps are installed before the declared infrastructures
  are applied, so a declared value of the wrong type stops the start. Values
  for apps that are not installed are kept and checked when the app is
  installed.
- An update drops installation values its settings no longer accept, and
  lists added, removed and changed settings in its dialog. Infrastructure
  values a new version does not accept are ignored, and the dialog marks
  them.
- Settings are **not for secrets**: they are stored in plain text, exported
  with the infrastructures, and sent to every browser that opens the app.
  Keys and tokens belong in `http` connections.
- `app.settings.update` is audited with the keys that changed; changes on an
  infrastructure are part of `infrastructure.update`.
- An app also sees whether each of its connections is bound on the current
  infrastructure, so it can say "not configured" before it calls.

## Signed apps

Apps are installed from ZIP packages. A package signed by a publisher the
deployment trusts installs without developer mode
([ADR 0044](../adr/0044-app-package-signatures-trust-store-and-updates.md)).
The signature is detached and covers the exact package bytes, as
`cosign sign-blob --key` writes it (ECDSA P-256, `<package>.zip.sig`); a
Sigstore bundle works too.

`STUDIO_APPS_TRUSTED_PUBLISHERS` names the trust store, read at startup:

```yaml
version: 1
publishers:
  - name: Example GmbH              # shown as the verified publisher
    keys:                           # PEM public keys, inline or as paths
      - keys/example.pub            # relative to this file
    appIds: [org.example.*]         # IDs, prefixes ending in .*, or *
    permissions:                    # reserved permissions it may use
      - studio.timeseries.read
    remoteCode: true                # connect origins with WebAssembly or workers
```

- A key signs only the app IDs of its publisher. Only ECDSA P-256 keys
  (`cosign generate-key-pair`) are accepted, and a key belongs to one
  publisher. Studio does not start with an invalid trust store.
- The *Apps* page takes a package and its signature, shows the verified
  publisher and what the app requests, and installs on confirmation. The API
  takes the signature in the `Studio-App-Signature` header;
  `POST /app-installations?inspect=true` checks a package without installing
  it.
- Installing an app that is installed updates it in place: the installation
  ID, deep links and audit records stay, and a running backend restarts with
  the new files. The update must be signed by the same publisher and have a
  higher version. The dialog marks permissions the update adds.
- `permissions` may grant `studio.timeseries.read`, which apps otherwise
  cannot use. `studio.containers` stays with the apps shipped with Studio.
- `remoteCode: true` lets the publisher's apps combine `connectOrigins` with
  `webAssembly` or `workers`. Such an app could fetch code and run it, so it
  would not be limited to the code in its signed package. Without the grant,
  these packages are refused, in developer mode and as managed packages too,
  and installed ones are revoked at the next start
  ([ADR 0045](../adr/0045-app-origins-embeds-and-full-page-modules.md)).
- Removing a key revokes the apps it signed at the next start: their files and
  calls are refused, and the *Apps* page says why. A package signed with a
  trusted key restores them. When rotating a key, add the new one, release
  with it, then remove the old one.

### Managed packages

`STUDIO_APP_PACKAGES` lets the deployment install apps itself, for example
from a mounted volume or an init container. At every start, Studio installs
or updates each package by digest and marks it as managed:

- A `<package>.zip.sig` next to a package must verify against the trust store;
  otherwise the package is skipped and its previous version stays. Unsigned
  packages are accepted: the operator vouches for them.
- Managed packages may go back to a lower version, replace an app with the
  same ID that an administrator or Studio installed, and work with
  `STUDIO_APPS_ALLOW_INSTALL=false`. The *Apps* page cannot update or remove
  them.
- A managed app whose package is no longer configured is uninstalled at the
  next start. When a configured package fails, nothing is removed.

## Without login

`STUDIO_AUTH_MODE=none` is for demos, closed networks and deployments behind
an authenticating proxy ([ADR 0036](../adr/0036-anonymous-mode.md)). Every
browser gets its own session as the shared user `anonymous` with
`STUDIO_ANONYMOUS_ROLES`; with `studio-admin` among them, every visitor
manages infrastructures and apps. Studio logs a warning at startup.

## Kubernetes notes

For a Helm chart (planned in `eclipse-basyx/charts`):

- Probes: liveness `GET <base>health/live`, readiness `GET <base>health/ready`
  on port 3000. The image's `HEALTHCHECK` uses the readiness probe.
- Security context: `runAsUser: 1000`, `runAsGroup: 1000`, `fsGroup: 1000`,
  `readOnlyRootFilesystem: true` with an `emptyDir` on `/tmp` and a volume on
  `/data`.
- Replicas: one with PGlite (a `ReadWriteOnce` volume on `/data`). Use
  `STUDIO_DATABASE_URL` for PostgreSQL; more than one replica is not yet
  supported.
- Secrets: `STUDIO_DATA_KEY_FILE` and `STUDIO_OIDC_CLIENT_SECRET_FILE` from a
  `Secret`; secrets referenced by declared infrastructures as `env:` or
  `file:`.
- Infrastructures: `STUDIO_INFRASTRUCTURES_FILE` from a `ConfigMap`, or
  `STUDIO_INFRASTRUCTURES` from values.
- Apps: the trust store and its keys from a `ConfigMap`
  (`STUDIO_APPS_TRUSTED_PUBLISHERS`); packages and their signatures on a
  volume filled by an init container (`STUDIO_APP_PACKAGES`).
- Ingress: the Studio host (path `STUDIO_BASE_PATH`) and, with apps, the apps
  host, both to the same service. With one origin per installation, the apps
  host is a wildcard (`*.apps.example.org`) with a wildcard certificate.
- Egress proxy: `HTTPS_PROXY`, `HTTP_PROXY` and a `NO_PROXY` that lists the
  cluster's domains, service names and CIDR ranges ([above](#outbound-proxy)).
- Shutdown: Studio stops on `SIGTERM`; startup with an invalid configuration
  exits with code 1.
