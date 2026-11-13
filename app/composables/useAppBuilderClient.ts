import type { AppBuilderOperation, AppBuilderOperationParams, AppBuilderOperationResults, ConversationEventEnvelope } from '#shared/contract'

export interface AppBuilderClient {
  call: <O extends AppBuilderOperation>(operation: O, params: AppBuilderOperationParams<O>) => Promise<AppBuilderOperationResults[O]>
  /**
   * Follows a conversation's events after `afterSeq` (Server-Sent Events,
   * ADR 0007); the browser reconnects on its own and resumes after the last
   * event it received. Returns the function that stops following.
   */
  follow: (conversationId: string, afterSeq: number, onEvent: (envelope: ConversationEventEnvelope) => void, onConnection?: (open: boolean) => void) => () => void
}

/** Native Studio client for the desktop-only App Builder (ADR 0054). */
export function useAppBuilderClient (): AppBuilderClient {
  const api = useStudioApi()
  const urls = useStudioUrl()

  return {
    async call (operation, params) {
      return await api(`/app-builder/${operation}`, { method: 'POST', body: params })
    },
    follow (conversationId, afterSeq, onEvent, onConnection) {
      const source = new EventSource(urls.api(`/app-builder/conversations/${encodeURIComponent(conversationId)}/events?after=${afterSeq}`))
      source.addEventListener('message', message => {
        onEvent(JSON.parse(message.data) as ConversationEventEnvelope)
      })
      source.addEventListener('open', () => onConnection?.(true))
      source.addEventListener('error', () => onConnection?.(false))
      return () => source.close()
    },
  }
}
