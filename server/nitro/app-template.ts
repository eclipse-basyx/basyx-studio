// Nitro-specific: `nuxt/server` has no storage API. The App Builder's
// template is the starter app (examples/apps/starter), and it copies the
// sources of the bundled apps (apps/), both packed as Nitro server assets
// (`nitro.serverAssets` in nuxt.config.ts, ADR 0054); port this to
// `nitro/storage` when moving to Nitro v3.
import { useStorage } from 'nitropack/runtime'

/** The starter app's files by path, as text. */
export async function loadAppTemplate (): Promise<Map<string, string>> {
  return await textFiles('assets:app-template')
}

/** Each bundled app's sources by its folder in apps/, files by path, as text. */
export async function loadBundledAppSources (): Promise<Map<string, Map<string, string>>> {
  const apps = new Map<string, Map<string, string>>()
  for (const [path, text] of await textFiles('assets:bundled-app-sources')) {
    const [app, ...rest] = path.split('/')
    if (app && rest.length > 0) {
      const files = apps.get(app) ?? new Map<string, string>()
      files.set(rest.join('/'), text)
      apps.set(app, files)
    }
  }
  // Folders without a manifest (leftovers of a build) are no apps.
  for (const [app, files] of apps) {
    if (!files.has('studio-app.json')) {
      apps.delete(app)
    }
  }
  return apps
}

async function textFiles (base: string): Promise<Map<string, string>> {
  const storage = useStorage(base)
  const files = new Map<string, string>()
  for (const key of (await storage.getKeys()).toSorted()) {
    const value = await storage.getItemRaw(key)
    if (value !== null && value !== undefined) {
      const text = typeof value === 'string' ? value : new TextDecoder().decode(value as ArrayBuffer)
      files.set(key.replaceAll(':', '/'), text)
    }
  }
  return files
}
