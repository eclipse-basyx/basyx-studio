<template>
  <v-dialog v-model="open" max-width="720" persistent scrollable>
    <DialogCard :title="t('wizard.addSubmodels')">
      <SubmodelSourcesForm v-model="sources" :target-id="targetId" />

      <v-alert v-if="steps.length > 0" class="mt-3" :title="t('wizard.partial')" type="warning">
        <ul class="ps-4">
          <li v-for="step in steps" :key="`${step.resource}:${step.id}`">
            {{ t(`wizard.resource.${step.resource}`) }} {{ step.id }}: {{ step.outcome }}<span v-if="step.detail"> ({{ step.detail }})</span>
          </li>
        </ul>
      </v-alert>

      <ProblemAlert v-if="error" class="mt-3" :error="error" />

      <template #actions>
        <v-btn :disabled="busy" :text="t('common.cancel')" @click="close" />
        <v-btn-primary :disabled="sources.length === 0" :loading="busy" :text="t('wizard.add')" @click="add" />
      </template>
    </DialogCard>
  </v-dialog>
</template>

<script lang="ts" setup>
  import type { SubmodelSource, SyncStep } from '#shared/contract'
  import { StudioApiError } from '~/composables/useStudioApi'

  // Adds submodels to an open shell: from templates, empty or from JSON
  // (MVP-5 plan, U3, T1). One request per submodel, each reporting its steps.
  const props = defineProps<{ targetId: string, shellKey: string }>()
  const emit = defineEmits<{ added: [] }>()
  const open = defineModel<boolean>({ required: true })

  const { t } = useI18n()
  const api = useStudioApi()
  const sources = ref<SubmodelSource[]>([])
  const busy = ref(false)
  const error = ref<unknown>(null)
  const steps = ref<SyncStep[]>([])
  // What earlier attempts wrote, so a retry adds only the rest (see pendingAdditions).
  const written = new Map<string, SubmodelSource | null>()

  async function addOne (key: string, source: SubmodelSource) {
    try {
      await api(`/targets/${props.targetId}/shells/${props.shellKey}/submodel-refs`, { method: 'POST', body: { submodel: source } })
      written.set(key, null)
    } catch (error_) {
      // The submodel exists, its reference does not: a retry only references it.
      const created = error_ instanceof StudioApiError
        ? (error_.problem?.steps as SyncStep[] | undefined)?.find(step => step.resource === 'submodel' && step.outcome === 'written')
        : undefined
      if (created) {
        written.set(key, { source: 'existing', id: created.id })
      }
      throw error_
    }
  }

  async function add () {
    busy.value = true
    error.value = null
    steps.value = []
    try {
      for (const { key, source } of pendingAdditions(sources.value, written)) {
        await addOne(key, source)
      }
      emit('added')
      close()
    } catch (error_) {
      error.value = error_
      if (error_ instanceof StudioApiError && error_.problem?.steps) {
        steps.value = error_.problem.steps as SyncStep[]
      }
      // What was written stays; the tree shows it.
      emit('added')
    } finally {
      busy.value = false
    }
  }

  function close () {
    open.value = false
    sources.value = []
    steps.value = []
    error.value = null
    written.clear()
  }
</script>
