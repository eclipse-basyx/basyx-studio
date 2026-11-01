// Sets or checks the one version of BaSyx Studio and its packages
// (ADR 0053): the package.json of Studio, @basyx/studio-sdk,
// @basyx/studio-app-kit and @basyx/file-viewer, and the starter example's
// ranges on the packages. The release v<version> must name it, and the
// SDK's README must have a row for it with the app API version.
//   node scripts/release-version.mjs <version>          set it
//   node scripts/release-version.mjs --check <version>  check it, as the release workflows do
import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

const { values: options, positionals } = parseArgs({ options: { check: { type: 'boolean' } }, allowPositionals: true })
const [version] = positionals
const root = new URL('..', import.meta.url)
const manifests = ['package.json', ...['studio-sdk', 'studio-app-kit', 'file-viewer'].map(name => `packages/${name}/package.json`)]
const starter = 'examples/apps/starter/package.json'
const readme = 'packages/studio-sdk/README.md'
const versionField = /^ {2}"version": "([^"]*)"/m
const packageRange = /("@basyx\/(?:studio-sdk|studio-app-kit|file-viewer)": ")[^"]*"/g

if (!/^\d+\.\d+\.\d+(?:-[\d.a-z-]+)?$/i.test(version ?? '')) {
  throw new Error('Usage: node scripts/release-version.mjs [--check] <version>, e.g. 0.2.0 or 0.2.0-rc.1')
}

const read = file => readFileSync(new URL(file, root), 'utf8')
const write = (file, text) => writeFileSync(new URL(file, root), text)

/** What still keeps a release of this version from being made. */
function problems () {
  const found = []
  for (const file of manifests) {
    const actual = read(file).match(versionField)?.[1]
    if (actual !== version) {
      found.push(`${file} is at ${actual}, not ${version}.`)
    }
  }
  if ([...read(starter).matchAll(packageRange)].some(match => !match[0].endsWith(`^${version}"`))) {
    found.push(`${starter} does not depend on ^${version} of the packages.`)
  }
  // A prerelease provides the app API of the release it leads to.
  const release = version.replace(/-.*$/, '')
  const appApi = read('packages/studio-sdk/src/protocol.ts').match(/studioAppApiVersion = '([^']+)'/)?.[1]
  if (!read(readme).split('\n').some(line => line.startsWith(`| ${release} | ${appApi}`))) {
    found.push(`The version table of ${readme} has no row "| ${release} | ${appApi}…" (app API ${appApi}).`)
  }
  return found
}

if (!options.check) {
  for (const file of manifests) {
    write(file, read(file).replace(versionField, `  "version": "${version}"`))
  }
  write(starter, read(starter).replace(packageRange, `$1^${version}"`))
  console.info(`Studio and its packages are at ${version}.`)
}

const found = problems()
for (const problem of found) {
  console.error(problem)
}
if (options.check && found.length > 0) {
  process.exitCode = 1
}
