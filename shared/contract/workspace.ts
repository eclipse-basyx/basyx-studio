import { z } from 'zod'
import { fileGrantKinds } from '../file-grant-kinds'

/** Opaque, single-use reference to a file the user chose in a native dialog. */
export const fileHandleSchema = z.string().regex(/^[\w-]{32}$/)

export const openWorkspaceInputSchema = z.object({ fileHandle: fileHandleSchema })
export type OpenWorkspaceInput = z.infer<typeof openWorkspaceInputSchema>

export const exportWorkspaceInputSchema = z.object({ fileHandle: fileHandleSchema })
export type ExportWorkspaceInput = z.infer<typeof exportWorkspaceInputSchema>

/** Desktop broker (Electron main process) only: grants access to a path the user chose. */
export const fileGrantInputSchema = z.object({
  path: z.string().min(1).max(4096),
  purpose: z.enum(['open', 'save']),
  /** Absent for AASX workspaces; a kind of the BaSyx Docker app otherwise (ADR 0033). */
  kind: z.enum(fileGrantKinds).optional(),
})
export type FileGrantInput = z.infer<typeof fileGrantInputSchema>

export const fileGrantSchema = z.object({
  handle: fileHandleSchema,
  fileName: z.string(),
})
export type FileGrant = z.infer<typeof fileGrantSchema>

/** Desktop broker only: what the main process must know before closing the window. */
export const desktopStateSchema = z.object({
  unsavedWorkspaces: z.array(z.string()),
})
export type DesktopState = z.infer<typeof desktopStateSchema>
