<template>
  <v-expansion-panels>
    <v-expansion-panel :disabled="!hasDetails" :value="item.id">
      <v-expansion-panel-title>
        <div class="d-flex align-center ga-3 flex-grow-1 overflow-hidden">
          <v-progress-circular
            v-if="item.status === 'in_progress' || item.status === 'pending'"
            :aria-label="t('tool.running')"
            indeterminate
            role="img"
            size="18"
            width="2"
          />

          <v-icon
            v-else
            :aria-label="item.status === 'failed' ? t('tool.failed') : t('tool.completed')"
            :color="item.status === 'failed' ? 'error' : 'success'"
            :icon="item.status === 'failed' ? 'mdi-close-circle-outline' : 'mdi-check-circle-outline'"
            role="img"
          />

          <v-icon color="medium-emphasis" :icon="icons[item.toolKind]" />

          <span class="text-body-medium text-truncate">
            <span class="font-weight-medium">{{ t(`tool.${item.toolKind}`) }}</span>
            <span v-if="label" class="ms-2 text-medium-emphasis">{{ label }}</span>
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

          <pre class="bg-surface-light rounded pa-3 text-body-small overflow-x-auto"><template v-for="(line, index) in diffLines(diff)" :key="index"><span :class="line.class">{{ line.text }}</span>
</template></pre>
        </div>

        <template v-if="item.output">
          <div class="text-label-large mb-1">{{ t('tool.output') }}</div>
          <pre class="bg-surface-light rounded pa-3 text-body-small overflow-auto text-pre-wrap text-break">{{ item.output }}</pre>
        </template>
      </v-expansion-panel-text>
    </v-expansion-panel>
  </v-expansion-panels>
</template>

<script lang="ts" setup>
  import type { ToolCallDiff, ToolCallKind } from '#shared/contract'
  import type { TranscriptItem } from './transcript'
  import { computed } from 'vue'
  import { useI18n } from './i18n'

  // One tool call of the agent: what it did, its status, and on demand the
  // changed lines and the output.
  const props = defineProps<{ item: Extract<TranscriptItem, { kind: 'tool' }>, folder: string }>()
  const { t } = useI18n()

  const icons: Record<ToolCallKind, string> = {
    read: 'mdi-file-eye-outline',
    edit: 'mdi-file-edit-outline',
    delete: 'mdi-file-remove-outline',
    move: 'mdi-file-move-outline',
    search: 'mdi-magnify',
    execute: 'mdi-console',
    think: 'mdi-thought-bubble-outline',
    fetch: 'mdi-web',
    switch_mode: 'mdi-swap-horizontal',
    other: 'mdi-tools',
  }

  const hasDetails = computed(() => props.item.diffs.length > 0 || props.item.output.length > 0)

  function relative (path: string): string {
    return path.startsWith(`${props.folder}/`) ? path.slice(props.folder.length + 1) : path
  }

  const label = computed(() => {
    const paths = props.item.locations.filter(path => path !== props.folder)
    const title = props.item.title
    // Agents title some calls with only the tool's name ("write"); the file says more.
    return paths.length > 0 && (!title || /^\w+$/.test(title)) ? paths.map(path => relative(path)).join(', ') : title
  })

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
