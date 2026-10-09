# 0019: Backend app runner

- Status: Accepted
- Date: 2026-10-09
- Deciders: BaSyx Studio maintainers
- Requirements: APP-010, APP-014

## Context

Some apps need server-side logic. Backend app code must not run in the Studio
Service process ([ADR 0004](0004-runtime-installable-apps.md)), and it must be
as constrained as UI apps: no infrastructure tokens, no ambient file or network
access.

## Decision

- **Runtime.** Deno, pinned by pnpm as a runtime dependency
  (`devEngines.runtime`, `deno@runtime:2.9.6`): the lockfile records the
  integrity of the official release archive for each platform. The Electron
  build ships the binary as an extra resource; hosted deployments set
  `STUDIO_DENO_PATH` or keep the pnpm-installed runtime.
- **Process model.** One process per installation, started on the first call
  and supervised by the Studio Service. It is stopped when idle (5 minutes) or
  uninstalled, killed when a call exceeds 30 s or the answer exceeds 16 MiB,
  and started again by the next call. A crash affects only that backend.
- **Permissions.** `deno run --no-prompt --no-remote --no-npm --no-config
  --no-lock --cached-only --allow-net=127.0.0.1:<service port>` with a heap
  limit and an empty environment. The backend's files are extracted from the
  verified store into a per-installation directory; a generated host module
  imports the entry statically, so no read permission is needed.
- **Calls.** Only an app's own UI starts backend calls
  (`studio.backend.call`), on behalf of the signed-in user. For each call the
  service mints a capability token: HMAC-SHA-256 with a key derived from
  Studio's data key, holding the installation, session and target, valid for
  60 s. The backend calls `POST /app-calls` with it as a bearer token. The
  token is accepted only there, only while the session is valid, and grants
  only AAS methods within the installed manifest's permissions and the user's
  rights. On desktop that route is exempt from the launch secret when a token
  is present.
- **Protocol.** JSON lines over stdin/stdout between the service and the host
  module. The backend's console output goes to stderr, is rate-limited, tagged
  with the app ID and kept apart from audit records.

## Consequences

- Backend apps can do no more than the calling user and their manifest allow,
  and cannot reach the internet, files, environment or subprocesses.
- The Electron app grows by about 81 MB per platform (Deno).
- Deno permissions reduce authority but are not a complete hostile-code
  boundary. Hosted production deployments still need OS or container isolation
  per backend; until then, hosted backend apps run in the Studio container.
- Background jobs (calls not started by a user) are not possible yet.

## Alternatives considered

- **Node.js worker threads or `vm`:** share the Studio process and are not a
  security boundary.
- **WebAssembly only:** too restrictive as the first runtime for app authors.
- **Containers per app from the start:** right for hosted production, but not
  available on desktop and not needed to prove the model.
