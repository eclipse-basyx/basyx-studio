import { defineStore } from 'pinia'

/**
 * Layout and interaction state of the shell browser: view or edit mode, the
 * command palette and the drawers. Never holds target data.
 */
export const useUiStore = defineStore('ui', () => {
  /** In view mode, edit controls are hidden even where the target allows edits (plan D8). */
  const mode = ref<'view' | 'edit'>('view')
  const commandOpen = ref(false)
  /** `null` lets the drawer decide by screen size. */
  const listDrawer = ref<boolean | null>(null)
  const detailsDrawer = ref(false)
  /** Easter egg: the arcade theme, toggled with the Konami code until the next reload. */
  const arcade = ref(false)

  const editing = computed(() => mode.value === 'edit')

  function toggleMode () {
    mode.value = mode.value === 'edit' ? 'view' : 'edit'
  }

  return { mode, editing, commandOpen, listDrawer, detailsDrawer, arcade, toggleMode }
})
