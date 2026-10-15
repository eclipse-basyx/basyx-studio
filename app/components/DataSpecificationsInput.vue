<template>
  <FormSection
    v-model:open="open"
    :badge="specifications.length || undefined"
    collapsible
    :hint="t('dataSpec.hint')"
    :title="t('dataSpec.title')"
  >
    <div v-for="(specification, index) in specifications" :key="index" class="d-flex flex-column ga-3">
      <div class="d-flex align-center">
        <v-icon class="me-2" icon="mdi-book-information-variant" size="18" />
        <span class="text-body-medium font-weight-medium">{{ isIec61360(specification) ? 'IEC 61360' : contentType(specification) }}</span>
        <v-spacer />

        <v-btn
          v-tooltip="t('dataSpec.remove')"
          :aria-label="t('dataSpec.remove')"
          icon="mdi-close"
          size="small"
          @click="specifications = specifications.filter((_, position) => position !== index)"
        />
      </div>

      <Iec61360Fields
        v-if="isIec61360(specification)"
        :findings="findings ?? []"
        :model-value="specification.dataSpecificationContent as Json"
        :prefix="`embeddedDataSpecifications[${index}].dataSpecificationContent`"
        :require-definition="requireDefinition"
        @update:model-value="next => change(index, next)"
      />

      <!-- AAS 3.1 knows no other content; whatever a server sends is kept as it is. -->
      <div v-else class="text-body-small text-medium-emphasis">{{ t('dataSpec.unsupported') }}</div>

      <v-divider v-if="index < specifications.length - 1" />
    </div>

    <div v-for="message in unclaimedErrors" :key="message" class="text-body-small text-error">{{ message }}</div>

    <v-btn
      class="align-self-start"
      prepend-icon="mdi-plus"
      size="small"
      :text="t('dataSpec.add')"
      @click="add"
    />
  </FormSection>
</template>

<script lang="ts" setup>
  import type { Json } from '~/utils/editor'
  import { isIec61360, newIec61360 } from '#shared/aas/iec61360'
  import { errorsFor, unclaimed } from '~/utils/languages'

  // Embedded data specifications (MVP-6 plan, F2): one section for concept
  // descriptions, shells, submodels and elements. Studio edits IEC 61360
  // content, the only kind AAS 3.1 defines.
  const props = defineProps<{
    findings?: ReadonlyArray<{ path: string, message: string }>
    /** The preferred name a new entry starts with, e.g. the idShort. */
    name?: string
    requireDefinition?: boolean
  }>()
  const specifications = defineModel<Json[]>({ required: true })

  const { t } = useI18n()
  const open = ref(specifications.value.length > 0 || Boolean(props.requireDefinition))

  function contentType (specification: Json): string {
    return String((specification.dataSpecificationContent as Json | undefined)?.modelType ?? t('dataSpec.unknown'))
  }

  function change (index: number, content: Json) {
    specifications.value = specifications.value.map((specification, position) => position === index ? { ...specification, dataSpecificationContent: content } : specification)
  }

  /** In English, which IEC 61360 requires (AASc-3a-002); translations are added in the field. */
  function add () {
    specifications.value = [...specifications.value, newIec61360(props.name || t('dataSpec.newName'))]
    open.value = true
  }

  // Findings on an entry that no field shows (its reference, the content as a
  // whole); the forms around leave everything under this section to it.
  const contentFields = ['preferredName', 'definition', 'dataType', 'unit', 'unitId', 'symbol', 'shortName', 'sourceOfDefinition', 'valueFormat', 'value', 'valueList']
  const unclaimedErrors = computed(() => {
    const own = (props.findings ?? []).filter(finding => errorsFor([finding], 'embeddedDataSpecifications').length > 0)
    const shown = specifications.value.flatMap((_, index) => contentFields.map(field => `embeddedDataSpecifications[${index}].dataSpecificationContent.${field}`))
    return unclaimed(own, shown).map(finding => finding.message)
  })
</script>
