<template>
  <v-form class="d-flex flex-column" @submit.prevent="apply()">
    <div class="px-4">
      <ShellFields
        :can-upload="canUpload"
        :findings="findings"
        :model-value="working"
        @thumbnail="uploadThumbnail"
        @update:model-value="store"
      />

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
  import type { ShellDetail } from '#shared/contract'
  import type { Json } from '~/utils/editor'
  import { StudioApiError } from '~/composables/useStudioApi'
  import { idShortPattern, unclaimed } from '~/utils/languages'

  // The shell form (MVP-5 plan, U5): metadata, asset information, thumbnail,
  // derivedFrom and administration. The submodel references stay as they are;
  // adding and removing submodels is done in the tree.
  const props = defineProps<{ targetId: string, shell: ShellDetail, explicitSave: boolean, canUpload: boolean }>()
  const emit = defineEmits<{ changed: [detail: ShellDetail] }>()

  const { t } = useI18n()
  const api = useStudioApi()
  const drafts = useDraftStore()

  const slot = computed(() => ({ submodelKey: `shell:${props.shell.key}`, elementKey: 'shell' }))
  const source = computed(() => props.shell.shell as Json)
  const draft = computed(() => drafts.get(props.targetId, slot.value.submodelKey, slot.value.elementKey))
  const working = computed<Json>(() => draft.value?.value ?? source.value)
  const dirty = computed(() => draft.value !== undefined)
  const idShortInvalid = computed(() => String(working.value.idShort ?? '') !== '' && !idShortPattern.test(String(working.value.idShort ?? '')))
  const leftover = computed(() => unclaimed(findings.value, ['idShort', 'assetInformation', 'embeddedDataSpecifications']))

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
      drafts.discard(props.targetId, slot.value.submodelKey, slot.value.elementKey)
      return
    }
    drafts.set(props.targetId, slot.value.submodelKey, slot.value.elementKey, { revision: draft.value?.revision ?? props.shell.revision!, value: next })
  }

  async function apply () {
    if (!draft.value) {
      return
    }
    applying.value = true
    error.value = null
    try {
      const result = await api<ShellDetail>(`/targets/${props.targetId}/shells/${props.shell.key}`, {
        method: 'PUT',
        headers: { 'If-Match': `"${draft.value.revision}"` },
        body: { shell: draft.value.value },
      })
      drafts.discard(props.targetId, slot.value.submodelKey, slot.value.elementKey)
      appliedMessage.value = t(props.explicitSave ? 'editor.appliedUnsaved' : 'editor.applied')
      emit('changed', result)
    } catch (error_) {
      conflict.value = error_ instanceof StudioApiError && error_.code === 'revision_conflict'
      error.value = error_
    } finally {
      applying.value = false
    }
  }

  async function overwrite () {
    if (!draft.value) {
      return
    }
    const current = await api<ShellDetail>(`/targets/${props.targetId}/shells/${props.shell.key}`)
    drafts.set(props.targetId, slot.value.submodelKey, slot.value.elementKey, { revision: current.revision!, value: draft.value.value })
    conflict.value = false
    await apply()
  }

  function discard () {
    drafts.discard(props.targetId, slot.value.submodelKey, slot.value.elementKey)
    conflict.value = false
    error.value = null
  }

  async function uploadThumbnail (value: File | File[] | null | undefined) {
    const file = Array.isArray(value) ? value[0] : value
    if (!file) {
      return
    }
    error.value = null
    try {
      const result = await api<ShellDetail>(`/targets/${props.targetId}/shells/${props.shell.key}/thumbnail`, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        query: { fileName: file.name },
        body: file,
      })
      emit('changed', result)
    } catch (error_) {
      error.value = error_
    }
  }
</script>
