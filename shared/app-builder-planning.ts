// The App Builder's planning chat (ADR 0054): before a new app exists, the
// user works out its requirements and a plan with the coding agent. The
// agent answers with a short reply and the whole document as it now stands,
// in a fenced block of its own; the page shows the reply in the chat and the
// document in its editor. Shared by the server (which writes the prompts) and
// the page (which reads the documents out of the replies).

export const planningStages = ['requirements', 'plan'] as const
export type PlanningStage = (typeof planningStages)[number]

/** The info string of the fenced block that holds a stage's document. */
export function documentFence (stage: PlanningStage): string {
  return `studio-${stage}`
}

/** Where a project keeps its planning documents. */
export const planningFiles: Record<PlanningStage, string> = {
  requirements: 'docs/requirements.md',
  plan: 'docs/plan.md',
}

/**
 * A reply split into what the chat shows and the stage's document: the last
 * complete block, or, while the agent still writes, the open one (`partial`).
 */
export function splitReply (text: string, stage: PlanningStage): { reply: string, document: string | null, partial: boolean } {
  const fence = documentFence(stage)
  const opening = new RegExp(`^(\`{3,}|~{3,})[ \\t]*${fence}[ \\t]*$`, 'gm')
  let match: RegExpExecArray | null
  let last: { start: number, bodyStart: number, marker: string } | null = null
  while ((match = opening.exec(text)) !== null) {
    last = { start: match.index, bodyStart: match.index + match[0].length + 1, marker: match[1]! }
  }
  if (!last) {
    return { reply: text.trim(), document: null, partial: false }
  }
  const rest = text.slice(last.bodyStart)
  const closing = new RegExp(String.raw`^${last.marker[0] === '`' ? '`' : '~'}{${last.marker.length},}[ \t]*$`, 'm').exec(rest)
  const before = text.slice(0, last.start)
  if (!closing) {
    return { reply: before.trim(), document: rest.trimEnd(), partial: true }
  }
  const after = rest.slice(closing.index + closing[0].length)
  return { reply: `${before}${after}`.trim(), document: rest.slice(0, closing.index).trimEnd(), partial: false }
}
