<template>
  <!-- In the desktop app the page is a panel inset in the window's frame,
       rounded where it meets the frame; a drawer beside it
       (the side list, the details) takes over that side's corners. In the
       browser the panel is the page itself: no colour, no corner. -->
  <v-sheet-window-content :color="inDesktopWindow ? undefined : 'transparent'" :rounded="rounded">
    <slot />
  </v-sheet-window-content>
</template>

<script lang="ts" setup>
  import { useLayout } from 'vuetify'

  const inDesktopWindow = useDesktopBridge() !== null
  // Inside <v-app>, so the layout is there; the default layout itself cannot ask.
  const layout = useLayout()

  /** Which ends of the panel meet the frame: nothing but the rail and the frame's edges beside them. */
  const rounded = computed(() => {
    if (!inDesktopWindow) {
      return 0
    }
    const main = layout.mainRect.value
    const start = main.left <= (layout.getLayoutItem('rail')?.size ?? 0)
    const end = main.right <= (layout.getLayoutItem('frame-end')?.size ?? 0)
    if (start && end) {
      return undefined
    }
    return start ? 's-lg' : (end ? 'e-lg' : 0)
  })
</script>
