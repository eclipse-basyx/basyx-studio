import { z } from 'zod'
import { previewElementPath, previewElementTag, previewPickerPathLimit, previewPickerProtocol } from '#shared/app-preview-picker'

const rect = z.strictObject({
  x: z.number().min(-1e6).max(1e6),
  y: z.number().min(-1e6).max(1e6),
  width: z.number().positive().max(1e6),
  height: z.number().positive().max(1e6),
})
const envelope = { protocol: z.literal(previewPickerProtocol), session: z.string() }
const request = z.number().int().positive()
const replySchema = z.discriminatedUnion('type', [
  z.strictObject({ ...envelope, type: z.literal('ready') }),
  z.strictObject({ ...envelope, type: z.literal('hover'), request, rect: rect.nullable() }),
  z.strictObject({ ...envelope, type: z.literal('pick'), request, element: z.strictObject({
    tag: z.string().regex(previewElementTag),
    path: z.string().max(previewPickerPathLimit).regex(previewElementPath),
  }).nullable() }),
])

export function previewPickerReply (event: Pick<MessageEvent, 'source' | 'origin' | 'data'>, source: Window, origin: string, session: string) {
  if (event.source !== source || event.origin !== origin || event.data?.session !== session) {
    return null
  }
  const parsed = replySchema.safeParse(event.data)
  return parsed.success ? parsed.data : null
}
