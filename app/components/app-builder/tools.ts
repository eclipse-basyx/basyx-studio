import type { TranscriptItem } from './transcript'

/** What a tool call worked on: its title, or its files where the agent titles it with only the tool's name ("write"). */
export function toolLabel (item: Extract<TranscriptItem, { kind: 'tool' }>, folder: string): string {
  const paths = item.locations.filter(path => path !== folder)
  return paths.length > 0 && (!item.title || /^\w+$/.test(item.title)) ? paths.map(path => relativePath(path, folder)).join(', ') : item.title
}

/** A path inside the app's folder, relative to it. */
export function relativePath (path: string, folder: string): string {
  return path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : path
}
