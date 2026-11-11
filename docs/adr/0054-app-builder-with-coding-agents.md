# 0054: App Builder: coding agents that build and install apps on the desktop

- Status: Proposed
- Date: 2026-11-09
- Deciders: BaSyx Studio maintainers
- Requirements: APP-001, APP-012, APP-015, APP-022, APP-023, DEP-006, SEC-007, SEC-009, UX-002, UX-003

## Context

Building a Studio app takes a repository, the published SDK and app kit
([ADR 0043](0043-published-sdk-and-app-kit.md)), a build, a package and an
installation ([ADR 0044](0044-app-package-signatures-trust-store-and-updates.md)).
Many Studio users know what view or tool they need but not how to build it.
Coding agents such as Claude Code, Codex and opencode can write such an app
from a description, if they get the right folder, the right instructions
and a way to try the result.

The *App Builder* ([plan](../development/app-builder-plan.md)) is a chat in
Studio, styled like these agents' own apps. The user describes an app; an
agent writes it in a folder on the user's computer; Studio builds it, shows it
live on the active target and installs it. The same chat improves apps it
built, copies of bundled apps, and apps in any folder with their sources.

The agents run local processes, edit files and start commands. Installed apps
cannot do that: they run in a sandboxed frame and reach Studio only through the
capability bridge ([ADR 0018](0018-capability-bridge-and-authorization.md)).
The agents speak different protocols, but the
[Agent Client Protocol](https://agentclientprotocol.com) (ACP) covers all
three: opencode has `opencode acp`; for Claude and Codex, the ACP project
publishes the adapters `@agentclientprotocol/claude-agent-acp` (on the Claude
Agent SDK) and `@agentclientprotocol/codex-acp` (on Codex's app server). Both
adapters can run an installed CLI in place of the one they depend on.

## Decision

- **Native desktop feature.** As with the container capability
  ([ADR 0033](0033-desktop-container-capability.md)), the App Builder is a
  native Studio page (`/app-builder`, `app/components/app-builder/`) with
  Studio's theme, locale and navigation. It is not an installed app and is not
  shown in a frame. The hosted runtime does not create the agent manager;
  its API returns `unsupported_operation`.
- **Agents through ACP, Studio as the client.** The Studio Service runs each
  agent as a child process and talks ACP over its stdio
  (`@agentclientprotocol/sdk`). Claude and Codex run through the two
  adapters, which are Studio dependencies with pinned versions under Studio's
  supply-chain rules ([ADR 0010](0010-pnpm-only-supply-chain.md)). They run on
  Electron's Node (`ELECTRON_RUN_AS_NODE`) and drive the user's installed
  `claude` and `codex` (`CLAUDE_CODE_EXECUTABLE`, `CODEX_PATH`). Studio
  ships the adapters without the agent binaries they would otherwise bring
  (about 650 MB per platform). opencode runs as the user's installed
  `opencode acp`. Studio has no ACP code of its own beyond the client. The
  agent processes get a clean environment: `PATH` (see *Discovery*),
  `HOME` and the locale, but no variables of a parent agent session.
- **Edit mode per agent.** Each agent has its own way to be free in the
  folder ([Phase 0](../development/app-builder-plan.md#phase-0-results)).
  Claude runs in mode `acceptEdits`: edits run and commands ask. Codex runs in
  mode `workspace-write`: its OS sandbox keeps writes in the folder, runs
  commands inside the sandbox without asking, and asks to leave it. opencode
  runs in mode `build` with permission rules that Studio passes in
  `OPENCODE_CONFIG_CONTENT`.
- **The user's own accounts.** Agents sign in with the credentials the user
  already has in each CLI. Studio never reads, copies or stores them. Before
  a chat starts, Studio asks each CLI for its sign-in status (for Claude,
  `claude auth status`; the adapter reports a missing sign-in only when the
  first prompt fails). When an agent is signed out, the page offers the
  agent's own ACP sign-in method where it has one, and otherwise names the
  terminal command (`claude auth login`, `codex login`, `opencode auth login`).
- **Discovery.** On macOS and Linux, a GUI app does not get the user's shell
  `PATH`. The service reads it once from the user's login shell
  (`$SHELL -ilc`, between markers, once per start), and then looks up
  `claude`, `codex`, `opencode`, `node`, `pnpm` (or Corepack) and `git`. If no
  `opencode` is on the `PATH`, Studio also looks for the CLI that the OpenCode
  desktop app installs in its own data folder. The page shows each agent as ready, missing or signed out, and
  explains what is missing, as the Docker page does for engines.
- **Projects in a visible folder.** Each app has a project folder, by default
  `~/Documents/BaSyx Studio/Apps/<slug>` (changeable in settings). The folder is a git
  repository. After each agent turn that changed files, Studio (not the agent)
  commits with the prompt as the message, so a turn can be shown as a diff and
  undone. Studio stores each project's folder, app ID, origin and
  conversations in its database; the files stay in the folder, and the user
  can open them in their editor.
- **Three origins.** *New*: Studio scaffolds the project from a template
  shipped with Studio (based on `examples/apps/starter`). Its `@basyx/*`
  dependencies come from npm at the running Studio's version. *Copy of a
  bundled app*: Studio ships the sources of `apps/*` and copies one into a new
  project. It gets a new app ID and npm versions in place of `workspace:*`, and
  the bundled app stays installed. *Existing folder*: a folder with a
  `studio-app.json` chosen through the host dialog (file grant kind
  `app-project`, [ADR 0015](0015-desktop-native-bridge-and-file-grants.md)).
  It is registered in place and never moved; without git, Studio asks before
  running `git init`. A folder may lie inside a larger repository, so Studio
  limits every git command to the folder: it never stages, commits or
  restores anything outside it.
- **Instructions for the agent.** Every project Studio creates contains an
  `AGENTS.md` (and a `CLAUDE.md` that includes it). It holds the app rules:
  the manifest and its permissions, the SDK and app kit, Vuetify without
  custom CSS, translations, tests and the commands to run. Studio keeps its
  section of the file current with the running Studio version. Existing
  folders keep their own files; Studio adds its instructions to the session's
  first prompt instead.
- **Free in the folder, ask outside it.** Each agent starts with the project
  folder as its working directory, in the mode that lets it edit there without
  asking (and in its own workspace sandbox where it has one). Studio answers
  the agent's permission requests (`session/request_permission`). It allows
  edits inside the folder, and the commands `pnpm install|build|test|typecheck|lint|package`
  and read-only `git`, run in the folder. Everything else becomes an approval
  card in the chat: *Allow once*, *Allow in this chat*, *Deny*. Studio
  keeps *Allow in this chat* itself and answers with `allow_once`, never with
  the agent's `allow_always`, which can store rules beyond the chat. Codex runs
  commands inside its sandbox without asking, so for Codex only leaving the
  sandbox reaches Studio.
- **Permission modes per chat.** The rule above is the chat's *Ask* mode,
  the default. *Auto* also allows commands that run in the folder, name no
  path outside it (absolute, `~` or `..`), use no variables or command
  substitution, and are none of `sudo`, `su`, `doas`, `osascript`,
  `launchctl`, `crontab`, `curl` or `wget`; files outside the folder still ask.
  The agents stay in their edit modes, so Codex's sandbox still holds; for
  Claude and opencode, Studio's check is the only one. *Unrestricted* allows
  every request and switches the agent to its own mode without checks where
  it has one: Claude to `bypassPermissions` (when its settings allow it),
  Codex to `agent-full-access` (no sandbox, no approvals); opencode asks
  Studio for what its rules do not allow, and Studio allows it. The page
  turns it on only after a warning that the user acknowledges each time, and
  the service refuses it without that acknowledgement
  (`setPermissionMode`, `acknowledgeRisk`). It applies to that chat only,
  marks the chat in the list and above the prompt box, and is not kept when
  Studio restarts: a saved chat comes back in *Ask*. Switching the mode
  decides waiting requests again.
- **Studio builds, not the agent.** After a turn, or on request, Studio
  itself runs `pnpm install` (when the manifest or lockfile changed),
  `pnpm build` and `studio-app pack` in the folder, with fixed arguments. If a
  build fails, the page shows the log and offers *Ask the agent to fix it*,
  which sends the log as the next prompt.
- **Preview installation.** Each project has its own preview installation of
  the app ID `<appId>.preview`. Studio rewrites the ID in the package before
  installing it. Its version is `<version>-preview.<n>`, and the record carries
  `preview: true`. A preview is installed unsigned under developer mode
  (desktop's default), or signed with the machine key when unsigned installs
  are off. It runs with the same sandbox and capability bridge as any app.
  It is left out of Studio's navigation and view contributions and appears
  only in the builder's preview pane, on the active target. The permission
  dialog appears in the pane only when permissions, origins or connections
  change from the previous preview. Settings and connection bindings are
  copied from the real installation if there is one.
- **Install through the normal path.** *Install* builds the version in
  `package.json` (the page offers a patch or minor bump when it is not higher
  than the installed one). Then the existing inspect → consent → install
  flow runs. The user chooses how: *Developer (unsigned)* or *Signed*. The
  update rules of ADR 0044 stay as they are.
- **Two kinds of signing key.** The *machine key* is a P-256 key that Studio
  creates on first use. Its private key is encrypted with Studio's data key
  (SEC-007). Its public key is added to the effective trust store, next to the
  deployment's `STUDIO_APPS_TRUSTED_PUBLISHERS`, as publisher *This computer*,
  limited to `local.*` app IDs and with no grantable permissions or remote
  code. The *user's own key* is a PEM file picked through the host dialog
  (file grant `signing-key`), used for one signature and not stored. With it,
  *Export package* saves the ZIP and its `.sig` for other Studios. Apps Studio
  creates get `local.<slug>` IDs; before the first signed install, the user may
  change the ID to their own key's namespace.
- **API and events.** `POST /api/studio/v1/app-builder/{operation}` takes
  commands such as starting a conversation, prompting, cancelling, answering
  an approval, building, installing and undoing a turn. Each command is
  validated with Zod in `shared/contract/app-builder.ts` and needs the session
  and CSRF token. A conversation's ACP updates reach the page as Server-Sent
  Events (`GET …/app-builder/conversations/{id}/events`, [ADR 0007](0007-http-and-realtime-transports.md)),
  numbered, so a reconnect resumes where it stopped.
- **Conversations persist.** Studio stores each conversation's transcript and
  its ACP session ID. Reopening one resumes it with `session/load` where the
  agent supports it. Otherwise Studio starts a new session in the same folder
  and shows the old transcript above it, read-only.

## Consequences

- A user can describe an app in Studio and use it a few minutes later,
  without a terminal or a repository of their own.
- The user must have installed and signed in to each agent's CLI that they
  want to use; Studio does not bring any. The adapters add a few megabytes to
  the installer. An adapter release has to wait for its release-age delay
  before Studio can take it. An adapter may expect a newer CLI than the user
  has, so the page shows the CLI's version, and an adapter update can require
  a CLI update.
- Agents are full-trust local software that the user chose, as the CLIs
  themselves are. Their confinement to the folder is only as strong as their
  own modes, sandboxes and permission requests. Studio is not a security
  boundary against a misbehaving agent. The apps an agent builds are: they
  install with the same checks, sandbox and consent as any other app.
- *Auto* trades approval cards for a check of the command's text, which a
  determined agent can get around (a script in the folder can do anything);
  *Unrestricted* removes the checks. Both are the user's choice per chat,
  as in the agents' own apps, and *Ask* stays the default.
- Studio becomes an ACP client, so a fourth ACP agent (Gemini CLI, Goose and
  others) is a configuration entry, not new code.
- Developer mode stays the iteration path. Signing with the machine key gives
  agent-built apps the same update rules as published ones. The machine key
  makes no claim beyond this computer, so its apps cannot be installed
  elsewhere without the user's own key.
- Shipping the sources of the bundled apps adds them to the Studio build. A
  copy does not follow later Studio releases; the user improves it like any
  other project.
- Node, pnpm and git become prerequisites of this feature, though not of
  Studio.

## Alternatives considered

- **A bundled app with a new privileged capability:** it would prove the
  app platform. But a capability that starts processes and writes files is
  full trust in any form, and a frame adds nothing to it. ADR 0033 made the
  same choice for containers.
- **Each CLI's own headless mode** (`claude -p` with stream-json,
  `codex app-server`, `opencode serve`): no adapters as dependencies. But it
  needs three protocol clients and three mappings of tool calls, diffs and
  permission prompts, and every new agent needs another.
- **The adapters with their own agent binaries:** no installed CLI needed,
  but about 650 MB more per platform in the installer, and agent versions
  that differ from the user's own.
- **Agents in hosted deployments:** this needs per-user isolation, agent
  credentials on the server and a sandbox for arbitrary commands. That is out
  of scope until there is a hosted build service
  ([app-platform.md](../architecture/app-platform.md), publication pipeline).
- **Sources hidden in Studio's data folder:** simpler to manage, but the user
  could not see, version or edit their app outside the chat.
- **Previews as prerelease versions of the real installation:** no second
  installation, but every work-in-progress build would replace the app the
  user is relying on.
