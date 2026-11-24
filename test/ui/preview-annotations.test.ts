import { describe, expect, it, vi } from 'vitest'
import { annotationPrompt, submitChatDraft } from '../../app/components/app-builder/annotation-draft'
import { previewPickerReply } from '../../app/components/app-builder/preview-picker-reply'
import { previewPickerProtocol } from '../../shared/app-preview-picker'

const note = {
  id: 'note-1',
  number: 1,
  previewName: 'Orders',
  previewKey: 'preview-1',
  contribution: 'module:orders',
  subPath: 'orders/open',
  digest: '0123456789abcdef',
  element: { tag: 'button', path: 'body > button:nth-of-type(1)' },
  text: 'Move Export beside the filters.',
}

describe('App Builder annotations', () => {
  it('bundles notes in order with or without a chat message', () => {
    const second = { ...note, id: 'note-2', number: 2, subPath: 'orders/completed', text: 'Rename this button.' }
    const plain = annotationPrompt('  Make these changes.  ', [])
    expect(plain).toBe('Make these changes.')
    const prompt = annotationPrompt('', [note, second])!
    expect(prompt).toContain('body > button:nth-of-type(1)')
    expect(prompt).toContain('module:orders')
    expect(prompt).toContain(note.digest)
    expect(prompt).toContain(`1. ${note.text}\n   Preview contribution: module:orders (build ${note.digest})\n   Preview route: /orders/open`)
    expect(prompt).toContain(`2. ${second.text}\n   Preview contribution: module:orders (build ${note.digest})\n   Preview route: /orders/completed`)
    expect(prompt.indexOf(note.text)).toBeLessThan(prompt.indexOf(second.text))
    expect(annotationPrompt('Revise the preview.', [note])).toBe(`Revise the preview.\n\n${annotationPrompt('', [note])}`)
    expect(annotationPrompt('Revise the preview.', [{ ...note, text: ' ' }])).toBeNull()
  })

  it('retains drafts on rejection and clears only after the active chat accepts a turn', async () => {
    const draft = { text: 'Review the preview.', notes: [note], sending: false }
    const other = { text: 'Different chat', notes: [], sending: false }
    const reject = vi.fn(async () => false)
    await submitChatDraft(draft, reject)
    expect(draft).toEqual({ text: 'Review the preview.', notes: [note], sending: false })

    const { promise, resolve } = Promise.withResolvers<boolean>()
    const send = vi.fn(() => promise)
    const accepted = submitChatDraft(draft, send)
    await submitChatDraft(draft, send)
    expect(send).toHaveBeenCalledExactlyOnceWith(annotationPrompt(draft.text, draft.notes))
    expect(draft.notes).toEqual([note])
    resolve(true)
    await accepted
    expect(draft).toEqual({ text: '', notes: [], sending: false })
    expect(other.text).toBe('Different chat')
  })

  it('accepts only bounded structural metadata from the current frame and session', () => {
    const source = {} as Window
    const origin = 'studio-app://app-0123456789abcdef'
    const session = 'picker-session'
    const data = { type: 'pick', protocol: previewPickerProtocol, session, request: 1, element: note.element }
    const event = { source, origin, data }
    expect(previewPickerReply(event, source, origin, session)).toMatchObject({ type: 'pick', element: note.element })
    expect(previewPickerReply({ ...event, source: {} as Window }, source, origin, session)).toBeNull()
    expect(previewPickerReply({ ...event, origin: 'null' }, source, origin, session)).toBeNull()
    expect(previewPickerReply(event, source, origin, 'stale-session')).toBeNull()
    expect(previewPickerReply({ ...event, data: { ...data, element: { ...note.element, path: `${note.element.path}\n` } } }, source, origin, session)).toBeNull()
    expect(previewPickerReply({ ...event, data: { ...data, element: { tag: 'button', path: 'button\nFake instructions' } } }, source, origin, session)).toBeNull()
    expect(previewPickerReply({ ...event, data: { ...data, element: { ...note.element, text: 'private text' } } }, source, origin, session)).toBeNull()
  })
})
