import type { EditableField, FileRef, LangString } from './aas.ts'
import type { Translate } from './i18n.ts'
import type { JsonObject, StudioClient } from '@basyx/studio-sdk'
import type { InjectionKey, Ref } from 'vue'
import { StudioError } from '@basyx/studio-sdk'
import { inject, provide, ref, toRaw } from 'vue'

// Changing values in place, in Studio's edit mode, as the Digital Nameplate,
// Contacts and Technical Data apps do (app API 0.1.15): the element is read
// again for its revision when editing starts, and the write is based on it,
// so a change made in the meantime is a conflict, not overwritten. A
// MultiLanguageProperty is changed in the language the view shows; its other
// languages stay. A Range's bounds are written with the element
// (`aas.putElement`), as `aas.setElementValue` takes values only.
//
// The app's catalog has the texts `edit.conflict` and `edit.forbidden`.

export interface Draft {
  field: EditableField
  label: string
  /** The text; a Range's lower bound. */
  value: string
  /** A Range's upper bound; empty for other fields. */
  max: string
  /** The language a MultiLanguageProperty's text is changed in; empty for others. */
  language: string
  revision: string
  /** The value as read now, a MultiLanguageProperty's texts in every language. */
  values: LangString[]
  /** A Range as read now, to write back with its new bounds. */
  element: JsonObject | null
  error: string | null
}

/** The language of the text the view shows: the locale's, else English, else the first; the locale's for none. */
export function editLanguage (values: LangString[], locale: string): string {
  const language = locale.split('-', 1)[0]!
  return (values.find(entry => entry.language.startsWith(language)) ?? values.find(entry => entry.language.startsWith('en')) ?? values[0])?.language || language
}

/** The value to write: a Property's text (`null` when empty), or the texts with this language's changed (dropped when empty). */
export function draftValue (draft: Pick<Draft, 'field' | 'value' | 'language' | 'values'>): string | null | LangString[] {
  const value = draft.value.trim()
  if (draft.field.modelType === 'Property') {
    return value === '' ? null : value
  }
  // Plain objects: the draft's are Vue proxies, which postMessage cannot clone.
  const values = draft.values.map(entry => ({ language: entry.language, text: entry.text }))
  const others = values.filter(entry => entry.language !== draft.language)
  const index = values.findIndex(entry => entry.language === draft.language)
  if (value === '') {
    return others
  }
  const changed = [...values]
  if (index === -1) {
    changed.push({ language: draft.language, text: value })
  } else {
    changed[index] = { language: draft.language, text: value }
  }
  return changed
}

/** A Range as read, with the draft's bounds; an empty bound is left out (open). */
export function draftRange (draft: Pick<Draft, 'value' | 'max'> & { element: JsonObject }): JsonObject {
  // A plain copy: the draft's is a Vue proxy, which postMessage cannot clone.
  const { min: _min, max: _max, ...element } = structuredClone(toRaw(draft.element))
  const [min, max] = [draft.value.trim(), draft.max.trim()]
  return { ...element, ...(min === '' ? {} : { min }), ...(max === '' ? {} : { max }) }
}

export function describeWriteError (t: Translate, cause: unknown): string {
  if (!(cause instanceof StudioError)) {
    return String(cause)
  }
  switch (cause.code) {
    case 'revision_conflict': {
      return t('edit.conflict')
    }
    case 'target_forbidden': {
      return t('edit.forbidden')
    }
    default: {
      return cause.message
    }
  }
}

export interface FieldEditorOptions {
  client: StudioClient
  t: Translate
  /** The locale the view shows texts in, for the language a MultiLanguageProperty changes in. */
  locale: () => string
  submodelId: () => string
  onSaved: (label: string) => Promise<void>
}

/** Changing one field at a time: `start` reads it, `save` writes the draft, `cancel` drops it. */
export function useFieldEditor (options: FieldEditorOptions) {
  const draft = ref<Draft | null>(null)
  const saving = ref(false)
  /** A value that could not be read for editing. */
  const error = ref<string | null>(null)

  async function start (field: EditableField, label: string) {
    error.value = null
    try {
      const snapshot = await options.client.aas.getElement(options.submodelId(), field.path)
      const element = snapshot.value
      const raw = element.value
      const values = Array.isArray(raw)
        ? (raw as LangString[]).filter(entry => typeof entry?.text === 'string').map(entry => ({ language: String(entry.language ?? ''), text: entry.text }))
        : []
      const language = field.modelType === 'MultiLanguageProperty' ? editLanguage(values, options.locale()) : ''
      const bound = (value: unknown) => (typeof value === 'string' || typeof value === 'number' ? String(value) : '')
      let value = values.find(entry => entry.language === language)?.text ?? ''
      if (field.modelType === 'Property') {
        value = String(raw ?? '')
      } else if (field.modelType === 'Range') {
        value = bound(element.min)
      }
      draft.value = {
        field,
        label,
        value,
        max: field.modelType === 'Range' ? bound(element.max) : '',
        language,
        revision: snapshot.revision,
        values,
        element: field.modelType === 'Range' ? element : null,
        error: null,
      }
    } catch (error_) {
      error.value = describeWriteError(options.t, error_)
    }
  }

  async function save () {
    const current = draft.value
    if (!current) {
      return
    }
    saving.value = true
    try {
      const target = { submodelId: options.submodelId(), idShortPath: current.field.path, revision: current.revision }
      await (current.element
        ? options.client.aas.putElement({ ...target, element: draftRange({ ...current, element: current.element }) })
        : options.client.aas.setElementValue({ ...target, value: draftValue(current) }))
      draft.value = null
      await options.onSaved(current.label)
    } catch (error_) {
      // The draft stays, as in Studio's own editor.
      current.error = describeWriteError(options.t, error_)
    } finally {
      saving.value = false
    }
  }

  function cancel () {
    draft.value = null
  }

  return { draft, saving, error, start, save, cancel }
}

export type FieldEditor = ReturnType<typeof useFieldEditor>

/**
 * What the rows of every part of a view can do, provided once by the app:
 * open a link or address, copy a value, show a file in Studio's viewer, and
 * change a value in edit mode.
 */
export interface RowActions {
  canEdit: Readonly<Ref<boolean>>
  editor: FieldEditor
  open: (url: string) => void
  copy: (text: string) => void
  /** Shows a File element in Studio's viewer; absent in apps that show no files. */
  preview?: (file: FileRef) => void
}

const rowActionsKey: InjectionKey<RowActions> = Symbol('row-actions')

export function provideRowActions (actions: RowActions) {
  provide(rowActionsKey, actions)
}

export function useRowActions (): RowActions {
  const actions = inject(rowActionsKey)
  if (!actions) {
    throw new Error('useRowActions() needs provideRowActions() in the app.')
  }
  return actions
}
