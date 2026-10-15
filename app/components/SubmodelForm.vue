<template>
  <v-form class="d-flex flex-column" @submit.prevent="apply()">
    <div class="px-4">
      <SubmodelFields :findings="findings" :model-value="working" @update:model-value="store" />

      <v-alert
        v-if="leftover.length > 0"
        class="mb-3"
        density="compact"
        :title="t('editor.findings')"
        type="error"
      >
        <ul class="ps-4 text-body-medium">
          <li v-for="finding in leftover" :key="`${finding.path}:${finding.message}`">
            <span v-if="finding.path" class="font-weight-medium">{{ finding.path }}: </span>{{ finding.message }}
          </li>
        </ul>
      </v-alert>

      <v-alert v-if="conflict" class="mb-3" :title="t('editor.conflictTitle')" type="warning">
        <div class="text-body-medium">{{ t('editor.conflictText') }}</div>

        <div class="d-flex flex-wrap ga-2 mt-3">
          <v-btn :text="t('editor.overwrite')" @click="overwrite" />
          <v-btn :text="t('editor.discard')" @click="discard" />
        </div>
      </v-alert>

      <ProblemAlert v-else-if="error && findings.length === 0" class="mb-3" :error="error" />
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
  import type { ElementDetail, SubmodelDetail } from '#shared/contract'
  import type { Json } from '~/utils/editor'
  import { StudioApiError } from '~/composables/useStudioApi'
  import { idShortPattern, unclaimed } from '~/utils/languages'

  // The submodel form of the edit area (MVP-5 plan, U5): metadata only. The
  // elements stay as they are and are edited in the tree.
  const props = defineProps<{
    targetId: string
    submodelKey: string
    detail: ElementDetail
    explicitSave: boolean
  }>()
  const emit = defineEmits<{ changed: [detail: ElementDetail] }>()

  const { t } = useI18n()
  const api = useStudioApi()
  const drafts = useDraftStore()

  // Submodel metadata and elements have their own draft slot in the store.
  const draftKey = 'submodel'
  const source = computed(() => props.detail.value as Json)
  const draft = computed(() => drafts.get(props.targetId, props.submodelKey, draftKey))
  const working = computed<Json>(() => draft.value?.value ?? source.value)
  const dirty = computed(() => draft.value !== undefined)
  const idShortInvalid = computed(() => !idShortPattern.test(String(working.value.idShort ?? '')))
  const leftover = computed(() => unclaimed(findings.value, ['idShort', 'semanticId', 'embeddedDataSpecifications']))

  const applying = ref(false)
  const error = ref<unknown>(null)
  const conflict = ref(false)
  const appliedMessage = ref<string | null>(null)

  const findings = computed(() => {
    const problem = error.value instanceof StudioApiError ? error.value.problem : null
    return problem?.code === 'validation_failed' ? (problem.violations ?? [{ path: '', message: problem.detail ?? problem.title }]) : []
  })

  function store (next: Json) {
    appliedMessage.value = null
    error.value = null
    if (JSON.stringify(next) === JSON.stringify(source.value)) {
      drafts.discard(props.targetId, props.submodelKey, draftKey)
      return
    }
    drafts.set(props.targetId, props.submodelKey, draftKey, { revision: draft.value?.revision ?? props.detail.revision!, value: next })
  }

  async function apply () {
    if (!draft.value) {
      return
    }
    applying.value = true
    error.value = null
    try {
      const result = await api<SubmodelDetail>(`/targets/${props.targetId}/submodels/${props.submodelKey}`, {
        method: 'PUT',
        headers: { 'If-Match': `"${draft.value.revision}"` },
        body: { submodel: draft.value.value },
      })
      drafts.discard(props.targetId, props.submodelKey, draftKey)
      appliedMessage.value = t(props.explicitSave ? 'editor.appliedUnsaved' : 'editor.applied')
      emit('changed', { key: result.key, path: '', value: result.submodel, revision: result.revision ?? null, concurrency: props.detail.concurrency, ancestors: [] })
    } catch (error_) {
      conflict.value = error_ instanceof StudioApiError && error_.code === 'revision_conflict'
      error.value = error_
    } finally {
      applying.value = false
    }
  }

  /** Bases the draft on the current metadata and applies it deliberately. */
  async function overwrite () {
    if (!draft.value) {
      return
    }
    const current = await api<SubmodelDetail>(`/targets/${props.targetId}/submodels/${props.submodelKey}`)
    drafts.set(props.targetId, props.submodelKey, draftKey, { revision: current.revision!, value: draft.value.value })
    conflict.value = false
    await apply()
  }

  function discard () {
    drafts.discard(props.targetId, props.submodelKey, draftKey)
    conflict.value = false
    error.value = null
  }
</script>
