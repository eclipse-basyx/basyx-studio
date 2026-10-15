import { defineStore } from 'pinia'

/**
 * An unapplied change of a whole element and the revision it is based on: the
 * element's revision when it exists, or the parent's structure revision for a
 * new element (MVP-5 plan, W7).
 */
export interface ElementDraft {
  revision: string
  value: Record<string, unknown>
}

/** The draft key of a new element below a parent (`null` for a submodel's top level). */
export function newElementDraftKey (parentKey: string | null): string {
  return `new:${parentKey ?? ''}`
}

/**
 * The slot of a concept description's draft in place of a submodel key
 * (MVP-6 plan, W5). Resource keys are base64url, so the colon never collides.
 */
export function conceptDescriptionDraftSlot (key: string): string {
  return `cd:${key}`
}

/**
 * Editor drafts per target, submodel and element (ADR 0006). They stay here
 * until applied or discarded, so a failed apply or a navigation never loses
 * the user's input. Drafts are never mixed with cached target data.
 */
export const useDraftStore = defineStore('drafts', () => {
  const drafts = ref<Record<string, ElementDraft>>({})

  function keyOf (targetId: string, submodelKey: string, elementKey: string): string {
    return JSON.stringify([targetId, submodelKey, elementKey])
  }

  function get (targetId: string, submodelKey: string, elementKey: string): ElementDraft | undefined {
    return drafts.value[keyOf(targetId, submodelKey, elementKey)]
  }

  function set (targetId: string, submodelKey: string, elementKey: string, draft: ElementDraft): void {
    drafts.value = { ...drafts.value, [keyOf(targetId, submodelKey, elementKey)]: draft }
  }

  function discard (targetId: string, submodelKey: string, elementKey: string): void {
    const { [keyOf(targetId, submodelKey, elementKey)]: _, ...rest } = drafts.value
    drafts.value = rest
  }

  function countFor (targetId: string): number {
    return Object.keys(drafts.value).filter(key => (JSON.parse(key) as string[])[0] === targetId).length
  }

  /** Whether an element of a target has an unapplied change (the tree marks it). */
  function has (targetId: string, submodelKey: string, elementKey: string): boolean {
    return keyOf(targetId, submodelKey, elementKey) in drafts.value
  }

  /** Drops every draft of a target, e.g. when its workspace is closed. */
  function discardTarget (targetId: string): void {
    drafts.value = Object.fromEntries(Object.entries(drafts.value).filter(([key]) => (JSON.parse(key) as string[])[0] !== targetId))
  }

  return { drafts, get, set, discard, countFor, has, discardTarget }
})
