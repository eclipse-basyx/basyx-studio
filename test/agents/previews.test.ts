import type { ConversationEvent } from '#shared/contract'
import type { BuildResult } from '../../server/lib/app-projects/build'
import type { PreviewInstaller } from '../../server/lib/app-projects/previews'
import type { AppManifest } from '@basyx/studio-sdk/protocol'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildProject, needsInstall, packageFileName, stripAnsi } from '../../server/lib/app-projects/build'
import { consentFor, previewAppId, ProjectPreviews } from '../../server/lib/app-projects/previews'

function manifest (id: string, permissions: string[], extra: Partial<AppManifest> = {}): AppManifest {
  return { id, version: '0.1.0', permissions, contributes: { modules: [] }, ...extra } as unknown as AppManifest
}

describe('App Builder preview consent (ADR 0054, plan B4)', () => {
  it('asks for a first preview, and later only for what is new', () => {
    const first = manifest('local.a', ['studio.aas.read'])
    expect(consentFor(null, first)).toEqual({ first: true, permissions: ['studio.aas.read'], added: ['permission studio.aas.read'] })
    expect(consentFor(first, first)).toBeNull()
    expect(consentFor(first, manifest('local.a', []))).toBeNull()
    const more = manifest('local.a', ['studio.aas.read', 'studio.aas.write'], { sandbox: { connectOrigins: ['https://api.example.com'], webAssembly: true } } as Partial<AppManifest>)
    expect(consentFor(first, more)).toEqual({
      first: false,
      permissions: ['studio.aas.read', 'studio.aas.write'],
      added: ['permission studio.aas.write', 'connectOrigins https://api.example.com', 'WebAssembly'],
    })
  })

  it('installs a preview beside the app, never over it', () => {
    expect(previewAppId('local.shell-list')).toBe('local.shell-list.preview')
  })
})

/** An app store in memory; packages are the manifest as JSON. */
function fakeInstaller () {
  const installed = new Map<string, AppManifest>()
  const installs: string[] = []
  const installer: PreviewInstaller = {
    read: bytes => JSON.parse(new TextDecoder().decode(bytes)) as AppManifest,
    current: async id => installed.has(id) ? { installationId: `inst-${id}`, manifest: installed.get(id)! } : null,
    install: async (bytes, id) => {
      installed.set(id, { ...installer.read(bytes), id })
      installs.push(id)
      return `inst-${id}`
    },
    contributions: async id => installed.has(id) ? { modules: [], submodelViews: [] } : null,
    remove: async id => {
      installed.delete(id)
    },
  }
  return { installer, installed, installs }
}

const project = { id: 'p1', appId: 'local.a', folder: '/work/a' }

function built (value: AppManifest): BuildResult {
  return { ok: true, log: '$ pnpm build', packageBytes: new TextEncoder().encode(JSON.stringify(value)) }
}

describe('App Builder previews (ADR 0054, plan B1–B4)', () => {
  it('waits for the first OK, then updates the preview by itself', async () => {
    const { installer, installs } = fakeInstaller()
    let next = built(manifest('local.a', ['studio.aas.read']))
    const previews = new ProjectPreviews({ installer, build: async () => next })
    const events: ConversationEvent[] = []

    await previews.build(project, event => events.push(event))
    expect(events).toEqual([
      { type: 'build', state: 'running', log: null, consentNeeded: false },
      { type: 'build', state: 'succeeded', log: null, consentNeeded: true },
    ])
    expect((await previews.describe(project)).consent).toMatchObject({ first: true })
    expect(installs).toEqual([])

    await previews.approve(project)
    expect(installs).toEqual(['local.a.preview'])
    expect(await previews.describe(project)).toMatchObject({ consent: null, installationId: 'inst-local.a.preview', build: { state: 'succeeded' } })

    await previews.build(project)
    expect(installs).toHaveLength(2)

    next = built(manifest('local.a', ['studio.aas.read', 'studio.aas.write']))
    await previews.build(project)
    expect(installs).toHaveLength(2)
    expect((await previews.describe(project)).consent).toMatchObject({ first: false, added: ['permission studio.aas.write'] })
    await expect(previews.approve(project).then(() => previews.approve(project))).rejects.toMatchObject({ code: 'not_found' })
  })

  it('reports a failed build with its log, and a package Studio refuses with its findings', async () => {
    const { installer } = fakeInstaller()
    const events: ConversationEvent[] = []
    const failing = new ProjectPreviews({ installer, build: async () => ({ ok: false, log: 'error TS2304', packageBytes: null }) })
    await failing.build(project, event => events.push(event))
    expect(events.at(-1)).toEqual({ type: 'build', state: 'failed', log: 'error TS2304', consentNeeded: false })

    const refusing = new ProjectPreviews({
      installer: { ...installer, read: () => {
        throw new Error('studio-app.json: permissions has an unknown entry')
      } },
      build: async () => built(manifest('local.a', [])),
    })
    await refusing.build(project, event => events.push(event))
    expect(events.at(-1)).toMatchObject({ state: 'failed', log: '$ pnpm build\nstudio-app.json: permissions has an unknown entry' })
  })

  it('runs one build at a time, and one more for what changed meanwhile', async () => {
    const { installer } = fakeInstaller()
    let builds = 0
    let release: () => void = () => {}
    const previews = new ProjectPreviews({
      installer,
      build: async () => {
        builds++
        await new Promise<void>(resolve => {
          release = resolve
        })
        return built(manifest('local.a', []))
      },
    })
    const first = previews.build(project)
    const second = previews.build(project)
    const third = previews.build(project)
    await new Promise(resolve => setTimeout(resolve, 0))
    release()
    await new Promise(resolve => setTimeout(resolve, 0))
    release()
    await Promise.all([first, second, third])
    expect(builds).toBe(2)
  })

  it('removes the old preview when the agent changes the app ID', async () => {
    const { installer, installed } = fakeInstaller()
    let next = built(manifest('local.a', []))
    const previews = new ProjectPreviews({ installer, build: async () => next })
    await previews.build(project)
    await previews.approve(project)
    next = built(manifest('local.b', []))
    await previews.build(project)
    expect([...installed.keys()]).toEqual([])
    await previews.approve(project)
    expect([...installed.keys()]).toEqual(['local.b.preview'])
    await previews.remove(project)
    expect([...installed.keys()]).toEqual([])
  })
})

const temporary: string[] = []
afterEach(() => {
  for (const path of temporary.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

describe('App Builder build steps (plan B1)', () => {
  it('installs only when the packages changed, then builds and packs with fixed commands', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'app-build-'))
    temporary.push(folder)
    writeFileSync(join(folder, 'package.json'), '{}')
    writeFileSync(join(folder, 'studio-app.json'), JSON.stringify({ id: 'local.a', version: '0.2.0' }))
    expect(await packageFileName(folder)).toBe('local.a-0.2.0.zip')
    expect(needsInstall(folder)).toBe(true)

    const calls: string[] = []
    const result = await buildProject(folder, {
      pnpm: 'pnpm',
      env: {},
      run: async (_, args, options) => {
        calls.push(`${args.join(' ')} @${options.cwd === folder ? 'folder' : options.cwd}`)
        if (args[0] === 'install') {
          mkdirSync(join(folder, 'node_modules'), { recursive: true })
          writeFileSync(join(folder, 'node_modules', '.modules.yaml'), '')
        }
        if (args[0] === 'exec') {
          writeFileSync(join(folder, 'local.a-0.2.0.zip'), 'zip')
        }
        return { code: 0, stdout: `${args[0]} ok`, stderr: '' }
      },
    })
    expect(calls).toEqual(['install --config.confirm-modules-purge=false @folder', 'build @folder', 'exec studio-app pack @folder'])
    expect(result.ok).toBe(true)
    expect(new TextDecoder().decode(result.packageBytes!)).toBe('zip')
    expect(needsInstall(folder)).toBe(false)

    const later = new Date(Date.now() + 5000)
    utimesSync(join(folder, 'package.json'), later, later)
    expect(needsInstall(folder)).toBe(true)

    const failed = await buildProject(folder, { pnpm: 'pnpm', env: {}, run: async () => ({ code: 1, stdout: '', stderr: 'error TS2304: Cannot find name' }) })
    expect(failed).toMatchObject({ ok: false, packageBytes: null })
    expect(failed.log).toContain('error TS2304')
    expect(failed.log).toContain('pnpm install failed with exit code 1.')
  })

  it('keeps terminal colours out of the log', () => {
    expect(stripAnsi('\u001B[33m[PLUGIN_TIMINGS] \u001B[0mdone')).toBe('[PLUGIN_TIMINGS] done')
  })
})
