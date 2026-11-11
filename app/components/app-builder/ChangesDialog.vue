<template>
  <v-dialog :model-value="patch !== null" scrollable @update:model-value="open => { if (!open) emit('close') }">
    <DialogCard :title="t('checkpoint.changesTitle')">
      <pre class="text-body-small" data-test="app-builder-patch"><template v-for="(line, index) in lines" :key="index"><span :class="line.class">{{ line.text }}</span>
</template></pre>

      <template #actions>
        <v-btn-primary :text="t('checkpoint.close')" @click="emit('close')" />
      </template>
    </DialogCard>
  </v-dialog>
</template>

<script lang="ts" setup>
  import { computed } from 'vue'
  import { useI18n } from './i18n'

  // A commit of the project as a patch, coloured by line.
  const props = defineProps<{ patch: string | null }>()
  const emit = defineEmits<{ close: [] }>()
  const { t } = useI18n()

  const maxLines = 5000

  const lines = computed(() => {
    const all = (props.patch ?? '').split('\n')
    const shown = all.slice(0, maxLines).map(text => ({ text, class: lineClass(text) }))
    return all.length > maxLines ? [...shown, { text: '…', class: 'text-medium-emphasis' }] : shown
  })

  function lineClass (line: string): string {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) {
      return 'font-weight-bold'
    }
    if (line.startsWith('@@')) {
      return 'text-info'
    }
    if (line.startsWith('+')) {
      return 'text-success'
    }
    return line.startsWith('-') ? 'text-error' : ''
  }
</script>
