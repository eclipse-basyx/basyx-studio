<template>
  <div class="d-flex flex-column ga-3">
    <!-- Names: what the concept is called (AASc-3a-002: at least one, in English). -->
    <LangStringsInput
      :error-messages="errorsFor(findings, `${prefix}.preferredName`)"
      :hint="t('dataSpec.preferredNameHint')"
      :label="t('dataSpec.preferredName')"
      :model-value="langStrings('preferredName')"
      @update:model-value="strings => set('preferredName', strings)"
    />

    <LangStringsInput
      :error-messages="errorsFor(findings, `${prefix}.definition`)"
      :hint="requireDefinition ? t('dataSpec.definitionRequired') : undefined"
      :label="t('dataSpec.definition')"
      :model-value="langStrings('definition')"
      @update:model-value="strings => set('definition', strings)"
    />

    <div class="d-flex flex-wrap align-start ga-3">
      <v-select
        clearable
        :error-messages="errorsFor(findings, `${prefix}.dataType`)"
        :items="iec61360DataTypes"
        :label="t('dataSpec.dataType')"
        min-width="200"
        :model-value="dataType"
        @update:model-value="type => set('dataType', type)"
      />

      <v-text-field
        :error-messages="unitErrors"
        :hint="needsUnit ? t('dataSpec.unitRequired') : undefined"
        :label="t('dataSpec.unit')"
        min-width="120"
        :model-value="str('unit') ?? ''"
        :persistent-hint="needsUnit"
        @update:model-value="text => set('unit', text)"
      />

      <v-text-field
        :label="t('dataSpec.symbol')"
        min-width="120"
        :model-value="str('symbol') ?? ''"
        @update:model-value="text => set('symbol', text)"
      />
    </div>

    <ReferenceInput
      :error-messages="errorsFor(findings, `${prefix}.unitId`)"
      :label="t('dataSpec.unitId')"
      :model-value="content.unitId"
      @update:model-value="reference => set('unitId', reference)"
    />

    <!-- Further details stay folded until they hold something. -->
    <v-expansion-panels v-model="openMore" multiple>
      <v-expansion-panel value="more">
        <v-expansion-panel-title>
          {{ t('dataSpec.more') }}
          <v-chip v-if="moreCount > 0" class="ms-2" :text="String(moreCount)" />
        </v-expansion-panel-title>

        <v-expansion-panel-text>
          <div class="d-flex flex-column ga-3">
            <LangStringsInput
              :error-messages="errorsFor(findings, `${prefix}.shortName`)"
              :label="t('dataSpec.shortName')"
              :model-value="langStrings('shortName')"
              @update:model-value="strings => set('shortName', strings)"
            />

            <div class="d-flex flex-wrap align-start ga-3">
              <v-text-field
                :error-messages="errorsFor(findings, `${prefix}.sourceOfDefinition`)"
                :label="t('dataSpec.sourceOfDefinition')"
                min-width="200"
                :model-value="str('sourceOfDefinition') ?? ''"
                @update:model-value="text => set('sourceOfDefinition', text)"
              />

              <v-text-field
                :error-messages="errorsFor(findings, `${prefix}.valueFormat`)"
                :label="t('dataSpec.valueFormat')"
                min-width="200"
                :model-value="str('valueFormat') ?? ''"
                @update:model-value="text => set('valueFormat', text)"
              />
            </div>

            <!-- A value or a list of values, never both (AASc-3a-010). -->
            <v-btn-toggle
              class="align-self-start"
              mandatory
              :model-value="valueMode"
              @update:model-value="setValueMode"
            >
              <v-btn :text="t('dataSpec.valueNone')" value="none" />
              <v-btn :text="t('dataSpec.valueSingle')" value="value" />
              <v-btn :text="t('dataSpec.valueList')" value="list" />
            </v-btn-toggle>

            <v-text-field
              v-if="valueMode === 'value'"
              :error-messages="errorsFor(findings, `${prefix}.value`)"
              :label="t('dataSpec.value')"
              :model-value="str('value') ?? ''"
              @update:model-value="text => set('value', text)"
            />

            <ValueListInput
              v-else-if="valueMode === 'list'"
              :error-messages="errorsFor(findings, `${prefix}.valueList`)"
              :model-value="pairs"
              @update:model-value="list => set('valueList', list.length > 0 ? { valueReferencePairs: list } : undefined)"
            />

            <div>
              <div class="text-body-medium mb-2">{{ t('dataSpec.levelType') }}</div>

              <v-chip-group
                column
                :model-value="levels"
                multiple
                selected-class="text-primary"
                @update:model-value="setLevels"
              >
                <v-chip
                  v-for="level in levelNames"
                  :key="level"
                  filter
                  :text="t(`dataSpec.levels.${level}`)"
                  :value="level"
                />
              </v-chip-group>
            </div>
          </div>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
  </div>
</template>

<script lang="ts" setup>
  import type { Iec61360DataType } from '#shared/aas/iec61360'
  import type { LangString } from '#shared/contract'
  import type { Json } from '~/utils/editor'
  import { iec61360DataTypes, measuredDataTypes } from '#shared/aas/iec61360'
  import { referenceIsEmpty, withField } from '~/utils/editor'
  import { errorsFor } from '~/utils/languages'

  // The content of one IEC 61360 data specification (MVP-6 plan, F3): the
  // same fields on concept descriptions, shells, submodels and elements.
  // Names, definition, type and unit come first; the rest is folded.
  const props = defineProps<{
    findings: ReadonlyArray<{ path: string, message: string }>
    /** The AAS Core path of this content, e.g. `embeddedDataSpecifications[0].dataSpecificationContent`. */
    prefix: string
    /** Concept descriptions need a definition in English (AASc-3a-008). */
    requireDefinition?: boolean
  }>()
  const content = defineModel<Json>({ required: true })

  const { t } = useI18n()
  const levelNames = ['min', 'nom', 'typ', 'max'] as const

  function str (field: string): string | null {
    const value = content.value[field]
    return typeof value === 'string' ? value : null
  }

  function langStrings (field: string): LangString[] {
    const value = content.value[field]
    return Array.isArray(value) ? value as LangString[] : []
  }

  const dataType = computed(() => str('dataType') as Iec61360DataType | null)

  function set (field: string, value: unknown) {
    content.value = withField(content.value, field, field === 'unitId' && referenceIsEmpty(value) ? undefined : value)
  }

  const needsUnit = computed(() => measuredDataTypes.includes(str('dataType') ?? '') && !str('unit') && referenceIsEmpty(content.value.unitId))
  const unitErrors = computed(() => errorsFor(props.findings, `${props.prefix}.unit`))

  const pairs = computed(() => ((content.value.valueList as { valueReferencePairs?: Json[] } | undefined)?.valueReferencePairs ?? []))
  // Chosen while the list is still empty, so an empty list keeps its editor open.
  const chosenMode = ref<'none' | 'value' | 'list' | null>(null)
  const valueMode = computed(() => {
    if (content.value.valueList !== undefined) {
      return 'list'
    }
    if (content.value.value !== undefined) {
      return 'value'
    }
    return chosenMode.value ?? 'none'
  })

  function setValueMode (mode: 'none' | 'value' | 'list') {
    chosenMode.value = mode
    const { value: _, valueList: __, ...rest } = content.value
    content.value = rest
  }

  const levels = computed(() => {
    const levelType = (content.value.levelType ?? {}) as Record<string, unknown>
    return levelNames.filter(level => levelType[level] === true)
  })

  /** A level type has all four flags; without any it is left out. */
  function setLevels (selected: string[]) {
    set('levelType', selected.length === 0 ? undefined : Object.fromEntries(levelNames.map(level => [level, selected.includes(level)])))
  }

  const moreCount = computed(() => ['shortName', 'sourceOfDefinition', 'valueFormat', 'value', 'valueList', 'levelType']
    .filter(field => content.value[field] !== undefined)
    .length)
  const openMore = ref<string[]>(moreCount.value > 0 ? ['more'] : [])
</script>
