<template>
  <v-card-section>
    <v-card-header class="flex-shrink-0">
      <template #prepend>
        <v-icon :icon="icon" size="18" />
      </template>

      <v-card-title class="text-title-small">{{ title }}</v-card-title>

      <template v-if="$slots.actions" #append>
        <slot name="actions" />
      </template>
    </v-card-header>

    <template v-if="$slots.default">
      <v-divider />

      <!-- The rest of the card's height, so cards in a row end on the same line. -->
      <div class="flex-grow-1">
        <slot />
      </div>
    </template>
  </v-card-section>
</template>

<script lang="ts" setup>
  // A part of the technical data in a card of its own: a tinted header with icon,
  // title and actions, as Studio's container cards, and the content below,
  // its label and value rows flush.
  defineProps<{ title: string, icon: string }>()
  defineSlots<{
    default?: () => unknown
    actions?: () => unknown
  }>()
</script>
