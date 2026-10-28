<template>
  <v-table-details>
    <tbody>
      <tr v-for="row in rows" :key="row.key" :data-field="row.field?.path" data-test="detail-row">
        <td class="text-medium-emphasis text-no-wrap align-top py-2">
          <v-icon v-if="row.icon" class="me-2" :icon="row.icon" size="16" />
          {{ row.label }}
        </td>

        <td class="text-break align-top py-2 w-100">
          <FieldEditForm v-if="editing(row)" />

          <div v-else class="d-flex align-start ga-1">
            <div class="flex-grow-1">
              <!-- The frame cannot open links itself: Studio opens them in the browser. -->
              <v-btn-link
                v-if="row.url"
                append-icon="mdi-open-in-new"
                data-test="detail-link"
                :text="row.value"
                @click="open(row.url)"
              />

              <div v-else-if="row.value">
                <div v-for="(line, index) in row.value.split('\n')" :key="index">{{ line }}</div>
              </div>

              <span v-else class="text-medium-emphasis">—</span>
            </div>

            <v-btn
              v-if="row.copy && !canEdit"
              :aria-label="t('copy.copy', { label: row.label })"
              data-test="detail-copy"
              icon
              size="small"
              @click="copy(row.copy)"
            >
              <v-icon icon="mdi-content-copy" size="16" />
              <v-tooltip activator="parent" location="bottom" :text="t('copy.copy', { label: row.label })" />
            </v-btn>

            <v-btn
              v-if="canEdit && row.field"
              :aria-label="t('edit.edit', { label: row.label })"
              data-test="edit"
              icon
              size="small"
              @click="editor.start(row.field, row.label)"
            >
              <v-icon icon="mdi-pencil-outline" size="16" />
              <v-tooltip activator="parent" location="bottom" :text="t('edit.edit', { label: row.label })" />
            </v-btn>
          </div>
        </td>
      </tr>
    </tbody>
  </v-table-details>
</template>

<script lang="ts" setup>
  import type { DetailRow } from './presentation'
  import { useRowActions } from '@basyx/studio-app-kit/editing'
  import FieldEditForm from './FieldEditForm.vue'
  import { useI18n } from './i18n'

  // Label and value rows of the general and further information: links open
  // through Studio, values copy to the clipboard, and in edit mode each
  // value changes in place.
  defineProps<{ rows: DetailRow[] }>()

  const { t } = useI18n()
  const { canEdit, editor, open, copy } = useRowActions()

  function editing (row: DetailRow): boolean {
    return editor.draft.value !== null && editor.draft.value.field.path === row.field?.path
  }
</script>
