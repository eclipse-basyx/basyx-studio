<template>
  <v-form class="d-flex flex-column" @submit.prevent="apply()">
    <v-form-fields class="px-4">
      <!-- Basics: what the user came for, nothing else in the way. -->
      <FormSection :title="t('editor.sections.basics')">
        <v-text-field
          v-if="named"
          :autofocus="creating"
          :counter="creating || undefined"
          :error-messages="idShortErrors"
          :hint="t('editor.idShortHint')"
          :label="t('details.idShort')"
          :model-value="String(working.idShort ?? '')"
          persistent-hint
          @update:model-value="text => set('idShort', text)"
        />

        <template v-if="modelType === 'Property'">
          <div class="d-flex align-start ga-3">
            <v-text-field
              class="flex-grow-1"
              :error-messages="errorsFor(violations, 'value')"
              :label="t('editor.value')"
              :model-value="String(working.value ?? '')"
              :placeholder="t('editor.emptyValue')"
              @update:model-value="text => set('value', text)"
            />

            <v-select
              class="flex-grow-0"
              :disabled="valueTypeLocked"
              :error-messages="errorsFor(violations, 'valueType')"
              :items="valueTypes"
              :label="t('details.valueType')"
              :model-value="str('valueType')"
              width="170"
              @update:model-value="type => set('valueType', type)"
            />
          </div>
        </template>

        <LangStringsInput
          v-else-if="modelType === 'MultiLanguageProperty'"
          :label="t('editor.value')"
          :model-value="langStrings('value')"
          @update:model-value="strings => set('value', strings)"
        />

        <template v-else-if="modelType === 'Range'">
          <div class="d-flex align-start ga-3">
            <v-text-field :error-messages="errorsFor(violations, 'min')" :label="t('editor.min')" :model-value="String(working.min ?? '')" @update:model-value="text => set('min', text)" />
            <v-text-field :error-messages="errorsFor(violations, 'max')" :label="t('editor.max')" :model-value="String(working.max ?? '')" @update:model-value="text => set('max', text)" />

            <v-select
              class="flex-grow-0"
              :disabled="valueTypeLocked"
              :items="valueTypes"
              :label="t('details.valueType')"
              :model-value="str('valueType')"
              width="170"
              @update:model-value="type => set('valueType', type)"
            />
          </div>
        </template>

        <template v-else-if="modelType === 'File' || modelType === 'Blob'">
          <div class="d-flex align-start ga-3">
            <v-text-field
              v-if="modelType === 'File'"
              class="flex-grow-1"
              :error-messages="errorsFor(violations, 'value')"
              :label="t('editor.filePath')"
              :model-value="String(working.value ?? '')"
              @update:model-value="text => set('value', text)"
            />

            <v-text-field
              class="flex-grow-0"
              :error-messages="errorsFor(violations, 'contentType')"
              :label="t('details.contentType')"
              :model-value="String(working.contentType ?? '')"
              width="220"
              @update:model-value="text => set('contentType', text)"
            />
          </div>

          <div v-if="modelType === 'Blob'" class="text-body-small text-medium-emphasis">{{ t('editor.blobHint') }}</div>
        </template>

        <ReferenceInput
          v-else-if="modelType === 'ReferenceElement'"
          :error-messages="errorsFor(violations, 'value')"
          :label="t('details.references')"
          :model-value="working.value"
          @update:model-value="reference => set('value', reference)"
        />

        <template v-else-if="modelType === 'RelationshipElement' || modelType === 'AnnotatedRelationshipElement'">
          <ReferenceInput
            :error-messages="errorsFor(violations, 'first')"
            :label="t('details.first')"
            :model-value="working.first"
            required
            @update:model-value="reference => set('first', reference)"
          />

          <ReferenceInput
            :error-messages="errorsFor(violations, 'second')"
            :label="t('details.second')"
            :model-value="working.second"
            required
            @update:model-value="reference => set('second', reference)"
          />
        </template>

        <template v-else-if="modelType === 'Entity'">
          <div class="d-flex align-start ga-3">
            <v-select
              class="flex-grow-0"
              :items="entityTypes"
              :label="t('details.entityType')"
              :model-value="str('entityType')"
              width="220"
              @update:model-value="type => set('entityType', type)"
            />

            <v-text-field
              class="flex-grow-1"
              :error-messages="errorsFor(violations, 'globalAssetId')"
              :label="t('shell.globalAssetId')"
              :model-value="String(working.globalAssetId ?? '')"
              @update:model-value="text => set('globalAssetId', text)"
            />
          </div>
        </template>

        <template v-else-if="modelType === 'SubmodelElementList'">
          <div class="d-flex align-start ga-3">
            <v-select
              :disabled="hasChildren"
              :hint="hasChildren ? t('editor.listTypeLocked') : undefined"
              :items="listElementTypes"
              :label="t('editor.listType')"
              :model-value="str('typeValueListElement')"
              :persistent-hint="hasChildren"
              @update:model-value="type => set('typeValueListElement', type)"
            />

            <v-select
              v-if="working.typeValueListElement === 'Property' || working.typeValueListElement === 'Range'"
              :disabled="hasChildren"
              :items="valueTypes"
              :label="t('details.valueType')"
              :model-value="str('valueTypeListElement')"
              @update:model-value="type => set('valueTypeListElement', type)"
            />
          </div>

          <v-switch
            :label="t('editor.orderRelevant')"
            :model-value="working.orderRelevant !== false"
            @update:model-value="value => set('orderRelevant', value ? undefined : false)"
          />
        </template>

        <template v-else-if="modelType === 'BasicEventElement'">
          <ReferenceInput
            :label="t('details.observed')"
            :model-value="working.observed"
            required
            @update:model-value="reference => set('observed', reference)"
          />

          <div class="d-flex align-start ga-3">
            <v-select :items="eventDirections" :label="t('editor.direction')" :model-value="str('direction')" @update:model-value="direction => set('direction', direction)" />
            <v-select :items="eventStates" :label="t('editor.state')" :model-value="str('state')" @update:model-value="state => set('state', state)" />
            <v-text-field :label="t('editor.messageTopic')" :model-value="String(working.messageTopic ?? '')" @update:model-value="text => set('messageTopic', text)" />
          </div>
        </template>

        <div v-else class="text-body-medium text-medium-emphasis">{{ t('editor.noValue', { type: modelType }) }}</div>
      </FormSection>

      <FormSection v-model:open="openNames" :badge="namesBadge" collapsible :title="t('editor.sections.names')">
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
          :hint="t('editor.categoryHint')"
          :items="categories"
          :label="t('details.category')"
          :model-value="String(working.category ?? '')"
          persistent-hint
          @update:model-value="value => set('category', value)"
        />
      </FormSection>

      <FormSection v-model:open="openSemantics" collapsible :hint="t('editor.semanticsHint')" :title="t('editor.sections.semantics')">
        <!-- Point the semantic ID at a concept description of this target (MVP-6 plan, E5). -->
        <template v-if="linkConcepts" #actions>
          <v-btn
            prepend-icon="mdi-link-variant"
            size="small"
            :text="t('cd.link')"
            @click.stop="linking = true"
          />
        </template>

        <ReferenceInput
          :error-messages="errorsFor(violations, 'semanticId')"
          :label="t('details.semanticId')"
          :model-value="working.semanticId"
          @update:model-value="reference => set('semanticId', reference)"
        />
      </FormSection>

      <FormSection v-model:open="openSupplemental" :badge="supplemental.length || undefined" collapsible :title="t('editor.sections.supplemental')">
        <div v-for="(reference, index) in supplemental" :key="index">
          <ReferenceInput
            :error-messages="errorsFor(violations, `supplementalSemanticIds[${index}]`)"
            :label="`${t('editor.supplementalSemanticId')} ${index + 1}`"
            :model-value="reference"
            removable
            required
            @update:model-value="value => setSupplemental(index, value)"
          />
        </div>

        <v-btn
          class="align-self-start"
          prepend-icon="mdi-plus"
          size="small"
          :text="t('editor.addSupplemental')"
          @click="set('supplementalSemanticIds', [...supplemental, { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: '' }] }])"
        />
      </FormSection>

      <ConceptDescriptionPickerDialog
        v-if="linkConcepts"
        v-model="linking"
        :current="semanticKey"
        :target-id="targetId"
        @pick="linkConcept"
      />

      <DataSpecificationsInput
        :findings="violations"
        :model-value="specifications"
        :name="String(working.idShort ?? '')"
        @update:model-value="list => set('embeddedDataSpecifications', list)"
      />

      <FormSection v-model:open="openQualifiers" :badge="qualifiers.length || undefined" collapsible :title="t('editor.sections.qualifiers')">
        <QualifiersInput :model-value="qualifiers" @update:model-value="list => set('qualifiers', list)" />
      </FormSection>

      <!-- Findings no field claims -->
      <v-alert
        v-if="leftover.length > 0"
        :title="t('editor.findings')"
        type="error"
      >
        <ul class="ps-4 text-body-medium">
          <li v-for="finding in leftover" :key="`${finding.path}:${finding.message}`">
            <span v-if="finding.path" class="font-weight-medium">{{ finding.path }}: </span>{{ finding.message }}
          </li>
        </ul>
      </v-alert>

      <v-alert v-if="conflict" :title="conflictTitle" type="warning">
        <div class="text-body-medium">{{ t('editor.conflictText') }}</div>

        <div class="d-flex flex-wrap ga-2 mt-3">
          <v-btn v-if="conflict.revision" :text="t('editor.overwrite')" @click="overwrite" />
          <v-btn :text="t('editor.discard')" @click="discard" />
        </div>
      </v-alert>

      <ProblemAlert v-else-if="error && violations.length === 0" :error="error" />

      <v-alert
        v-if="concurrency === 'best_effort'"
        icon="mdi-information-outline"
        type="info"
      >
        <div class="text-body-small">{{ t('editor.bestEffort') }}</div>
      </v-alert>
    </v-form-fields>

    <FormActions
      :apply-text="creating ? t('editor.create') : t('editor.apply')"
      :blocked="conflict !== null || idShortInvalid"
      :busy="applying"
      :creating="creating"
      :dirty="dirty"
      :message="appliedMessage"
      @apply="apply"
      @discard="creating ? cancel() : discard()"
    />
  </v-form>
</template>

<script lang="ts" setup>
  import type { ElementDetail, LangString } from '#shared/contract'
  import type { Json } from '~/utils/editor'
  import { StudioApiError } from '~/composables/useStudioApi'
  import { newElementDraftKey } from '~/stores/drafts'
  import { entityTypes, eventDirections, eventStates, listElementTypes, valueTypes, withField } from '~/utils/editor'
  import { categories, errorsFor, idShortPattern, unclaimed } from '~/utils/languages'

  // The element form of the edit area (MVP-5 plan, U1, U2): the sections of
  // the element's type, a draft of the whole element, and findings from AAS
  // Core before and after applying. It edits an existing element, or with
  // `create` a new one under a parent that is written on apply (U4).
  const props = defineProps<{
    targetId: string
    submodelKey: string
    /** The element to edit; absent when creating. */
    detail?: ElementDetail
    /** A new element: its parent (`null` for the top level), revision and position. */
    create?: { parentKey: string | null, structureRevision: string, index: number | null, element: Json, isListChild: boolean }
    /** Applied changes need an explicit save of the workspace. */
    explicitSave: boolean
    /** The target has concept descriptions to link the semantic ID to. */
    linkConcepts?: boolean
  }>()
  const emit = defineEmits<{
    /** The element changed at its source; reload what shows it. */
    changed: [detail: ElementDetail]
    created: [detail: ElementDetail]
    cancel: []
  }>()

  const { t } = useI18n()
  const api = useStudioApi()
  const drafts = useDraftStore()

  const creating = computed(() => props.create !== undefined)
  const draftKey = computed(() => props.create ? newElementDraftKey(props.create.parentKey) : props.detail!.key)
  const source = computed<Json>(() => props.create ? props.create.element : props.detail!.value as Json)
  const draft = computed(() => drafts.get(props.targetId, props.submodelKey, draftKey.value))
  const working = computed<Json>(() => draft.value?.value ?? source.value)
  const dirty = computed(() => draft.value !== undefined)
  const concurrency = computed(() => props.detail?.concurrency ?? null)

  const modelType = computed(() => String(working.value.modelType ?? ''))
  // List children have no idShort of their own; they are addressed by position.
  const inList = computed(() => props.create ? props.create.isListChild : String(props.detail?.path).endsWith(']'))
  const named = computed(() => !inList.value)
  // Elements in a typed list take the list's value type.
  const valueTypeLocked = inList
  const hasChildren = computed(() => Array.isArray(source.value.value) && source.value.value.length > 0)
  const qualifiers = computed(() => (Array.isArray(working.value.qualifiers) ? working.value.qualifiers : []) as Array<Record<string, unknown>>)
  const violations = computed(() => findings.value)
  const handledFields = ['idShort', 'value', 'valueType', 'min', 'max', 'contentType', 'first', 'second', 'semanticId', 'globalAssetId', 'supplementalSemanticIds', 'embeddedDataSpecifications']
  const leftover = computed(() => unclaimed(violations.value, handledFields))

  const idShortErrors = computed(() => {
    const id = String(working.value.idShort ?? '')
    if (errorsFor(violations.value, 'idShort').length > 0) {
      return errorsFor(violations.value, 'idShort')
    }
    return id !== '' && !idShortPattern.test(id) ? [t('editor.idShortInvalid')] : []
  })
  const idShortInvalid = computed(() => named.value && (String(working.value.idShort ?? '') === '' || !idShortPattern.test(String(working.value.idShort ?? ''))))

  // Closed groups say whether they hold something; a group with content starts open.
  const hasNames = computed(() => langStrings('displayName').length > 0 || langStrings('description').length > 0 || Boolean(working.value.category))
  const namesBadge = computed(() => hasNames.value ? '✓' : undefined)
  const openNames = ref(hasNames.value)
  const openSemantics = ref(Boolean(source.value.semanticId))
  const openQualifiers = ref(qualifiers.value.length > 0)
  const supplemental = computed(() => (Array.isArray(working.value.supplementalSemanticIds) ? working.value.supplementalSemanticIds : []) as unknown[])
  const openSupplemental = ref(supplemental.value.length > 0)
  const specifications = computed(() => (Array.isArray(working.value.embeddedDataSpecifications) ? working.value.embeddedDataSpecifications : []) as Json[])

  // Linking sets the semantic ID to the concept description's ID, as a global reference.
  const linking = ref(false)
  const semanticKey = computed(() => (working.value.semanticId as { keys?: Array<{ value?: string }> } | undefined)?.keys?.[0]?.value ?? null)

  function linkConcept (id: string) {
    set('semanticId', { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: id }] })
    openSemantics.value = true
  }

  function setSupplemental (index: number, value: unknown) {
    set('supplementalSemanticIds', supplemental.value.map((entry, position) => position === index ? value : entry).filter(entry => entry !== null))
  }

  function str (field: string): string | null {
    const value = working.value[field]
    return typeof value === 'string' ? value : null
  }

  function langStrings (field: string): LangString[] {
    const value = working.value[field]
    return Array.isArray(value) ? value as LangString[] : []
  }

  const applying = ref(false)
  const error = ref<unknown>(null)
  const conflict = ref<ElementDetail | null>(null)
  const appliedMessage = ref<string | null>(null)

  const findings = computed(() => {
    const problem = error.value instanceof StudioApiError ? error.value.problem : null
    if (problem?.code !== 'validation_failed' && problem?.code !== 'idshort_conflict') {
      return []
    }
    if (problem.code === 'idshort_conflict') {
      return [{ path: 'idShort', message: problem.detail ?? problem.title }]
    }
    return problem.violations ?? [{ path: '', message: problem.detail ?? problem.title }]
  })
  const conflictTitle = computed(() => t(error.value instanceof StudioApiError && error.value.code === 'structure_conflict' ? 'editor.structureConflictTitle' : 'editor.conflictTitle'))

  /** The revision the draft is based on: kept from when the user started, even if the element reloads. */
  function revisionOf (): string {
    return draft.value?.revision ?? (props.create ? props.create.structureRevision : props.detail!.revision!)
  }

  function store (next: Json) {
    appliedMessage.value = null
    error.value = null
    if (!creating.value && JSON.stringify(next) === JSON.stringify(source.value)) {
      drafts.discard(props.targetId, props.submodelKey, draftKey.value)
      return
    }
    drafts.set(props.targetId, props.submodelKey, draftKey.value, { revision: revisionOf(), value: next })
  }

  function set (field: string, value: unknown) {
    store(withField(working.value, field, value))
  }

  function elementUrl () {
    return `/targets/${props.targetId}/submodels/${props.submodelKey}/elements`
  }

  async function apply () {
    if (!creating.value && !draft.value) {
      return
    }
    applying.value = true
    error.value = null
    try {
      if (props.create) {
        const result = await api<ElementDetail>(elementUrl(), {
          method: 'POST',
          headers: { 'If-Match': `"${revisionOf()}"` },
          body: { parentElementKey: props.create.parentKey ?? undefined, index: props.create.index ?? undefined, element: working.value },
        })
        drafts.discard(props.targetId, props.submodelKey, draftKey.value)
        emit('created', result)
        return
      }
      const result = await api<ElementDetail>(`${elementUrl()}/${props.detail!.key}`, {
        method: 'PUT',
        headers: { 'If-Match': `"${revisionOf()}"` },
        body: { element: working.value },
      })
      drafts.discard(props.targetId, props.submodelKey, draftKey.value)
      appliedMessage.value = t(props.explicitSave ? 'editor.appliedUnsaved' : 'editor.applied')
      emit('changed', result)
    } catch (error_) {
      const code = error_ instanceof StudioApiError ? error_.code : null
      if (code === 'revision_conflict' && props.detail) {
        conflict.value = await api<ElementDetail>(`${elementUrl()}/${props.detail.key}`).catch(() => null)
        if (conflict.value) {
          emit('changed', conflict.value)
        }
      }
      error.value = error_
    } finally {
      applying.value = false
    }
  }

  /** Bases the draft on the current revision and applies it deliberately. */
  async function overwrite () {
    if (!conflict.value?.revision || !draft.value) {
      return
    }
    drafts.set(props.targetId, props.submodelKey, draftKey.value, { revision: conflict.value.revision, value: draft.value.value })
    conflict.value = null
    await apply()
  }

  function discard () {
    drafts.discard(props.targetId, props.submodelKey, draftKey.value)
    conflict.value = null
    error.value = null
  }

  /** Abandons a new element: its draft goes too, so the next creation under this parent starts fresh. */
  function cancel () {
    discard()
    emit('cancel')
  }

  watch(draftKey, () => {
    conflict.value = null
    error.value = null
    appliedMessage.value = null
  })
</script>
