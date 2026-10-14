<template>
  <!-- Plain chips, not a chip group: a group makes them selectable. Neutral
       when available, outlined and dimmed when not. -->
  <div class="d-flex flex-wrap ga-2">
    <v-chip
      v-for="feature in features"
      :key="feature.key"
      v-tooltip="t(`capabilities.${feature.key}Hint`)"
      :class="feature.on ? undefined : 'text-disabled'"
      :prepend-icon="feature.on ? feature.icon : 'mdi-minus-circle-outline'"
      :text="t(`capabilities.${feature.key}`)"
      :variant="feature.on ? 'tonal' : 'outlined'"
    />
  </div>
</template>

<script lang="ts" setup>
  import type { TargetCapabilities } from '#shared/contract'
  import { targetFeatures } from '~/utils/aas'

  const props = defineProps<{ capabilities: TargetCapabilities }>()
  const { t } = useI18n()

  const features = computed(() => targetFeatures(props.capabilities))
</script>
