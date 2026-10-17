<template>
  <div
    class="position-relative"
    @dragenter="onDragEnter"
    @dragleave="onDragLeave"
    @dragover="onDragOver"
    @drop="onDrop"
  >
    <slot />

    <v-overlay
      class="align-center justify-center"
      contained
      :model-value="dragging"
      persistent
    >
      <v-sheet class="pa-6 text-center" rounded="lg">
        <v-icon class="mb-2" color="primary" icon="mdi-tray-arrow-down" size="40" />
        <div class="text-title-medium">{{ title }}</div>
        <div v-if="text" class="text-body-small text-medium-emphasis">{{ text }}</div>
      </v-sheet>
    </v-overlay>
  </div>
</template>

<script lang="ts" setup>
  // A drop target for files from the desktop or the file manager; other drags
  // (text, links, list rows) pass through unchanged. Events it handles stop
  // here, so a drop zone inside another one (the shell list on the shells
  // page) shows one overlay and imports once.
  const props = defineProps<{ title: string, text?: string, disabled?: boolean }>()
  const emit = defineEmits<{ file: [file: File] }>()

  const dragging = ref(false)
  // dragenter and dragleave fire for every child, so only the outermost pair counts.
  let depth = 0

  function accepts (event: DragEvent): boolean {
    return !props.disabled && (event.dataTransfer?.types.includes('Files') ?? false)
  }

  function onDragEnter (event: DragEvent) {
    if (accepts(event)) {
      event.stopPropagation()
      depth++
      dragging.value = true
    }
  }

  function onDragLeave (event: DragEvent) {
    if (dragging.value) {
      event.stopPropagation()
      depth = Math.max(0, depth - 1)
      dragging.value = depth > 0
    }
  }

  function onDragOver (event: DragEvent) {
    if (accepts(event)) {
      event.stopPropagation()
      event.preventDefault()
      event.dataTransfer!.dropEffect = 'copy'
    }
  }

  function onDrop (event: DragEvent) {
    depth = 0
    dragging.value = false
    if (!accepts(event)) {
      return
    }
    event.stopPropagation()
    event.preventDefault()
    const file = event.dataTransfer?.files[0]
    if (file) {
      emit('file', file)
    }
  }
</script>
