<template>
  <v-form class="d-flex flex-column" @submit.prevent="apply()">
    <div class="px-4">
      <ConceptDescriptionFields :findings="findings" :model-value="working" @update:model-value="store" />

      <v-alert
        v-if="leftover.length > 0"
        class="my-3"
        :title="t('editor.findings')"
        type="error"
      >
        <ul class="ps-4 text-body-medium">
          <li v-for="finding in leftover" :key="`${finding.path}:${finding.message}`">
            <span v-if="finding.path" class="font-weight-medium">{{ finding.path }}: </span>{{ finding.message }}
          </li>
        </ul>
      </v-alert>

      <v-alert v-if="conflict" class="my-3" :title="t('cd.conflictTitle')" type="warning">
        <div class="text-body-medium">{{ t('editor.conflictText') }}</div>

        <div class="d-flex flex-wrap ga-2 mt-3">
          <v-btn :text="t('editor.overwrite')" @click="overwrite" />
          <v-btn :text="t('editor.discard')" @click="discard" />
        </div>
      </v-alert>

      <ProblemAlert v-else-if="error && findings.length === 0" class="my-3" :error="error" />
    </div>

    <FormActions
      :apply-text="t('editor.apply')"
      :blocked="conflict || idShortInvalid"
      :busy="applying"
      :dirty="dirty"
      :message="appliedMessage"
      @apply="apply"
      @discard="discard"
    />
  </v-form>
</template>

<script lang="ts" setup>
  import type { ConceptDescriptionDetail } from '#shared/contract'
  import type { Json } from '~/utils/editor'
  import { StudioApiError } from '~/composables/useStudioApi'
  import { conceptDescriptionDraftSlot } from '~/stores/drafts'
  import { idShortPattern, unclaimed } from '~/utils/languages'

  // The concept description form of the details drawer (MVP-6 plan, F1, W5):
  // a draft of the whole concept description, applied with the revision it
  // is based on, as `SubmodelForm` does for submodels.
  const props = defineProps<{
    targetId: string
    detail: ConceptDescriptionDetail
    explicitSave: boolean
  }>()
  const emit = defineEmits<{ changed: [detail: ConceptDescriptionDetail] }>()

  const { t } = useI18n()
  const api = useStudioApi()
  const drafts = useDraftStore()

  const slot = computed(() => conceptDescriptionDraftSlot(props.detail.key))
  const draftKey = 'concept-description'
  const source = computed(() => props.detail.conceptDescription as Json)
  const draft = computed(() => drafts.get(props.targetId, slot.value, draftKey))
  const working = computed<Json>(() => draft.value?.value ?? source.value)
  const dirty = computed(() => draft.value !== undefined)
  const idShortInvalid = computed(() => String(working.value.idShort ?? '') !== '' && !idShortPattern.test(String(working.value.idShort ?? '')))
  const leftover = computed(() => unclaimed(findings.value, ['idShort', 'id', 'isCaseOf', 'embeddedDataSpecifications']))

  const applying = ref(false)
  const error = ref<unknown>(null)
  const conflict = ref(false)
  const appliedMessage = ref<string | null>(null)

  const findings = computed(() => {
    const problem = error.value instanceof StudioApiError ? error.value.problem : null
    return problem?.code === 'validation_failed' ? (problem.violations ?? [{ path: '', message: problem.detail ?? problem.title }]) : []
  })

  function url () {
    return `/targets/${props.targetId}/concept-descriptions/${props.detail.key}`
  }

  function store (next: Json) {
    appliedMessage.value = null
    error.value = null
    if (JSON.stringify(next) === JSON.stringify(source.value)) {
      drafts.discard(props.targetId, slot.value, draftKey)
      return
    }
    drafts.set(props.targetId, slot.value, draftKey, { revision: draft.value?.revision ?? props.detail.revision!, value: next })
  }

  async function apply () {
    if (!draft.value) {
      return
    }
    applying.value = true
    error.value = null
    try {
      const result = await api<ConceptDescriptionDetail>(url(), {
        method: 'PUT',
        headers: { 'If-Match': `"${draft.value.revision}"` },
        body: { conceptDescription: draft.value.value },
      })
      drafts.discard(props.targetId, slot.value, draftKey)
      appliedMessage.value = t(props.explicitSave ? 'editor.appliedUnsaved' : 'editor.applied')
      emit('changed', result)
    } catch (error_) {
      conflict.value = error_ instanceof StudioApiError && error_.code === 'revision_conflict'
      error.value = error_
    } finally {
      applying.value = false
    }
  }

  /** Bases the draft on the current concept description and applies it deliberately. */
  async function overwrite () {
    if (!draft.value) {
      return
    }
    const current = await api<ConceptDescriptionDetail>(url())
    drafts.set(props.targetId, slot.value, draftKey, { revision: current.revision!, value: draft.value.value })
    conflict.value = false
    await apply()
  }

  function discard () {
    drafts.discard(props.targetId, slot.value, draftKey)
    conflict.value = false
    error.value = null
  }

  watch(slot, () => {
    conflict.value = false
    error.value = null
    appliedMessage.value = null
  })
</script>
