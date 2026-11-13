<template>
  <v-sheet-full-page>
    <div class="d-flex flex-grow-1 overflow-hidden">
      <!-- The sidebar, as in the App Builder: title, new and import, the instances, the engine. -->
      <v-sheet class="d-flex flex-column flex-shrink-0 border-e" width="280">
        <!-- One column grid: every icon at 24 px from the edge, every text after it. -->
        <div class="d-flex align-center ga-5 ps-6 pe-4 pt-4 pb-4">
          <v-icon color="primary" icon="mdi-docker" />
          <span class="text-title-medium font-weight-bold">{{ t('app.title') }}</span>
        </div>

        <v-list class="mx-2 py-0" slim>
          <v-list-item
            :active="Boolean(wizard && !wizard.stack && !wizard.importInfo)"
            base-color="primary"
            data-test="new"
            :disabled="!engineRunning || !list"
            prepend-icon="mdi-plus"
            :title="t('list.new')"
            @click="openWizard()"
          />

          <v-list-item
            data-test="import"
            :disabled="!engineRunning || !list"
            prepend-icon="mdi-import"
            :title="t('list.import')"
            @click="importStack"
          />
        </v-list>

        <v-divider class="my-2" />

        <div class="d-flex flex-column flex-grow-1 overflow-y-auto">
          <v-list v-if="stacks.length > 0" class="mx-2 py-0" lines="two" slim>
            <v-list-item
              v-for="stack in stacks"
              :key="stack.id"
              :active="!wizard && stack.id === selected?.id"
              :data-test="`row-${stack.id}`"
              :title="stack.name"
              @click="select(stack.id)"
            >
              <template #prepend>
                <v-icon color="primary" :icon="stack.spec ? presetIcons[stack.spec.preset] : 'mdi-help-box-outline'" />
              </template>

              <template #subtitle>
                <span class="d-inline-flex align-center ga-1">
                  <v-icon :color="statusColors[stack.status]" icon="mdi-circle" size="8" />
                  {{ rowSubtitle(stack) }}
                </span>
              </template>
            </v-list-item>
          </v-list>

          <v-empty-state
            v-else
            class="flex-grow-1"
            :icon="engineRunning ? 'mdi-server-off' : 'mdi-server-outline'"
            min-height="0"
            size="40"
            :text="engineRunning ? t('list.none') : t('list.waitingForEngine')"
          />
        </div>

        <v-divider />

        <EngineStatus
          v-if="engines"
          :engines="engines"
          @select="selectEngine"
        />
      </v-sheet>

      <!-- The work area: the selected instance, the wizard or a welcome. -->
      <!-- A tint sets the work area apart from the sidebar and its cards. -->
      <div class="d-flex flex-column flex-grow-1 overflow-y-auto bg-card-header">
        <div v-if="actionError || listError || engineError" class="d-flex flex-column ga-2 px-8 pt-4">
          <ErrorAlert v-if="engineError" closable :error="engineError" @close="engineError = null">
            <template #actions>
              <v-btn :text="t('problem.retry')" @click="checkEngines" />
            </template>
          </ErrorAlert>

          <ErrorAlert v-if="actionError" closable :error="actionError" @close="actionError = null" />

          <ErrorAlert v-if="listError" closable :error="listError" @close="listError = null">
            <template #actions>
              <v-btn :text="t('problem.retry')" @click="refresh" />
            </template>
          </ErrorAlert>
        </div>

        <v-progress-linear v-if="!engines" />

        <EngineMissing v-else-if="!engineRunning" :engines="engines" />

        <NewInstanceWizard
          v-else-if="wizard"
          :key="wizard.key"
          :existing="existingNames"
          :import-info="wizard.importInfo"
          :stack="wizard.stack"
          @cancel="closeWizard"
          @done="onWizardDone"
        />

        <template v-else-if="list">
          <v-empty-state
            v-if="stacks.length === 0"
            icon="mdi-server"
            :text="t('list.emptyText')"
            :title="t('list.emptyTitle')"
          >
            <template #actions>
              <v-btn-primary prepend-icon="mdi-plus" :text="t('list.new')" @click="openWizard()" />
              <v-btn-secondary prepend-icon="mdi-import" :text="t('list.import')" @click="importStack" />
            </template>
          </v-empty-state>

          <InstanceDetail
            v-else-if="selected"
            :key="selected.id"
            :job="jobs.get(selected.id) ?? null"
            :stack="selected"
            @change="openWizard(selected)"
            @dismiss-job="dismissJob(selected.id)"
            @job="track"
          />
        </template>

        <v-progress-linear v-else-if="!listError" />
      </div>
    </div>
  </v-sheet-full-page>
</template>

<script lang="ts" setup>
  import type { DockerClient } from './support'
  import type { Engines, Job, Stack, StackImport, StackList } from '@basyx/studio-sdk'
  import { computed, onBeforeUnmount, onMounted, provide, reactive, ref } from 'vue'
  import EngineMissing from './EngineMissing.vue'
  import EngineStatus from './EngineStatus.vue'
  import ErrorAlert from './ErrorAlert.vue'
  import { provideI18n } from './i18n'
  import InstanceDetail from './InstanceDetail.vue'
  import NewInstanceWizard from './NewInstanceWizard.vue'
  import { createEngineRequestQueue, startContainerPolling } from './polling'
  import { clientKey, presetIcons, problemOf, statusColors } from './support'

  // BaSyx Docker (ADR 0033): finds Docker or Podman, lists the instances,
  // and follows their jobs. All work happens in the Studio Service.
  const props = defineProps<{ client: DockerClient }>()
  provide(clientKey, props.client)
  const { t } = provideI18n()
  const containers = props.client.containers
  const engineRequest = createEngineRequestQueue()

  const engines = ref<Engines | null>(null)
  const list = ref<StackList | null>(null)
  const engineError = ref<unknown | null>(null)
  const actionError = ref<unknown | null>(null)
  const listError = ref<unknown | null>(null)
  /** The running or last finished job per stack. */
  const jobs = reactive(new Map<string, Job>())
  const wizard = ref<{ key: number, stack: Stack | null, importInfo: StackImport | null } | null>(null)
  const selectedId = ref<string | null>(null)

  const engineRunning = computed(() => Boolean(engines.value?.selected?.running))
  const existingNames = computed(() => list.value?.items.map(stack => stack.name) ?? [])
  /** The instances Studio knows: containers it finds without a stored instance stay hidden. */
  const stacks = computed(() => list.value?.items.filter(stack => stack.status !== 'orphan') ?? [])
  /** The chosen instance, else the first one. */
  const selected = computed(() => stacks.value.find(stack => stack.id === selectedId.value) ?? stacks.value[0] ?? null)

  function rowSubtitle (stack: Stack): string {
    const status = t(`status.${stack.status}`)
    return stack.spec ? `${status} · ${t(`preset.${stack.spec.preset}`)}` : status
  }

  function select (stackId: string) {
    selectedId.value = stackId
    wizard.value = null
  }

  async function checkEngines () {
    try {
      engines.value = await engineRequest(() => containers.listEngines())
      engineError.value = null
    } catch (error) {
      engineError.value = error
      engines.value = { selected: null, candidates: [], configured: null }
    }
  }

  async function selectEngine (host: string | null) {
    try {
      engines.value = await engineRequest(() => containers.selectEngine(host))
      await refresh()
    } catch (error) {
      actionError.value = error
    }
  }

  async function refresh () {
    if (!engineRunning.value) {
      return
    }
    try {
      // Listing can also discover engines after the backend cache expires.
      list.value = await engineRequest(() => containers.listStacks())
      listError.value = null
      for (const stack of list.value.items) {
        if (stack.jobId && jobs.get(stack.id)?.id !== stack.jobId) {
          jobs.set(stack.id, await containers.getJob(stack.jobId))
        }
      }
      if (!list.value.engineAvailable) {
        await checkEngines()
      }
    } catch (error) {
      if (problemOf(error)?.code === 'container_engine_unavailable') {
        await checkEngines()
      } else {
        listError.value = error
      }
    }
  }

  function track (job: Job) {
    jobs.set(job.stackId, job)
  }

  function dismissJob (stackId: string) {
    jobs.delete(stackId)
  }

  /** Follows running jobs and tells Studio when one ends. */
  async function followJobs () {
    for (const [stackId, job] of jobs) {
      if (job.state !== 'running') {
        continue
      }
      try {
        const next = await containers.getJob(job.id)
        jobs.set(stackId, next)
        if (next.state !== 'running') {
          const name = list.value?.items.find(stack => stack.id === stackId)?.name ?? ''
          if (next.state === 'succeeded') {
            const key = next.kind === 'stop' ? 'job.succeededStop' : (next.kind === 'remove' ? 'job.succeededRemove' : 'job.succeededCreate')
            void props.client.ui.notify(t(key, { name }), 'success')
            if (next.kind === 'stop' || next.kind === 'remove') {
              jobs.delete(stackId)
            }
          }
          await refresh()
        }
      } catch (error) {
        actionError.value = error
        jobs.delete(stackId)
      }
    }
  }

  function openWizard (stack: Stack | null = null, importInfo: StackImport | null = null) {
    wizard.value = { key: Date.now(), stack, importInfo }
  }

  function closeWizard () {
    wizard.value = null
  }

  async function onWizardDone (job: Job) {
    wizard.value = null
    selectedId.value = job.stackId
    track(job)
    await refresh()
  }

  async function importStack () {
    actionError.value = null
    try {
      const imported = await containers.importStack()
      if (imported) {
        openWizard(null, imported)
      }
    } catch (error) {
      actionError.value = error
    }
  }

  let stopPolling: (() => void) | undefined
  onMounted(() => {
    stopPolling = startContainerPolling({
      isVisible: () => document.visibilityState === 'visible',
      isEngineRunning: () => engineRunning.value,
      hasRunningJobs: () => [...jobs.values()].some(job => job.state === 'running'),
      checkEngines,
      refresh,
      followJobs,
      onError: error => (actionError.value = error),
    })
  })

  onBeforeUnmount(() => stopPolling?.())
</script>
