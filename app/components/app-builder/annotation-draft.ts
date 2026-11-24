import type { PreviewElement } from '#shared/app-preview-picker'

export interface PreviewAnnotation {
  id: string
  previewKey: string
  contribution: string
  digest: string | null
  element: PreviewElement
  text: string
}

export interface ChatDraft {
  text: string
  notes: PreviewAnnotation[]
  sending: boolean
}

export const maxAnnotations = 10
export const maxAnnotationLength = 2000

export function annotationDetails (note: PreviewAnnotation): string {
  return `Preview contribution: ${note.contribution}${note.digest ? ` (build ${note.digest})` : ''}\nElement: ${note.element.path}`
}

export function annotationPrompt (text: string, notes: readonly PreviewAnnotation[]): string | null {
  if (notes.some(note => !note.text.trim())) {
    return null
  }
  const sections = [text.trim()]
  if (notes.length > 0) {
    const annotations = notes.map((note, index) => `${index + 1}. ${note.text.trim()}\n   ${annotationDetails(note).replaceAll('\n', '\n   ')}`)
    sections.push(`Preview annotations\n\n${annotations.join('\n\n')}`)
  }
  return sections.filter(Boolean).join('\n\n') || null
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
