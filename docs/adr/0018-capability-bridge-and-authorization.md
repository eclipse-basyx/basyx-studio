# 0018: Capability bridge and app authorization

- Status: Accepted
- Date: 2026-10-09
- Deciders: BaSyx Studio maintainers
- Requirements: APP-006, APP-009, SEC-005

## Context

Sandboxed apps need AAS data and a few Studio functions. They must never
receive tokens or reach infrastructure directly, and an app must never be able
to do more than the signed-in user may, or more than it declared.

## Decision

- **Protocol `studio-sdk/0`.** The frame posts `hello` to its parent. The host
  answers only the frame it created, once per load of the entry, with a
  `connect` message that carries the context and transfers a `MessagePort`.
  All requests and responses use that port. A frame that navigates away loses
  its port and is reloaded. `@basyx/studio-sdk` implements the client.
- **Validation.** The host validates every message from a frame with Zod and
  forwards capability calls to `POST /app-calls`, adding the installation and
  the target the frame is bound to. The server validates the parameters of
  every method again.
- **Permissions and methods.** Manifests declare coarse permissions, which are
  what an administrator approves: `studio.aas.read`, `studio.aas.write`,
  `studio.ui.notifications`, `studio.ui.navigation`, `studio.backend`. Each
  method needs one of them; `studio.ui.getContext` needs none. The server reads
  the permissions from the installed manifest, never from the caller.
- **User rights.** AAS methods open the target for the calling user, exactly as
  Studio's own routes do, so downstream authorization and Studio's
  client-credentials audit apply unchanged. Writes use the MVP-2 write path
  with revision tokens and the same problems (`revision_conflict`,
  `target_forbidden`, …).
- **Scope.** A frame is bound to the active target; apps may read and write any
  data on it that the user may. Switching the target creates a new frame.
- **UI methods.** `notify` and `navigate` are authorized by the server and
  carried out by the host (a notification labelled with the app's name; a
  change of the module's own sub-path).
- **Audit.** Refused calls (`app.call`, failure, with method and code) and all
  writes are audited with `app_installation_id`. Reads follow the existing
  `target.read` rule and carry the installation too.

## Consequences

- An app gains no rights a user lacks; a read-only user gets
  `target_forbidden` from the app as from Studio.
- The method list is small and versioned; new capabilities extend
  `studio-sdk/0` compatibly or start a new protocol version.
- Each call is an extra HTTP round trip from the renderer; batched methods can
  be added when an app needs them.

## Alternatives considered

- **Fine-grained permissions per method in the manifest:** harder to review
  and approve; methods change more often than permissions.
- **Calls carrying arbitrary target IDs:** would let a frame reach targets the
  user is not looking at.
- **Direct `postMessage` without a port:** every message would need origin and
  source checks, and other frames could interleave messages.
