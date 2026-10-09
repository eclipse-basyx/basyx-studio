# 0017: App origin and Content Security Policy

- Status: Accepted
- Date: 2026-10-09
- Deciders: BaSyx Studio maintainers
- Requirements: APP-010, SEC-004 to SEC-008

## Context

App UI code must never run in Studio's renderer context
([ADR 0004](0004-runtime-installable-apps.md)): no access to Studio's cookies,
storage, DOM, Pinia state or API. Apps also must not load code from outside
their own package, and one app must not reach another.

## Decision

- **Frames.** Every app entry runs in an `iframe` with
  `sandbox="allow-scripts"` only: no `allow-same-origin`, popups, forms, modals,
  downloads or top navigation. The document has an opaque origin. Studio
  creates frames only on the client, after its message listener is in place.
- **Separate origin.** App files are served from an origin other than Studio's:
  - hosted: `STUDIO_APPS_URL` (for example `https://apps.studio.example`),
    served by the same Nitro process under `/app/<installation>/<path>`. On the
    apps host every other path answers 404, and `/app/` answers 404 on the
    Studio host. Apps are disabled when no apps origin is configured.
  - desktop: the `studio-app://<installation>/<path>` protocol, registered as a
    standard, secure scheme on the renderer session. The Electron main process
    fetches the files from the local service with the broker secret; the
    service serves app files on desktop only to that process.
  - development: `http://apps.localhost:3000`, since `*.localhost` resolves to
    loopback.
- **Content Security Policy of every app file:** `default-src 'none'`; scripts,
  styles, images, fonts, media and `fetch` only from the installation's own
  URL prefix (inline styles allowed for UI libraries); no frames, workers,
  objects, forms or `<base>`; `frame-ancestors` limited to Studio's origin;
  and `sandbox allow-scripts`, so a document opened outside Studio is
  sandboxed too. Files are served with `nosniff`, `no-referrer`, and
  `Access-Control-Allow-Origin: *` (module scripts from an opaque origin are
  CORS requests; app files are not secret and carry no credentials).
- **Studio pages** send `frame-ancestors 'self'`, so apps cannot frame Studio.
- **Electron** additionally lets subframes navigate only to app URLs of the
  same installation (`will-frame-navigate`) and grants device permissions only
  to the Studio page.

## Consequences

- An app cannot read Studio's cookies or storage, call the Studio API, open
  windows, navigate Studio, embed Studio, or load another installation's code.
  End-to-end tests run a hostile probe app in both runtimes.
- Apps have no persistent browser storage. If they need state, Studio will
  offer it as a capability.
- Hosted deployments need one more host name and TLS certificate.
- A browser frame can always navigate itself, and the new URL can carry data.
  Studio revokes the bridge when a frame leaves its entry, but cannot stop the
  request in a browser; Electron blocks it. This matters once apps combine AAS
  reads with network permissions, and is part of the install warning then.

## Alternatives considered

- **Same origin with a sandbox attribute only:** one missing attribute or a
  directly opened app URL would run app code with Studio's authority.
- **One subdomain per installation:** needs wildcard DNS and certificates; the
  opaque origin already separates apps from each other.
- **Shadow DOM or module federation:** not a security boundary.
