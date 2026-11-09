// Nitro-specific: `nuxt/server` has no storage API. The App Builder's
// template is the starter app (examples/apps/starter), packed as Nitro server
// assets (`nitro.serverAssets` in nuxt.config.ts, ADR 0054); port this to
// `nitro/storage` when moving to Nitro v3.
import { useStorage } from 'nitropack/runtime'

/** The starter app's files by path, as text. */
export async function loadAppTemplate (): Promise<Map<string, string>> {
  const storage = useStorage('assets:app-template')
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
