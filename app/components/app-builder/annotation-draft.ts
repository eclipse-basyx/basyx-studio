import type { PreviewElement } from '#shared/app-preview-picker'
import type { AppContributions } from '#shared/contract'

export interface PreviewAnnotation {
  id: string
  number: number
  previewName: string
  previewKey: string
  contribution: string
  subPath: string
  digest: string | null
  earlierBuild?: boolean
  element: PreviewElement
  text: string
}

export interface ChatDraft {
  text: string
  notes: PreviewAnnotation[]
  sending: boolean
}

export const maxAnnotationLength = 2000

export function annotationDetails (note: PreviewAnnotation): string {
  return `Preview contribution: ${note.contribution}${note.digest ? ` (build ${note.digest})` : ''}\nPreview route: /${note.subPath}\nElement: ${note.element.path}`
}

/** The installed preview can change while another window owns the build UI. */
export function markEarlierPreviewBuilds (notes: readonly PreviewAnnotation[], contributions: AppContributions | null) {
  for (const note of notes) {
    const current = note.contribution.startsWith('module:')
      ? contributions?.modules.find(entry => `module:${entry.id}` === note.contribution)
      : contributions?.submodelViews.find(entry => `view:${entry.id}` === note.contribution)
    if (!current || current.digest !== note.digest) {
      note.earlierBuild = true
    }
  }
}

export function annotationPrompt (text: string, notes: readonly PreviewAnnotation[]): string | null {
  if (notes.some(note => !note.text.trim())) {
    return null
  }
  const message = text.trim()
  if (notes.length === 0) {
    return message || null
  }
  const annotations = notes.map((note, index) => !message && index === 0
    ? `${note.text.trim()}\n\nAnnotation ${note.number}\n${annotationDetails(note)}`
    : `${note.number}. ${note.text.trim()}\n   ${annotationDetails(note).replaceAll('\n', '\n   ')}`)
  return message ? `${message}\n\nPreview annotations\n\n${annotations.join('\n\n')}` : annotations.join('\n\n')
}

export async function submitChatDraft (draft: ChatDraft, send: (text: string) => Promise<boolean>): Promise<void> {
  const text = annotationPrompt(draft.text, draft.notes)
  if (draft.sending || !text) {
    return
  }
  draft.sending = true
  try {
    if (await send(text)) {
      draft.text = ''
      draft.notes = []
    }
  } finally {
    draft.sending = false
  }
}
