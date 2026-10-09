import type { AppManifest } from '@basyx/studio-sdk/protocol'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strToU8, zipSync } from 'fflate'

export const fixturesDirectory = fileURLToPath(new URL('fixtures', import.meta.url))

/** A minimal valid manifest with one submodel view at `ui/index.html`. */
export function manifestOf (overrides: Partial<AppManifest> = {}): AppManifest {
  return {
    manifestVersion: 0,
    id: 'org.example.test',
    version: '1.0.0',
    publisher: { name: 'Example' },
    title: { en: 'Test app' },
    studioApi: '^0.1.0',
    runtimes: ['hosted', 'desktop'],
    permissions: ['studio.aas.read'],
    contributes: {
      submodelViews: [{ id: 'view', title: { en: 'View' }, entry: 'ui/index.html', semanticIds: ['urn:example:semantic'] }],
    },
    ...overrides,
  }
}

/** Zips a manifest (object or raw text) and files into an app package. */
export function zipApp (manifest: AppManifest | string | null, files?: Record<string, string | Uint8Array>): Uint8Array {
  files ??= { 'ui/index.html': '<!doctype html><title>x</title>' }
  const entries: Record<string, Uint8Array> = {}
  if (manifest !== null) {
    entries['studio-app.json'] = strToU8(typeof manifest === 'string' ? manifest : JSON.stringify(manifest))
  }
  for (const [path, content] of Object.entries(files)) {
    entries[path] = typeof content === 'string' ? strToU8(content) : content
  }
  return zipSync(entries)
}

async function filesBelow (directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true })
  return entries.filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name))
}

/** Zips a directory, e.g. a test app under test/apps/fixtures or a built example app. */
export async function zipDirectory (directory: string): Promise<Uint8Array> {
  const entries: Record<string, Uint8Array> = {}
  for (const file of await filesBelow(directory)) {
    entries[relative(directory, file).split('\\').join('/')] = new Uint8Array(await readFile(file))
  }
  return zipSync(entries)
}
