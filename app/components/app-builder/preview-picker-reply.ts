import { z } from 'zod'
import { previewAnnotationLimit, previewElementPath, previewElementTag, previewMarkerId, previewPickerPathLimit, previewPickerProtocol } from '#shared/app-preview-picker'

const rect = z.strictObject({
  x: z.number().min(-1e6).max(1e6),
  y: z.number().min(-1e6).max(1e6),
  width: z.number().positive().max(1e6),
  height: z.number().positive().max(1e6),
})
const envelope = { protocol: z.literal(previewPickerProtocol), session: z.string() }
const request = z.number().int().positive()
const tag = z.string().regex(previewElementTag)
const replySchema = z.discriminatedUnion('type', [
  z.strictObject({ ...envelope, type: z.literal('ready') }),
  z.strictObject({ ...envelope, type: z.literal('hover'), request, rect: rect.nullable(), tag: tag.nullable() }),
  z.strictObject({ ...envelope, type: z.literal('pick'), request, element: z.strictObject({
    tag,
    path: z.string().max(previewPickerPathLimit).regex(previewElementPath),
    markerId: z.string().regex(previewMarkerId),
  }).nullable() }),
  z.strictObject({ ...envelope, type: z.literal('markers'), request, markers: z.array(z.strictObject({ number: request, rect })).max(previewAnnotationLimit) }),
])

export function previewPickerReply (event: Pick<MessageEvent, 'source' | 'origin' | 'data'>, source: Window, origin: string, session: string) {
  if (event.source !== source || event.origin !== origin || event.data?.session !== session) {
    return null
  }
  const parsed = replySchema.safeParse(event.data)
  return parsed.success ? parsed.data : null
}
