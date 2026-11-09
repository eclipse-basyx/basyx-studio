import type { StackFileKind } from '@basyx/studio-sdk/protocol'
import { stackFileKinds } from '@basyx/studio-sdk/protocol'

// Kinds of the single-use file grants of Studio's native pages: for local
// BaSyx instances (ADR 0033), AASX files to load, an export to import, where
// to save an export or logs; for the App Builder (ADR 0054), a signing key
// to sign with once and where to save a signed package. The SDK names the
// stack kinds; this module adds what the Electron main process, the contract
// and the Studio Service need. It has no runtime dependencies, so Electron
// can bundle it.

/** The App Builder's kinds: a PEM private key to sign a package with, where to save a package. */
export const appBuilderFileKinds = ['signing-key', 'app-package'] as const
export type AppBuilderFileKind = typeof appBuilderFileKinds[number]

export type FileGrantKind = StackFileKind | AppBuilderFileKind
export const fileGrantKinds = [...stackFileKinds, ...appBuilderFileKinds] as const

/** The extensions a file of each kind may have; the first is the default when saving. */
export const fileGrantExtensions: Record<FileGrantKind, readonly string[]> = {
  'stack-aasx': ['aasx'],
  'stack-import': ['zip', 'json'],
  'stack-export': ['zip'],
  'stack-logs': ['txt'],
  'signing-key': ['pem', 'key'],
  'app-package': ['zip'],
}

const saveKinds: ReadonlySet<FileGrantKind> = new Set<FileGrantKind>(['stack-export', 'stack-logs', 'app-package'])

/** Kinds whose dialog asks where to save; the others pick existing files. */
export function isSaveKind (kind: FileGrantKind): boolean {
  return saveKinds.has(kind)
}

export function isStackFileKind (value: unknown): value is StackFileKind {
  return typeof value === 'string' && (stackFileKinds as readonly string[]).includes(value)
}

export function isFileGrantKind (value: unknown): value is FileGrantKind {
  return typeof value === 'string' && (fileGrantKinds as readonly string[]).includes(value)
}

export { type StackFileKind, stackFileKinds } from '@basyx/studio-sdk/protocol'
