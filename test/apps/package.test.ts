import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { readAppPackage } from '~~/server/lib/apps/package'
import { StudioProblem } from '~~/server/lib/problem'
import { fixturesDirectory, manifestOf, zipApp, zipDirectory } from './support'

function rejection (bytes: Uint8Array, mode: 'hosted' | 'desktop' = 'hosted'): StudioProblem {
  try {
    readAppPackage(bytes, mode)
  } catch (error) {
    if (error instanceof StudioProblem) {
      return error
    }
    throw error
  }
  throw new Error('The package was accepted.')
}

describe('readAppPackage', () => {
  it('accepts a valid package and addresses every file by its digest', () => {
    const pkg = readAppPackage(zipApp(manifestOf(), {
      'ui/index.html': '<!doctype html>',
      'ui/app.js': 'console.log(1)',
      'ui/style.css': 'body{}',
    }), 'hosted')
    expect(pkg.manifest.id).toBe('org.example.test')
    expect(pkg.digest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(pkg.files.map(file => [file.path, file.contentType]).toSorted()).toEqual([
      ['ui/app.js', 'text/javascript; charset=utf-8'],
      ['ui/index.html', 'text/html; charset=utf-8'],
      ['ui/style.css', 'text/css; charset=utf-8'],
    ])
    expect(pkg.files.every(file => /^[0-9a-f]{64}$/.test(file.digest))).toBe(true)
  })

  it('accepts an archive of a folder and skips archive litter', () => {
    const pkg = readAppPackage(zipSync({
      'my-app/studio-app.json': strToU8(JSON.stringify(manifestOf())),
      'my-app/ui/index.html': strToU8('<!doctype html>'),
      'my-app/.DS_Store': strToU8('x'),
    }), 'hosted')
    expect(pkg.files.map(file => file.path)).toEqual(['ui/index.html'])
  })

  it('rejects archives that are not ZIP files, unsafe or too large', () => {
    expect(rejection(strToU8('not a zip')).code).toBe('app_package_rejected')

    const traversal = rejection(zipSync({ 'studio-app.json': strToU8(JSON.stringify(manifestOf())), '../evil.js': strToU8('x') }))
    expect(traversal.code).toBe('app_package_rejected')
    expect(traversal.violations?.[0]?.message).toContain('unsafe entry name')

    const oversized = rejection(zipSync({ 'studio-app.json': strToU8(JSON.stringify(manifestOf())), 'ui/blob.png': randomBytes(21 * 1024 * 1024) }, { level: 0 }))
    expect(oversized.violations?.[0]?.message).toContain('larger than 20 MiB')

    const bomb = rejection(zipSync({ 'studio-app.json': strToU8(JSON.stringify(manifestOf())), 'ui/zeros.txt': new Uint8Array(15 * 1024 * 1024) }))
    expect(bomb.violations?.[0]?.message).toContain('compressed suspiciously well')
  })

  it('rejects file types apps may not contain', () => {
    const problem = rejection(zipApp(manifestOf(), { 'ui/index.html': '<!doctype html>', 'bin/tool.exe': 'MZ', 'run.sh': '#!/bin/sh' }))
    expect(problem.violations).toEqual(expect.arrayContaining([
      { path: 'bin/tool.exe', message: 'has a file type that apps may not contain' },
      { path: 'run.sh', message: 'has a file type that apps may not contain' },
    ]))
  })

  it('reports schema violations of the manifest with their paths', () => {
    expect(rejection(zipApp(null)).violations).toEqual([{ path: 'studio-app.json', message: 'is missing at the package root' }])
    expect(rejection(zipApp('{ not json')).violations).toEqual([{ path: 'studio-app.json', message: 'is not valid JSON' }])

    const problem = rejection(zipApp({ ...manifestOf(), id: 'NoDots', permissions: ['studio.root'], extra: true } as never))
    expect(problem.code).toBe('app_package_rejected')
    expect(problem.violations).toEqual(expect.arrayContaining([
      { path: 'studio-app.json', message: 'has the unknown property "extra"' },
      expect.objectContaining({ path: 'studio-app.json#id' }),
      expect.objectContaining({ path: 'studio-app.json#permissions.0', message: expect.stringContaining('must be one of') }),
    ]))
  })

  it('checks references, unique IDs and routes, and backend permissions', () => {
    const problem = rejection(zipApp(manifestOf({
      permissions: ['studio.backend'],
      contributes: {
        submodelViews: [{ id: 'same', title: { en: 'A' }, entry: 'ui/missing.html', semanticIds: ['urn:x'] }],
        modules: [
          { id: 'same', title: { en: 'B' }, entry: 'ui/index.html', route: 'page', context: 'global' },
          { id: 'other', title: { en: 'C' }, entry: 'ui/index.html', route: 'page', context: 'target' },
        ],
      },
    })))
    expect(problem.violations).toEqual(expect.arrayContaining([
      { path: 'studio-app.json#contributes.submodelViews[0].entry', message: 'names "ui/missing.html", which is not in the package' },
      { path: 'studio-app.json#contributes.modules[0].id', message: 'duplicates the contribution ID "same"' },
      { path: 'studio-app.json#contributes.modules[1].route', message: 'duplicates the route "page"' },
      { path: 'studio-app.json#permissions', message: 'requests studio.backend, but the app has no backend' },
    ]))

    const backend = rejection(zipApp(manifestOf({ backend: { runtime: 'deno', entry: 'backend/main.js' } })))
    expect(backend.violations).toEqual(expect.arrayContaining([
      { path: 'studio-app.json#backend.entry', message: 'names "backend/main.js", which is not in the package' },
      { path: 'studio-app.json#permissions', message: 'must include studio.backend when the app has a backend' },
    ]))
  })

  it('refuses apps for another Studio app API or runtime', () => {
    const api = rejection(zipApp(manifestOf({ studioApi: '^2.0.0' })))
    expect(api.code).toBe('app_incompatible')
    expect(api.violations).toEqual([{ path: 'studio-app.json#studioApi', message: 'requires Studio app API ^2.0.0; this Studio provides 0.1.0' }])

    expect(rejection(zipApp(manifestOf({ studioApi: 'not a range' }))).code).toBe('app_incompatible')
    expect(rejection(zipApp(manifestOf({ runtimes: ['desktop'] })), 'hosted').violations).toEqual([
      { path: 'studio-app.json#runtimes', message: 'does not include hosted' },
    ])
  })
})

const examples = fileURLToPath(new URL('../../examples/apps/dist', import.meta.url))

// The example apps, after `pnpm apps:build`.
describe.runIf(existsSync(examples))('example app packages', () => {
  it.each(['nameplate', 'shell-explorer', 'backend-demo'])('%s is a valid package for hosted and desktop', async name => {
    const bytes = new Uint8Array(await readFile(join(examples, `${name}.zip`)))
    expect(readAppPackage(bytes, 'hosted').manifest.id).toBe(`org.eclipse.basyx.examples.${name}`)
    expect(readAppPackage(bytes, 'desktop').files.length).toBeGreaterThan(1)
  })
})

describe('the isolation probe', () => {
  it('is a valid package', async () => {
    expect(readAppPackage(await zipDirectory(join(fixturesDirectory, 'probe')), 'hosted').manifest.permissions).toEqual(['studio.aas.read'])
  })
})
