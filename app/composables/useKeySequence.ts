/**
 * Calls `callback` when the user types `keys` in order (`KeyboardEvent.key`
 * values, letters in any case), e.g. the Konami code. Unlike Vuetify's
 * useHotkey sequences there is no timeout between keys, and a repeated
 * first key ("up up up down …") does not break the sequence. Typing in a
 * field, held keys and shortcuts with Ctrl, Alt or Meta are ignored.
 */
export function useKeySequence (keys: readonly string[], callback: () => void) {
  const expected = keys.map(key => key.toLowerCase())
  let recent: string[] = []

  function onKeydown (event: KeyboardEvent) {
    const inField = event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]')
    if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || inField) {
      return
    }
    if (['Shift', 'CapsLock'].includes(event.key)) {
      return
    }
    recent = [...recent, event.key.toLowerCase()].slice(-expected.length)
    if (recent.length === expected.length && recent.every((key, index) => key === expected[index])) {
      recent = []
      callback()
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
}
