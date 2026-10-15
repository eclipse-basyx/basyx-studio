import { defineStore } from 'pinia'

/** An element copied in Studio: plain AAS JSON, so it pastes across submodels, shells and targets (MVP-5 plan, C1). */
export interface CopiedElement {
  element: Record<string, unknown>
  /** Where it came from, for the paste menu. */
  label: string
}

export const useClipboardStore = defineStore('clipboard', () => {
  const copied = ref<CopiedElement | null>(null)
  /** A model reference to a node (*Copy reference*, C2) for reference fields. */
  const copiedReference = ref<{ type: string, keys: Array<{ type: string, value: string }> } | null>(null)

  function copy (value: CopiedElement): void {
    copied.value = value
  }

  function copyReference (reference: { type: string, keys: Array<{ type: string, value: string }> }): void {
    copiedReference.value = reference
  }

  function clear (): void {
    copied.value = null
  }

  return { copied, copiedReference, copy, copyReference, clear }
})
