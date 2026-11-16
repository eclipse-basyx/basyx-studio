<template>
  <!-- The wizard fills the work area: a slim header with the steps, the form, and the actions at the bottom. -->
  <div class="d-flex flex-column flex-grow-1 overflow-hidden bg-surface" data-test="wizard">
    <v-sheet class="d-flex flex-0-0 align-center ga-2 px-4" height="56">
      <h1 class="text-title-medium font-weight-medium text-truncate flex-grow-1 ma-0">{{ heading }}</h1>

      <v-stepper
        :aria-label="t('wizard.progress')"
        class="flex-shrink-0"
        :mobile-breakpoint="1024"
        :model-value="step"
        role="group"
      >
        <v-stepper-header>
          <template v-for="item in steps" :key="item.value">
            <v-divider v-if="item.value > 1" class="mx-1" />

            <v-stepper-item
              :aria-current="step === item.value ? 'step' : undefined"
              :aria-label="item.title"
              class="px-2 py-1 text-body-small"
              :complete="step > item.value"
              :title="item.title"
              :value="item.value"
            />
          </template>
        </v-stepper-header>
      </v-stepper>
    </v-sheet>

    <v-divider />

    <div class="d-flex flex-grow-1 overflow-hidden">
      <div class="d-flex flex-column flex-grow-1 overflow-hidden">
        <div ref="form" class="flex-grow-1 overflow-y-auto pa-8">
          <!-- The form uses the full width of the work area, like the instance overview. -->
          <v-sheet color="transparent">
            <!-- Step 1: preset and, for secured instances, the access model. -->
            <template v-if="step === 1">
              <v-radio-group v-model="preset" hide-details>
                <v-row density="compact">
                  <v-col v-for="option in selectablePresets" :key="option" :cols="choiceColumns">
                    <v-card
                      :class="{ 'border-primary': preset === option }"
                      :color="preset === option ? 'primary' : undefined"
                      height="100%"
                      :variant="preset === option ? 'tonal' : undefined"
                    >
                      <v-radio class="align-start pa-3 w-100 h-100" :data-test="`preset-${option}`" :value="option">
                        <template #label>
                          <div class="ml-1">
                            <div class="d-flex flex-wrap align-center ga-2 mb-1">
                              <v-icon :icon="presetIcons[option]" size="small" />
                              <span class="font-weight-medium">{{ t(`preset.${option}`) }}</span>
                              <v-chip v-if="option === 'quick'" color="success" size="x-small" :text="t('preset.recommended')" />
                            </div>

                            <div class="text-body-small text-medium-emphasis text-wrap">{{ t(`preset.${option}Text`) }}</div>
                          </div>
                        </template>
                      </v-radio>
                    </v-card>
                  </v-col>
                </v-row>
              </v-radio-group>

              <!-- The access model follows the template grid, with the chosen
                 model's details in a single panel below. -->
              <template v-if="spec.security.mode === 'keycloak'">
                <div class="text-title-small mt-6">{{ t('access.title') }}</div>
                <div class="text-body-small text-medium-emphasis mb-2">{{ t('access.hint') }}</div>

                <v-radio-group v-model="access" hide-details>
                  <v-row density="compact">
                    <v-col v-for="option in accessModels" :key="option" :cols="choiceColumns">
                      <v-card
                        :class="{ 'border-primary': access === option }"
                        :color="access === option ? 'primary' : undefined"
                        height="100%"
                        :variant="access === option ? 'tonal' : undefined"
                      >
                        <v-radio class="align-start pa-3 w-100 h-100" :data-test="`access-${option}`" :value="option">
                          <template #label>
                            <div class="ml-1">
                              <div class="d-flex flex-wrap align-center ga-2 mb-1">
                                <v-icon :icon="accessModelDetails[option].icon" size="small" />
                                <span class="font-weight-medium">{{ t(`access.${option}`) }}</span>
                                <v-chip :text="t(`access.${option}Technology`)" />
                              </div>

                              <div class="text-body-small text-medium-emphasis text-wrap">{{ t(`access.${option}Text`) }}</div>
                            </div>
                          </template>
                        </v-radio>
                      </v-card>
                    </v-col>
                  </v-row>
                </v-radio-group>

                <v-card class="mt-3" data-test="access-details">
                  <v-card-text class="d-flex flex-column ga-4">
                    <div>
                      <div class="text-body-small text-medium-emphasis mb-1">{{ t('access.includedUsers') }}</div>
                      <div class="text-body-medium">{{ t(`access.${access}Users`) }}</div>
                    </div>

                    <div>
                      <div class="text-body-small text-medium-emphasis mb-1">{{ t('access.permissions') }}</div>

                      <div
                        v-for="permission in accessModelDetails[access].permissions"
                        :key="permission"
                        class="d-flex align-start ga-2 text-body-medium mb-1"
                      >
                        <v-icon class="mt-1" color="success" icon="mdi-check" size="small" />
                        <span>{{ t(`access.${permission}`) }}</span>
                      </div>
                    </div>

                    <div>
                      <div class="text-body-small text-medium-emphasis mb-1">{{ t('access.bestFor') }}</div>
                      <div class="text-body-medium">{{ t(`access.${access}UseCase`) }}</div>
                    </div>
                  </v-card-text>
                </v-card>
              </template>
            </template>

            <!-- Step 2: name and startup files; optional settings stay out of the main path. -->
            <template v-else-if="step === 2">
              <v-text-field
                v-model="spec.name"
                data-test="name"
                density="compact"
                :hint="t('wizard.nameHint')"
                :label="t('wizard.name')"
                persistent-hint
                :rules="[nameRule]"
              />

              <div class="d-flex align-center ga-2 mt-6 mb-2">
                <div class="text-title-small flex-grow-1">{{ t('wizard.aasx') }}</div>

                <v-btn-secondary
                  data-test="add-aasx"
                  prepend-icon="mdi-plus"
                  size="small"
                  :text="t('wizard.aasxAdd')"
                  @click="pickFiles"
                />
              </div>

              <v-card>
                <v-list v-if="files.length > 0">
                  <template v-for="(file, index) in files" :key="file.key">
                    <v-divider v-if="index > 0" />

                    <v-list-item prepend-icon="mdi-package-variant-closed" :title="file.name">
                      <template #append>
                        <v-btn
                          v-tooltip="t('wizard.aasxRemove')"
                          :aria-label="t('wizard.aasxRemove')"
                          icon="mdi-close"
                          @click="file.remove"
                        />
                      </template>
                    </v-list-item>
                  </template>
                </v-list>

                <v-card-text v-else class="text-body-medium text-medium-emphasis">{{ t('wizard.aasxNone') }}</v-card-text>
              </v-card>

              <div class="text-title-small mt-6 mb-2">{{ t('wizard.storage') }}</div>

              <v-radio-group v-model="spec.persistence" hide-details>
                <v-row density="compact">
                  <v-col v-for="option in persistenceOptions" :key="option" cols="12" sm="6">
                    <v-card
                      :class="{ 'border-primary': spec.persistence === option }"
                      :color="spec.persistence === option ? 'primary' : undefined"
                      height="100%"
                      :variant="spec.persistence === option ? 'tonal' : undefined"
                    >
                      <v-radio class="align-start pa-3 w-100" :data-test="`persistence-${option}`" :value="option">
                        <template #label>
                          <div class="ml-1">
                            <div class="font-weight-medium mb-1">{{ t(`persistence.${option}`) }}</div>
                            <div class="text-body-small text-medium-emphasis text-wrap">{{ t(`persistence.${option}Text`) }}</div>
                          </div>
                        </template>
                      </v-radio>
                    </v-card>
                  </v-col>
                </v-row>
              </v-radio-group>

              <!-- Optional settings share one inset instead of nesting more cards. -->
              <v-card class="mt-6">
                <v-expansion-panels>
                  <v-expansion-panel data-test="advanced">
                    <v-expansion-panel-title>
                      <div>
                        <div class="font-weight-medium">{{ t('wizard.advanced') }}</div>
                        <div class="text-body-small text-medium-emphasis">{{ advancedSummary }}</div>
                      </div>
                    </v-expansion-panel-title>

                    <v-expansion-panel-text>
                      <div class="d-flex flex-column ga-6 pt-2">
                        <section class="d-flex flex-column ga-4">
                          <div>
                            <h2 class="text-title-small ma-0">{{ t('wizard.services') }}</h2>
                            <p class="text-body-small text-medium-emphasis ma-0">{{ t('wizard.servicesHint') }}</p>
                          </div>

                          <v-select
                            v-model="spec.topology"
                            :items="topologyOptions"
                            :label="t('wizard.topology')"
                          />

                          <div>
                            <div class="text-body-small text-medium-emphasis mb-1">{{ t('wizard.features') }}</div>

                            <v-row density="compact">
                              <v-col :cols="settingsColumns">
                                <v-checkbox v-model="spec.features.history" :label="t('wizard.history')" />
                              </v-col>

                              <v-col :cols="settingsColumns">
                                <v-checkbox v-model="spec.features.eventFeed" :label="t('wizard.eventFeed')" />
                              </v-col>

                              <v-col :cols="settingsColumns">
                                <v-checkbox
                                  v-model="spec.features.registrySync"
                                  :disabled="spec.topology === 'separate'"
                                  :label="t('wizard.registrySync')"
                                />
                              </v-col>

                              <v-col :cols="settingsColumns">
                                <v-checkbox v-model="spec.features.discoverySync" :label="t('wizard.discoverySync')" />
                              </v-col>
                            </v-row>
                          </div>
                        </section>

                        <v-divider />

                        <section class="d-flex flex-column ga-4">
                          <div>
                            <h2 class="text-title-small ma-0">{{ t('wizard.runtime') }}</h2>
                            <p class="text-body-small text-medium-emphasis ma-0">{{ t('wizard.runtimeHint') }}</p>
                          </div>

                          <v-select
                            v-model="spec.images.channel"
                            :items="imageOptions"
                            :label="t('wizard.images')"
                          />

                          <v-checkbox v-model="restartAlways" :label="t('wizard.restart')" />
                        </section>

                        <v-divider />

                        <section class="d-flex flex-column ga-4">
                          <div>
                            <h2 class="text-title-small ma-0">{{ t('wizard.network') }}</h2>
                            <p class="text-body-small text-medium-emphasis ma-0">{{ t('wizard.networkHint') }}</p>
                          </div>

                          <v-row density="compact">
                            <v-col class="d-flex flex-column ga-3" :cols="settingsColumns">
                              <v-select
                                v-model="portMode"
                                :items="portOptions"
                                :label="t('wizard.ports')"
                              />

                              <v-number-input
                                v-if="portMode === 'fixed'"
                                v-model="basePort"
                                control-variant="hidden"
                                density="compact"
                                :hint="t('wizard.basePortHint')"
                                :label="t('wizard.basePort')"
                                :max="64000"
                                :min="1024"
                                persistent-hint
                              />
                            </v-col>

                            <v-col class="d-flex flex-column ga-2" :cols="settingsColumns">
                              <v-checkbox v-model="network" :label="t('wizard.exposure')" />

                              <v-alert
                                v-if="network"
                                density="compact"
                                :text="t('wizard.exposureWarning')"
                                type="warning"
                              />
                            </v-col>
                          </v-row>
                        </section>
                      </div>
                    </v-expansion-panel-text>
                  </v-expansion-panel>
                </v-expansion-panels>
              </v-card>
            </template>

            <!-- Step 3: what will happen, in plain words. -->
            <template v-else>
              <v-alert v-if="importInfo?.notes.length" class="mb-4" :title="t('wizard.importNotes')" type="info">
                <ul class="ps-4">
                  <li v-for="note in importInfo.notes" :key="note">{{ t(`wizard.note_${note}`) }}</li>
                </ul>
              </v-alert>

              <v-progress-linear v-if="planning" />

              <div v-else-if="plan" class="d-flex flex-column ga-4" data-test="review">
                <v-alert
                  v-if="plan.portsInUse.length > 0"
                  :text="t('wizard.portsInUse', { ports: plan.portsInUse.join(', ') })"
                  type="warning"
                />

                <v-card data-test="summary-facts">
                  <v-card-text class="d-flex flex-column ga-4">
                    <h2 class="text-title-small font-weight-medium ma-0">{{ t('wizard.summary') }}</h2>

                    <p class="text-body-medium text-medium-emphasis ma-0" data-test="summary">{{ summary }}</p>

                    <v-divider />

                    <v-row density="compact">
                      <v-col v-for="fact in summaryFacts" :key="fact.label" class="pb-2" :cols="settingsColumns">
                        <div class="text-body-small text-medium-emphasis mb-1">{{ fact.label }}</div>
                        <div class="text-body-medium">{{ fact.value }}</div>
                      </v-col>
                    </v-row>
                  </v-card-text>
                </v-card>

                <v-card>
                  <v-card-text class="pb-0">
                    <h2 class="text-title-small font-weight-medium ma-0">{{ t('card.addresses') }}</h2>
                  </v-card-text>

                  <v-list lines="two">
                    <template v-for="(address, index) in addresses" :key="address.url">
                      <v-divider v-if="index > 0" />

                      <v-list-item :subtitle="address.url">
                        <template #title>
                          <span class="text-body-medium">{{ address.title }}</span>
                        </template>
                      </v-list-item>
                    </template>
                  </v-list>
                </v-card>

                <div class="d-flex flex-column ga-2 text-body-small text-medium-emphasis">
                  <div v-if="plan.portsInUse.length === 0" class="d-flex align-start ga-2">
                    <v-icon icon="mdi-download-outline" size="small" />
                    <span>{{ plan.downloadMb ? t('wizard.download', { size: plan.downloadMb }) : t('wizard.downloadNone') }}</span>
                  </div>

                  <div class="d-flex align-start ga-2">
                    <v-icon icon="mdi-information-outline" size="small" />
                    <span>{{ t('wizard.summaryNote') }}</span>
                  </div>
                </div>
              </div>

            </template>

            <ErrorAlert v-if="error" class="mt-2" :error="error">
              <template v-if="retry" #actions>
                <v-btn :text="t('problem.retry')" @click="retry" />
              </template>
            </ErrorAlert>
          </v-sheet>
        </div>

        <v-divider />

        <v-sheet class="d-flex flex-0-0 align-center ga-2 px-4" height="72">
          <v-btn :text="t('wizard.cancel')" @click="emit('cancel')" />

          <v-spacer />
          <v-btn v-if="step > 1" prepend-icon="mdi-chevron-left" :text="t('wizard.back')" @click="step--" />

          <v-btn-primary
            v-if="step < 3"
            append-icon="mdi-chevron-right"
            data-test="next"
            :disabled="step === 2 && Boolean(nameProblem)"
            :text="t('wizard.next')"
            @click="step++"
          />

          <v-btn-primary
            v-else
            data-test="submit"
            :disabled="!plan || plan.portsInUse.length > 0"
            :loading="submitting"
            prepend-icon="mdi-play"
            :text="stack ? t('wizard.apply') : t('wizard.start')"
            @click="submit"
          />
        </v-sheet>
      </div>

      <!-- What will be created, kept up to date while the user chooses (steps 1 and 2). -->
      <v-sheet
        v-if="summaryOpen && step < 3"
        :aria-label="t('wizard.summary')"
        class="d-flex flex-column ga-3 flex-shrink-0 overflow-y-auto border-s px-4 pt-3 pb-4"
        data-test="summary-panel"
        tag="aside"
        width="300"
      >
        <div class="d-flex align-center">
          <div class="text-overline text-medium-emphasis flex-grow-1">{{ t('wizard.summary') }}</div>

          <v-btn
            v-tooltip="t('wizard.hideSummary')"
            :aria-label="t('wizard.hideSummary')"
            data-test="hide-summary"
            icon="mdi-chevron-right"
            size="small"
            @click="summaryOpen = false"
          />
        </div>

        <div class="d-flex align-center ga-3">
          <v-avatar color="primary" variant="tonal">
            <v-icon :icon="presetIcons[spec.preset]" />
          </v-avatar>

          <div class="overflow-hidden">
            <div class="text-title-small text-truncate">{{ spec.name.trim() || t('wizard.name') }}</div>
            <div class="text-body-small text-medium-emphasis">{{ summaryTemplate }}</div>
          </div>
        </div>

        <div class="d-flex flex-column ga-2">
          <div v-for="fact in summaryFacts" :key="fact.label" class="d-flex justify-space-between ga-3 text-body-small">
            <span class="text-medium-emphasis">{{ fact.label }}</span>
            <span class="text-end">{{ fact.value }}</span>
          </div>
        </div>
      </v-sheet>

      <!-- Hidden, the summary folds into a rail on the right edge that opens it again. -->
      <v-sheet
        v-else-if="lgAndUp && step < 3"
        class="d-flex flex-column align-center flex-shrink-0 border-s pt-3"
        data-test="summary-rail"
        width="48"
      >
        <v-btn
          v-tooltip="t('wizard.showSummary')"
          :aria-label="t('wizard.showSummary')"
          data-test="toggle-summary"
          icon="mdi-chevron-left"
          size="small"
          @click="summaryOpen = true"
        />
      </v-sheet>
    </div>
  </div>
</template>

<script lang="ts" setup>
  import type { Job, PickedFile, Stack, StackImport, StackPlan, StackSpec } from '@basyx/studio-sdk'
  import { computed, onBeforeUnmount, reactive, ref, useTemplateRef, watch } from 'vue'
  import { useDisplay } from 'vuetify'
  import ErrorAlert from './ErrorAlert.vue'
  import { useI18n } from './i18n'
  import { cloneSpec, nextStackName, portSummary, presetIcons, presetSpec, selectablePresets, stackNameProblem, useClient } from './support'

  const props = defineProps<{ existing: string[], stack: Stack | null, importInfo: StackImport | null }>()
  const emit = defineEmits<{ done: [job: Job], cancel: [] }>()
  const { t } = useI18n()
  const client = useClient()

  // Use the form's available width so the sidebar and open summary both count.
  // Two columns need enough room for the choice heading, icon and badge.
  const form = useTemplateRef<HTMLElement>('form')
  const formWidth = ref(0)
  const resizes = import.meta.client ? new ResizeObserver(([entry]) => (formWidth.value = entry?.contentRect.width ?? 0)) : null
  watch(form, (element, previous) => {
    if (previous) {
      resizes?.unobserve(previous)
    }
    if (element) {
      resizes?.observe(element)
    }
  })
  onBeforeUnmount(() => resizes?.disconnect())
  const choiceColumns = computed(() => formWidth.value >= 720 ? 6 : 12)
  const settingsColumns = computed(() => formWidth.value >= 600 ? 6 : 12)

  const accessModels = ['roles', 'sharing'] as const
  const accessModelDetails = {
    roles: {
      icon: 'mdi-account-key-outline',
      permissions: ['rolesAdmin', 'rolesViewer'],
    },
    sharing: {
      icon: 'mdi-share-variant-outline',
      permissions: ['sharingOwner', 'sharingAdmin'],
    },
  } as const
  const initial: StackSpec = props.stack?.spec ?? props.importInfo?.spec ?? presetSpec('quick', nextStackName(props.existing))
  const spec = reactive<StackSpec>(cloneSpec(initial))
  const step = ref(props.importInfo ? 3 : 1)
  const keptFiles = ref<string[]>(props.stack ? [...initial.aasxFiles] : [])
  const pickedFiles = ref<PickedFile[]>([])
  const plan = ref<StackPlan | null>(null)
  const planning = ref(false)
  const submitting = ref(false)
  const error = ref<unknown | null>(null)
  const retry = ref<(() => Promise<void>) | null>(null)
  const steps = computed(() => [
    { value: 1, title: t('wizard.stepWhat') },
    { value: 2, title: t('wizard.stepName') },
    { value: 3, title: t('wizard.stepCheck') },
  ])
  const nameProblem = computed(() => stackNameProblem(spec.name, props.existing, props.stack?.name))
  const topologyOptions = computed(() => [
    { title: t('wizard.topologySingle'), value: 'single' },
    { title: t('wizard.topologySeparate'), value: 'separate' },
  ])
  const portOptions = computed(() => [
    { title: t('wizard.portsAuto'), value: 'auto' },
    { title: t('wizard.portsFixed'), value: 'fixed' },
  ])
  const imageOptions = computed(() => [
    { title: t('wizard.imagesTested'), value: 'tested' },
    { title: t('wizard.imagesLatest'), value: 'latest' },
  ])

  function nameRule (): string | true {
    return nameProblem.value ? t(`wizard.name${nameProblem.value === 'required' ? 'Required' : 'Duplicate'}`) : true
  }

  const heading = computed(() => {
    if (props.stack) {
      return t('wizard.changeTitle', { name: props.stack.name })
    }
    return props.importInfo ? t('wizard.importTitle', { name: initial.name }) : t('list.new')
  })

  // Choosing a preset sets its services and sign-in; name, data and files stay.
  const preset = computed({
    get: () => spec.preset,
    set: (value: StackSpec['preset']) => {
      const defaults = presetSpec(value, spec.name)
      spec.preset = value
      spec.topology = defaults.topology
      spec.security = defaults.security
    },
  })
  const access = computed({
    get: () => spec.security.mode === 'keycloak' ? spec.security.access : 'roles',
    set: (value: 'roles' | 'sharing') => {
      spec.security = { mode: 'keycloak', access: value }
    },
  })
  const portMode = ref<'auto' | 'fixed'>(initial.network.basePort !== null && !props.stack ? 'fixed' : 'auto')
  const basePort = ref<number>(initial.network.basePort ?? 18_100)
  const network = computed({
    get: () => spec.network.exposure === 'network',
    set: (value: boolean) => {
      spec.network.exposure = value ? 'network' : 'local'
    },
  })
  const restartAlways = computed({
    get: () => spec.restart === 'always',
    set: (value: boolean) => {
      spec.restart = value ? 'always' : 'manual'
    },
  })
  const persistenceOptions = ['keep', 'ephemeral'] as const

  /** The startup files: those the instance keeps and those just picked. */
  const files = computed(() => [
    ...keptFiles.value.map(name => ({ key: `kept:${name}`, name, remove: () => {
      keptFiles.value = keptFiles.value.filter(item => item !== name)
    } })),
    ...pickedFiles.value.map(file => ({ key: file.handle, name: file.fileName, remove: () => {
      pickedFiles.value = pickedFiles.value.filter(item => item !== file)
    } })),
  ])

  // The summary shows when the window is wide enough and follows it as it
  // changes; the header button shows or hides it at any width.
  const { lgAndUp } = useDisplay()
  const summaryOpen = ref(lgAndUp.value)
  watch(lgAndUp, wide => {
    summaryOpen.value = wide
  })

  const summaryTemplate = computed(() => spec.security.mode === 'keycloak'
    ? `${t(`preset.${spec.preset}`)} · ${t(`access.${spec.security.access}`)}`
    : t(`preset.${spec.preset}`))

  const portsSummary = computed(() => portSummary(t, currentSpec().network.basePort))

  const summaryFacts = computed(() => [
    { label: t('wizard.topology'), value: t(spec.topology === 'separate' ? 'wizard.topologySeparate' : 'wizard.topologySingle') },
    { label: t('facts.signIn'), value: spec.security.mode === 'keycloak' ? t(`access.${spec.security.access}Users`) : t('facts.noSignIn') },
    { label: t('facts.data'), value: t(spec.persistence === 'keep' ? 'facts.dataKept' : 'facts.dataEphemeral') },
    { label: t('facts.aasx'), value: t('facts.files', { count: files.value.length + (props.importInfo?.aasxFiles.length ?? 0) }) },
    { label: t('wizard.ports'), value: portsSummary.value },
    { label: t('wizard.images'), value: t(spec.images.channel === 'latest' ? 'facts.imagesLatest' : 'facts.imagesTested') },
  ])

  /** The advanced settings in one line, so their defaults show while the panel is closed. */
  const advancedSummary = computed(() => [
    t(spec.topology === 'separate' ? 'wizard.topologySeparate' : 'wizard.topologySingle'),
    portsSummary.value,
    t(spec.images.channel === 'latest' ? 'facts.imagesLatest' : 'facts.imagesTested'),
    ...(spec.network.exposure === 'network' ? [t('facts.networkShared')] : []),
  ].join(' · '))

  /** The spec as sent: ports per the chosen mode, the files that stay. */
  function currentSpec (): StackSpec {
    const keepPorts = props.stack && portMode.value === 'auto' ? props.stack.spec?.network.basePort ?? null : null
    return {
      ...cloneSpec(spec),
      name: spec.name.trim(),
      network: { exposure: spec.network.exposure, basePort: portMode.value === 'fixed' ? basePort.value : keepPorts },
      aasxFiles: props.stack ? [...keptFiles.value] : [],
    }
  }

  const addresses = computed(() => {
    const urls = plan.value?.urls
    if (!urls) {
      return []
    }
    return ([
      ['environment', urls.environment],
      ['aasRegistry', urls.aasRegistry],
      ['submodelRegistry', urls.submodelRegistry],
      ['discovery', urls.discovery],
      ['keycloak', urls.keycloak],
    ] as const).filter(([, url]) => url).map(([component, url]) => ({ title: t(`component.${component}`), url: url! }))
  })

  const summary = computed(() => {
    const sentences = [t(spec.topology === 'separate' ? 'wizard.summaryFull' : 'wizard.summaryQuick', { name: spec.name.trim() })]
    if (spec.security.mode === 'keycloak') {
      sentences.push(t('wizard.summarySecured', { access: t(spec.security.access === 'roles' ? 'wizard.summaryRoles' : 'wizard.summarySharing') }))
    }
    sentences.push(t(spec.persistence === 'keep' ? 'wizard.summaryData' : 'wizard.summaryEphemeral'))
    const files = keptFiles.value.length + pickedFiles.value.length + (props.importInfo?.aasxFiles.length ?? 0)
    if (files > 0) {
      sentences.push(t('wizard.summaryAasx', { count: files }))
    }
    return sentences.join(' ')
  })

  async function loadPlan () {
    planning.value = true
    error.value = null
    retry.value = null
    plan.value = null
    try {
      plan.value = await client.containers.planStack(currentSpec(), props.stack?.id)
    } catch (error_) {
      error.value = error_
      retry.value = loadPlan
    } finally {
      planning.value = false
    }
  }

  watch(step, value => {
    if (value === 3) {
      void loadPlan()
    }
  }, { immediate: true })

  async function pickFiles () {
    error.value = null
    retry.value = null
    try {
      const { files } = await client.containers.pickAasxFiles()
      pickedFiles.value = [...pickedFiles.value, ...files]
    } catch (error_) {
      error.value = error_
      retry.value = pickFiles
    }
  }

  async function submit () {
    if (!plan.value) {
      return
    }
    submitting.value = true
    error.value = null
    retry.value = null
    try {
      // The planned spec carries the ports Studio picked.
      const next = { ...cloneSpec(plan.value.spec), aasxFiles: currentSpec().aasxFiles }
      const handles = pickedFiles.value.map(file => file.handle)
      const result = props.stack
        ? await client.containers.changeStack({ stackId: props.stack.id, spec: next, aasxFiles: handles })
        : await client.containers.createStack({ spec: next, aasxFiles: handles, ...(props.importInfo ? { importId: props.importInfo.importId } : {}) })
      emit('done', result.job)
    } catch (error_) {
      error.value = error_
      retry.value = submit
    } finally {
      submitting.value = false
    }
  }
</script>
