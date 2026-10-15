<template>
  <v-dialog v-model="open" max-width="720" persistent scrollable>
    <DialogCard :title="t('cd.newTitle')">
      <ConceptDescriptionFields
        v-model="conceptDescription"
        autofocus
        :findings="findings"
        identifier
      />

      <v-alert
        v-if="leftover.length > 0"
        class="mt-3"
        :title="t('editor.findings')"
        type="error"
      >
        <ul class="ps-4 text-body-medium">
          <li v-for="finding in leftover" :key="`${finding.path}:${finding.message}`">
            <span v-if="finding.path" class="font-weight-medium">{{ finding.path }}: </span>{{ finding.message }}
          </li>
        </ul>
      </v-alert>

      <ProblemAlert v-else-if="error && findings.length === 0" class="mt-3" :error="error" />

      <template #actions>
        <v-btn :disabled="busy" :text="t('common.cancel')" @click="open = false" />
        <v-btn-primary :disabled="idShortInvalid" :loading="busy" :text="t('cd.create')" @click="create" />
      </template>
    </DialogCard>
  </v-dialog>
</template>

<script lang="ts" setup>
  import type { ConceptDescriptionDetail } from '#shared/contract'
  import type { Json } from '~/utils/editor'
  import { newConceptDescription } from '#shared/aas/iec61360'
  import { StudioApiError } from '~/composables/useStudioApi'
  import { idShortPattern, unclaimed } from '~/utils/languages'

  // Creates a concept description (MVP-6 plan, L4): empty, or prefilled from
  // an element's semantic ID (E3). The same fields as the drawer's form.
  const props = defineProps<{
    targetId: string
    /** The starting point; an empty concept description without it. */
    initial?: Json | null
  }>()
  const emit = defineEmits<{ created: [detail: ConceptDescriptionDetail] }>()
  const open = defineModel<boolean>({ required: true })

  const { t } = useI18n()
  const api = useStudioApi()

  const conceptDescription = ref<Json>({})
  const busy = ref(false)
  const error = ref<unknown>(null)

  watch(open, value => {
    if (value) {
      // An empty ID lets Studio generate one by the infrastructure's scheme.
      conceptDescription.value = structuredClone(toRaw(props.initial)) ?? newConceptDescription('', '')
      error.value = null
    }
  }, { immediate: true })

  const findings = computed(() => {
    const problem = error.value instanceof StudioApiError ? error.value.problem : null
    if (problem?.code === 'identifier_conflict') {
      return [{ path: 'id', message: t('cd.idTaken') }]
    }
    return problem?.code === 'validation_failed' ? (problem.violations ?? [{ path: '', message: problem.detail ?? problem.title }]) : []
  })
  const leftover = computed(() => unclaimed(findings.value, ['idShort', 'id', 'isCaseOf', 'embeddedDataSpecifications']))
  const idShortInvalid = computed(() => String(conceptDescription.value.idShort ?? '') !== '' && !idShortPattern.test(String(conceptDescription.value.idShort ?? '')))

  async function create () {
    busy.value = true
    error.value = null
    try {
      const result = await api<ConceptDescriptionDetail>(`/targets/${props.targetId}/concept-descriptions`, {
        method: 'POST',
        body: { conceptDescription: conceptDescription.value },
      })
      open.value = false
      emit('created', result)
    } catch (error_) {
      error.value = error_
    } finally {
      busy.value = false
    }
  }
</script>
