<template>
  <v-menu
    v-model="menu"
    :close-on-content-click="false"
    location="bottom start"
    :open-on-click="false"
  >
    <template #activator="{ props: activator }">
      <div ref="container">
        <v-text-field
          v-bind="activator"
          :aria-label="label"
          :clearable="draft.length > 0 || filterCount > 0 || queryActive"
          density="compact"
          :dirty="draft.length > 0 || filterCount > 0 || queryActive"
          :loading="loading"
          :model-value="draft"
          :persistent-clear="filterCount > 0 || queryActive"
          :placeholder="queryActive || filterCount > 0 ? undefined : label"
          prepend-inner-icon="mdi-magnify"
          :readonly="queryActive"
          @click="menu = true"
          @click:clear="clear"
          @keydown.enter.prevent="submit"
          @keydown.esc="menu = false"
          @keydown.space="commitOnSpace"
          @update:model-value="updateDraft"
        >
          <template v-if="queryActive || filterCount > 0" #default>
            <v-chip
              v-if="queryActive"
              class="ms-n1 me-2"
              closable
              color="primary"
              prepend-icon="mdi-code-json"
              :text="t('shells.query.active')"
              @click.stop="emit('advanced')"
              @click:close.stop="clear"
            />

            <v-chip
              v-else
              :aria-label="t('shells.filters.show', filterCount)"
              class="ms-n1 me-2"
              color="primary"
              prepend-icon="mdi-filter-variant"
              :text="t('shells.filters.count', filterCount)"
              @click.stop="menu = true"
            />
          </template>

          <!-- Finds the shell of an asset by the QR code on it, as in the Web UI.
               A clickable icon, as Vuetify's own clear icon: a button would add
               its padding to the field's and sit further from the edge than
               the search icon on the left. -->
          <template v-if="scannable" #append-inner>
            <v-icon
              v-tooltip="t('scan.button')"
              :aria-label="t('scan.button')"
              icon="mdi-qrcode-scan"
              @click.stop="emit('scan')"
              @keydown.enter.space.prevent.stop="emit('scan')"
            />
          </template>
        </v-text-field>
      </div>
    </template>

    <v-card max-width="360" min-width="280">
      <v-list max-height="400">
        <template v-if="!queryActive && filters.length > 0">
          <v-list-subheader :title="t('shells.filters.applied')" />

          <v-list-item
            v-for="(filter, index) in filters"
            :key="`${formatFilter(filter)}:${index}`"
            prepend-icon="mdi-filter-check-outline"
            :title="formatFilter(filter)"
          >
            <template #append>
              <v-btn
                :aria-label="t('shells.filters.remove', { filter: formatFilter(filter) })"
                icon="mdi-close"
                size="x-small"
                @click.stop="removeFilter(index)"
              />
            </template>
          </v-list-item>

          <v-divider class="my-1" />
        </template>

        <template v-if="!queryActive">
          <v-list-subheader :title="heading" />

          <!-- Values of fields with a fixed set (assetKind) -->
          <template v-if="state.stage === 'value' && state.field && searchFieldValues[state.field]">
            <v-list-item
              v-for="value in valueOptions"
              :key="value"
              :title="value"
              @click="selectValue(value)"
            />
          </template>

          <v-list-item
            v-else-if="state.stage === 'value' && canCommit"
            prepend-icon="mdi-plus"
            :subtitle="t('shells.filters.add')"
            :title="state.value.trim()"
            @click="commit()"
          />

          <v-list-item
            v-else-if="state.stage === 'value'"
            disabled
            :subtitle="t('shells.filters.spaceToAdd')"
            :title="t('shells.filters.typeValue')"
          />

          <template v-else-if="state.stage === 'operator' && state.field">
            <v-list-item
              v-for="option in operatorOptions"
              :key="option.operator"
              :title="t(`shells.operators.${option.operator}`)"
              @click="selectOperator(option.operator)"
            >
              <template #append>
                <span class="text-body-small text-medium-emphasis text-mono">{{ option.symbol }}</span>
              </template>
            </v-list-item>
          </template>

          <template v-else>
            <v-list-item
              v-for="field in fieldOptions"
              :key="field"
              prepend-icon="mdi-filter-outline"
              :title="t(`shells.fields.${field}`)"
              @click="selectField(field)"
            >
              <template #append>
                <span class="text-body-small text-medium-emphasis">{{ field }}</span>
              </template>
            </v-list-item>
          </template>

          <!-- Filters by facet, e.g. the source of a concept description. -->
          <template v-for="group in groups" :key="group.title">
            <v-divider class="my-1" />

            <v-list-subheader :title="group.title" />

            <v-list-item
              v-for="option in group.options"
              :key="option.value"
              :active="selected.includes(option.value)"
              :prepend-icon="option.icon"
              :title="option.title"
              @click="toggleFacet(option.value)"
            >
              <template #append>
                <v-icon v-if="selected.includes(option.value)" color="primary" icon="mdi-check" size="small" />
              </template>
            </v-list-item>
          </template>
        </template>

        <template v-if="advancedEnabled">
          <v-divider v-if="!queryActive" class="my-1" />

          <v-list-item
            prepend-icon="mdi-code-json"
            :title="queryActive ? t('shells.query.edit') : t('shells.query.title')"
            @click="openAdvanced"
          />
        </template>
      </v-list>
    </v-card>
  </v-menu>
</template>

<script lang="ts" setup>
  import type { SearchField, SearchFilter, SearchOperator } from '#shared/search/expression'
  import type { FilterGroup } from '~/utils/records'
  import { formatFilter, parseSearch, searchFields, searchFieldValues } from '#shared/search/expression'

  // The search of the BaSyx AAS Web UI (MVP-4 plan, S2), for shells and
  // concept descriptions: free text, with filters built from suggestions
  // (field, operator, value) and shown as one chip; the menu lists them,
  // offers facet filters where there are any, and leads to the advanced
  // query. The model is the search expression, e.g. `motor assetKind=Type`.
  const props = withDefaults(defineProps<{
    loading?: boolean
    /** A raw query from the advanced dialog replaces the expression. */
    queryActive: boolean
    advancedEnabled: boolean
    /** Offer the QR code scanner (asset ID lookup). */
    scannable?: boolean
    /** The fields the expression knows; those of the shell search by default. */
    fields?: readonly SearchField[]
    /** Facet filters below the fields, as `group:value` in `selected`. */
    groups?: FilterGroup[]
    placeholder?: string
  }>(), { fields: () => searchFields, groups: () => [], placeholder: undefined })
  const emit = defineEmits<{ 'advanced': [], 'clear-query': [], 'scan': [] }>()
  const expression = defineModel<string>({ required: true })
  const selected = defineModel<string[]>('selected', { default: () => [] })

  const { t } = useI18n()
  const label = computed(() => props.placeholder ?? t('shells.search'))

  const symbols: Record<SearchOperator, string> = { 'contains': ':', 'equals': '=', 'not-equals': '!=' }

  interface DraftState {
    stage: 'field' | 'operator' | 'value'
    field?: SearchField
    operator?: SearchOperator
    fragment: string
    value: string
    /** Where the filter being typed starts in the draft. */
    start: number
  }

  const menu = ref(false)
  const container = useTemplateRef<HTMLDivElement>('container')
  const filters = ref<SearchFilter[]>([])
  const draft = ref('')
  let lastEmitted: string | undefined

  /** Where the last field name starts in the draft, as a word of its own. */
  function lastField (text: string): { field: SearchField, start: number } | null {
    const lower = text.toLowerCase()
    let best: { field: SearchField, start: number } | null = null
    for (const field of props.fields) {
      const key = field.toLowerCase()
      for (let index = lower.lastIndexOf(key); index >= 0; index = index > 0 ? lower.lastIndexOf(key, index - 1) : -1) {
        const before = index === 0 ? ' ' : lower[index - 1]!
        const after = lower[index + key.length] ?? ' '
        if (/\s/.test(before) && /[\s:=!]/.test(after)) {
          // `idShort` wins over `id` at the same place.
          if (!best || index > best.start || (index === best.start && field.length > best.field.length)) {
            best = { field, start: index }
          }
          break
        }
      }
    }
    return best
  }

  /** The filter being typed at the end of the draft, if any. */
  const state = computed<DraftState>(() => {
    const found = lastField(draft.value)
    if (found) {
      const rest = draft.value.slice(found.start + found.field.length)
      const symbol = ['!=', '=', ':'].find(candidate => rest.trimStart().startsWith(candidate))
      if (symbol) {
        const operator = (Object.entries(symbols).find(([, candidate]) => candidate === symbol)![0]) as SearchOperator
        return { stage: 'value', field: found.field, operator, fragment: '', value: rest.trimStart().slice(symbol.length), start: found.start }
      }
      if (rest !== '' && rest.trim() === '') {
        return { stage: 'operator', field: found.field, fragment: '', value: '', start: found.start }
      }
    }
    const fragmentStart = Math.max(draft.value.lastIndexOf(' '), draft.value.lastIndexOf('\t')) + 1
    return { stage: 'field', fragment: draft.value.slice(fragmentStart), value: '', start: fragmentStart }
  })

  const heading = computed(() => {
    if (state.value.stage === 'operator') {
      return t('shells.filters.howToMatch', { field: t(`shells.fields.${state.value.field}`) })
    }
    if (state.value.stage === 'value') {
      return t('shells.filters.enterValue', { field: t(`shells.fields.${state.value.field}`) })
    }
    return t('shells.filters.byField')
  })

  const fieldOptions = computed(() => {
    const fragment = state.value.fragment.toLowerCase()
    const matches = props.fields.filter(field => field.toLowerCase().startsWith(fragment) || t(`shells.fields.${field}`).toLowerCase().includes(fragment))
    return fragment && matches.length > 0 ? matches : props.fields
  })

  const operatorOptions = computed(() => {
    const field = state.value.field
    // Fields with a fixed set of values compare for equality.
    const operators: SearchOperator[] = field && searchFieldValues[field] ? ['equals', 'not-equals'] : ['contains', 'equals', 'not-equals']
    return operators.map(operator => ({ operator, symbol: symbols[operator] }))
  })

  const valueOptions = computed(() => {
    const options = (state.value.field && searchFieldValues[state.value.field]) || []
    const fragment = state.value.value.trim().toLowerCase()
    const matches = options.filter(option => option.toLowerCase().startsWith(fragment))
    return matches.length > 0 ? matches : options
  })

  const canCommit = computed(() => {
    const value = state.value.value.trim()
    return state.value.stage === 'value' && value !== '' && (!value.startsWith('"') || /^"(?:\\.|[^"])*"$/.test(value))
  })

  watch(expression, value => {
    if (value === lastEmitted) {
      return
    }
    const parsed = parseSearch(value, props.fields)
    filters.value = parsed.filters
    draft.value = parsed.text
  }, { immediate: true })

  function emitExpression () {
    // A filter still being typed (field or operator chosen, not added yet) does not search.
    const text = state.value.stage === 'field' ? draft.value : draft.value.slice(0, state.value.start)
    lastEmitted = [...filters.value.map(filter => formatFilter(filter)), text.trim()].filter(Boolean).join(' ')
    expression.value = lastEmitted
  }

  function updateDraft (value: string | null) {
    if (!props.queryActive) {
      draft.value = value ?? ''
      emitExpression()
      // Opened by typing or a click, not by focus: focus comes back after the dialog closes.
      menu.value = true
    }
  }

  function focus () {
    void nextTick(() => container.value?.querySelector('input')?.focus())
  }

  function selectField (field: SearchField) {
    const prefix = state.value.fragment ? draft.value.slice(0, state.value.start) : `${draft.value.trimEnd()}${draft.value.trim() ? ' ' : ''}`
    draft.value = `${prefix}${field} `
    emitExpression()
    focus()
  }

  function selectOperator (operator: SearchOperator) {
    draft.value = `${draft.value.slice(0, state.value.start)}${state.value.field}${symbols[operator]}`
    emitExpression()
    focus()
  }

  function selectValue (value: string) {
    draft.value = `${draft.value.slice(0, state.value.start)}${state.value.field}${symbols[state.value.operator!]}${value}`
    commit()
  }

  /** Moves the filter being typed into the applied filters. */
  function commit () {
    if (!canCommit.value) {
      return
    }
    const raw = state.value.value.trim()
    const value = raw.startsWith('"') ? raw.slice(1, -1).replaceAll(/\\([\\"])/g, '$1') : raw
    filters.value = [...filters.value, { field: state.value.field!, operator: state.value.operator!, value }]
    draft.value = draft.value.slice(0, state.value.start).trimEnd()
    emitExpression()
    focus()
  }

  function commitOnSpace (event: KeyboardEvent) {
    if (canCommit.value && !state.value.value.trim().startsWith('"')) {
      event.preventDefault()
      commit()
    }
  }

  function submit () {
    if (props.queryActive) {
      openAdvanced()
      return
    }
    commit()
    menu.value = false
  }

  /** Field filters and facet filters, for the chip in the field. */
  const filterCount = computed(() => filters.value.length + selected.value.length)

  function toggleFacet (value: string) {
    selected.value = selected.value.includes(value) ? selected.value.filter(candidate => candidate !== value) : [...selected.value, value]
  }

  function removeFilter (index: number) {
    filters.value = filters.value.filter((_, position) => position !== index)
    emitExpression()
    focus()
  }

  function clear () {
    filters.value = []
    selected.value = []
    draft.value = ''
    emitExpression()
    if (props.queryActive) {
      emit('clear-query')
    }
    menu.value = false
  }

  function openAdvanced () {
    menu.value = false
    emit('advanced')
  }
</script>
