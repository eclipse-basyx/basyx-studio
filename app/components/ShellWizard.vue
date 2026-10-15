<template>
  <v-dialog v-model="open" max-width="760" persistent scrollable>
    <DialogCard :title="t('wizard.title')">
      <v-stepper v-model="step" alt-labels flat>
        <v-stepper-header>
          <v-stepper-item :complete="step > 1" :title="t('wizard.steps.shell')" :value="1" />
          <v-divider />
          <v-stepper-item :complete="step > 2" :title="t('wizard.steps.submodels')" :value="2" />
          <v-divider />
          <v-stepper-item :title="t('wizard.steps.review')" :value="3" />
        </v-stepper-header>

        <v-stepper-window>
          <v-stepper-window-item :value="1">
            <!-- The same fields as the form of an existing shell. -->
            <ShellFields v-model="shell" autofocus :findings="findings" identifier />
          </v-stepper-window-item>

          <v-stepper-window-item :value="2">
            <SubmodelSourcesForm v-model="sources" :target-id="targetId" />
          </v-stepper-window-item>

          <v-stepper-window-item :value="3">
            <div class="text-title-small mb-2">{{ t('wizard.willWrite') }}</div>

            <v-list lines="two">
              <v-list-item
                v-for="item in plan"
                :key="item.title"
                :prepend-icon="item.icon"
                :subtitle="item.subtitle"
                :title="item.title"
              />
            </v-list>

            <v-alert v-if="steps.length > 0" class="mt-3" :title="t('wizard.partial')" type="warning">
              <ul class="ps-4">
                <li v-for="stepResult in steps" :key="`${stepResult.resource}:${stepResult.id}`">
                  {{ t(`wizard.resource.${stepResult.resource}`) }} {{ stepResult.id }}: {{ stepResult.outcome }}<span v-if="stepResult.detail"> ({{ stepResult.detail }})</span>
                </li>
              </ul>
            </v-alert>

            <v-alert v-if="findings.length > 0" class="mt-3" :title="t('editor.findings')" type="error">
              <ul class="ps-4">
                <li v-for="finding in findings" :key="`${finding.path}:${finding.message}`">{{ finding.path }}: {{ finding.message }}</li>
              </ul>
            </v-alert>

            <ProblemAlert v-else-if="error" class="mt-3" :error="error" />
          </v-stepper-window-item>
        </v-stepper-window>
      </v-stepper>

      <template #actions>
        <v-btn :disabled="busy" :text="t('common.cancel')" @click="close" />
        <v-btn v-if="step > 1" :disabled="busy" :text="t('wizard.back')" @click="step--" />
        <v-btn-primary v-if="step < 3" :text="t('wizard.next')" @click="step++" />
        <v-btn-primary v-else :loading="busy" :text="t('wizard.create')" @click="create" />
      </template>
    </DialogCard>
  </v-dialog>
</template>

<script lang="ts" setup>
  import type { ShellCreateResult, SubmodelSource, SyncStep } from '#shared/contract'
  import { StudioApiError } from '~/composables/useStudioApi'

  // The creation wizard (MVP-5 plan, T3): shell and asset, submodels from
  // templates, review, create. Submodels are written first, then the shell,
  // then registries and discovery; a failure lists what was written.
  const props = defineProps<{ targetId: string }>()
  const emit = defineEmits<{ created: [result: ShellCreateResult] }>()
  const open = defineModel<boolean>({ required: true })

  const { t } = useI18n()
  const api = useStudioApi()

  const step = ref(1)
  const busy = ref(false)
  const error = ref<unknown>(null)
  const steps = ref<SyncStep[]>([])
  const sources = ref<SubmodelSource[]>([])
  const blankShell = (): Record<string, unknown> => ({ assetInformation: { assetKind: 'Instance' } })
  const shell = ref<Record<string, unknown>>(blankShell())

  const findings = computed(() => {
    const problem = error.value instanceof StudioApiError ? error.value.problem : null
    return problem?.code === 'validation_failed' ? (problem.violations ?? []) : []
  })

  const plan = computed(() => [
    ...sources.value.map(source => ({
      icon: 'mdi-file-tree-outline',
      title: source.source === 'template' ? `${source.idShort ?? source.templateId}` : (source.source === 'empty' ? source.idShort : String((source as { submodel: Record<string, unknown> }).submodel.idShort ?? 'JSON')),
      subtitle: t('wizard.newSubmodel'),
    })),
    { icon: '$aas', title: String(shell.value.idShort || t('wizard.unnamed')), subtitle: t('wizard.newShell') },
  ])

  /** The shell as filled in: empty fields are left out so Studio generates them. */
  function body () {
    const clean = (value: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(
      Object.entries(value).filter(([, entry]) => entry !== '' && entry !== undefined && !(Array.isArray(entry) && entry.length === 0)),
    )
    const asset = clean((shell.value.assetInformation ?? {}) as Record<string, unknown>)
    return { shell: { ...clean(shell.value), assetInformation: asset }, submodels: sources.value }
  }

  async function create () {
    busy.value = true
    error.value = null
    steps.value = []
    try {
      const result = await api<ShellCreateResult>(`/targets/${props.targetId}/shells`, { method: 'POST', body: body() })
      emit('created', result)
      close()
    } catch (error_) {
      error.value = error_
      if (error_ instanceof StudioApiError && error_.problem?.steps) {
        steps.value = error_.problem.steps as SyncStep[]
      }
    } finally {
      busy.value = false
    }
  }

  function close () {
    open.value = false
    step.value = 1
    error.value = null
    steps.value = []
    sources.value = []
    shell.value = blankShell()
  }
</script>
