import { z } from 'zod'

/** The current preview context, carried to another Studio window through the native bridge. */
export const previewSelectionSchema = z.object({
  entryKey: z.string().max(500).nullable(),
  targetId: z.string().min(1).max(200).nullable(),
  shell: z.object({
    id: z.string().min(1).max(4000),
    idShort: z.string().max(2000).nullable(),
    displayName: z.array(z.object({ language: z.string().max(100), text: z.string().max(2000) })).max(100),
  }).strict().nullable(),
  submodelId: z.string().min(1).max(4000).nullable(),
  subPath: z.string().max(4000),
}).strict()
export type PreviewSelection = z.infer<typeof previewSelectionSchema>

export const previewWindowRequestSchema = z.object({
  projectId: z.uuid(),
  selection: previewSelectionSchema,
}).strict()
export type PreviewWindowRequest = z.infer<typeof previewWindowRequestSchema>

/** The native bridge chooses the route; a renderer cannot request an arbitrary URL. */
export function previewWindowUrl (base: string, request: PreviewWindowRequest): string {
  const parsed = previewWindowRequestSchema.parse(request)
  return new URL(`/app-builder-preview/${parsed.projectId}`, base).href
}
