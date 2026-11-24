<template>
  <!-- In the desktop app, and in a browser from md up, the page is a panel
       inset in the frame, rounded and bordered where it meets the frame; a
       drawer beside it (the side list, the details) takes over that side's
       corners and draws the line between them. On phones and the login page
       the panel is the page itself: no colour, no corner, no border. -->
  <v-sheet-window-content
    :border="panel?.border"
    :color="framed ? undefined : 'transparent'"
    :rounded="panel?.rounded ?? 0"
  >
    <slot />
  </v-sheet-window-content>
</template>

<script lang="ts" setup>
  import { useLayout } from 'vuetify'

  const { framed, look } = useWindowPanel()
  // Inside <v-app>, so the layout is there; the default layout itself cannot ask.
  const layout = useLayout()

  /** Which ends of the panel meet the frame: nothing but the rail and the frame's edges beside them. */
  const panel = computed(() => {
    const main = layout.mainRect.value
    return look({
      start: main.left <= (layout.getLayoutItem('rail')?.size ?? 0),
      end: main.right <= (layout.getLayoutItem('frame-end')?.size ?? 0),
    })
  })
</script>
