<template>
  <v-form-fields>
    <FormSection :title="t('editor.sections.basics')">
      <v-text-field
        :autofocus="autofocus"
        :error-messages="idShortErrors"
        :hint="t('editor.idShortHint')"
        :label="t('details.idShort')"
        :model-value="String(shell.idShort ?? '')"
        persistent-hint
        @update:model-value="text => set('idShort', text)"
      />

      <v-text-field
        v-if="identifier"
        :error-messages="errorsFor(findings, 'id')"
        :hint="t('wizard.generatedIdHint')"
        :label="t('shell.identifier')"
        :model-value="String(shell.id ?? '')"
        persistent-hint
        @update:model-value="text => set('id', text)"
      />
    </FormSection>

    <FormSection :hint="t('shell.assetHint')" :title="t('shell.asset')">
      <v-btn-toggle
        class="align-self-start"
        mandatory
        :model-value="String(asset.assetKind ?? 'Instance')"
        @update:model-value="kind => setAsset('assetKind', kind)"
      >
        <v-btn v-for="kind in assetKinds" :key="kind" :text="t(`editor.assetKinds.${kind}`)" :value="kind" />
      </v-btn-toggle>

      <div class="d-flex align-start ga-3">
        <v-text-field
          class="flex-grow-1"
          :error-messages="errorsFor(findings, 'assetInformation')"
          :hint="identifier ? t('wizard.generatedHint') : undefined"
          :label="t('shell.globalAssetId')"
          :model-value="String(asset.globalAssetId ?? '')"
          :persistent-hint="identifier"
          @update:model-value="text => setAsset('globalAssetId', text)"
        />

        <v-text-field
          :label="t('shell.assetType')"
          :model-value="String(asset.assetType ?? '')"
          @update:model-value="text => setAsset('assetType', text)"
        />
      </div>

      <div class="text-body-medium">{{ t('shell.specificAssetIds') }}</div>

      <div v-for="(entry, index) in specificAssetIds" :key="index" class="d-flex align-start ga-3">
        <v-text-field :label="t('shell.specificName')" :model-value="String(entry.name ?? '')" @update:model-value="text => setSpecific(index, { name: text })" />
        <v-text-field :label="t('editor.qualifierValue')" :model-value="String(entry.value ?? '')" @update:model-value="text => setSpecific(index, { value: text })" />

        <v-btn
          :aria-label="t('editor.remove')"
          class="mt-2"
          icon="mdi-close"
          size="small"
          @click="setAsset('specificAssetIds', specificAssetIds.filter((_, position) => position !== index))"
        />
      </div>

      <v-btn
        class="align-self-start"
        prepend-icon="mdi-plus"
        size="small"
        :text="t('shell.addSpecific')"
        @click="setAsset('specificAssetIds', [...specificAssetIds, { name: '', value: '' }])"
      />

      <v-file-input
        v-if="canUpload"
        accept="image/*"
        :label="t('shell.thumbnail')"
        prepend-icon=""
        prepend-inner-icon="mdi-image-outline"
        @update:model-value="file => emit('thumbnail', file)"
      />
    </FormSection>

    <FormSection v-model:open="openNames" :badge="hasNames ? '✓' : undefined" collapsible :title="t('editor.sections.names')">
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

      <v-combobox
        clearable
        :items="categories"
        :label="t('details.category')"
        :model-value="String(shell.category ?? '')"
        @update:model-value="value => set('category', value)"
      />
    </FormSection>

    <FormSection v-model:open="openDerived" collapsible :hint="t('shell.derivedHint')" :title="t('shell.derivedFrom')">
      <ReferenceInput
        :label="t('shell.derivedFrom')"
        :model-value="shell.derivedFrom"
        @update:model-value="reference => set('derivedFrom', reference)"
      />
    </FormSection>

    <DataSpecificationsInput
      :findings="findings"
      :model-value="list('embeddedDataSpecifications')"
      :name="String(shell.idShort ?? '')"
      @update:model-value="specifications => set('embeddedDataSpecifications', specifications)"
    />

    <FormSection v-model:open="openAdmin" collapsible :title="t('shell.administration')">
      <div class="d-flex align-start ga-3">
        <v-text-field :label="t('details.version')" :model-value="String(administration.version ?? '')" @update:model-value="text => setAdministration('version', text)" />
        <v-text-field :label="t('shell.revisionLabel')" :model-value="String(administration.revision ?? '')" @update:model-value="text => setAdministration('revision', text)" />
      </div>
    </FormSection>
  </v-form-fields>
</template>

<script lang="ts" setup>
  import type { LangString } from '#shared/contract'
  import type { Json } from '~/utils/editor'
  import { withField } from '~/utils/editor'
  import { categories, errorsFor, idShortPattern } from '~/utils/languages'

  // The fields of a shell, for editing an existing one and for creating a new
  // one (the wizard): the same inputs, sections and guidance in both.
  const props = defineProps<{
    findings?: Array<{ path: string, message: string }>
    /** Offer the identifier field (creation; an existing shell's ID cannot change). */
    identifier?: boolean
    canUpload?: boolean
    autofocus?: boolean
  }>()
  const shell = defineModel<Json>({ required: true })
  const emit = defineEmits<{ thumbnail: [file: File | File[] | null | undefined] }>()

  const { t } = useI18n()
  const assetKinds = ['Instance', 'Type', 'NotApplicable']
  const findings = computed(() => props.findings ?? [])

  const asset = computed(() => (shell.value.assetInformation ?? {}) as Json)
  const administration = computed(() => (shell.value.administration ?? {}) as Json)
  const specificAssetIds = computed(() => (Array.isArray(asset.value.specificAssetIds) ? asset.value.specificAssetIds : []) as Json[])

  const idShortErrors = computed(() => {
    const id = String(shell.value.idShort ?? '')
    return errorsFor(findings.value, 'idShort').concat(id !== '' && !idShortPattern.test(id) ? [t('editor.idShortInvalid')] : [])
  })

  function langStrings (field: string): LangString[] {
    const value = shell.value[field]
    return Array.isArray(value) ? value as LangString[] : []
  }

  const hasNames = computed(() => langStrings('displayName').length > 0 || langStrings('description').length > 0 || Boolean(shell.value.category))
  const openNames = ref(hasNames.value)
  const openDerived = ref(Boolean(shell.value.derivedFrom))
  const openAdmin = ref(Boolean(shell.value.administration))

  function list (field: string): Json[] {
    const value = shell.value[field]
    return Array.isArray(value) ? value as Json[] : []
  }

  function set (field: string, value: unknown) {
    shell.value = withField(shell.value, field, value)
  }
  const setAsset = (field: string, value: unknown) => set('assetInformation', withField(asset.value, field, value))
  const setAdministration = (field: string, value: unknown) => set('administration', withField(administration.value, field, value))
  const setSpecific = (index: number, patch: Json) => setAsset('specificAssetIds', specificAssetIds.value.map((entry, position) => position === index ? { ...entry, ...patch } : entry))
</script>
