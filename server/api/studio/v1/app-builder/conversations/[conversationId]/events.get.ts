import type { ConversationEventEnvelope } from '#shared/contract'
import { getQuery, getRequestHeader } from 'nuxt/server'
import { requireAgents } from '~~/server/utils/app-builder'
import { requireActor } from '~~/server/utils/auth'
import { defineStudioHandler, routeParam } from '~~/server/utils/handler'
import { useStudio } from '~~/server/utils/studio'

const heartbeatMs = 20_000

/** The last event the page has: `Last-Event-ID` on a reconnect, else `?after=`. */
function afterSeq (value: unknown): number {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : 0
}

/**
 * A conversation's events as Server-Sent Events (ADR 0007, ADR 0054): the
 * ones after the page's last, then each new one. Every event's `id` is its
 * number, so the browser resumes where it stopped.
 */
export default defineStudioHandler(async event => {
  await requireActor(event)
  const conversation = requireAgents(await useStudio()).get(routeParam(event, 'conversationId'))
  const after = afterSeq(getRequestHeader(event, 'last-event-id') ?? getQuery(event).after)
  event.res.headers.set('Content-Type', 'text/event-stream; charset=utf-8')
  event.res.headers.set('X-Accel-Buffering', 'no')

  const encoder = new TextEncoder()
  let stop = () => {}
  const stream = new ReadableStream<Uint8Array>({
    start (controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text))
        } catch {
          stop()
        }
      }
      const unsubscribe = conversation.subscribe(after, (envelope: ConversationEventEnvelope) => {
        send(`id: ${envelope.seq}\ndata: ${JSON.stringify(envelope)}\n\n`)
      })
      const heartbeat = setInterval(() => send(': keep-alive\n\n'), heartbeatMs)
      stop = () => {
        clearInterval(heartbeat)
        unsubscribe()
      }
      send('retry: 2000\n\n')
    },
    cancel () {
      stop()
    },
  })
  const signal = (event.req as { signal?: AbortSignal }).signal
  signal?.addEventListener('abort', () => stop(), { once: true })
  return stream
})
