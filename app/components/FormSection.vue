<template>
  <section class="py-4 border-b">
    <div class="d-flex align-center" :class="collapsible ? 'cursor-pointer' : undefined" @click="toggle">
      <v-icon v-if="collapsible" class="me-1" :icon="open ? 'mdi-chevron-down' : 'mdi-chevron-right'" size="18" />
      <span class="text-label-large font-weight-semibold">{{ title }}</span>
      <v-chip v-if="badge" class="ms-2" :text="badge" />
      <v-spacer />
      <slot name="actions" />
    </div>

    <p v-if="hint && open" class="text-body-small text-medium-emphasis mt-2">{{ hint }}</p>

    <!-- One rhythm for everything in a group: fields, rows and buttons are 12 px apart. -->
    <div v-show="open" class="d-flex flex-column ga-3 mt-3">
      <slot />
    </div>
  </section>
</template>

<script lang="ts" setup>
  // A titled group of fields (MVP-5 form layout): flat, no nested cards.
  // Collapsible groups show a count where they hold something, so a closed
  // group still says that it is not empty.
  const props = defineProps<{
    title: string
    hint?: string
    badge?: string | number
    collapsible?: boolean
  }>()
  const open = defineModel<boolean>('open', { default: true })

  function toggle () {
    if (props.collapsible) {
      open.value = !open.value
    }
  }
</script>
