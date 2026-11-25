import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { defineNuxtModule } from 'nuxt/kit'

interface DependencyLicences {
  name: string
  license: string
  paths: string[]
  homepage?: string
}

const noticeFile = /^(?:licen[cs]es?|copying|copyright|notices?|ofl|unlicense|third[-_ ]party[-_ ](?:licen[cs]es?|notices?))(?:$|[-_. ])/i

/**
 * Runs the pnpm that runs this build. Scripts put node_modules/.bin first on
 * the PATH, and on Windows its pnpm shim cannot start, because the install
 * script of the pnpm devDependency is denied (pnpm-workspace.yaml). Run from
 * outside pnpm, the pnpm on the PATH is used.
 */
function pnpm (args: string[], cwd: string): string {
  const options = { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 } as const
  const execPath = process.env.npm_execpath
  if (execPath && /pnpm/i.test(basename(execPath))) {
    return /\.[cm]?js$/i.test(execPath)
      ? execFileSync(process.execPath, [execPath, ...args], options)
      : execFileSync(execPath, args, { ...options, shell: /\.(?:cmd|bat)$/i.test(execPath) })
  }
  return execFileSync('pnpm', args, { ...options, shell: process.platform === 'win32' })
}

/** Reads the notices distributed in the installed production dependency trees. */
function generateNotices (rootDir: string): string {
  const inventory = pnpm([
    '--filter', 'studio', '--filter', './apps/*', '--filter', './packages/*',
    'licenses', 'list', '--prod', '--json',
  ], rootDir)

  const dependencies = Object.values(JSON.parse(inventory) as Record<string, DependencyLicences[]>).flat()
  const packages = new Map<string, { licence: string, homepage?: string, notices: Map<string, string> }>()
  for (const dependency of dependencies) {
    for (const path of dependency.paths) {
      const { version } = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')) as { version: string }
      const name = `${dependency.name}@${version}`
      let entry = packages.get(name)
      if (!entry) {
        entry = { licence: dependency.license, homepage: dependency.homepage, notices: new Map() }
        packages.set(name, entry)
      }
      for (const file of readdirSync(path, { withFileTypes: true })) {
        if (file.isFile() && noticeFile.test(file.name)) {
          const content = readFileSync(join(path, file.name), 'utf8').replaceAll('\r\n', '\n').trim()
          if (content) {
            entry.notices.set(content, file.name)
          }
        }
      }
    }
  }
  if (packages.size === 0) {
    throw new Error('No production dependencies were found for the Studio licence notices.')
  }

  const divider = '-'.repeat(72)
  const sections = [...packages].toSorted(([a], [b]) => a.localeCompare(b, 'en')).map(([name, entry]) => [
    divider,
    name,
    `Licence: ${entry.licence}`,
    ...(entry.homepage ? [`Project: ${entry.homepage}`] : []),
    ...[...entry.notices].toSorted(([, a], [, b]) => a.localeCompare(b, 'en')).map(([content, filename]) => `\n${filename}\n\n${content}`),
  ].join('\n'))

  return [
    'BaSyx Studio third-party licence notices',
    '',
    'Generated from the installed production dependencies of Studio, its bundled apps, and their workspace packages.',
    'The desktop application includes the Electron and Chromium notices in its application resources.',
    '',
    divider,
    readFileSync(resolve(rootDir, 'public/about-assets/NOTICE.txt'), 'utf8').trim(),
    '',
    ...sections,
    '',
  ].join('\n')
}

export default defineNuxtModule({
  meta: { name: 'studio-third-party-notices' },
  setup (_, nuxt) {
    nuxt.hook('nitro:config', nitroConfig => {
      // Nuxt recreates its build directory before Nitro copies public assets.
      const dir = mkdtempSync(join(tmpdir(), 'studio-third-party-notices-'))
      nuxt.hook('close', () => rmSync(dir, { recursive: true, force: true }))
      writeFileSync(join(dir, 'third-party-notices.txt'), generateNotices(nuxt.options.rootDir))
      nitroConfig.publicAssets ??= []
      nitroConfig.publicAssets.push({ dir, maxAge: 0 })
    })
  },
})
