<template>
  <v-expansion-panel :disabled="!hasDetails" :value="item.id">
    <v-expansion-panel-title>
      <div class="d-flex align-center ga-2 flex-grow-1 overflow-hidden">
        <v-progress-circular
          v-if="item.status === 'in_progress' || item.status === 'pending'"
          :aria-label="t('tool.running')"
          indeterminate
          role="img"
          size="12"
          width="2"
        />

        <v-icon
          v-else
          :aria-label="item.status === 'failed' ? t('tool.failed') : t('tool.completed')"
          :color="item.status === 'failed' ? 'error' : undefined"
          :icon="item.status === 'failed' ? 'mdi-close-circle-outline' : 'mdi-check'"
          role="img"
          size="x-small"
        />

        <span class="text-body-small text-truncate">
          <span class="text-medium-emphasis">{{ t(`tool.${item.toolKind}`) }}</span>
          <span v-if="label" class="ms-2">{{ label }}</span>
        </span>

        <v-chip
          v-if="item.status === 'failed'"
          class="ms-auto"
          color="error"
          :text="t('tool.failed')"
        />
      </div>
    </v-expansion-panel-title>

    <v-expansion-panel-text>
      <div v-for="diff in item.diffs" :key="diff.path" class="mb-3">
        <div class="text-label-large mb-1">
          {{ t('tool.changes') }} · {{ relative(diff.path) }}
          <v-chip v-if="diff.oldText === null" class="ms-2" size="x-small" :text="t('tool.newFile')" />
        </div>

        <pre class="bg-surface-light rounded pa-2 text-body-small overflow-x-auto"><template v-for="(line, index) in diffLines(diff)" :key="index"><span :class="line.class">{{ line.text }}</span>
</template></pre>
      </div>

      <template v-if="item.output">
        <div class="text-label-large mb-1">{{ t('tool.output') }}</div>
        <pre class="bg-surface-light rounded pa-2 text-body-small overflow-auto text-pre-wrap text-break">{{ item.output }}</pre>
      </template>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<script lang="ts" setup>
  import type { ToolCallDiff } from '#shared/contract'
  import type { TranscriptItem } from './transcript'
  import { computed } from 'vue'
  import { useI18n } from './i18n'
  import { relativePath, toolLabel } from './tools'

  // One row of a group of tool calls (ToolGroup): what it did, its status,
  // and on demand the changed lines and the output.
  const props = defineProps<{ item: Extract<TranscriptItem, { kind: 'tool' }>, folder: string }>()
  const { t } = useI18n()

  const hasDetails = computed(() => props.item.diffs.length > 0 || props.item.output.length > 0)
  const label = computed(() => toolLabel(props.item, props.folder))
  const relative = (path: string) => relativePath(path, props.folder)

  const maxDiffLines = 400

  /** A line diff, enough for an agent's edit: lines only in the old text, then lines only in the new one, around what both share. */
  function diffLines (diff: ToolCallDiff): { text: string, class: string }[] {
    const before = diff.oldText === null ? [] : diff.oldText.split('\n')
    const after = diff.newText.split('\n')
    let start = 0
    while (start < before.length && start < after.length && before[start] === after[start]) {
      start++
    }
    let end = 0
    while (end < before.length - start && end < after.length - start && before.at(-1 - end) === after.at(-1 - end)) {
      end++
    }
    const context = 2
    const lines = [
      ...before.slice(Math.max(0, start - context), start).map(text => ({ text: `  ${text}`, class: 'text-medium-emphasis' })),
      ...before.slice(start, before.length - end).map(text => ({ text: `- ${text}`, class: 'text-error' })),
      ...after.slice(start, after.length - end).map(text => ({ text: `+ ${text}`, class: 'text-success' })),
      ...after.slice(after.length - end, after.length - end + context).map(text => ({ text: `  ${text}`, class: 'text-medium-emphasis' })),
    ]
    return lines.length > maxDiffLines ? [...lines.slice(0, maxDiffLines), { text: '…', class: 'text-medium-emphasis' }] : lines
  }
</script>
