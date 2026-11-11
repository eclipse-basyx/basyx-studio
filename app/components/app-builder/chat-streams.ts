import type { ConversationSummary } from '#shared/contract'

/** HTTP/1 has six connections per origin; leave room for file and preview requests. */
export function chatStreamIds (conversations: Pick<ConversationSummary, 'id' | 'state'>[], activeId: string | null): string[] {
  const ids = activeId ? [activeId] : []
  for (const conversation of conversations) {
    if (ids.length >= 4) {
      break
    }
    if (conversation.id !== activeId && ['working', 'starting'].includes(conversation.state)) {
      ids.push(conversation.id)
    }
  }
  return ids
}
