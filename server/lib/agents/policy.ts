import type { ToolCallKind } from '#shared/contract'
import { isAbsolute, relative, resolve, sep } from 'node:path'

// Studio's answer to an agent's permission request (ADR 0054, plan A1): the
// agent is free inside the project folder, and everything else is the
// user's decision. Studio never answers with the agent's own "always"
// option, which can store rules beyond the chat.

export interface PermissionSubject {
  kind: ToolCallKind
  /** The shell command, for `execute`. */
  command: string | null
  /** The folder the command runs in, when the agent says. */
  cwd: string | null
  /** Files the tool call touches, absolute or relative to the folder. */
  paths: string[]
}

/** Pulls the command, its folder and the touched files out of a tool call. */
export function permissionSubject (toolCall: { kind?: string | null, rawInput?: unknown, locations?: { path: string }[] | null }, folder: string): PermissionSubject {
  const kind = (toolCall.kind ?? 'other') as ToolCallKind
  const input = toolCall.rawInput && typeof toolCall.rawInput === 'object' ? toolCall.rawInput as Record<string, unknown> : {}
  const command = typeof input.command === 'string'
    ? input.command
    : (Array.isArray(input.command) && input.command.every(part => typeof part === 'string') ? (input.command as string[]).join(' ') : null)
  const cwd = typeof input.cwd === 'string' ? input.cwd : null
  const paths = new Set<string>()
  for (const location of toolCall.locations ?? []) {
    paths.add(location.path)
  }
  for (const key of ['file_path', 'filePath', 'path', 'notebook_path']) {
    const value = input[key]
    if (typeof value === 'string' && value.length > 0) {
      paths.add(value)
    }
  }
  // An execute call's location is the folder it runs in, not a file it writes.
  if (kind === 'execute') {
    paths.clear()
  }
  return { kind, command, cwd, paths: [...paths].map(path => isAbsolute(path) ? path : resolve(folder, path)) }
}

/** Whether `path` is the folder or inside it, by its spelling (the agent's sandbox handles links). */
export function isInside (folder: string, path: string): boolean {
  const rel = relative(resolve(folder), resolve(folder, path))
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

// No chaining, redirection, substitution or globbing: the command must be
// exactly one of the allowed ones.
const shellSyntax = /[;&|<>`$(){}[\]*?!~\\\n\r"']/

const allowedCommands: RegExp[] = [
  /^pnpm (?:install|i)(?: --(?:frozen-lockfile|prefer-offline|offline))*$/,
  /^pnpm (?:run )?(?:build|test|typecheck|lint|package)(?: -[\w-]+(?:=[\w.-]+)?)*$/,
  /^pnpm exec vitest run(?: [\w./-]+)*$/,
  // Flags without values (no `--output=<file>`), and paths or revisions.
  /^git (?:status|diff|log|show)(?: -(?!-?output)[\w-]+| [\w.][\w./-]*)*$/,
]

/** Whether a command is one the agent may run in the folder without asking. */
export function isAllowedCommand (command: string): boolean {
  const trimmed = command.trim().replaceAll(/\s+/g, ' ')
  return !shellSyntax.test(trimmed) && allowedCommands.some(pattern => pattern.test(trimmed))
}

const cdPrefix = /^cd\s+(?:"([^"]+)"|'([^']+)'|([^\s"';&|]+))\s*&&\s*/
const outputFilter = /(?:\s+2>&1)?(?:\s*\|\s*(?:tail|head)(?:\s+-n)?\s+-?\d+)?\s*$/

/**
 * The commands an agent runs, as Studio judges them: agents write
 * `cd "<folder>" && pnpm build 2>&1 | tail -20`, so a leading `cd` into the
 * folder itself and a trailing `2>&1 | tail -n` are left out, and `&&` joins
 * commands that must each be allowed. `null` when the command does more.
 */
export function commandsOf (command: string, folder: string): string[] | null {
  let rest = command.trim()
  const cd = cdPrefix.exec(rest)
  if (cd) {
    const target = cd[1] ?? cd[2] ?? cd[3]!
    if (resolve(folder, target) !== resolve(folder)) {
      return null
    }
    rest = rest.slice(cd[0].length)
  }
  const parts = rest.split(/\s*&&\s*/).map(part => part.replace(outputFilter, '').trim())
  return parts.every(part => part.length > 0) ? parts : null
}

/** The key under which *Allow in this chat* remembers an answer. */
export function chatRuleKey (subject: PermissionSubject): string {
  return subject.kind === 'execute'
    ? `execute:${(subject.command ?? '').trim().replaceAll(/\s+/g, ' ')}`
    : `${subject.kind}:${subject.paths.toSorted().join('\n')}`
}

export type PolicyDecision = { answer: 'allow', reason: 'folder' | 'chat' } | { answer: 'ask' }

/** What Studio does with a permission request before the user sees it. */
export function decidePermission (subject: PermissionSubject, folder: string, allowedInChat: ReadonlySet<string>): PolicyDecision {
  if (allowedInChat.has(chatRuleKey(subject))) {
    return { answer: 'allow', reason: 'chat' }
  }
  if (subject.kind === 'execute') {
    const inFolder = subject.cwd === null || isInside(folder, subject.cwd)
    const commands = subject.command === null ? null : commandsOf(subject.command, folder)
    return inFolder && commands?.every(command => isAllowedCommand(command)) ? { answer: 'allow', reason: 'folder' } : { answer: 'ask' }
  }
  const local = subject.paths.length > 0 && subject.paths.every(path => isInside(folder, path))
  if (local && ['read', 'edit', 'delete', 'move', 'search'].includes(subject.kind)) {
    return { answer: 'allow', reason: 'folder' }
  }
  return { answer: 'ask' }
}

export interface PermissionOptionLike {
  optionId: string
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always' | string
}

/** The agent's option for Studio's answer: allow once, or reject once. */
export function pickOption (options: PermissionOptionLike[], allow: boolean): string | null {
  const wanted = allow ? ['allow_once'] : ['reject_once', 'reject_always']
  for (const kind of wanted) {
    const option = options.find(entry => entry.kind === kind)
    if (option) {
      return option.optionId
    }
  }
  return null
}
