import { defineStore } from 'pinia'

/** An action on the selected tree node that the command palette offers in edit mode (MVP-5 plan, U3). */
export interface StructureAction {
  key: string
  title: string
  icon: string
  run: () => void
}

/**
 * The shell page registers the actions of the selected node here, so the
 * palette can offer the same ones as the row menu. Never holds target data.
 */
export const useStructureActionsStore = defineStore('structureActions', () => {
  const actions = ref<StructureAction[]>([])

  function set (next: StructureAction[]): void {
    actions.value = next
  }

  return { actions, set }
})
