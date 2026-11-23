# Contributing to BaSyx Studio

Thanks for helping to improve BaSyx Studio. This guide explains how to report
problems, propose changes and get a pull request merged.

## Questions, bugs and ideas

- **Questions** go to [GitHub Discussions](https://github.com/eclipse-basyx/basyx-studio/discussions).
- **Bugs** go to a [bug report](https://github.com/eclipse-basyx/basyx-studio/issues/new?template=bug_report.yml).
  Search the existing issues first, and include the Studio version, how you
  run Studio, and the AAS server it talks to.
- **Features** start as a [feature request](https://github.com/eclipse-basyx/basyx-studio/issues/new?template=feature_request.yml).
  For anything larger than a small fix, agree on the approach in the issue
  before you write code.
- **Security vulnerabilities** are never reported in public issues. Follow the
  [Eclipse BaSyx security policy](https://github.com/eclipse-basyx/.github/blob/main/SECURITY.md).

## Before your first pull request

BaSyx Studio is an [Eclipse Foundation](https://www.eclipse.org) project.
Every contributor needs a signed
[Eclipse Contributor Agreement (ECA)](https://www.eclipse.org/legal/ECA.php),
and the email address of your commits must be the one of your Eclipse account.
A check on every pull request verifies this.

Contributions are licensed under the project's [MIT License](LICENSE.md).

## Set up the project

The [setup guide](setup.md) covers the prerequisites, the web and desktop
development servers, the bundled apps and the container image. In short:

```bash
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm testenv:up
cp .env.example .env
pnpm dev
```

The project uses pnpm only, with the supply-chain rules described in the setup
guide. Do not add lockfiles of other package managers.

## Make a change

- **Follow the project rules** in [AGENTS.md](AGENTS.md). They apply to people
  and coding agents alike: the user interface is built from Vuetify components
  without custom CSS, shared looks live in the Vuetify defaults, and server
  code keeps domain logic in `server/lib`. ESLint enforces most of them.
- **Translate every new text.** Add it to all files under `i18n/locales`;
  `pnpm i18n:check` reports missing keys.
- **Document the change.** Update the README, `docs/` and the
  [setup guide](setup.md) where they describe what you changed.
- **Record architecture decisions.** A change to an accepted decision needs a
  new or superseding [ADR](docs/adr/README.md); accepted ADRs are not
  rewritten.
- **Test it.** Add unit tests for logic, and integration or end-to-end tests
  where the change crosses the server or the user interface.

Run the checks before you push:

```bash
pnpm lint
pnpm lint:md
pnpm typecheck
pnpm test
pnpm test:integration   # needs pnpm testenv:up
```

[Continuous integration](docs/development/ci.md) runs these and the end-to-end
tests on every pull request.

## Open a pull request

1. Fork the repository and create a branch from `main`.
2. Keep the pull request to one topic. Write commit messages and the title as
   a short sentence that says what changes, as in the existing history (for
   example "Report a 412 from the target to a request without If-Match as a
   rejected request").
3. Fill in the pull request template: what and why, how you tested it, and
   screenshots in light and dark mode for changes to the user interface.
4. A maintainer reviews the pull request. Once the checks pass and the review
   is approved, it is merged.

## Using coding agents

Coding agents are welcome. [AGENTS.md](AGENTS.md) (and `CLAUDE.md`, which
points to it) gives them the project rules. You stay the author of what you
submit: review the result, run the checks, and be ready to explain every
change in your pull request.

## Code of conduct

Everyone taking part in this project follows the
[Eclipse Foundation Community Code of Conduct](CODE_OF_CONDUCT.md).
