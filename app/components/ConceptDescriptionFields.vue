<template>
  <v-form-fields>
    <FormSection :title="t('editor.sections.basics')">
      <v-text-field
        :autofocus="autofocus"
        :error-messages="idShortErrors"
        :hint="t('editor.idShortHint')"
        :label="t('details.idShort')"
        :model-value="String(conceptDescription.idShort ?? '')"
        persistent-hint
        @update:model-value="text => set('idShort', text)"
      />

      <v-text-field
        v-if="identifier"
        :error-messages="errorsFor(findings, 'id')"
        :hint="t('cd.idHint')"
        :label="t('details.identifier')"
        :model-value="String(conceptDescription.id ?? '')"
        persistent-hint
        @update:model-value="text => set('id', text)"
      />
    </FormSection>

    <!-- The IEC 61360 content is what a concept description is for, so it comes first. -->
    <DataSpecificationsInput
      :findings="findings"
      :model-value="list('embeddedDataSpecifications')"
      :name="String(conceptDescription.idShort ?? '')"
      require-definition
      @update:model-value="specifications => set('embeddedDataSpecifications', specifications)"
    />

    <FormSection
      v-model:open="openNames"
      :badge="hasNames ? '✓' : undefined"
      collapsible
      :hint="t('cd.namesHint')"
      :title="t('editor.sections.names')"
    >
      <LangStringsInput
        :label="t('details.displayName')"
        :model-value="langStrings('displayName')"
        @update:model-value="strings => set('displayName', strings)"
      />

      <LangStringsInput
        :label="t('details.description')"
        :model-value="langStrings('description')"
        @update:model-value="strings => set('description', strings)"
      />
    </FormSection>

    <FormSection
      v-model:open="openCaseOf"
      :badge="caseOf.length || undefined"
      collapsible
      :hint="t('cd.isCaseOfHint')"
      :title="t('cd.isCaseOf')"
    >
      <div v-for="(reference, index) in caseOf" :key="index">
        <ReferenceInput
          :error-messages="errorsFor(findings, `isCaseOf[${index}]`)"
          :label="`${t('cd.isCaseOf')} ${index + 1}`"
          :model-value="reference"
          removable
          required
          @update:model-value="value => setCaseOf(index, value)"
        />
      </div>

      <v-btn
        class="align-self-start"
        prepend-icon="mdi-plus"
        size="small"
        :text="t('editor.addReference')"
        @click="set('isCaseOf', [...caseOf, { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: '' }] }])"
      />
    </FormSection>

    <FormSection v-model:open="openAdmin" collapsible :title="t('shell.administration')">
      <div class="d-flex align-start ga-3">
        <v-text-field :label="t('details.version')" :model-value="String(administration.version ?? '')" @update:model-value="text => set('administration', withField(administration, 'version', text))" />
        <v-text-field :label="t('shell.revisionLabel')" :model-value="String(administration.revision ?? '')" @update:model-value="text => set('administration', withField(administration, 'revision', text))" />
      </div>
    </FormSection>
  </v-form-fields>
</template>

<script lang="ts" setup>
  import type { LangString } from '#shared/contract'
  import type { Json } from '~/utils/editor'
  import { withField } from '~/utils/editor'
  import { errorsFor, idShortPattern } from '~/utils/languages'

  // The fields of a concept description (MVP-6 plan, F1), for editing in the
  // drawer and for creating in a dialog: the same inputs in both, as
  // `SubmodelFields` for submodels.
  const props = defineProps<{
    findings?: Array<{ path: string, message: string }>
    /** Offer the identifier field (creation; an existing ID cannot change). */
    identifier?: boolean
    autofocus?: boolean
  }>()
  const conceptDescription = defineModel<Json>({ required: true })

  const { t } = useI18n()
  const findings = computed(() => props.findings ?? [])

  const idShortErrors = computed(() => {
    const id = String(conceptDescription.value.idShort ?? '')
    return errorsFor(findings.value, 'idShort').concat(id !== '' && !idShortPattern.test(id) ? [t('editor.idShortInvalid')] : [])
  })

  function langStrings (field: string): LangString[] {
    const value = conceptDescription.value[field]
    return Array.isArray(value) ? value as LangString[] : []
  }

  function list (field: string): Json[] {
    const value = conceptDescription.value[field]
    return Array.isArray(value) ? value as Json[] : []
  }

  const hasNames = computed(() => langStrings('displayName').length > 0 || langStrings('description').length > 0)
  const caseOf = computed(() => list('isCaseOf'))
  const administration = computed(() => (conceptDescription.value.administration ?? {}) as Json)
  const openNames = ref(hasNames.value)
  const openCaseOf = ref(caseOf.value.length > 0)
  const openAdmin = ref(Boolean(conceptDescription.value.administration))

  function setCaseOf (index: number, value: unknown) {
    set('isCaseOf', caseOf.value.map((entry, position) => position === index ? value : entry).filter(entry => entry !== null))
  }

  function set (field: string, value: unknown) {
    conceptDescription.value = withField(conceptDescription.value, field, value)
  }
</script>
