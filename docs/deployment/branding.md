# Branding and legal pages

A company can give Studio its own name, logos, colours and font, decide which
appearance settings users may change, and add the legal pages its users need
to see ([ADR 0055](../adr/0055-corporate-design.md)). The same works for the
hosted Studio and for the desktop app. Whatever a deployment sets, Studio
shows *Powered by Eclipse BaSyx* and an About page about the project.

- [Where branding comes from](#where-branding-comes-from)
- [The branding file](#the-branding-file)
- [Environment variables](#environment-variables)
- [Branding in Studio](#branding-in-studio)
- [Locked settings](#locked-settings)
- [Legal pages](#legal-pages)
- [Desktop app](#desktop-app)
- [About and Powered by Eclipse BaSyx](#about-and-powered-by-eclipse-basyx)
- [Coming from the BaSyx AAS Web UI](#coming-from-the-basyx-aas-web-ui)

## Where branding comes from

Three sources set the branding. Each value comes from the first source that
has it:

1. **Environment variables** (`STUDIO_PRODUCT_NAME`, `STUDIO_LOGO*`, …),
   for simple values in containers.
2. **The branding file** (`STUDIO_BRANDING_FILE`), a YAML file with
   everything, including logos, legal texts and locks.
3. **Administrators in Studio** (*Settings → Branding*), stored in Studio's
   database.

A value set by a variable or the file is shown read-only in Studio, with its
source. Locks add up: administrators can lock more settings, but cannot
unlock what the file locks. With `STUDIO_BRANDING_EDITABLE=false`, Studio
ignores the administrators' branding and shows the page read-only.

Studio reads variables and the file at startup; restart it after changing
them. Changes in Studio apply at once, for every user.

## The branding file

[`examples/deployment/branding`](../../examples/deployment/branding/) is a
complete example with logos, legal texts and a Compose file:

```yaml
version: 1

productName: Example Twin Studio
organisation: Example GmbH            # copyright line and About page
supportUrl: mailto:studio-support@example.com   # or a web page
helpUrl: https://example.com/docs/twin-studio

logo:
  light: ./logo-light.svg             # one path serves both themes
  dark: ./logo-dark.svg
  compact: ./logo-mark.svg            # square, for small places and the desktop icon
favicon: ./logo-mark.svg
font: ./fonts/ExampleSans.woff2       # optional

appearance:
  theme: system                       # light, dark or system
  accent: { light: "#00549F", dark: "#5FA8FF" }   # or one "#RRGGBB" for both
  secondary: "#F69222"
  background: slate                   # neutral, slate, warm, midnight, contrast
  shape: rounded                      # normal or rounded

languages:
  default: de                         # for users who pick none; else the browser's
  available: [de, en]                 # the languages users can pick from
  values: de                          # default language of multi-language values

signInMessage:
  de: Willkommen im Digital-Twin-Portal der Example GmbH.
  en: Welcome to the Example GmbH digital twin portal.

legal:
  imprint:                            # per language, a Markdown file or a URL
    de: ./legal/impressum.de.md
    en: https://example.com/en/imprint
  privacy: https://example.com/privacy   # one page for every language
  accessibility: https://example.com/accessibility
  terms: ./legal/terms.md

locked: [theme, accent, shape]
```

Every field is optional except `version`. Paths are relative to the file.
Studio checks the whole file at startup and refuses to start with a message
that names the field, for example
`STUDIO_BRANDING_FILE: /etc/branding.yml: appearance.accent: use #RRGGBB`.

| Field | Accepts |
| --- | --- |
| `logo.*` | SVG, PNG, WebP or JPEG, up to 2 MB; or an `https://` URL |
| `favicon` | SVG, PNG or ICO, up to 2 MB; or an `https://` URL |
| `font` | A woff2 file, up to 2 MB. No URL: a font from another host would learn of every page view |
| `legal.*` | Markdown (`.md`) or an `http(s)` URL, for all languages or per language code |
| `languages.*` | `en`, `de`, `fr`, `es`, `zh-Hans`, `ja`, `nl` |
| `locked` | `theme`, `accent`, `background`, `shape`, `uiLanguage`, `valueLanguage` |

Logos should be wide and transparent, about 4:1, and readable at 24 px
height; the compact logo square, readable at 16 px. Studio serves the files
at `<base>/branding/<slot>` with a policy that keeps an SVG from running
scripts, and never inlines them into the page.

**Colours.** Text and icons in the accent and secondary colour must stay
readable. Where a colour reaches less than 4.5:1 contrast (WCAG AA) against
the page, Studio uses a darker shade in the light theme and a lighter one in
the dark theme, and says so in the log and on the Branding page. Give the
dark theme its own, lighter colour to keep control over it.

**Font.** The font replaces Roboto in the whole interface; Roboto stays the
fallback for missing characters. Bundled apps keep their own font.

## Environment variables

The variables of the [configuration reference](README.md#branding-legal-links-and-switches)
still work and take precedence over the file:

| Variable | Sets |
| --- | --- |
| `STUDIO_PRODUCT_NAME` | `productName` |
| `STUDIO_LOGO`, `STUDIO_LOGO_LIGHT`, `STUDIO_LOGO_DARK` | `logo.light`, `logo.dark` (absolute path or URL) |
| `STUDIO_PRIMARY_COLOR`, `…_LIGHT`, `…_DARK` | `appearance.accent` |
| `STUDIO_COPYRIGHT_NAME` | `organisation` |
| `STUDIO_LEGAL_NOTICE_URL` | `legal.imprint` |
| `STUDIO_PRIVACY_POLICY_URL` | `legal.privacy` |
| `STUDIO_BRANDING_FILE` | The branding file |
| `STUDIO_BRANDING_EDITABLE` | `false` turns off branding in Studio (default `true`) |

## Branding in Studio

Administrators open *Settings → Branding*. They can set every field of the
file, upload logos, favicon and font, write the sign-in message and legal
texts per language, and lock settings. A preview shows the light and the dark
theme before saving. Every change is written to the audit log with the
administrator's subject.

**Export** downloads `branding.zip`: the branding in effect, from all three
sources, as `branding.yml` with its files. Unpack it next to the deployment
and set `STUDIO_BRANDING_FILE`, or **Import** it into another Studio, where it
replaces what administrators set there. A design made in Studio can so be
rolled out by IT, to containers or to desktop computers.

## Locked settings

Settings → Appearance shows a lock next to a locked setting, and its control
is disabled with the hint *Set by your organisation*. Locks are enforced by
the Studio Service, not only in the page: a request that changes a locked
setting keeps the organisation's value. A user's own choice is kept in the
database and comes back when the lock is lifted.

Unlocked settings start at the deployment's default. A user who picks the
default stores nothing for it, and so follows the deployment when it changes
the default later.

Locks complement the switches that already narrow what users may do:
`STUDIO_READ_ONLY`, `STUDIO_ALLOW_UPLOADS`, `STUDIO_APPS_ALLOW_INSTALL` and
`STUDIO_INFRASTRUCTURES_EDITABLE`.

## Legal pages

Studio has four slots: **imprint** (legal notice), **privacy** (privacy
policy), **accessibility** (accessibility statement) and **terms** (terms of
use). Each one is, per language, either a link to a page elsewhere or
Markdown that Studio shows at `/legal/<page>`. Users see their language, else
the default language, else English, else any.

The pages and the About page open **without signing in**. Studio links them on
the sign-in page, in the account menu, in Settings and on the About page, so
they are at most two clicks away from any screen.

Hosted Markdown is shown as text: no HTML, no scripts, no images, and links
open in a new tab without a referrer. Lines of a paragraph join; end a line
with `\` to keep an address on several lines.

**What a deployment in the EU usually needs.** *This is guidance, not legal
advice; your organisation is responsible for the content.*

- **Imprint (Germany: Impressum, § 5 DDG).** Required for services offered
  in Germany for business purposes, including internal portals of some
  organisations. It must be easy to find and directly reachable.
- **Privacy policy (GDPR, Art. 13 and 14).** Who processes which personal
  data, why, how long, and the users' rights.
- **Accessibility statement.** Required for public-sector bodies (EU
  Directive 2016/2102) and for some consumer-facing services under the
  European Accessibility Act (Germany: BFSG).
- **Terms of use.** Optional; common for portals used by partners or
  customers.

A hosted Studio without an imprint or privacy policy logs a warning at
startup.

### Personal data Studio itself processes

For your privacy policy, BaSyx Studio processes:

- **Sign-in.** The subject, name and roles from your identity provider, in a
  session that ends after `STUDIO_SESSION_TTL_HOURS` (default 12 hours). One
  technically necessary session cookie; no tracking or analytics cookies.
- **Preferences.** Each user's appearance, languages, recently opened shells
  and Overview layouts, stored with their subject.
- **Credentials.** Tokens Studio uses for infrastructures on the user's
  behalf, encrypted with the data key.
- **Audit log.** Sign-in and sign-out, changes to infrastructures, apps and
  branding, app and connection calls, and target authorizations, with the
  user's subject and a request ID.
- **Server logs.** Startup and error messages; the container's log driver
  decides how long they are kept.

Studio loads nothing from other hosts unless the deployment configures it:
infrastructures, external file origins (`STUDIO_EXTERNAL_FILE_ORIGINS`), app
origins or logos given as URLs.

## Desktop app

The desktop app reads the same branding file. Besides `STUDIO_BRANDING_FILE`
it looks in a place for the whole computer, which IT can manage and users
cannot change:

| System | Path |
| --- | --- |
| macOS | `/Library/Application Support/BaSyx Studio/branding.yml` |
| Windows | `%ProgramData%\BaSyx Studio\branding.yml` |
| Linux | `/etc/basyx-studio/branding.yml` |

The desktop user is always an administrator, so only this file makes locks
binding: values and locks from it are read-only on the Branding page.
Without the file, branding made in Studio applies to that installation only.

The window title, the About panel of macOS and the welcome screen use the
brand; a PNG compact logo (or favicon) also becomes the dock and window
icon. The installer, the app bundle's icon and its name stay BaSyx Studio's.

## About and Powered by Eclipse BaSyx

Every Studio has an About page (`/about`, also without signing in): this
deployment's name, organisation, version, support and legal links, then
Eclipse BaSyx, its links, its developer team and the organisations involved.
*Powered by Eclipse BaSyx* is shown on the sign-in page, in the account menu,
in Settings, on the About page and on the branded desktop welcome screen. No
setting removes it.

## Coming from the BaSyx AAS Web UI

The Web UI's variables have these counterparts:

| BaSyx AAS Web UI | BaSyx Studio |
| --- | --- |
| `LOGO_PATH`, `LOGO_LIGHT_PATH`, `LOGO_DARK_PATH` | `STUDIO_LOGO`, `STUDIO_LOGO_LIGHT`, `STUDIO_LOGO_DARK`, or `logo` in the branding file |
| `PRIMARY_COLOR`, `PRIMARY_LIGHT_COLOR`, `PRIMARY_DARK_COLOR` | `STUDIO_PRIMARY_COLOR`, `…_LIGHT`, `…_DARK`, or `appearance.accent` |
| `COPYRIGHT_NAME` | `STUDIO_COPYRIGHT_NAME`, or `organisation` |
| `LEGAL_NOTICE_URL`, `PRIVACY_POLICY_URL` | `STUDIO_LEGAL_NOTICE_URL`, `STUDIO_PRIVACY_POLICY_URL`, or `legal` |
| `ALLOW_EDITING=false` | `STUDIO_READ_ONLY=true` |
| `ALLOW_UPLOADING=false` | `STUDIO_ALLOW_UPLOADS=false` |
| `ENDPOINT_CONFIG_AVAILABLE=false` | `STUDIO_INFRASTRUCTURES_EDITABLE=false` with [declared infrastructures](README.md#declared-infrastructures) |
