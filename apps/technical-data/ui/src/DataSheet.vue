<template>
  <v-table-sheet data-test="data-sheet">
    <template v-if="$slots.top" #top>
      <slot name="top" />
    </template>

    <!-- Each column a fixed share of the width, so collapsing a section does not move them. -->
    <thead class="bg-card-header">
      <tr>
        <th :class="width">{{ t('sheet.property') }}</th>
        <th v-if="descriptionColumn" :class="width" data-test="sheet-description-column">{{ t('sheet.description') }}</th>
        <th v-if="definitionColumn" :class="width" data-test="sheet-definition-column">{{ t('sheet.definition') }}</th>
        <th :class="width">{{ t('sheet.value') }}</th>
      </tr>
    </thead>

    <tbody>
      <tr v-if="shown.length === 0 && empty" data-test="sheet-empty">
        <td class="py-4 text-medium-emphasis" :colspan="columns">{{ empty }}</td>
      </tr>

      <template v-for="sheet in shown" :key="sheet.path">
        <!-- Each area heads its properties, where there are several. -->
        <tr
          v-if="grouped"
          :id="areaAnchor(sheet.path)"
          class="bg-card-header"
          data-test="sheet-area"
        >
          <td class="py-2" :colspan="columns">
            <div class="d-flex align-center ga-2 text-title-small">
              <v-btn
                v-if="!searching"
                :aria-expanded="!collapsed.has(sheet.path)"
                :aria-label="t(collapsed.has(sheet.path) ? 'sheet.expand' : 'sheet.collapse', { label: sheet.title })"
                data-test="sheet-toggle"
                icon
                size="x-small"
                @click="toggle(sheet.path)"
              >
                <v-icon :icon="collapsed.has(sheet.path) ? 'mdi-chevron-right' : 'mdi-chevron-down'" />
              </v-btn>

              <v-icon :icon="icon" size="18" />
              <span data-test="sheet-area-title">{{ sheet.title }}</span>
            </div>
          </td>
        </tr>

        <tr
          v-for="row in sheet.rows"
          :key="row.key"
          :class="{ 'bg-card-header': row.kind === 'section' }"
          :data-field="row.field?.path"
          :data-test="row.kind === 'section' ? 'sheet-section' : 'sheet-row'"
        >
          <!-- A section heads its elements; sections are indented by their depth, properties are not. -->
          <td
            v-if="row.kind === 'section'"
            class="py-2"
            :class="indent(row.depth)"
            :colspan="columns"
          >
            <div class="d-flex align-center ga-2 font-weight-medium">
              <v-btn
                v-if="!searching"
                :aria-expanded="!collapsed.has(row.key)"
                :aria-label="t(collapsed.has(row.key) ? 'sheet.expand' : 'sheet.collapse', { label: row.label })"
                data-test="sheet-toggle"
                icon
                size="x-small"
                @click="toggle(row.key)"
              >
                <v-icon :icon="collapsed.has(row.key) ? 'mdi-chevron-right' : 'mdi-chevron-down'" />
              </v-btn>

              <v-icon class="text-medium-emphasis" icon="mdi-folder-outline" size="16" />
              <span data-test="sheet-section-label">{{ row.label }}</span>

              <v-btn
                v-if="about(row)"
                :aria-label="about(row)"
                data-test="sheet-about"
                icon
                size="x-small"
              >
                <v-icon class="text-medium-emphasis" icon="mdi-information-outline" size="14" />
                <v-tooltip activator="parent" location="bottom" max-width="400" :text="about(row)" />
              </v-btn>
            </div>
          </td>

          <template v-else>
            <td class="text-medium-emphasis align-top py-2" data-test="sheet-label">
              {{ row.label }}
              <!-- On a narrow frame, without their columns. -->
              <v-btn
                v-if="!wide && about(row)"
                :aria-label="about(row)"
                data-test="sheet-about"
                icon
                size="x-small"
              >
                <v-icon icon="mdi-information-outline" size="14" />
                <v-tooltip activator="parent" location="bottom" max-width="400" :text="about(row)" />
              </v-btn>
            </td>

            <td v-if="descriptionColumn" class="align-top py-2 text-body-small text-medium-emphasis" data-test="sheet-description">{{ row.description }}</td>

            <td v-if="definitionColumn" class="align-top py-2 text-body-small text-medium-emphasis" data-test="sheet-definition">{{ row.definition }}</td>

            <td class="align-top py-2 text-break">
              <FieldEditForm v-if="editing(row)" />

              <div v-else class="d-flex align-start ga-1">
                <!-- The value and its unit are read together. -->
                <div class="flex-grow-1 font-weight-medium" data-test="sheet-value">
                  <v-btn-link
                    v-if="row.file"
                    append-icon="mdi-eye-outline"
                    data-test="sheet-file"
                    :text="row.value"
                    @click="preview?.(row.file)"
                  />

                  <template v-else-if="row.value">{{ valueWithUnit(row) }}</template>

                  <span v-else class="text-medium-emphasis">—</span>
                </div>

                <v-btn
                  v-if="canEdit && row.field"
                  :aria-label="t('edit.edit', { label: row.label })"
                  data-test="edit"
                  icon
                  size="x-small"
                  @click="editor.start(row.field, row.label)"
                >
                  <v-icon icon="mdi-pencil-outline" size="14" />
                  <v-tooltip activator="parent" location="bottom" :text="t('edit.edit', { label: row.label })" />
                </v-btn>
              </div>
            </td>
          </template>
        </tr>
      </template>
    </tbody>
  </v-table-sheet>
</template>

<script lang="ts" setup>
  import type { SheetRow } from './presentation'
  import { useRowActions } from '@basyx/studio-app-kit/editing'
  import { computed, ref } from 'vue'
  import { useDisplay } from 'vuetify'
  import FieldEditForm from './FieldEditForm.vue'
  import { useI18n } from './i18n'
  import { areaAnchor, valueWithUnit, visibleRows } from './presentation'

  // Areas of technical properties (or specific descriptions) as one data
  // sheet, as the BaSyx AAS Web UI's table view: property, the element's
  // description, the concept's definition, and the value with its unit;
  // areas and sections as tinted rows that collapse, indented by their
  // depth, the properties flush. The description and definition columns
  // show where there is text for them and the frame is wide enough; on a
  // narrow one, an info button beside the label holds both, for the
  // keyboard and screen readers too. The top slot sits above the column
  // headers, inside the sheet's border.
  const props = defineProps<{
    sheets: Array<{ path: string, title: string, rows: SheetRow[] }>
    /** Whether areas get rows of their own: where there are several, also when a search shows one. */
    grouped: boolean
    icon: string
    /** A search shows every match, collapsed or not, and nothing collapses meanwhile. */
    searching: boolean
    /** What the sheet says without rows, e.g. that nothing matches a search. */
    empty?: string
  }>()
  defineSlots<{
    /** Above the column headers, inside the sheet's border: a title, a search. */
    top?: () => unknown
  }>()

  const { t } = useI18n()
  const { canEdit, editor, preview } = useRowActions()
  const { mdAndUp: wide } = useDisplay()

  const collapsed = ref(new Set<string>())
  const shown = computed(() => props.sheets.map(sheet => ({
    ...sheet,
    rows: props.searching ? sheet.rows : visibleRows(sheet.rows, collapsed.value, props.grouped ? sheet.path : ''),
  })))

  const descriptionColumn = computed(() => wide.value && props.sheets.some(sheet => sheet.rows.some(row => row.kind === 'value' && row.description)))
  const definitionColumn = computed(() => wide.value && props.sheets.some(sheet => sheet.rows.some(row => row.kind === 'value' && row.definition)))
  const columns = computed(() => 2 + (descriptionColumn.value ? 1 : 0) + (definitionColumn.value ? 1 : 0))
  const width = computed(() => ({ 2: 'w-50', 3: 'w-33', 4: 'w-25' })[columns.value])

  function toggle (key: string) {
    const next = new Set(collapsed.value)
    if (!next.delete(key)) {
      next.add(key)
    }
    collapsed.value = next
  }

  const indents = ['ps-4', 'ps-8', 'ps-12', 'ps-16']

  /** Below an area's row, its sections one step in. */
  function indent (depth: number): string {
    return indents[Math.min(depth + (props.grouped ? 1 : 0), indents.length - 1)]!
  }

  /** What the info icon says: the description, then the definition. */
  function about (row: SheetRow): string {
    return [row.description, row.definition].filter(Boolean).join(' — ')
  }

  function editing (row: SheetRow): boolean {
    return editor.draft.value !== null && editor.draft.value.field.path === row.field?.path
  }
</script>
