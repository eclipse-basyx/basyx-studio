import type { AgentSetting, ApprovalState, ChangedFile, ConversationEventEnvelope, ConversationState, PlanEntry, ToolCallDiff, ToolCallKind, ToolCallStatus } from '#shared/contract'

// Folds a conversation's events (ADR 0054) into what the chat shows: the
// streamed message chunks joined, each tool call updated in place, one plan
// per turn, and approvals with their answer.

export type TranscriptItem
  = | { kind: 'user', id: string, text: string }
    | { kind: 'agent', id: string, text: string }
    | { kind: 'thought', id: string, text: string }
    | { kind: 'tool', id: string, title: string, toolKind: ToolCallKind, status: ToolCallStatus, locations: string[], diffs: ToolCallDiff[], output: string }
    | { kind: 'plan', id: string, entries: PlanEntry[] }
    | { kind: 'approval', id: string, title: string, toolKind: ToolCallKind, command: string | null, paths: string[], state: ApprovalState, denyEndsTurn: boolean }
    | { kind: 'notice', id: string, stopReason: string }
    | { kind: 'info', id: string, text: string }
    | { kind: 'checkpoint', id: string, commit: string, message: string, files: ChangedFile[], undone: boolean }
    | { kind: 'error', id: string, message: string }

export interface Transcript {
  items: TranscriptItem[]
  state: ConversationState
  model: AgentSetting | null
  /** The last event folded in. */
  seq: number
}

export function emptyTranscript (): Transcript {
  return { items: [], state: 'starting', model: null, seq: 0 }
}

/** Stop reasons that the chat explains; `end_turn` needs no note. */
const notedStops = new Set(['cancelled', 'max_tokens', 'max_turn_requests', 'refusal', 'error'])

/** Adds one event; events at or before `transcript.seq` are ignored, so a replay after a reconnect is harmless. */
export function applyEvent (transcript: Transcript, { seq, event }: ConversationEventEnvelope): void {
  if (seq <= transcript.seq) {
    return
  }
  transcript.seq = seq
  const items = transcript.items
  const last = items.at(-1)
  const id = String(seq)
  switch (event.type) {
    case 'userMessage': {
      items.push({ kind: 'user', id, text: event.text })
      break
    }
    case 'agentMessage':
    case 'agentThought': {
      const kind = event.type === 'agentMessage' ? 'agent' : 'thought'
      if (last?.kind === kind) {
        last.text += event.text
      } else {
        items.push({ kind, id, text: event.text })
      }
      break
    }
    case 'toolCall': {
      applyToolCall(items, event)
      break
    }
    case 'plan': {
      // One plan per turn: a new plan replaces the one since the last prompt.
      const lastUser = items.findLastIndex(item => item.kind === 'user')
      const plan = items.findLast((item, index): item is Extract<TranscriptItem, { kind: 'plan' }> => item.kind === 'plan' && index > lastUser)
      if (plan) {
        plan.entries = event.entries
      } else {
        items.push({ kind: 'plan', id, entries: event.entries })
      }
      break
    }
    case 'approval': {
      const existing = items.find((item): item is Extract<TranscriptItem, { kind: 'approval' }> => item.kind === 'approval' && item.id === event.approvalId)
      if (existing) {
        existing.state = event.state
      } else {
        items.push({ kind: 'approval', id: event.approvalId, title: event.title, toolKind: event.kind, command: event.command, paths: event.paths, state: event.state, denyEndsTurn: event.denyEndsTurn })
      }
      break
    }
    case 'turnEnded': {
      if (notedStops.has(event.stopReason)) {
        items.push({ kind: 'notice', id, stopReason: event.stopReason })
      }
      break
    }
    case 'checkpoint': {
      items.push({ kind: 'checkpoint', id, commit: event.commit, message: event.message, files: event.files, undone: false })
      break
    }
    case 'checkpointUndone': {
      markUndone(items, event.commit)
      break
    }
    case 'notice': {
      items.push({ kind: 'info', id, text: event.text })
      break
    }
    case 'state': {
      transcript.state = event.state
      transcript.model = event.model ?? transcript.model
      break
    }
    case 'error': {
      items.push({ kind: 'error', id, message: event.message })
      break
    }
  }
}

type ToolItem = Extract<TranscriptItem, { kind: 'tool' }>

/** A tool call's first event adds it; later ones change only the fields they carry. */
function applyToolCall (items: TranscriptItem[], event: Extract<ConversationEventEnvelope['event'], { type: 'toolCall' }>): void {
  const existing = items.find((item): item is ToolItem => item.kind === 'tool' && item.id === event.toolCallId)
  if (!existing) {
    items.push({
      kind: 'tool',
      id: event.toolCallId,
      title: event.title ?? '',
      toolKind: event.kind ?? 'other',
      status: event.status ?? 'pending',
      locations: event.locations ?? [],
      diffs: event.diffs ?? [],
      output: event.output ?? '',
    })
    return
  }
  existing.title = event.title ?? existing.title
  existing.toolKind = event.kind ?? existing.toolKind
  existing.status = event.status ?? existing.status
  existing.locations = event.locations ?? existing.locations
  existing.diffs = event.diffs ?? existing.diffs
  existing.output = event.output ?? existing.output
}

/** That turn's commit and every one after it. */
function markUndone (items: TranscriptItem[], commit: string): void {
  const from = items.findIndex(item => item.kind === 'checkpoint' && item.commit === commit)
  for (const item of from === -1 ? [] : items.slice(from)) {
    if (item.kind === 'checkpoint') {
      item.undone = true
    }
  }
}

/** The approvals still waiting for the user. */
export function pendingApprovals (transcript: Transcript): Extract<TranscriptItem, { kind: 'approval' }>[] {
  return transcript.items.filter((item): item is Extract<TranscriptItem, { kind: 'approval' }> => item.kind === 'approval' && item.state === 'pending')
}
