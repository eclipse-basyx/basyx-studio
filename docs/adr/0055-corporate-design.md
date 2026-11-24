# 0055: Corporate design: branding sources, locked appearance, legal pages and About

- Status: Proposed
- Date: 2026-11-24
- Deciders: BaSyx Studio maintainers
- Requirements: BRAND-001 to BRAND-009, SAP-001, UX-002

## Context

Companies roll Studio out as their own tool, hosted or on managed desktops
([issue #204](https://github.com/eclipse-basyx/basyx-studio/issues/204)).
They need their name, logos and colours, need to keep users from changing
parts of the look, and, in the EU and Germany, need an imprint and a privacy
policy that users reach without signing in. The BaSyx AAS Web UI offers part
of this through environment variables and has an About page that credits
the project.

Studio already read a product name, logos, a default accent, a copyright
line and two legal links from `STUDIO_*` variables
([ADR 0035](0035-container-image-and-base-path.md)). Every user could still
change every appearance setting, legal pages could only be links, the
desktop app had no branding, and nothing in Studio named Eclipse BaSyx once
a deployment set its own name.

## Decision

- **Three sources, highest first.** Environment variables, then a YAML
  *branding file* (`STUDIO_BRANDING_FILE`), then what administrators set in
  Studio (*Settings → Branding*, the tables `branding_settings` and
  `branding_assets`). Each value comes from the first source that has it;
  legal pages merge per page, files per slot, and locks add up. A value from
  the environment or the file is read-only in Studio, with its source shown.
  `STUDIO_BRANDING_EDITABLE=false` ignores the administrators' source and
  refuses changes to it. The variables of ADR 0035 keep their meaning.
- **One schema.** `shared/branding.ts` defines the settings (name,
  organisation, support and help links, accent and secondary colour per
  theme, default theme, background, shape and languages, offered languages,
  sign-in message, legal pages, locks), the file slots (`logo-light`,
  `logo-dark`, `logo-compact`, `favicon`, `font`) and their types. The file
  groups them for people (`logo`, `appearance`, `languages`) and names files
  where the settings hold contents; its errors name the field as written in
  the file, and an invalid file stops Studio at startup. Export writes the
  branding in effect in the same format with its files (`branding.zip`);
  import replaces the administrators' source.
- **Files stay on Studio's origin.** Logos, favicon and font are served at
  `<base>/branding/<slot>?v=<digest>` with a sandboxing policy, as the logos
  of ADR 0035 were, and cached for good under their digest. A font cannot be
  a URL: it would tell another host about every page view. The font is set
  as `--v-font-body` in a head style generated from configuration, the one
  place Studio writes CSS (as it writes theme colours).
- **Locks are enforced by the server.** The preferences API applies the
  deployment's policy: locked settings (`theme`, `accent`, `background`,
  `shape`, `uiLanguage`, `valueLanguage`) take its value whatever a request
  says, and the user's earlier choice stays stored for when the lock is
  lifted. Unlocked settings default to the deployment's value; a value equal
  to the default is not stored, so users follow a changed default. The UI
  shows locked controls disabled with a lock and *Set by your organisation*.
- **Legal pages are public.** Four slots (`imprint`, `privacy`,
  `accessibility`, `terms`), each per language a URL or Markdown. Studio
  shows Markdown at `/legal/<page>` with the file viewer's sanitising
  renderer (no HTML, no scripts, no remote images). These pages and `/about`
  open without a session; the sign-in page, the account menu, Settings and
  About link them. A hosted Studio without imprint or privacy policy logs a
  warning.
- **About and Powered by Eclipse BaSyx are not configurable.** Every
  deployment has `/about` with its own details and a fixed part about
  Eclipse BaSyx: its links, developer team and organisations, kept in
  `shared/about.ts`. Studio ships the available photos and organisation
  logos with their source notices. *Powered by Eclipse BaSyx* is shown on
  the sign-in page, in the account menu, in Settings, on About and on the desktop welcome
  screen. No setting removes them; Studio's licence still lets forks do so.
  About links to the third-party licence notices generated from the installed
  production dependency trees when Studio builds.
- **Desktop.** The desktop app prefers the system-wide file to
  `STUDIO_BRANDING_FILE` and environment branding values (`/Library/Application Support/BaSyx
  Studio/branding.yml`, `%ProgramData%\BaSyx Studio\branding.yml`,
  `/etc/basyx-studio/branding.yml`). Its desktop user is always an
  administrator. A system-wide lock uses the setting from that file or,
  when it is unset, Studio's default. The main process
  names the windows and the About panel after the brand and uses a PNG
  compact logo as the dock and window icon; installers and bundle icons stay
  BaSyx Studio's.
- **Apps follow the shape and font.** The theme Studio sends apps carries
  `shape` and the optional deployment font URL (app API 0.1.16). The app kit
  applies both. The font is served under the installation's file URL and
  the app's existing Content Security Policy applies.

## Consequences

- One brand per deployment; per-infrastructure or per-tenant branding would
  need another source.
- Each replica reads the administrators' settings and asset metadata per
  request. Serving and exporting files reads their bytes. Open clients
  refresh their branding when the window regains focus. Changes to the
  branding file and environment variables need a restart.
- Legal texts are the operator's responsibility. Studio provides the slots,
  their reachability and the [guide](../deployment/branding.md), including
  the personal data Studio itself processes.
- The About page's team list needs an owner who keeps it current and asks
  people before listing them.
- Rebranded installers (name, icons, signing identity) are out of scope;
  SAP-007 covers a branded desktop product.

## Alternatives considered

- **Variables only, as the Web UI.** Cannot carry legal texts, per-language
  messages or files in containers without mounts, and give the desktop
  nothing.
- **Administrators only.** On the desktop every user is an administrator, so
  locks would bind nobody; hosted operators also want branding in their
  deployment's configuration from the first start.
- **Hiding locked controls.** Users would not know why a setting is missing.
  Disabled controls with a lock explain it.
- **Hot-loading the branding file.** Consistent with neither
  `STUDIO_INFRASTRUCTURES_FILE` nor the variables; a restart is explicit.
