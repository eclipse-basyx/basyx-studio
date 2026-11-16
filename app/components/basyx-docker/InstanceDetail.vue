<template>
  <div class="d-flex flex-column flex-grow-1" :data-test="`stack-${stack.id}`">
    <!-- The title and actions share the sidebar and wizard's header height. -->
    <v-sheet class="d-flex flex-0-0 align-center ga-2 px-4" data-test="instance-header" height="56">
      <h1 class="text-title-medium font-weight-medium text-truncate flex-grow-1 ma-0">{{ stack.name }}</h1>

      <v-chip :color="statusColors[stack.status]" data-test="status" prepend-icon="mdi-circle" :text="t(`status.${stack.status}`)" />

      <template v-if="stack.spec && stack.status !== 'missing'">
        <v-btn
          v-if="stack.status === 'stopped' || stack.status === 'error' || stack.status === 'partial' || stack.status === 'unknown'"
          data-test="start"
          :disabled="busy"
          prepend-icon="mdi-play"
          :text="t('card.start')"
          @click="run(() => containers.startStack(stack.id))"
        />

        <v-btn
          v-if="stack.status === 'running' || stack.status === 'partial' || stack.status === 'error'"
          data-test="stop"
          :disabled="busy"
          prepend-icon="mdi-stop"
          :text="t('card.stop')"
          @click="run(() => containers.stopStack(stack.id))"
        />

        <v-btn-primary
          v-if="stack.infrastructureId"
          data-test="open"
          :disabled="stack.status !== 'running'"
          prepend-icon="mdi-open-in-app"
          :text="t('card.open')"
          @click="client.ui.openTarget(stack.infrastructureId)"
        />
      </template>

      <v-menu>
        <template #activator="{ props: activator }">
          <v-btn
            v-bind="activator"
            :aria-label="t('card.actions')"
            data-test="menu"
            icon="mdi-dots-vertical"
            size="small"
          />
        </template>

        <v-list>
          <v-list-item v-if="stack.urls.environment" prepend-icon="mdi-open-in-new" :title="t('card.openInBrowser')" @click="openExternal(`${stack.urls.environment}/description`)" />

          <v-list-item
            v-if="stack.spec"
            :disabled="busy"
            prepend-icon="mdi-tune-variant"
            :title="t('card.change')"
            @click="emit('change')"
          />

          <v-list-item
            v-if="stack.spec"
            :disabled="busy"
            prepend-icon="mdi-export"
            :title="t('card.export')"
            @click="exporting = true"
          />

          <v-list-item
            v-if="stack.updateAvailable || stack.spec?.images.channel === 'latest'"
            :disabled="busy"
            prepend-icon="mdi-update"
            :title="t('card.update')"
            @click="run(() => containers.updateStack(stack.id))"
          />

          <v-divider />

          <v-list-item
            base-color="error"
            :disabled="busy"
            prepend-icon="mdi-delete-outline"
            :title="t('card.remove')"
            @click="removing = true"
          />
        </v-list>
      </v-menu>
    </v-sheet>

    <v-divider />

    <div class="d-flex flex-column ga-4 px-8 pt-4 pb-6">
      <div class="text-body-medium text-medium-emphasis">{{ subtitle }}</div>

      <ErrorAlert v-if="error" closable :error="error" @close="error = null" />

      <v-alert v-if="exporting" density="compact" :text="t('card.exportWarning')" type="warning">
        <template #append>
          <v-btn :text="t('remove.cancel')" @click="exporting = false" />
          <v-btn-primary :text="t('card.export')" @click="exportStack" />
        </template>
      </v-alert>

      <v-tabs v-model="tab" density="compact">
        <v-tab :text="t('tab.overview')" value="overview" />
        <v-tab data-test="tab-logs" :text="t('card.logs')" value="logs" />
        <v-tab v-if="secured" data-test="tab-sign-in" :text="t('card.signIn')" value="signIn" />
        <v-tab v-if="stack.spec" :text="t('tab.settings')" value="settings" />
      </v-tabs>

      <v-tabs-window v-model="tab">
        <v-tabs-window-item value="overview">
          <div class="d-flex flex-column ga-4">
            <template v-if="job">
              <ErrorAlert
                v-if="job.state === 'failed'"
                closable
                data-test="job-failed"
                :error="job.problem"
                @close="emit('dismiss-job')"
              >
                <template #actions>
                  <v-btn :text="t('card.logs')" @click="tab = 'logs'" />
                </template>
              </ErrorAlert>

              <v-card v-if="job.state !== 'succeeded'" max-width="560">
                <v-card-item :title="t(`job.${job.kind}`)">
                  <template #append>
                    <span class="text-body-small text-medium-emphasis">{{ t('job.progress', { done: doneSteps, total: job.steps.length }) }}</span>
                  </template>
                </v-card-item>

                <v-card-text>
                  <v-progress-linear :max="job.steps.length" :model-value="doneSteps" rounded />
                  <JobProgress class="mt-2" :job="job" />
                  <v-btn class="mt-1" :text="t('job.showLogs')" @click="tab = 'logs'" />
                </v-card-text>
              </v-card>
            </template>

            <v-alert v-if="stack.status === 'orphan'" density="compact" :text="t('card.orphanText')" type="info" />

            <v-alert v-else-if="stack.status === 'missing' && !busy" density="compact" :text="t('card.missingText')" type="warning">
              <template #append>
                <v-btn :text="t('card.recreate')" @click="run(() => containers.startStack(stack.id))" />
              </template>
            </v-alert>

            <v-alert v-if="stack.updateAvailable && !busy" density="compact" :text="t('card.updateAvailable')" type="info">
              <template #append>
                <v-btn :text="t('card.update')" @click="run(() => containers.updateStack(stack.id))" />
              </template>
            </v-alert>

            <v-alert v-if="stack.status === 'running' && !stack.infrastructureId" density="compact" :text="t('card.notInStudio')" type="info" />

            <v-row v-if="!job || job.state !== 'running'" density="compact">
              <v-col cols="12" md="6">
                <v-card class="h-100">
                  <v-card-title class="text-title-small font-weight-bold pt-3 pb-0">{{ t('card.parts') }}</v-card-title>

                  <v-list>
                    <template v-for="(component, index) in stack.components" :key="component.id">
                      <v-divider v-if="index > 0" />

                      <v-list-item :title="t(`component.${component.id}`)">
                        <template #prepend>
                          <v-icon :color="componentColors[component.state]" icon="mdi-circle" size="8" />
                        </template>

                        <template #append>
                          <span class="text-body-small text-medium-emphasis">{{ t(`componentState.${componentState(component)}`) }}</span>
                        </template>
                      </v-list-item>
                    </template>
                  </v-list>
                </v-card>
              </v-col>

              <v-col cols="12" md="6">
                <v-card class="h-100">
                  <v-card-title class="text-title-small font-weight-bold pt-3 pb-0">{{ t('card.addresses') }}</v-card-title>

                  <v-list v-if="addresses.length > 0" lines="two">
                    <template v-for="(address, index) in addresses" :key="address.url">
                      <v-divider v-if="index > 0" />

                      <v-list-item :subtitle="address.url" :title="address.title">
                        <template #append>
                          <v-btn
                            v-tooltip="t('card.copy')"
                            :aria-label="t('card.copy')"
                            icon="mdi-content-copy"
                            @click="copy(address.url)"
                          />
                        </template>
                      </v-list-item>
                    </template>
                  </v-list>

                  <v-card-text v-else class="text-body-medium text-medium-emphasis pt-2">{{ t('card.noAddresses') }}</v-card-text>
                </v-card>
              </v-col>
            </v-row>

            <v-card v-if="stack.spec">
              <v-card-text>
                <v-row density="compact">
                  <v-col v-for="fact in overviewFacts" :key="fact.label" cols="6" md="3">
                    <div class="text-body-small text-medium-emphasis">{{ fact.label }}</div>
                    <div class="text-body-medium">{{ fact.value }}</div>
                  </v-col>
                </v-row>
              </v-card-text>
            </v-card>
          </div>
        </v-tabs-window-item>

        <v-tabs-window-item value="logs">
          <LogsPanel v-if="tab === 'logs'" :stack="stack" />
        </v-tabs-window-item>

        <v-tabs-window-item v-if="secured" value="signIn">
          <SignInDetails v-if="tab === 'signIn'" :stack="stack" />
        </v-tabs-window-item>

        <v-tabs-window-item v-if="stack.spec" value="settings">
          <v-card>
            <v-list lines="two">
              <template v-for="(fact, index) in settingsFacts" :key="fact.label">
                <v-divider v-if="index > 0" />
                <v-list-item :subtitle="fact.value" :title="fact.label" />
              </template>
            </v-list>

            <v-divider />

            <v-card-actions>
              <v-btn-secondary
                data-test="change"
                :disabled="busy"
                prepend-icon="mdi-tune-variant"
                :text="t('card.change')"
                @click="emit('change')"
              />
            </v-card-actions>
          </v-card>
        </v-tabs-window-item>
      </v-tabs-window>
    </div>

    <v-dialog max-width="520" :model-value="removing" @update:model-value="removing = false">
      <DialogCard data-test="remove-confirm" :title="t('remove.title', { name: stack.name })">
        <p class="mt-0">{{ t('remove.text') }}</p>

        <v-checkbox
          v-model="deleteData"
          data-test="remove-data"
          :label="t('remove.data')"
        />

        <v-checkbox
          v-if="stack.infrastructureId"
          v-model="removeInfrastructure"
          :label="t('remove.infrastructure')"
        />

        <template #actions>
          <v-btn :text="t('remove.cancel')" @click="removing = false" />

          <v-btn-primary
            color="error"
            data-test="remove-confirm-button"
            :text="t('remove.confirm')"
            @click="remove"
          />
        </template>
      </DialogCard>
    </v-dialog>
  </div>
</template>

<script lang="ts" setup>
  import type { Job, Stack, StackComponent } from '@basyx/studio-sdk'
  import { computed, ref } from 'vue'
  import ErrorAlert from './ErrorAlert.vue'
  import { useI18n } from './i18n'
  import JobProgress from './JobProgress.vue'
  import LogsPanel from './LogsPanel.vue'
  import SignInDetails from './SignInDetails.vue'
  import { statusColors, useClient } from './support'

  const props = defineProps<{ stack: Stack, job: Job | null }>()
  const emit = defineEmits<{ 'job': [job: Job], 'change': [], 'dismiss-job': [] }>()
  const { t } = useI18n()
  const client = useClient()
  const containers = client.containers

  const tab = ref<'overview' | 'logs' | 'signIn' | 'settings'>('overview')
  const removing = ref(false)
  const exporting = ref(false)
  const error = ref<unknown | null>(null)
  const deleteData = ref(false)
  const removeInfrastructure = ref(true)

  const busy = computed(() => props.stack.status === 'busy' || props.job?.state === 'running')
  const secured = computed(() => props.stack.spec?.security.mode === 'keycloak')
  const doneSteps = computed(() => props.job?.steps.filter(step => step.state === 'done' || step.state === 'skipped').length ?? 0)

  type ComponentState = StackComponent['state']
  const componentColors: Record<ComponentState, string | undefined> = {
    running: 'success',
    starting: 'info',
    unhealthy: 'error',
    stopped: undefined,
    exited: undefined,
    missing: 'warning',
  }

  /** A one-off container that exited cleanly has finished, not stopped. */
  function componentState (component: StackComponent): ComponentState | 'finished' {
    return component.state === 'exited' && component.exitCode === 0 ? 'finished' : component.state
  }

  const subtitle = computed(() => {
    const spec = props.stack.spec
    if (!spec) {
      return t('card.orphanSubtitle')
    }
    const parts = [t(`preset.${spec.preset}`)]
    if (spec.security.mode === 'keycloak') {
      parts.push(t(`access.${spec.security.access}`))
    }
    parts.push(spec.persistence === 'keep' ? t('card.dataKept') : t('card.dataEphemeral'))
    return parts.join(' · ')
  })

  const addresses = computed(() => {
    const urls = props.stack.urls
    return ([
      ['environment', urls.environment],
      ['aasRegistry', urls.aasRegistry],
      ['submodelRegistry', urls.submodelRegistry],
      ['discovery', urls.discovery],
      ['keycloak', urls.keycloak],
    ] as const).filter(([, url]) => url).map(([component, url]) => ({ title: t(`component.${component}`), url: url! }))
  })

  const overviewFacts = computed(() => {
    const spec = props.stack.spec
    if (!spec) {
      return []
    }
    return [
      { label: t('facts.template'), value: t(`preset.${spec.preset}`) },
      { label: t('facts.data'), value: t(spec.persistence === 'keep' ? 'facts.dataKept' : 'facts.dataEphemeral') },
      { label: t('facts.aasx'), value: t('facts.files', { count: spec.aasxFiles.length }) },
      { label: t('facts.network'), value: t(spec.network.exposure === 'network' ? 'facts.networkShared' : 'facts.networkLocal') },
    ]
  })

  const settingsFacts = computed(() => {
    const spec = props.stack.spec
    if (!spec) {
      return []
    }
    const features = (['history', 'eventFeed', 'registrySync', 'discoverySync'] as const).filter(feature => spec.features[feature]).map(feature => t(`wizard.${feature}`))
    return [
      { label: t('facts.template'), value: t(`preset.${spec.preset}`) },
      { label: t('access.title'), value: spec.security.mode === 'keycloak' ? t(`access.${spec.security.access}`) : t('facts.noSignIn') },
      { label: t('wizard.topology'), value: t(spec.topology === 'separate' ? 'wizard.topologySeparate' : 'wizard.topologySingle') },
      { label: t('wizard.features'), value: features.length > 0 ? features.join(', ') : t('facts.none') },
      { label: t('facts.data'), value: t(spec.persistence === 'keep' ? 'facts.dataKept' : 'facts.dataEphemeral') },
      { label: t('facts.aasx'), value: spec.aasxFiles.length > 0 ? spec.aasxFiles.join(', ') : t('facts.none') },
      { label: t('wizard.ports'), value: spec.network.basePort === null ? t('wizard.portsAuto') : t('facts.portsFrom', { port: spec.network.basePort }) },
      { label: t('facts.network'), value: t(spec.network.exposure === 'network' ? 'facts.networkShared' : 'facts.networkLocal') },
      { label: t('wizard.images'), value: t(spec.images.channel === 'latest' ? 'wizard.imagesLatest' : 'wizard.imagesTested') },
      { label: t('facts.restart'), value: t(spec.restart === 'always' ? 'facts.restartAlways' : 'facts.restartManual') },
    ]
  })

  function openExternal (url: string) {
    void client.ui.openExternal(url)
  }

  async function copy (value: string) {
    await client.ui.copyText(value)
    await client.ui.notify(t('card.copied'), 'success')
  }

  async function run (action: () => Promise<Job>) {
    error.value = null
    try {
      emit('job', await action())
    } catch (error_) {
      error.value = error_
    }
  }

  async function remove () {
    removing.value = false
    await run(() => containers.removeStack({ stackId: props.stack.id, deleteData: deleteData.value, removeInfrastructure: removeInfrastructure.value && Boolean(props.stack.infrastructureId) }))
  }

  async function exportStack () {
    exporting.value = false
    error.value = null
    try {
      const saved = await containers.exportStack(props.stack.id, props.stack.name)
      if (saved) {
        void client.ui.notify(saved.fileName, 'success')
      }
    } catch (error_) {
      error.value = error_
    }
  }
</script>
