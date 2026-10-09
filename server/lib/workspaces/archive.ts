import { unzipSync } from 'fflate'
import { StudioProblem } from '../problem'

export interface ArchiveLimits {
  maxArchiveBytes: number
  maxEntries: number
  maxEntryBytes: number
  maxTotalBytes: number
  /** Highest compression ratio accepted for entries above `ratioThresholdBytes`. */
  maxCompressionRatio: number
  ratioThresholdBytes: number
}

const MiB = 1024 * 1024

export const defaultArchiveLimits: ArchiveLimits = {
  maxArchiveBytes: 256 * MiB,
  maxEntries: 10_000,
  maxEntryBytes: 256 * MiB,
  maxTotalBytes: 512 * MiB,
  maxCompressionRatio: 200,
  ratioThresholdBytes: MiB,
}

// Relative, slash-separated names without empty, `.` or `..` segments,
// backslashes, drive letters or control characters.
// eslint-disable-next-line no-control-regex
const forbiddenCharacters = /[\u0000-\u001F\u007F\\:]/

export function isSafeEntryName (name: string): boolean {
  if (!name || name.length > 1024 || name.startsWith('/') || forbiddenCharacters.test(name)) {
    return false
  }
  const segments = (name.endsWith('/') ? name.slice(0, -1) : name).split('/')
  return segments.every(segment => segment !== '' && segment !== '.' && segment !== '..')
}

function reject (detail: string): never {
  throw new StudioProblem('package_rejected', detail)
}

/**
 * Checks an AASX (ZIP) archive from its central directory before anything is
 * decompressed (DATA-006). The decompressor writes at most the declared size
 * of an entry, so validating the declared sizes bounds memory; CPU time is
 * bounded by the Workspace Worker's time limit.
 */
export function inspectArchive (
  bytes: Uint8Array,
  limits: ArchiveLimits = defaultArchiveLimits,
  /** What the archive is, for the message when it is not a ZIP file. */
  description = 'AASX (ZIP) package',
): { entries: number, totalBytes: number } {
  if (bytes.length > limits.maxArchiveBytes) {
    reject(`The package is larger than ${Math.round(limits.maxArchiveBytes / MiB)} MiB.`)
  }
  const names = new Set<string>()
  let totalBytes = 0
  try {
    unzipSync(bytes, {
      filter: entry => {
        if (names.size >= limits.maxEntries) {
          reject(`The package has more than ${limits.maxEntries} entries.`)
        }
        if (!isSafeEntryName(entry.name)) {
          reject(`The package contains an unsafe entry name: ${JSON.stringify(entry.name.slice(0, 200))}.`)
        }
        const key = entry.name.toLowerCase()
        if (names.has(key)) {
          reject(`The package contains the entry ${JSON.stringify(entry.name)} twice.`)
        }
        names.add(key)
        if (entry.compression !== 0 && entry.compression !== 8) {
          reject(`The package uses an unsupported compression method (${entry.compression}).`)
        }
        if (entry.originalSize > limits.maxEntryBytes) {
          reject(`The entry ${JSON.stringify(entry.name)} is larger than ${Math.round(limits.maxEntryBytes / MiB)} MiB.`)
        }
        if (entry.originalSize > limits.ratioThresholdBytes && entry.originalSize > entry.size * limits.maxCompressionRatio) {
          reject(`The entry ${JSON.stringify(entry.name)} is compressed suspiciously well.`)
        }
        totalBytes += entry.originalSize
        if (totalBytes > limits.maxTotalBytes) {
          reject(`The package expands to more than ${Math.round(limits.maxTotalBytes / MiB)} MiB.`)
        }
        return false
      },
    })
  } catch (error) {
    if (error instanceof StudioProblem) {
      throw error
    }
    reject(`The file is not a valid ${description}.`)
  }
  return { entries: names.size, totalBytes }
}
