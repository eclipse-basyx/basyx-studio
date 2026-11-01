// Sets or checks the one version of BaSyx Studio and its packages
// (ADR 0053): the package.json of Studio, @basyx/studio-sdk,
// @basyx/studio-app-kit and @basyx/file-viewer, the starter example's
// ranges on the packages, and the row of the SDK README's release table
// with the app API version. The release workflow sets it; the tag
// v<version> must name it.
//   node scripts/release-version.mjs <version>          set it, if newer than every release tag
//   node scripts/release-version.mjs --check <version>  check it, as the release workflows do
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const { values: options, positionals } = parseArgs({ options: { check: { type: 'boolean' } }, allowPositionals: true })
const [version] = positionals
const root = new URL('..', import.meta.url)
const manifests = ['package.json', ...['studio-sdk', 'studio-app-kit', 'file-viewer'].map(name => `packages/${name}/package.json`)]
const starter = 'examples/apps/starter/package.json'
const readme = 'packages/studio-sdk/README.md'
const releaseTable = '| Studio and packages | App API (`studioAppApiVersion`) |'
const versionField = /^ {2}"version": "([^"]*)"/m
const packageRange = /("@basyx\/(?:studio-sdk|studio-app-kit|file-viewer)": ")[^"]*"/g
const semver = /^(\d+)\.(\d+)\.(\d+)(?:-([\d.a-z-]+))?$/i

if (!semver.test(version ?? '')) {
  throw new Error('Usage: node scripts/release-version.mjs [--check] <version>, e.g. 0.2.0 or 0.2.0-rc.1')
}

const read = file => readFileSync(new URL(file, root), 'utf8')
const write = (file, text) => writeFileSync(new URL(file, root), text)
// A prerelease provides the app API of the release it leads to.
const release = version.replace(/-.*$/, '')
const appApi = read('packages/studio-sdk/src/protocol.ts').match(/studioAppApiVersion = '([^']+)'/)?.[1]
const row = `| ${release} | ${appApi} |`

/** SemVer precedence of two versions: negative, zero or positive. */
function compare (a, b) {
  const [, ...left] = a.match(semver)
  const [, ...right] = b.match(semver)
  for (let index = 0; index < 3; index++) {
    const difference = Number(left[index]) - Number(right[index])
    if (difference !== 0) {
      return difference
    }
  }
  // A version without prerelease ranks above its prereleases.
  if (!left[3] || !right[3]) {
    return (left[3] ? -1 : 0) + (right[3] ? 1 : 0)
  }
  const leftParts = left[3].split('.')
  const rightParts = right[3].split('.')
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index++) {
    const [l, r] = [leftParts[index], rightParts[index]]
    if (l === undefined || r === undefined) {
      return l === undefined ? -1 : 1
    }
    const numeric = /^\d+$/.test(l) && /^\d+$/.test(r)
    const difference = numeric ? Number(l) - Number(r) : l.localeCompare(r)
    if (difference !== 0) {
      return difference
    }
  }
  return 0
}

/** The README with the release table's row for this version, added or with the current app API. */
function withReleaseRow (text) {
  const lines = text.split('\n')
  const header = lines.indexOf(releaseTable)
  if (header === -1) {
    throw new Error(`${readme} has no release table (${releaseTable}).`)
  }
  let end = header + 2
  while (lines[end]?.startsWith('|')) {
    end++
  }
  const existing = lines.findIndex((line, index) => index > header + 1 && index < end && line.startsWith(`| ${release} |`))
  if (existing === -1) {
    lines.splice(end, 0, row)
  } else {
    lines[existing] = row
  }
  return lines.join('\n')
}

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
  if (!read(readme).split('\n').includes(row)) {
    found.push(`The release table of ${readme} has no row "${row}".`)
  }
  return found
}

if (!options.check) {
  const tags = execFileSync('git', ['tag', '--list', 'v*'], { cwd: fileURLToPath(root), encoding: 'utf8' })
  const released = tags.split('\n').map(tag => tag.slice(1)).filter(tag => semver.test(tag))
  const newest = released.toSorted(compare).at(-1)
  if (newest && compare(version, newest) <= 0) {
    throw new Error(`${version} is not newer than the release v${newest}.`)
  }
  for (const file of manifests) {
    write(file, read(file).replace(versionField, `  "version": "${version}"`))
  }
  write(starter, read(starter).replace(packageRange, `$1^${version}"`))
  write(readme, withReleaseRow(read(readme)))
  console.info(`Studio and its packages are at ${version}, with app API ${appApi}.`)
}

const found = problems()
for (const problem of found) {
  console.error(problem)
}
if (found.length > 0) {
  process.exitCode = 1
}
