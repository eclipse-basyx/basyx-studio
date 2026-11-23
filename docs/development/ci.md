# Continuous integration

`.github/workflows/ci.yml` checks every pull request against `main`, every
push to `main`, and `main` once a night. Its jobs run side by side on
standard `ubuntu-latest` runners. On a pull request, a job whose files did not
change is skipped by fixed path rules; `CI result` sums up the run.

## Jobs

| Job | What it proves | Runs on a pull request |
| --- | --- | --- |
| Jobs of this run (`changes`) | Decides which jobs run and writes why into its job summary | Always |
| Lint and translations | `pnpm lint`, `pnpm i18n:check` | Always |
| Typecheck | `pnpm typecheck` | Always |
| Unit tests | `pnpm test` | Always |
| Build hosted Studio | `pnpm build`; hands the build to the end-to-end jobs | Always |
| Integration tests against the test environment | `pnpm testenv:smoke`, `pnpm test:integration`, with the PostgreSQL cases of unit tests | Studio's code, `test/integration`, `test/support`, `test-setup`, and the unit tests that use the test environment |
| End-to-end tests, hosted web (4 shards) | `pnpm test:e2e:web`, `pnpm test:e2e:origins` on the build | Studio's code, the web and origins tests, `test/apps`, `test-setup`, `examples/apps` |
| Build the unpacked desktop app | `pnpm build:electron:dir`; hands the app to the desktop end-to-end jobs | Studio's code, `electron`, `build`, the desktop tests, `test/apps`, `test-setup/fixtures`, `examples/apps` |
| End-to-end tests of the packaged desktop app (2 shards) | `pnpm test:e2e:desktop` on the unpacked Linux app | As the desktop build |
| Local container lifecycle and export/import | `test/integration/containers.test.ts` on the runner's Docker | The container, desktop and database code on the server |
| Container image build and smoke test | The image, `.github/scripts/image-smoke-test.sh` and the deployment examples | `docker`, `examples/deployment`, and the server parts they exercise |
| An app built from the packed packages | `scripts/check-app-tarballs.mjs` | `packages`, `examples/apps` |
| CI result | Every planned job succeeded | Always |

"Studio's code" is `app`, `server`, `shared`, `apps`, `packages`, `i18n`,
`modules`, `public` and `scripts/build-example-apps.mjs`.

## When a job is skipped

`scripts/ci-changes.mjs` holds the rules, and `test/ci/changes.test.ts` tests
them. A change to a rule changes this document in the same pull request.

1. A push to `main`, the nightly run and a manual run (*Run workflow*) run
   every job.
2. A pull request with the label `ci:full` runs every job. The labels are read
   when the run starts, so after adding the label, choose *Re-run all jobs*.
3. If the changed files are unknown, every job runs.
4. The changed files are those that merging the pull request would change,
   over all of its commits; a moved file counts at its old and its new path.
   Documentation (`docs/**`, `**/*.md`) does not count; a pull request with
   nothing else starts no run at all.
5. If one of them is a file at the repository root (`package.json`,
   `pnpm-lock.yaml`, `nuxt.config.ts`, `Dockerfile`, …), under `patches/`, or
   part of CI (`ci.yml`, `.github/actions`, `.github/scripts`,
   `scripts/ci-changes.mjs`), every job runs.
6. Otherwise a job runs if it always runs, or if a changed file matches one of
   its paths.

`**` in a path spans folders and `*` stays within one. The summary of the
`Jobs of this run` job lists each job with the file and path that ran it.

A pull request can still break a skipped job when it changes code that the
job's paths do not name. The push to `main` and the nightly run catch that;
the fix is then a path added to the job's rule.

## CI result

`CI result` fails if a job failed or was cancelled, or if a job was skipped
although the plan ran it (for example because the build it needs failed). A
skipped job counts as passed only when the plan skipped it. `main` has no
branch protection today; if CI is ever required before merging, `CI result`
is the one check to require, so that renaming, adding or sharding jobs never
touches the branch protection.

## End-to-end shards

The hosted web tests run in four shards, each on its own runner against its
own test environment, so they stay isolated without changes to the tests.
`test/e2e/web.config.ts` assigns the files with `STUDIO_E2E_SHARD`:

| Shard | Files |
| --- | --- |
| `apps` | `apps.spec.ts` |
| `models3d` | `models3d.spec.ts` |
| `content` | `viewer`, `structure`, `files`, `edit` |
| `other` | every other file, and the app origin tests |

A new spec file lands in `other` without further changes. When a shard grows
much longer than the others, move a file to another shard or name a new one in
both `web.config.ts` and the matrix in `ci.yml`. Locally, all files run when
`STUDIO_E2E_SHARD` is not set.

The desktop tests run in two shards in the same way
(`test/e2e/desktop.config.ts`): `containers` (`containers.spec.ts`) and
`other`, every other file.

Both build jobs take the bundled apps (`server/bundled-apps`) from the cache
when nothing they are built from changed (`.github/actions/bundled-apps`): the
apps, the packages, the dependency set and the build script. The cache has no
fallback keys, so any change to these builds them again.

The shards start together with the build job, not after it. Each one starts
the test environment in the background (`.github/scripts/testenv.sh start`),
installs dependencies and the browser, builds the example apps (`pnpm
apps:build`), and then waits until the build job has
uploaded its artifact (`.github/scripts/wait-for-artifact.sh`); it fails as
soon as the build job ends without one. The artifact list can name the
artifact a moment before a download finds it, so a failed download is tried
once more after 30 seconds. The desktop shards wait for the
desktop build likewise and install their display and keyring packages in the
background meanwhile. The runner image has Chromium's
libraries, so their packages are installed only if Chromium does not start:
apt mirrors sometimes take minutes for them.

## Duration

Before this layout, a pull request took about 20 minutes: the integration
job waited for lint, typecheck, unit tests and build, then ran the test
environment, the container tests, a second build and all end-to-end tests one
after another.

With every job running and the bundled apps from the cache, a run takes about
5 minutes (October 2026). The path to the result is the hosted build (about
2.5 minutes) followed by the longest web shard (about 2 minutes); the image
job takes about as long, but runs only when its paths change. Without the
cache, the build takes about 45 seconds longer.
