import type { AppInstallation, AppPackageInspection, ReleaseSigning } from '#shared/contract'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import semver from 'semver'

// Installing what a project built (ADR 0054, plan B5–B8): Studio raises the
// version if asked, builds with fixed commands, signs unsigned, with this
// computer's key or with the user's own key, and runs the same inspect →
// consent → install path as an upload on the Apps page (ADR 0044).

export type VersionBump = 'none' | 'patch' | 'minor'

export function bumpVersion (version: string, bump: VersionBump): string {
  if (bump === 'none') {
    return version
  }
  const next = semver.inc(version, bump)
  if (!next) {
    throw new TypeError(`${version} is not a version Studio can raise.`)
  }
  return next
}

/** The version in `studio-app.json`, and the app ID. */
export async function readIdentity (folder: string): Promise<{ id: string, version: string }> {
  const manifest = JSON.parse(await readFile(join(folder, 'studio-app.json'), 'utf8')) as { id?: unknown, version?: unknown }
  if (typeof manifest.id !== 'string' || typeof manifest.version !== 'string') {
    throw new TypeError('studio-app.json has no id or version.')
  }
  return { id: manifest.id, version: manifest.version }
}

/** Sets the version in `studio-app.json` and `package.json`, keeping everything else. */
export async function setVersion (folder: string, version: string): Promise<void> {
  for (const name of ['studio-app.json', 'package.json']) {
    const path = join(folder, name)
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch {
      continue
    }
    const json = JSON.parse(text) as Record<string, unknown>
    json.version = version
    await writeFile(path, `${JSON.stringify(json, null, 2)}\n`)
  }
}

/** Who asks, for the app store's checks and audit records. */
export interface ReleaseCaller {
  actor: unknown
  requestId: string
}

/** Studio's app store and keys behind the releases (server/utils/app-builder.ts). */
export interface ReleaseInstaller {
  installed: (appId: string) => Promise<{ version: string, trust: string, publisher: string | null } | null>
  /** The signature, the content of a `.sig` file; `keyHandle` is a `signing-key` file grant. */
  sign: (bytes: Uint8Array, signing: ReleaseSigning, keyHandle: string | null, passphrase: string | null) => Promise<string | null>
  inspect: (bytes: Uint8Array, signature: string | null) => Promise<AppPackageInspection>
  install: (bytes: Uint8Array, signature: string | null, caller: ReleaseCaller) => Promise<AppInstallation>
  /** Writes the package, and its `.sig` beside it, to an `app-package` file grant; returns the file name. */
  save: (bytes: Uint8Array, signature: string | null, fileHandle: string) => Promise<string>
  /** This computer's key; with `create`, made on first use. */
  machineKey: (create: boolean) => Promise<{ publicKey: string, fingerprint: string } | null>
}

/** A built and signed package that waits for the user's consent. */
export interface PreparedRelease {
  digest: string
  bytes: Uint8Array
  signature: string | null
  version: string
}
