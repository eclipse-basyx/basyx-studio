# 0026: UI translation

- Status: Proposed
- Date: 2026-10-14
- Deciders: BaSyx Studio maintainers
- Requirements: none yet; proposes UX-007 ("Studio and the bundled apps shall
  be usable in English, German, French, Spanish, Simplified Chinese, Japanese
  and Dutch")

## Context

Studio's UI strings live in one file, `i18n/locales/en.json` (about 760 lines,
81 interpolations, 16 plural messages), used through `useI18n()` and `t()`.
`@nuxtjs/i18n` 10 runs with `strategy: 'no_prefix'` and a single locale.
Vuetify's own texts (`$vuetify.*`) are registered for English only in
`i18n/i18n.config.ts`; `vuetify-nuxt-module` already installs Vuetify's
vue-i18n locale and date adapters because `@nuxtjs/i18n` is present, but it
ignores its own `localeMessages` option in that case, so Vuetify messages for
other locales have to be registered by Studio.

Some parts already depend on the locale:

- Dates and numbers are formatted with `toLocaleString(locale)` in a handful
  of components; `useTimeAgo` uses translated keys.
- `preferences.valueLanguage` chooses the language of multi-language AAS
  values (descriptions, display names, MultiLanguageProperty). It is a free
  BCP 47 tag, because AAS content can be in any language.
- Apps get `context.locale` (the UI locale) over the `studio-sdk/0` bridge and
  use it to pick AAS value texts (`apps/shared/app.ts: langText`), while
  Studio itself uses `valueLanguage` for the same purpose. Their own UI
  strings ("Save", "Cancel", "No technical properties.") are hard-coded in
  English. Manifest titles and descriptions are already language maps
  (`{ "en": … }`) resolved by `useAppContributions`.
- Server errors arrive as `Problem` codes and are translated on the client
  (`ProblemAlert`: `problem.<code>`), so the Studio Service needs no
  translations.
- `en.json` contains `apps.permissions` twice; JSON parsing keeps the second
  value ("Permissions: {list}"), which is the one `admin/apps.vue` uses. The
  first one is unreachable.

The first languages are English, German, French, Spanish, Simplified Chinese,
Japanese and Dutch. French and the CJK languages break the English plural
assumptions, and Roboto has no CJK glyphs.

## Decision

### Locales and files

- Locale codes and their BCP 47 `language` (used for detection, `<html lang>`
  and `Intl`):

  | code | language | name | Vuetify locale |
  | --- | --- | --- | --- |
  | `en` | `en-US` | English | `en` |
  | `de` | `de-DE` | Deutsch | `de` |
  | `fr` | `fr-FR` | Français | `fr` |
  | `es` | `es-ES` | Español | `es` |
  | `zh-Hans` | `zh-CN` | 简体中文 | `zhHans` |
  | `ja` | `ja-JP` | 日本語 | `ja` |
  | `nl` | `nl-NL` | Nederlands | `nl` |

  `zh-Hans` leaves room for `zh-Hant` later. The list is defined once in
  `shared/locales.ts` and used by `nuxt.config.ts`, the preference schema and
  the key check.
- One JSON file per locale, `i18n/locales/<code>.json`, with the same key tree
  as `en.json`. English is the source; other files contain only translated
  keys. Splitting by feature is deferred until a file passes roughly 2,000
  lines.
- Each locale also loads `i18n/locales/vuetify/<code>.ts`, which returns
  `{ $vuetify: <Vuetify locale> }` through `defineI18nLocale`. `@nuxtjs/i18n`
  merges a locale's `files` and lazy-loads them, so a session loads only its
  own locale plus the English fallback. The eager English registration in
  `i18n.config.ts` moves into `vuetify/en.ts`.

### Choosing and storing the UI language

Precedence, highest first:

1. The user's stored preference `uiLanguage` (server-side, follows the user
   across browsers and the desktop app).
2. The `i18n_redirected` cookie (last language used in this browser).
3. `Accept-Language` on the server, `navigator.languages` in the browser
   (the desktop app's Chromium sends the OS language).
4. English.

- `detectBrowserLanguage: { useCookie: true, cookieKey: 'i18n_redirected',
  fallbackLocale: 'en' }`. With `no_prefix` there are no redirects;
  the module only reads the cookie or header and renders the server response
  in that locale, and the client hydrates with the same locale, so
  there is no hydration mismatch. Regional tags fall back to the language
  (`de-AT` → `de`, `zh-SG` → `zh-Hans`; `zh-TW` also lands on `zh-Hans` until
  `zh-Hant` exists).
- New preference field `uiLanguage: z.enum(localeCodes).nullable().default(null)`,
  where `null` means "follow the browser". It is separate from
  `valueLanguage`: the UI can only offer languages Studio is translated into,
  while AAS content may be in any language (a German user may want English
  descriptions, or Italian content that Studio does not translate).
- Applying the preference: as with the theme (`app.vue`), after hydration, when
  the preferences arrive and differ from the current locale, Studio calls
  `setLocale()`. That loads the messages, rewrites the cookie, and makes the
  next server render match. Only the first visit in a new browser can show one
  render in the browser language before switching; preferences are not read
  during the server render, which would add a database query to every request.
- Settings → Appearance gets a "Language" select (autonym names, plus
  "Browser default"). It calls `setLocale()` immediately and saves
  `uiLanguage`. The existing select becomes "Content language" with an added
  "Same as interface language" entry; stored `valueLanguage` values stay as
  they are.
- `<html lang>` comes from the locale's tag in `shared/i18n/locales.ts`, set
  in `app.vue`.

### Hidden dialects

- Saarländisch (`de-saar`), Pfälzisch (`de-pfalz`) and Berlinerisch
  (`de-berlin`) are an easter egg. Settings lists them only after "basyx" is
  typed on the page (outside a field), or while one of them is chosen.
- A dialect has `base: 'de'`: it loads `de.json` and then its own file. The
  dialect files translate every key; German only covers keys added later
  until the dialects catch up, and the key check counts them as translated.
- Their real tags carry a variant subtag (`de-DE-saarland`) for `<html lang>`
  and `Intl`. The i18n module gets a private-use tag (`x-de-saar`) instead,
  because browser detection falls back to the primary subtag and would
  otherwise offer a dialect to every German browser while `de` is not yet
  available.

### Vuetify, dates and numbers

- Vuetify's components read `$vuetify.*` through the vue-i18n adapter that
  `vuetify-nuxt-module` installs, and its date adapter follows the vue-i18n
  locale (`vuetify:date-i18n:plugin`). No change in `vuetify.config.ts`.
- Dates and numbers use named formats from `i18n.config.ts`
  (`datetimeFormats.date`, `dateTime`; `numberFormats.integer`; more as
  step 4 needs them) through `d()` and `n()`, replacing the scattered
  `toLocaleString(locale, …)` calls. Numbers interpolated into messages are
  passed already formatted (`{ count, formatted: n(count) }`) where grouping
  matters.
- `useTimeAgo` keeps its keys; `Intl.RelativeTimeFormat` was considered but its
  short style differs between locales in ways that look inconsistent next to
  Studio's own abbreviations.

### Plurals and interpolation

- Messages keep vue-i18n's syntax: `{name}` interpolation and `|` choices.
  `t(key, { count })` already selects the plural form (vue-i18n uses a named
  `count` or `n` as the plural index).
- Studio defines one plural rule for all locales in `i18n.config.ts`
  (`pluralRules`), based on `Intl.PluralRules`, with a project-wide meaning for
  the number of choices:
  - 1 choice: always that text (natural for Chinese and Japanese).
  - 2 choices: `one | other`.
  - 3 choices: `zero | one | other`.

  vue-i18n's default rule treats 0 as plural, which is wrong for French
  ("0 résultat"); `Intl.PluralRules('fr')` gets it right. Chinese and Japanese
  map every count to `other`, so translators may write one form, or keep a
  separate zero form. Locales with more categories (none of the first seven)
  would extend the convention when they are added.
- Messages are never built by concatenating translated fragments; a sentence
  with variable parts is one message with named placeholders, so translators
  can reorder them.

### Bundled apps

- Apps translate themselves: they run in sandboxed frames and cannot use
  Studio's vue-i18n instance. Each bundled app gets
  `ui/src/locales/<code>.json` and uses vue-i18n with the same plural rule,
  exported from `apps/shared/`, keyed on `context.locale`. Third-party apps
  may do the same or ignore the locale.
- `studio-sdk/0` gains an additive `context.valueLanguage` (the resolved
  content language). Apps use it for AAS values and `context.locale` for their
  own strings, matching Studio. Apps on older SDKs keep using `locale`.
- Manifest `title` and `description` maps get entries for all seven locales;
  `useAppContributions` already resolves them with an English fallback.
- Electron's own texts (startup error box, native dialogs) stay English for
  now; they are rare and outside the Nuxt app.

### Fonts

- Roboto (loaded by `@nuxt/fonts`) covers English, German, French, Spanish
  and Dutch. No CJK web font is shipped: a CJK font is several megabytes and
  every supported desktop OS has one (PingFang/Hiragino on macOS, Microsoft
  YaHei/Yu Gothic on Windows, Noto Sans CJK on most Linux desktops).
- The browser falls back per character from Roboto to the system font. With
  the correct `<html lang>`, it picks the Chinese or Japanese glyph variants
  of unified Han characters. If testing shows poor fallbacks on a platform,
  `$body-font-family` in `assets/styles/settings.scss` gets explicit
  system families after Roboto; no custom CSS is needed.

### Translation workflow and checks

- `en.json` is the source of truth and the only file developers edit when
  they add a string. Other locales may lag; vue-i18n falls back to English per
  key (`fallbackLocale: 'en'`, `missingWarn` and `fallbackWarn` only in
  development).
- First translations: machine-drafted (an LLM, given the key path, the English
  text and a short glossary of AAS terms such as Shell, Submodel, Concept
  Description, which stay in English where the community does so), then
  reviewed by a native speaker before the locale is offered in the picker.
  German and Dutch review can come from the maintainers' circle; French,
  Spanish, Chinese and Japanese need community reviewers. A locale without a
  review is not listed in the picker; its file may exist.
- Translations are ordinary pull requests on the JSON files. A hosted tool
  such as Weblate (which reads vue-i18n JSON) is deferred until there are
  outside translators who do not use Git.
- `pnpm i18n:check` (`scripts/check-i18n.mjs`, run in CI) checks Studio's and
  the bundled apps' locale files against English:
  - fails on duplicate keys (a duplicate-aware parse, not `JSON.parse`),
  - fails on keys that do not exist in English,
  - fails when a translation's placeholders differ from English
    (`{name}` sets) or it has 2 choices where English has 3 or the other way
    round (1 choice is always allowed),
  - fails on invalid message syntax (compiled with `@intlify/message-compiler`),
  - reports missing keys per locale as a coverage table; with `--strict`
    (used for release builds) missing keys in a listed locale fail.
- ESLint gets `@intlify/eslint-plugin-vue-i18n` for the source side:
  `no-missing-keys` (a `t()` key that is not in English), `no-unused-keys`,
  `no-raw-text` (hard-coded text in templates, as a warning until the apps are
  converted) and `no-deprecated-tc`. Dynamic keys such as
  `` t(`problem.${code}`) `` are listed in the rule's ignore patterns.

## Consequences

- Users get the UI in their browser's language without configuration, and a
  chosen language follows them across devices.
- Adding a string costs one English entry; the other locales show English
  until translated, and CI shows the gap instead of hiding it.
- The first six translations (de, fr, es, zh-Hans, ja, nl) were
  machine-drafted and switched on before review, by the maintainers' choice
  on 2026-10-14; native-speaker review is still pending.
- Every listed locale needs a reviewer per release; an unmaintained locale is
  removed from the picker rather than shipped stale.
- The custom plural rule is a small piece of shared code that both Studio and
  the apps must use; tests cover it per locale.
- The first render in a new browser may be in the browser language when the
  stored preference differs.
- Bundled apps take a vue-i18n dependency each.
- Deferred: Traditional Chinese, right-to-left languages, translated Electron
  dialogs, translated server log messages, a translation management service.

## Alternatives considered

- **UI language from `valueLanguage`:** one setting, but it would offer only
  translated languages for AAS content, or show an untranslated UI for content
  languages such as Italian.
- **Reading the preference during the server render:** no language switch on a
  new browser, but a database query per request and a session dependency in
  server-side i18n; the cookie gives the same result after the first visit.
- **Prefix or domain strategy (`/de/…`):** shareable language-specific URLs,
  but Studio is an authenticated tool, not a public site; it would change every
  route and the desktop app's URLs.
- **`vuetify-nuxt-module` `localeMessages`:** not applied when `@nuxtjs/i18n`
  is present, and it would load every Vuetify locale eagerly.
- **vue-i18n's default plural rule:** wrong for French zero and forces three
  forms on Chinese and Japanese; per-locale hand-written rules would duplicate
  what `Intl.PluralRules` already knows.
- **Shipping Noto Sans CJK:** consistent glyphs everywhere, but several
  megabytes per weight and script for a font every target OS already has.
- **Passing Studio's messages to apps over the bridge:** apps would share
  Studio's key namespace and break when Studio renames keys; apps own their
  strings.
- **A translation service from day one:** useful with many outside
  translators, but another account, sync job and supply-chain dependency
  before there are any.

## Implementation steps

1. Fix the duplicate `apps.permissions` key (drop the unreachable first value)
   and add `pnpm i18n:check` to CI, running against `en.json` alone.
2. Add `shared/locales.ts`, configure the seven locales in `nuxt.config.ts`
   with lazy `files` and `detectBrowserLanguage`, move Vuetify messages to
   `i18n/locales/vuetify/<code>.ts`, add the plural rule and named formats to
   `i18n.config.ts`, and set `<html lang>` in `app.vue`. Only `en`
   is listed in the picker yet.
3. Add `uiLanguage` to the preferences contract, the language select in
   Settings, and apply it after hydration; rename the value-language select to
   "Content language" with "Same as interface language".
4. Replace `toLocaleString` calls with `d()` and `n()`; add
   `@intlify/eslint-plugin-vue-i18n` and fix its findings.
5. Machine-draft `de` first, review it, and check plurals, layout of long
   German labels and Vuetify texts; then the other five locales.
6. Bundled apps: shared plural rule and vue-i18n setup in `apps/shared/`,
   extract their strings, add `context.valueLanguage` to `studio-sdk/0`,
   translate manifests.
7. Check CJK rendering on macOS, Windows and Linux, in the browser and the
   desktop app; add explicit font families only if needed.
