<template>
  <div data-test="app-builder-tools">
    <v-btn
      :append-icon="open ? 'mdi-chevron-up' : 'mdi-chevron-down'"
      :aria-expanded="open"
      class="text-medium-emphasis"
      data-test="app-builder-tools-toggle"
      max-width="100%"
      size="small"
      @click="open = !open"
    >
      <template v-if="working || failed > 0" #prepend>
        <v-progress-circular
          v-if="working"
          :aria-label="t('tool.running')"
          indeterminate
          role="img"
          size="12"
          width="2"
        />

        <v-icon v-else color="error" icon="mdi-alert-circle-outline" />
      </template>

      <span class="text-truncate">{{ working ? workingLabel : summary }}</span>
      <span v-if="failed > 0" class="text-error ms-1">· {{ t('toolGroup.failed', { count: failed }) }}</span>
    </v-btn>

    <v-expand-transition>
      <div v-if="open" class="border-s ms-3 ps-2 mt-1">
        <v-expansion-panels multiple>
          <template v-for="entry in entries" :key="entry.id">
            <ToolCallItem v-if="entry.kind === 'tool'" :folder="folder" :item="entry" />

            <v-expansion-panel v-else :value="entry.id">
              <v-expansion-panel-title>
                <div class="d-flex align-center ga-2 overflow-hidden">
                  <v-icon icon="mdi-thought-bubble-outline" size="x-small" />
                  <span class="text-body-small text-medium-emphasis text-truncate">{{ firstLine(entry.text) }}</span>
                </div>
              </v-expansion-panel-title>

              <v-expansion-panel-text>
                <div class="text-body-small text-medium-emphasis text-pre-wrap text-break">{{ entry.text }}</div>
              </v-expansion-panel-text>
            </v-expansion-panel>
          </template>
        </v-expansion-panels>
      </div>
    </v-expand-transition>
  </div>
</template>

<script lang="ts" setup>
  import type { ToolCallKind } from '#shared/contract'
  import type { TranscriptItem } from './transcript'
  import { computed, ref } from 'vue'
  import { useI18n } from './i18n'
  import ToolCallItem from './ToolCallItem.vue'
  import { toolLabel } from './tools'

  export type ActivityEntry = Extract<TranscriptItem, { kind: 'tool' | 'thought' }>

  // A stretch of the agent's thinking and tool calls, as in the coding
  // agents' own apps: one quiet line that says what the agent did, or what it
  // is doing, and opens on demand to the thoughts and calls, with their
  // changes and output. `active`: the agent is still at it.
  const props = defineProps<{ entries: ActivityEntry[], folder: string, active: boolean }>()
  const { t } = useI18n()
  const open = ref(false)

  const calls = computed(() => props.entries.filter((entry): entry is Extract<ActivityEntry, { kind: 'tool' }> => entry.kind === 'tool'))
  const runningCall = computed(() => calls.value.findLast(call => call.status === 'pending' || call.status === 'in_progress'))
  const working = computed(() => runningCall.value !== undefined || (props.active && props.entries.at(-1)?.kind === 'thought'))
  const failed = computed(() => calls.value.filter(call => call.status === 'failed').length)

  /** What the agent does now: the call that runs, else thinking. */
  const workingLabel = computed(() => {
    const call = runningCall.value
    return call ? `${t(`tool.${call.toolKind}`)} ${toolLabel(call, props.folder)}`.trim() : t('chat.thinking')
  })

  const groups: Record<ToolCallKind, 'read' | 'edit' | 'search' | 'execute' | 'fetch' | 'other'> = {
    read: 'read',
    edit: 'edit',
    delete: 'edit',
    move: 'edit',
    search: 'search',
    execute: 'execute',
    fetch: 'fetch',
    think: 'other',
    switch_mode: 'other',
    other: 'other',
  }

  /** "Read 3 files, ran 2 commands": the calls counted by what they did, in the order they first came; "Thinking" without calls. */
  const summary = computed(() => {
    const counts = new Map<string, number>()
    for (const call of calls.value) {
      const group = groups[call.toolKind]
      counts.set(group, (counts.get(group) ?? 0) + 1)
    }
    if (counts.size === 0) {
      return t('chat.thinking')
    }
    const text = [...counts].map(([group, count]) => t(count === 1 ? `toolGroup.${group}One` : `toolGroup.${group}`, { count })).join(t('toolGroup.separator'))
    return text.charAt(0).toLocaleUpperCase() + text.slice(1)
  })

  function firstLine (text: string): string {
    return text.trim().split('\n', 1)[0] ?? ''
  }
</script>
