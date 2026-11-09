# App Builder plan: build and improve apps by chatting with a coding agent

- Status: Planned
- Date: 2026-11-09
- Depends on: signed packages and updates
  ([ADR 0044](../adr/0044-app-package-signatures-trust-store-and-updates.md)),
  the published SDK and app kit
  ([ADR 0043](../adr/0043-published-sdk-and-app-kit.md)), file grants
  ([ADR 0015](../adr/0015-desktop-native-bridge-and-file-grants.md)) and the
  App Builder decision ([ADR 0054](../adr/0054-app-builder-with-coding-agents.md))
- Scope decision gate: desktop only; Claude, Codex and opencode through the
  Agent Client Protocol; the agent is free inside the project folder;
  a live preview on the active target; install unsigned or signed

## Goal

A desktop user describes an app in Studio and uses it a few minutes later.
The same chat improves it later, and it also improves copies of bundled apps
and apps in a folder of the user's choice.

> on the desktop, a user opens *App Builder* → sees which agents are ready
> (Claude, Codex, opencode) → *New app* → writes "a view for the Digital
> Nameplate that shows the manufacturer's logo, the serial number as a QR code
> and a print button" and picks Codex → watches the agent plan, edit files and
> run the tests, with each step as a card → the preview pane shows the view on
> a shell of the active target → asks for a larger QR code → the preview
> updates → *Install* → *Signed with this computer's key* → confirms the
> permissions → the view appears on every nameplate in Studio → a week later,
> opens the project again and asks for a German translation

## Starting point

- **Native desktop pages:** `/docker` (`app/pages/docker.vue`,
  `app/components/basyx-docker/`, `app/composables/useDockerClient.ts`) is the
  pattern: a desktop-only route, an operation dispatcher
  (`POST /api/studio/v1/containers/{operation}`, `server/utils/containers.ts`),
  domain code in `server/lib/containers/`, jobs the page polls, and an
  "engine missing" state.
- **Service process:** Electron starts the Studio Service with
  `ELECTRON_RUN_AS_NODE` (`electron/main.ts`). The service may spawn child
  processes; it already runs Deno for backend apps (`server/lib/apps/runner.ts`).
- **Installation:** `installApp` and `inspectAppPackage`
  (`server/lib/apps/store.ts`) check a package and its signature, and that an
  update has a higher version and the same publisher. Desktop allows unsigned
  installs by default (`STUDIO_APPS_ALLOW_UNSIGNED`, `server/lib/config.ts`).
  The trust store is read from `STUDIO_APPS_TRUSTED_PUBLISHERS`
  (`server/lib/apps/trust.ts`).
- **Signing:** `@basyx/studio-app-kit/signature` signs and verifies the
  `cosign sign-blob` format; `studio-app pack` builds packages.
- **Template:** `examples/apps/starter` is an app in a repository of its own,
  with `@basyx/*` from npm (0.2.2 is current), `minimumReleaseAge` and tests
  on the SDK's test Studio.
- **Bundled apps:** `apps/*`, packed by `pnpm apps:bundle` into
  `server/bundled-apps/`. Only the packages ship today, not the sources.
- **Agents (2026-11-09):** `opencode acp` (opencode 2.2.6),
  `@agentclientprotocol/claude-agent-acp` 0.101.0 (Claude Agent SDK 0.3.318),
  `@agentclientprotocol/codex-acp` 2.6.0 (`@openai/codex` 0.166),
  `@agentclientprotocol/sdk` 2.5.0.

## Decisions

Made with the user on 2026-11-09. Items marked *assumption* were proposed
with the plan and not discussed individually; they hold unless changed.

### Scope

| # | Topic | Decision |
| --- | --- | --- |
| S1 | Placement | A native desktop-only page at `/app-builder` with a fixed navigation item, like `/docker`. No hosted variant. |
| S2 | Agents | Claude, Codex and opencode, all through ACP. Claude and Codex through the ACP project's adapters as Studio dependencies, driving the user's installed `claude` and `codex`; opencode as the installed `opencode acp`. Studio ships no agent binaries. |
| S3 | What it changes | Apps it created, copies of bundled apps, and any folder with an app's sources. |
| S4 | Look | Like the agents' own apps: projects and chats on the left, the chat in the middle, a composer at the bottom, the preview on the right. *Assumption.* |

### Agents and chat

| # | Topic | Decision |
| --- | --- | --- |
| A1 | Autonomy | Free inside the project folder: edits, and `pnpm install/build/test/typecheck/lint/package` and read-only `git` run in the folder. Everything else is an approval card: *Allow once*, *Allow in this chat*, *Deny*. |
| A2 | Agent and model | Chosen in the composer per chat. The model and mode lists come from the agent (ACP session config options) where it offers them. *Assumption.* |
| A3 | Sign-in | With the user's own accounts. Signed out: the agent's own sign-in through ACP where it offers one, otherwise the terminal command to run. Studio never touches the credentials. |
| A4 | Transcript | Messages as Markdown; tool calls as collapsible cards with status; file edits as diffs (Monaco diff editor); the agent's plan as a checklist; approvals inline. *Assumption.* |
| A5 | Turn history | Studio commits after each turn that changed files. Each turn's card has *Show changes* and *Undo this turn* (with confirmation, UX-003), which reverts it and the turns after it. *Assumption.* |
| A6 | Cancel | *Stop* sends ACP `session/cancel`; files changed so far stay and are committed as an interrupted turn. *Assumption.* |
| A7 | Resume | Chats are kept per project. Reopening one resumes it with `session/load` where the agent supports it; otherwise a new session starts, with the old transcript shown read-only above it. |

### Projects

| # | Topic | Decision |
| --- | --- | --- |
| P1 | Folder | `~/Documents/BaSyx Studio/Apps/<slug>` by default, changeable in settings; a git repository per app. *Open folder* and *Open in editor* on the project. |
| P2 | New app | Scaffolded from a template shipped with Studio (derived from `examples/apps/starter`): `@basyx/*` from npm at Studio's version, `minimumReleaseAge`, a submodel view or module chosen by the agent from the prompt, `AGENTS.md` and `CLAUDE.md`. |
| P3 | App ID | `local.<slug>`, publisher *This computer*. The project settings allow another ID before the first signed install. *Assumption.* |
| P4 | Copy of a bundled app | Studio ships the sources of `apps/*`. *Copy and change* on a bundled app (here and on the *Apps* page) makes a project with ID `local.<slug>`, the name "<name> (copy)" and npm versions in place of `workspace:*`. |
| P5 | Existing folder | Picked with the host dialog (`app-project` grant), must contain `studio-app.json`. Registered in place; without git, Studio asks before `git init`. Its own `AGENTS.md` is kept; Studio's rules go into the first prompt instead. |
| P6 | Removing a project | Removes it from Studio; deleting the folder and uninstalling the app are separate checkboxes, unchecked by default (UX-003). *Assumption.* |

### Build, preview and install

| # | Topic | Decision |
| --- | --- | --- |
| B1 | Build | After each turn that changed files, and on *Build*: Studio runs `pnpm install` (when `package.json` or the lockfile changed), `pnpm build` and `studio-app pack`, with fixed arguments. *Assumption* for the automatic build after every turn. |
| B2 | Build errors | The log in a card with *Ask the agent to fix it*, which sends the log as the next prompt. |
| B3 | Preview | A separate installation `<appId>.preview`, version `<version>-preview.<n>`, marked `preview`, out of navigation and view contributions, shown only in the preview pane on the active target. The pane picks a shell or submodel the app applies to, or the module's page. |
| B4 | Preview consent | Asked in the pane only when permissions, origins or connections change since the previous preview; settings and bindings are copied from the real installation. |
| B5 | Install | *Install* or *Update* runs the existing inspect → consent → install flow with the version from `package.json`. When it is not higher than the installed one, the page offers a patch or minor bump. |
| B6 | Trust | The user chooses: *Developer (unsigned)* or *Signed*. Signed uses the machine key by default, or the user's own key. |
| B7 | Machine key | P-256, created on first use, encrypted with Studio's data key, trusted as publisher *This computer* for `local.*`. *Copy public key* lets another Studio trust it. |
| B8 | Own key | A PEM file picked with the host dialog (`signing-key` grant), used once and not stored. *Export package* saves the ZIP and the `.sig`. |

## Design

### Page

```text
┌ App Builder ─────────────────────────────────────────────────────────────────────────────┐
│ [+ New app]           │ Nameplate QR                         Codex · model ▾ │ Preview ◧ │
│ ▾ Nameplate QR    ●   │                                                      │           │
│     Add QR code       │  You: a view for the Digital Nameplate that shows    │ Shell ▾   │
│     German texts      │  the logo, the serial number as a QR code and a      │ ┌───────┐ │
│ ▸ Line dashboard      │  print button                                        │ │ ACME  │ │
│ ▸ Nameplate (copy)    │                                                      │ │ ▓▓▓▓  │ │
│                       │  ☑ Plan: 1 Read the starter ☑ 2 Add view ☐ 3 Tests  │ │ ▓QR▓  │ │
│ Agents                │  ▸ Edited ui/src/App.vue        +84 −3   [Diff]      │ │[Print]│ │
│  ✓ Claude             │  ▸ Ran pnpm test                ✓ 6 passed           │ └───────┘ │
│  ✓ Codex              │  ┌ Wants to run: curl https://… ─────────────────┐   │ Preview 3 │
│  ⚠ opencode signed out│  │ [Allow once] [Allow in this chat] [Deny]       │   │ ✓ built   │
│                       │  └────────────────────────────────────────────────┘   │           │
│                       │  Agent: The view is ready. …                         │ [Install] │
│                       │ ┌──────────────────────────────────────────────────┐ │           │
│                       │ │ Ask for a change…                         [Send] │ │           │
│                       │ └──────────────────────────────────────────────────┘ │           │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### New app

```text
 What should the app do?
 ┌──────────────────────────────────────────────────────────────┐
 │ a view for the Digital Nameplate that …                      │
 └──────────────────────────────────────────────────────────────┘
 Start from  ◉ Empty app   ○ Copy of a bundled app [Nameplate ▾]   ○ Folder on this computer [Choose…]
 Agent [Codex ▾]  Name [Nameplate QR]  Folder ~/Documents/BaSyx Studio/Apps/nameplate-qr
                                                                          [Cancel] [Start]
```

### Install

```text
 Install "Nameplate QR" 0.1.0
 ◉ Signed with this computer's key   (updates need the same key)
 ○ Signed with my own key…           (for other Studios too)
 ○ Developer, unsigned
 → then the existing permission dialog (ADR 0044)
```

### Code structure

- `app/pages/app-builder.vue` and `app/components/app-builder/`: `App.vue`,
  `ProjectList.vue`, `AgentStatus.vue`, `AgentsMissing.vue`, `NewAppDialog.vue`,
  `ChatTranscript.vue`, `MessageItem.vue`, `ToolCallCard.vue`, `DiffCard.vue`,
  `PlanCard.vue`, `ApprovalCard.vue`, `Composer.vue`, `PreviewPane.vue`,
  `BuildStatus.vue`, `InstallDialog.vue`, `i18n.ts`, `locales/*.json`.
  Vuetify only, no custom CSS; new recurring looks go into
  `vuetify.config.ts` defaults or aliases.
- `app/composables/useAppBuilderClient.ts`: operations, the SSE stream with
  resume, desktop dialogs.
- `shared/contract/app-builder.ts`: Zod schemas for projects, agents,
  conversations, events (a Studio-side mapping of ACP `session/update`),
  approvals, builds and operations.
- `server/lib/agents/`: `catalog.ts` (the three agents: command, arguments,
  mode for "edit in folder"), `environment.ts` (login-shell `PATH`, tool
  lookup), `client.ts` (ACP client on `@agentclientprotocol/sdk`: spawn,
  initialize, sessions, cancel, shutdown), `policy.ts` (answers to
  permission requests from A1), `events.ts` (ACP updates → contract events,
  sequence numbers, persistence).
- `server/lib/app-projects/`: `projects.ts` (register, scaffold, copy,
  remove), `template/` (the shipped template and `AGENTS.md`), `git.ts`
  (commit per turn, diff, revert), `build.ts` (install, build, pack, logs),
  `preview.ts` (ID and version rewrite, preview installation), `release.ts`
  (version bump, install, export), `keys.ts` (machine key, signing).
  No `nuxt/server` imports (AGENTS.md).
- `server/lib/apps/`: `preview` column and its filtering in
  `listActiveInstallations` and contributions; the machine key as an extra
  trust store publisher in `trust.ts`.
- `server/database/schema.ts` and a migration: `app_projects`,
  `app_builder_conversations`, `app_builder_events`, `app_installations.preview`,
  `machine_signing_keys`.
- `server/utils/app-builder.ts`, `server/api/studio/v1/app-builder/[operation].post.ts`,
  `server/api/studio/v1/app-builder/conversations/[id]/events.get.ts`.
- `shared/file-grant-kinds.ts`, `electron/main.ts`, `electron/preload.ts`:
  grants `app-project` (directory) and `signing-key` (`.pem`); *Open in editor*
  and *Open folder* through the shell.
- `scripts/build-example-apps.mjs`: also copy the sources of `apps/*` (without
  `node_modules` and `dist`) to `server/bundled-app-sources/`.

## Phases

### Phase 0: spikes (decides details, no UI) — done on macOS, 2026-11-09

- Run both adapters on Electron's Node from the packaged app on macOS,
  Windows and Linux; measure the installer growth; check `allowBuilds` for
  their install scripts and `electron-builder` for their native binaries.
- For each agent, confirm: the mode that edits the folder without asking;
  that commands outside A1 arrive as `session/request_permission`;
  `session/load` support; model and mode lists; how sign-in is reported.
- Confirm that reading `PATH` from the login shell finds `opencode`, `node`,
  `pnpm` and `git` when Studio is started from Finder, the Dock and the Start
  menu.
- Result: a note in this plan per agent; changes to ADR 0054 if a premise
  does not hold.

### Phase 0 results

A raw JSON-RPC ACP client (about 150 lines) ran each agent on macOS (arm64)
with the same prompt: create a file, run `pnpm --version`, run `curl`, and
append to a file outside the folder. The client allowed every permission
request except `curl`. Versions: claude-agent-acp 0.101.0 with Claude Code
2.1.282, codex-acp 2.6.0 with Codex 0.151.0, opencode 2.2.6,
`@agentclientprotocol/sdk` 2.4.0. 2.5.0 was younger than the release-age
delay and is what both adapters pin anyway.

| Question | Claude | Codex | opencode |
| --- | --- | --- | --- |
| Starts over ACP on Electron's Node (Electron 45.1, Node 24.22) | yes | yes | n/a (own binary) |
| Uses the installed CLI | yes, `CLAUDE_CODE_EXECUTABLE` | yes, `CODEX_PATH` (0.151 under an adapter built for 0.166 worked) | yes |
| `initialize` | 0.3–0.8 s | 0.2–0.4 s | 0.2 s |
| Sign-in | `authMethods` empty; signed out, `session/new` succeeds and `session/prompt` fails with `authRequired` | `api-key`, `chat-gpt` | `opencode-login` |
| Modes (config option `mode`) | `default`, `acceptEdits`, `plan`, `auto`, `bypassPermissions` | `read-only`, `workspace-write`, `agent`, `agent-full-access`; plus `collaboration_mode` `plan` | `build`, `plan` |
| Models (config option `model`) | yes, and `effort` | yes, 17 models | yes, all configured providers |
| Edits in the folder without asking | `acceptEdits`: yes, with a `diff` in the tool call | `workspace-write`: yes | with `"edit": "allow"`: yes |
| Commands | each asks, `pnpm --version` included, so Studio's policy decides | run inside the OS sandbox without asking, `curl` included; network was on, and `CODEX_CONFIG` with `network_access: false` did not change that | by rule from `OPENCODE_CONFIG_CONTENT`: `pnpm *` allowed, `curl` asked |
| Writing outside the folder | asks, for the edit tool (`kind: edit`) and for the shell | asks (sandbox escalation) | asks (`bash: "*": ask`); default opencode settings asked nothing and wrote it |
| Permission options | `allow_once`, `allow_always` (`allow-with-updates`), `reject_once` | `allow_once`, `allow_always` (exec-policy rule), `reject_once` | `allow_once`, `allow_always`, `reject_once` |
| After *Deny* | the turn goes on; the agent reports the step it skipped | — | the turn ends (`stopReason: cancelled`) |
| `session/load` in a new process | yes: replays the transcript, remembers the content | yes: replays the transcript, remembers the content | yes: replays the transcript, remembers the content |

Consequences for the design (folded into ADR 0054):

- **No agent binaries in the installer.** The adapters' platform packages
  (`@anthropic-ai/claude-agent-sdk-<platform>` 305 MB,
  `@openai/codex@…-<platform>` 347 MB on darwin-arm64) are left out of the
  Electron build. The adapters themselves are about 5 MB with dependencies.
  Users install the CLIs they want. Since the adapters are started as
  processes and never imported, Nitro's file tracing does not see them;
  they ship like Deno, as `extraResources`, or through Nitro's
  `traceInclude`.
- **Clean environment.** An adapter started from inside another agent
  session (as in this spike, run from Claude Code) inherits that session's
  `CLAUDE_*` and `ANTHROPIC_*` variables. Studio passes only what the agents
  need.
- **Sign-in check before the chat.** Claude reports a missing sign-in only on
  the first prompt, so the agent status comes from `claude auth status`
  (JSON), `codex login status` and opencode's `authMethods`.
- **Model per chat.** Codex fell back to the model from the user's
  configuration, which their ChatGPT account could not use, and after
  `session/load` it switched back to it. Studio stores the chosen model per
  chat and sets it again after every load.
- **opencode needs Studio's rules.** With its default settings, opencode ran
  `curl` and wrote outside the folder without asking. Studio always passes:
  `{"permission":{"edit":"allow","bash":{"*":"ask","pnpm *":"allow","git status*":"allow","git diff*":"allow","git log*":"allow"},"webfetch":"ask","external_directory":"ask"}}`.
  A *Deny* ends opencode's turn, so the card says so.
- **"Allow in this chat" stays in Studio.** The agents' `allow_always`
  options can store rules that outlive the chat (Claude's
  `allow-with-updates` updates its permission settings; Codex's adds an
  exec-policy rule; not inspected further). Studio keeps *Allow in this chat* in its own
  memory of the chat and answers each matching request with `allow_once`,
  so nothing outlives the chat.
- **Codex confines by sandbox, not by asking.** Commands in the folder,
  including network calls, do not reach Studio's policy. Writes outside the
  folder do. Whether Codex's network can be turned off per session is still
  open; Studio runs `pnpm install` itself (B1) either way.
- **`PATH`.** With launchd's `PATH`, only `git` was found. The login shell
  (`/bin/zsh -ilc` with markers, stdin closed) found all six tools in 1.35 s.
  Studio does this once per start, in the background. `opencode` here is a
  symlink into the OpenCode desktop app's versioned CLI folder, which an app
  update can break; Studio also looks in that folder.

Not covered yet:

- Windows and Linux, and the packaged app started from Finder, the Dock or
  the Start menu (the spike used Electron's binary from `node_modules`).

Claude was tested after `claude auth login`. A first run before that, with
the CLI signed out, is where the sign-in finding comes from.

### Phase A: agents and chat

Catalogue, environment, ACP client, policy, events, SSE; the page with agent
status, chats on a scratch folder, transcript cards, approvals, cancel.
Done when a prompt to each of the three agents streams into the page, an
approval card round-trips, and *Stop* works.

*Done on macOS, 2026-11-09.* The status, the chat with transcript cards
(messages as Markdown, thoughts, tool calls with diffs and output, plans,
approvals), cancel and the model choice work in the desktop app. Tests use an
in-process ACP agent (`test/agents`). Conversations live in memory and end
with the Studio Service, each in a scratch folder under
`STUDIO_DATA_DIR/app-builder/scratch`; saved chats and projects are phase B.
The page's texts are in English and German; the other locales fall back to
English until phase F. Not yet checked: the adapters in a packaged build
(`traceInclude` in `nuxt.config.ts`).

### Phase B: projects

Scaffold from the template, `AGENTS.md`, git commits per turn, *Show changes*
and *Undo this turn*, project list, open folder and editor, resume.
Done when "make an app that lists the shells" produces a project whose
`pnpm build` and `pnpm test` pass.

*Built on macOS, 2026-11-09; the end-to-end check with a real agent is
open.* Projects (`app_projects`), chats (`app_builder_conversations`) and
their events (`app_builder_events`, written in batches) are in the database
(migration `0010_app_builder`). A new project is the starter app with the
project's name, the app ID `local.<slug>` and `@basyx/*` at Studio's minor
version, plus `AGENTS.md` and `CLAUDE.md`, committed as the first commit
under `~/Documents/BaSyx Studio/Apps/<slug>` (`STUDIO_APP_PROJECTS_DIR`
changes it). After each turn Studio commits what changed and shows it as a
card with *Show changes* and *Undo from here*; undo restores the files of the
commit before in a new commit and tells the agent with the next prompt.
Saved chats are `inactive` until the next prompt, which starts the agent and
loads its session; the chosen model is set again. Agents idle for 15 minutes
are stopped. Tests: `test/agents/projects.test.ts` runs the whole flow with
real git and an in-process agent.

Learned on the way:

- Claude runs read-only commands (`git ls-files`, `cat`) without a
  permission request, and writes commands as
  `cd "<folder>" && pnpm install 2>&1 | tail -5`. The policy reads a `cd`
  into the project folder, `&&` between commands and a trailing
  `2>&1 | tail/head -n` (`commandsOf`); anything else still asks.
- A reload of the Studio Service (in `nuxt dev`, any server change) ends the
  running agents; their chats come back `inactive` and resume with the next
  prompt.

### Phase C: build and preview

Build pipeline, build-error card, preview installation (ID and version
rewrite, `preview` flag, filtering), preview pane with shell or submodel
picker, consent on permission changes.
Done when each turn's result is visible in the pane within seconds of the
build, and preview apps appear nowhere else in Studio.

*Built on macOS, 2026-11-09.* After every turn that changed files, Studio
runs `pnpm install` (only when `package.json` or the lockfile is newer than
`node_modules`), `pnpm build` and `pnpm exec studio-app pack` in the folder
(`server/lib/app-projects/build.ts`); the chat shows the build, and a failed
one offers *Ask the agent to fix it* with the end of its log. The package
installs as `<appId>.preview`, flagged `preview` (migration
`0011_app_previews`), unsigned, with the checks of an upload but without
version rules, so it never replaces the app and follows the folder. Previews
are left out of `listActiveInstallations` (contributions, `openView`,
`embedView`) and of the *Apps* list. The pane (`PreviewPane.vue`) asks first,
and again when a build adds permissions, origins, sandbox features,
connections or a backend; it shows a module or submodel view on a target,
shell and submodel the user picks. AAS Clicker built in about 6 seconds.

Open: the build state and a preview waiting for the OK live in memory, so
after a restart the pane says *Not built* until the next build; settings and
connection bindings are not yet copied from the installed app (B4); backends
of previews are not tried yet.

### Phase D: install and signing

Install dialog, version bump, unsigned and signed installs, machine key and
trust store entry, own key, export.
Done when an app goes from preview to installed signed with the machine key,
an update with the same key passes, and an update with another key is refused
as in ADR 0044.

### Phase E: copies and existing folders

Shipping the sources of bundled apps, *Copy and change* (also on the *Apps*
page), existing folders with the `app-project` grant.
Done when a copy of the Digital Nameplate builds, previews and installs next
to the bundled one.

### Phase F: finish

All strings in the seven locales ([ADR 0026](../adr/0026-ui-translation.md)),
accessibility (keyboard, announced streaming and status), docs
(`docs/architecture/app-platform.md`, user guide), ADR 0054 to *Accepted*
once the platforms are qualified.

## Tests

- Unit (`test/`): policy decisions for paths and commands (inside, outside,
  symlinks, `..`); the mapping of ACP updates to events; the preview ID and
  version rewrite; version bumps; machine key encryption and signatures;
  trust store with the machine publisher; preview filtering.
- Integration: the ACP client against a fake agent (a small ACP server in
  the test that edits files and asks for permission), so CI needs no agent
  account; git commit and revert on a temp folder; build and pack of the
  template.
- E2E desktop (`test:e2e:desktop`): page with agents missing, a chat with the
  fake agent, preview and install.
- By hand with the real agents: the user story above with each of the three.

## Open questions

- Which CLI versions each adapter release needs at least, so the page can
  say "update Codex" instead of failing. (Phase A)
- Whether the automatic build after every turn is too slow for large apps;
  if so, build on the agent's turn end only when files under `ui/` or the
  manifest changed. (Phase C)
- Backend apps (Deno) in agent-built apps: allowed by the template, but
  preview of backends needs the runner to accept preview installations.
  (Phase C)
