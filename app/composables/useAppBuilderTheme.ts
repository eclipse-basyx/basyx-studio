import { computed, watchEffect } from 'vue'
import { useTheme } from 'vuetify'

/** The App Builder and its separate preview follow Studio's mode and accent. */
export function useAppBuilderTheme () {
  const theme = useTheme()
  watchEffect(() => {
    for (const mode of ['light', 'dark'] as const) {
      const { primary, 'on-primary': onPrimary } = theme.themes.value[mode]!.colors
      Object.assign(theme.themes.value[`claude-${mode}`]!.colors, { primary, 'on-primary': onPrimary })
    }
  })
  return computed(() => theme.current.value.dark ? 'claude-dark' : 'claude-light')
}
