<template>
  <v-card v-if="modelType === 'Property'" border="0" color="surface-light">
    <v-card-item>
      <v-card-subtitle class="text-label-medium">{{ t('details.valueOf', { type: element.valueType ?? '' }) }}</v-card-subtitle>

      <template v-if="history.length > 0" #append>
        <v-chip
          :color="refreshing ? 'success' : undefined"
          :prepend-icon="refreshing ? 'mdi-refresh-auto' : 'mdi-pause'"
          :text="refreshing ? t('details.refreshEvery', { seconds: preferences.refreshIntervalSeconds }) : t('details.paused')"
        />
      </template>
    </v-card-item>

    <v-card-text class="d-flex align-baseline ga-2 pt-0">
      <span class="text-body-large font-weight-medium text-high-emphasis text-break" data-test="property-value">
        {{ display || t('editor.emptyValue') }}
      </span>

      <span v-if="unit && display" class="text-body-medium text-medium-emphasis">{{ unit }}</span>
    </v-card-text>

    <template v-if="history.length > 1">
      <v-sparkline
        :gradient="gradient"
        height="60"
        line-width="2"
        :model-value="history"
        padding="6"
        smooth="8"
      />

      <v-card-text class="pt-1 text-label-small text-medium-emphasis">{{ t('details.sessionHistory', { count: history.length }) }}</v-card-text>
    </template>
  </v-card>

  <v-card v-else-if="modelType === 'MultiLanguageProperty'" border="0" color="surface-light">
    <v-list>
      <v-list-item v-for="entry in languages" :key="entry.language" :title="entry.text">
        <template #prepend>
          <v-chip class="me-3" color="info" :text="entry.language.toUpperCase()" />
        </template>

        <template #append>
          <v-btn :aria-label="t('common.copy')" icon="mdi-content-copy" size="x-small" @click="copy(entry.text)" />
        </template>
      </v-list-item>

      <v-list-item v-if="languages.length === 0" :title="t('editor.emptyValue')" />
    </v-list>
  </v-card>

  <v-card v-else-if="modelType === 'Range'" border="0" color="surface-light">
    <v-card-item>
      <v-card-subtitle class="text-label-medium">{{ t('details.range', { type: element.valueType ?? '' }) }}</v-card-subtitle>
    </v-card-item>

    <v-card-text class="d-flex align-baseline ga-3 pt-0 text-headline-small">
      <span>{{ element.min ?? '…' }}</span>
      <v-icon icon="mdi-arrow-left-right" size="small" />
      <span>{{ element.max ?? '…' }}</span>
      <span v-if="unit" class="text-body-medium text-medium-emphasis">{{ unit }}</span>
    </v-card-text>
  </v-card>

  <FileValue
    v-else-if="modelType === 'File'"
    :can-replace="canReplace"
    :detail="detail"
    :submodel-key="submodelKey"
    :target-id="targetId"
    @changed="value => emit('changed', value)"
  />

  <OperationPanel
    v-else-if="modelType === 'Operation'"
    :can-invoke="canInvoke"
    :element="element"
    :element-key="detail.key"
    :submodel-key="submodelKey"
    :target-id="targetId"
  />

  <ElementStructureView
    v-else-if="structureTypes.includes(modelType)"
    :element="element"
    :submodel-id="decodeResourceKey(submodelKey) ?? ''"
    :submodel-key="submodelKey"
    @select="id => emit('select', id)"
  />

  <!-- Collections, lists, entities and annotated relationships: their children. -->
  <v-card v-if="children.length > 0 && modelType !== 'Operation'" border="0" :class="isContainer ? undefined : 'mt-3'" color="surface-light">
    <v-card-item>
      <v-card-subtitle class="text-label-medium">{{ t('details.elements', children.length) }}</v-card-subtitle>
    </v-card-item>

    <v-list class="pt-0">
      <v-list-item
        v-for="child in children"
        :key="child.id"
        append-icon="mdi-chevron-right"
        :prepend-icon="modelTypeIcon(child.modelType)"
        :subtitle="child.preview ?? child.modelType"
        :title="child.variableGroup ? t(`variables.${child.variableGroup}`) : child.title"
        @click="emit('select', child.id)"
      />
    </v-list>
  </v-card>
</template>

<script lang="ts" setup>
  import type { ElementDetail, LangString } from '#shared/contract'
  import type { ShellTreeItem } from '~/composables/useShellTrees'
  import { useTheme } from 'vuetify'
  import { ownUnit } from '#shared/aas/iec61360'
  import { decodeResourceKey, langText, modelTypeIcon } from '~/utils/aas'

  const props = defineProps<{
    targetId: string
    submodelKey: string
    detail: ElementDetail
    item: ShellTreeItem | null
    history: number[]
    /** Values are re-read right now. */
    refreshing: boolean
    canReplace: boolean
    canInvoke: boolean
  }>()
  const emit = defineEmits<{
    changed: [detail: ElementDetail]
    select: [id: string]
  }>()

  const { t } = useI18n()
  const theme = useTheme()
  const copy = useClipboard()
  const preferences = usePreferences().preferences

  const element = computed(() => props.detail.value as Record<string, any>)
  const modelType = computed(() => String(element.value.modelType ?? ''))
  const languages = computed(() => (Array.isArray(element.value.value) ? element.value.value : []) as LangString[])
  const display = computed(() => {
    if (modelType.value === 'MultiLanguageProperty') {
      return langText(languages.value, preferences.value.valueLanguage) ?? ''
    }
    return typeof element.value.value === 'string' ? element.value.value : ''
  })
  // The element's own IEC 61360 unit, else the one of its concept description (MVP-6 plan, E6).
  const target = useTarget(() => props.targetId)
  const unitOf = useConceptUnits(() => props.targetId, () => Boolean(target.data.value?.capabilities.conceptDescriptions) && ['Property', 'Range'].includes(modelType.value))
  const unit = computed(() => ownUnit(element.value) ?? unitOf(element.value.semanticId?.keys?.[0]?.value))
  const children = computed(() => (props.item?.children ?? []).filter(child => !child.more))
  const structureTypes = ['Blob', 'ReferenceElement', 'RelationshipElement', 'AnnotatedRelationshipElement', 'BasicEventElement', 'Entity', 'Capability']
  // Collections and lists show only their children; other types show them below their own view.
  const isContainer = computed(() => ['SubmodelElementCollection', 'SubmodelElementList'].includes(modelType.value))
  const gradient = computed(() => {
    const colors = theme.current.value.colors
    return [String(colors.secondary), String(colors.primary)]
  })
</script>
