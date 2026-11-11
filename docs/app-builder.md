# Building apps with the App Builder

The App Builder is part of the BaSyx Studio desktop app. You describe an app
in a chat, a coding agent writes it on your computer, Studio shows it beside
the chat, and you install it when it does what you want. The same chat
changes it later. How it works inside is in
[ADR 0054](adr/0054-app-builder-with-coding-agents.md).

## What you need

- **A coding agent**, installed and signed in: [Claude Code](https://docs.anthropic.com/en/docs/claude-code/setup)
  (`claude auth login`), [Codex](https://developers.openai.com/codex/cli)
  (`codex login`) or [opencode](https://opencode.ai/download). The agent works
  with your own account; Studio never sees its credentials.
- **Node.js, pnpm and git.** Studio builds and commits apps with them.

Studio finds these tools the way a terminal does. *Agents* at the bottom of
the App Builder shows what it found; after you install or sign in to
something, choose *Check again*.

## Making an app

1. Open *App Builder* in the navigation and choose *New app*.
2. Choose where to start:
   - **Empty app**: Studio's starter app.
   - **Copy of a bundled app**: the sources of an app shipped with Studio, such
     as the Digital Nameplate, as an app of your own. On the *Apps* page, the
     *Copy and change in the App Builder* button of a bundled app does the same.
     The bundled app stays installed.
   - **Folder on this computer**: an app you already have, with its
     `studio-app.json`. Studio works in that folder and never moves or
     deletes it.
3. Give the app a name, pick an agent, and describe what it should do.

New apps and copies go to `Documents/BaSyx Studio/Apps/<name>`. Each folder
is a git repository.

## Working with the agent

- The agent may change files in the app's folder and run `pnpm install`,
  `build`, `test`, `typecheck` and `package` there without asking. For
  anything else, it asks: *Allow once*, *Allow in this chat* or *Deny*. With
  opencode, *Deny* also ends its turn.
- The permissions menu beside the model sets how freely the agent works in
  this chat:
  - **Ask** (the default): as above.
  - **Auto**: the agent also runs other commands in the app's folder, as long
    as they name no path outside it and neither use `sudo` nor download with
    `curl` or `wget`. It still asks before it touches anything outside the
    folder.
  - **Unrestricted**: the agent no longer asks, and Studio allows everything:
    files anywhere on this computer, any command, the network. Studio warns
    first and turns it on only when you confirm that you understand the risk.
    A red bar above the prompt box and a mark in the chat list show it; *Back
    to Ask* turns it off. It applies to this chat only, and after Studio
    restarts the chat asks again.
- *Stop* ends the agent's turn. The model menu switches the agent's model.
- After each turn that changed files, Studio commits them. The card shows
  the files; *Show changes* shows what changed, and *Undo from here* puts the
  files back as they were before that turn, in a new commit, so nothing is
  lost. The agent learns of an undo with your next message.
- Chats are saved. An agent that has been idle for a while is stopped and
  continues its session with your next message.

## Preview

After each turn that changed files, Studio builds the app and shows it in
the preview pane. Choose which part of the app to show, and the
infrastructure, shell and submodel it runs on. The first preview, and every
build that asks for more permissions, waits for *Allow and show*. If a build
fails, *Ask the agent to fix it* hands the log to the agent.

The preview is installed beside your app, not over it; it appears only in
the App Builder.

## Installing

*Install in Studio* in the chat header:

1. **Version.** An update needs a higher version than the installed one;
   Studio raises it (patch or minor) and commits the change.
2. **Signature:**
   - **This computer's key**, for apps whose ID starts with `local.` (all
     apps the App Builder creates). Studio creates the key on first use and
     trusts it. *Copy public key* lets another Studio trust it in its trust
     store (`STUDIO_APPS_TRUSTED_PUBLISHERS`).
   - **Your own key**: an ECDSA P-256 private key in PEM, as `cosign
     generate-key-pair` writes it, used once and never stored. Use it for apps
     that other Studios install.
   - **Developer mode, unsigned**: only while unsigned installs are allowed,
     as they are in the desktop app by default.
3. *Build and check* builds the app and shows what it asks for, as the
   *Apps* page does for an upload. *Install* installs it; *Save package…*
   saves the package and its signature for other Studios.

An app signed with a key can only be updated with the same key.

## Good to know

- An app from a folder inside a larger git repository: Studio commits,
  shows and undoes only what is in the app's folder. The folder must have no
  uncommitted changes when you add it.
- Removing an app from the App Builder deletes its chats and its preview.
  The folder stays unless you tick the box; a folder you added yourself
  always stays.
- If Studio restarts while an agent works, its turn stops; send a message to
  go on.
