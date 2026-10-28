<template>
  <v-table-details>
    <tbody>
      <tr v-for="(row, index) in rows" :key="`${row.key}:${index}`" :data-field="row.field?.path" data-test="detail-row">
        <td class="text-medium-emphasis text-no-wrap align-top py-2">
          <v-icon v-if="row.icon" class="me-2" :icon="row.icon" size="16" />
          {{ row.label }}
        </td>

        <td class="text-break align-top py-2 w-100">
          <!-- Edited in place: a dialog would not fit a frame sized to its content.
               No form: app frames may not submit forms (sandbox without allow-forms). -->
          <div v-if="draft && draft.field.path === row.field?.path" data-test="edit-field">
            <v-text-field
              v-model="draft.value"
              autofocus
              :hint="draft.language ? t('edit.language', { language: draft.language }) : undefined"
              :label="row.label"
              :persistent-hint="Boolean(draft.language)"
              @keydown.enter="editor.save"
              @keydown.esc="editor.cancel"
            />

            <v-alert
              v-if="draft.error"
              class="mt-2"
              data-test="edit-error"
              density="compact"
              :text="draft.error"
              type="warning"
            />

            <div class="d-flex justify-end ga-2 mt-2">
              <v-btn :text="t('edit.cancel')" @click="editor.cancel" />
              <v-btn-primary :loading="editor.saving.value" :text="t('edit.save')" @click="editor.save" />
            </div>
          </div>

          <div v-else class="d-flex align-start ga-1">
            <div class="flex-grow-1">
              <div class="d-flex flex-wrap align-center ga-2">
                <!-- The frame cannot open links itself: Studio opens them in the browser, mail or phone app. -->
                <v-btn-link
                  v-if="row.url"
                  :append-icon="linkIcon(row.url)"
                  data-test="detail-link"
                  :text="row.value"
                  @click="open(row.url)"
                />

                <div v-else-if="row.value">
                  <div v-for="(line, lineIndex) in row.value.split('\n')" :key="lineIndex">{{ line }}</div>
                </div>

                <span v-else class="text-medium-emphasis">—</span>

                <v-chip v-if="row.type" data-test="detail-type" size="x-small" :text="row.type" />
              </div>

              <div v-if="row.note" class="text-body-small text-medium-emphasis">{{ row.note }}</div>
            </div>

            <!-- An address opens in Google Maps, in a new browser tab. -->
            <v-btn
              v-if="row.map && !canEdit"
              :aria-label="t('contact.showOnMap')"
              data-test="show-on-map"
              icon
              size="small"
              @click="open(row.map)"
            >
              <v-icon icon="mdi-map-search-outline" size="16" />
              <v-tooltip activator="parent" location="bottom" :text="t('contact.showOnMap')" />
            </v-btn>

            <v-btn
              v-if="row.copy && !canEdit"
              :aria-label="t('contact.copy', { label: row.label })"
              data-test="detail-copy"
              icon
              size="small"
              @click="copy(row.copy)"
            >
              <v-icon icon="mdi-content-copy" size="16" />
              <v-tooltip activator="parent" location="bottom" :text="t('contact.copy', { label: row.label })" />
            </v-btn>

            <v-btn
              v-if="canEdit && row.field"
              :aria-label="t('edit.edit', { label: row.label })"
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
  import type { ContactRow } from '@basyx/studio-app-kit/contacts'
  import { useRowActions } from '@basyx/studio-app-kit/editing'
  import { useI18n } from './i18n'

  // A contact's label and value rows, as the Documents app's definition
  // list: links open through Studio, addresses in Google Maps, values copy
  // to the clipboard, and in edit mode each value changes in place.
  defineProps<{ rows: ContactRow[] }>()

  const { t } = useI18n()
  const { canEdit, editor, open, copy } = useRowActions()
  const draft = editor.draft

  function linkIcon (url: string): string {
    if (url.startsWith('mailto:')) {
      return 'mdi-email-outline'
    }
    return url.startsWith('tel:') ? 'mdi-phone-outline' : 'mdi-open-in-new'
  }
</script>
