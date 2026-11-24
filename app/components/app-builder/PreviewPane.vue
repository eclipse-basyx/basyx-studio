<template>
  <div class="d-flex flex-column fill-height overflow-hidden" data-test="app-builder-preview">
    <v-sheet-preview-toolbar>
      <div class="text-title-small flex-grow-1">{{ t('preview.title') }}</div>

      <v-chip
        v-if="preview"
        :color="buildColors[preview.build.state]"
        data-test="app-builder-build-state"
        :prepend-icon="buildIcons[preview.build.state]"
        :text="t(`previewBuild.${preview.build.state}`)"
      />

      <v-btn
        v-if="conversationId && !detached"
        ref="annotateButton"
        v-tooltip="t('annotations.toggle')"
        :active="annotating"
        :aria-label="t('annotations.toggle')"
        :aria-pressed="annotating"
        data-test="app-builder-annotate"
        :disabled="!pickerReady || building || approving || annotationDisabled"
        icon="mdi-comment-plus-outline"
        @click="annotating = !annotating"
      />

      <v-btn
        v-if="desktop?.openAppPreview && !detached"
        v-tooltip="t('preview.popOut')"
        :aria-label="t('preview.popOut')"
        data-test="app-builder-preview-popout"
        icon="mdi-open-in-new"
        :loading="opening"
        @click="popOut"
      />

      <v-btn
        v-tooltip="t('preview.rebuild')"
        :aria-label="t('preview.rebuild')"
        data-test="app-builder-rebuild"
        icon="mdi-refresh"
        :loading="building || preview?.build.state === 'running'"
        @click="rebuild"
      />

      <v-btn
        v-tooltip="detached ? t('preview.closeWindow') : t('preview.close')"
        :aria-label="detached ? t('preview.closeWindow') : t('preview.close')"
        icon="mdi-close"
        @click="emit('close')"
      />
    </v-sheet-preview-toolbar>

    <div class="d-flex flex-column ga-2 pa-2 flex-grow-1 overflow-y-auto bg-background">
      <ProblemAlert v-if="error" :error="error" />

      <v-progress-linear v-if="!preview && !error" />

      <template v-else-if="preview">
        <v-card v-if="preview.consent" data-test="app-builder-preview-consent">
          <v-card-item prepend-icon="mdi-shield-check-outline" :subtitle="t('preview.consentText')" :title="preview.consent.first ? t('preview.consentFirst') : t('preview.consentChanged')" />

          <v-card-text>
            <div class="text-label-large mb-1">{{ preview.consent.first ? t('preview.permissions') : t('preview.added') }}</div>

            <div class="d-flex flex-wrap ga-1">
              <v-chip v-for="entry in preview.consent.added" :key="entry" :text="entry" />
            </div>
          </v-card-text>

          <v-card-actions>
            <v-btn-primary data-test="app-builder-preview-allow" :loading="approving" :text="t('preview.allow')" @click="approve" />
          </v-card-actions>
        </v-card>

        <div v-if="!preview.contributions && !preview.consent" class="text-center text-medium-emphasis py-8">
          <v-icon icon="mdi-application-outline" size="40" />
          <div class="text-body-medium mt-2">{{ preview.build.state === 'running' ? t('preview.building') : t('preview.none') }}</div>
        </div>

        <template v-else-if="preview.contributions">
          <div class="d-flex flex-wrap ga-2">
            <v-select
              v-model="selectedKey"
              data-test="app-builder-preview-entry"
              hide-details
              item-title="title"
              item-value="key"
              :items="entries"
              :label="t('preview.show')"
              min-width="200"
            />

            <v-select
              v-if="needsTarget"
              v-model="targetId"
              data-test="app-builder-preview-target"
              hide-details
              item-title="name"
              item-value="id"
              :items="targets.data.value?.items ?? []"
              :label="t('preview.target')"
              min-width="200"
            />
          </div>

          <div v-if="needsShell && targetId" class="d-flex flex-wrap align-center ga-2">
            <v-btn-secondary data-test="app-builder-preview-shell" prepend-icon="mdi-cube-outline" :text="shell ? shellLabel : t('preview.chooseShell')" @click="picking = true" />

            <v-select
              v-if="selected?.kind === 'submodelView' && shell"
              v-model="submodelId"
              data-test="app-builder-preview-submodel"
              hide-details
              item-title="title"
              item-value="id"
              :items="submodels"
              :label="t('preview.submodel')"
              :loading="refs.isPending.value"
              min-width="220"
              :no-data-text="t('preview.noSubmodel')"
            />
          </div>

          <v-alert v-if="needsTarget && !targetId" :text="t('preview.needsTarget')" type="info" />

          <template v-else-if="needsTarget && target.data.value?.id !== targetId">
            <v-progress-linear />
          </template>

          <TargetAuthorization v-else-if="needsTarget && target.data.value && target.needsAuthorization.value" :target="target.data.value" @authorized="target.refetch()" />

          <v-alert v-else-if="needsShell && !shell" :text="t('preview.needsShell')" type="info" />

          <v-alert v-else-if="selected?.kind === 'submodelView' && !submodel" :text="t('preview.needsSubmodel')" type="info" />

          <v-card-pane v-else-if="selected" class="flex-grow-1">
            <AppFrame
              :key="frameKey"
              :contribution="selected"
              :overlay-active="annotating"
              :shell-id="shell?.id ?? null"
              :sub-path="subPath"
              :submodel="submodel"
              :target="needsTarget ? target.data.value ?? null : null"
              @navigate="path => (subPath = path)"
            >
              <template #overlay="{ frame, loadSequence }">
                <PreviewElementPicker
                  v-if="conversationId && !detached && selected.frameOrigin"
                  :key="annotationScope"
                  v-model="annotating"
                  :frame="frame"
                  :load-sequence="loadSequence"
                  :markers="annotationMarkers"
                  :next-number="nextAnnotationNumber"
                  :origin="selected.frameOrigin"
                  @pick="addAnnotation"
                  @ready="pickerAvailability"
                />
              </template>
            </AppFrame>
          </v-card-pane>
        </template>
      </template>
    </div>

    <ShellPickerDialog
      v-if="targetId"
      v-model="picking"
      :target-id="targetId"
      :title="t('preview.chooseShell')"
      @pick="choose"
    />
  </div>
</template>

<script lang="ts" setup>
  import type { PreviewElement } from '#shared/app-preview-picker'
  import type { PreviewSelection } from '#shared/app-preview-window'
  import type { AppContributionInfo, AppPreview, ShellSummary, SubmodelRef, Target } from '#shared/contract'
  import type { PreviewAnnotation } from './annotation-draft'
  import { useQuery } from '@pinia/colada'
  import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
  import { useI18n } from './i18n'
  import PreviewElementPicker from './PreviewElementPicker.vue'

  // The app as the last build made it (ADR 0054, plan B3): its preview
  // installation in a frame like any app's, on a target the user picks.
  const props = defineProps<{
    projectId: string
    buildSeq: number
    defaultTargetId: string | null
    initialSelection?: PreviewSelection | null
    detached?: boolean
    conversationId?: string
    annotationDisabled?: boolean
    notes?: readonly PreviewAnnotation[]
  }>()
  const emit = defineEmits<{
    'close': []
    'annotation-context': [key: string]
    'annotate': [annotation: Omit<PreviewAnnotation, 'id' | 'text'>]
  }>()
  const { t } = useI18n()
  const client = useAppBuilderClient()
  const api = useStudioApi()
  const navigation = useNavigationStore()
  const desktop = useDesktopBridge()
  const label = useLocalizedLabel()

  const preview = ref<AppPreview | null>(null)
  const error = ref<unknown>(null)
  const building = ref(false)
  const approving = ref(false)
  const opening = ref(false)
  const selectedKey = ref<string | null>(props.initialSelection?.entryKey ?? null)
  const targetId = ref<string | null>(props.initialSelection ? props.initialSelection.targetId : props.defaultTargetId ?? navigation.currentTarget)
  const shell = ref<PreviewSelection['shell']>(props.initialSelection?.shell ?? null)
  const submodelId = ref<string | null>(props.initialSelection?.submodelId ?? null)
  const subPath = ref(props.initialSelection?.subPath ?? '')
  const picking = ref(false)
  const annotating = ref(false)
  const pickerReady = ref(false)
  const annotateButton = useTemplateRef<{ $el: HTMLElement }>('annotateButton')

  const buildColors = { none: undefined, running: undefined, succeeded: 'success', failed: 'error' } as const
  const buildIcons = { none: 'mdi-minus', running: 'mdi-progress-clock', succeeded: 'mdi-check', failed: 'mdi-alert-circle-outline' } as const

  let refreshing = false
  let loadVersion = 0
  async function load () {
    if (refreshing || building.value || approving.value) {
      return
    }
    refreshing = true
    const version = ++loadVersion
    try {
      const loaded = await client.call('getPreview', { projectId: props.projectId })
      if (version === loadVersion) {
        preview.value = loaded
        error.value = null
      }
    } catch (error_) {
      if (version === loadVersion) {
        error.value = error_
      }
    } finally {
      refreshing = false
    }
  }

  async function rebuild () {
    loadVersion++
    building.value = true
    try {
      preview.value = await client.call('buildPreview', { projectId: props.projectId })
      error.value = null
    } catch (error_) {
      error.value = error_
    }
    building.value = false
  }

  async function approve () {
    const digest = preview.value?.consent?.digest
    if (!digest) {
      return
    }
    loadVersion++
    approving.value = true
    try {
      // The OK names the package the user saw; a newer build asks again (`preview_changed`).
      preview.value = await client.call('approvePreview', { projectId: props.projectId, digest })
      error.value = null
    } catch (error_) {
      error.value = error_
      // Shows what the waiting package asks for now, next to the problem.
      preview.value = await client.call('getPreview', { projectId: props.projectId }).catch(() => preview.value)
    }
    approving.value = false
  }

  async function popOut () {
    if (!desktop?.openAppPreview) {
      return
    }
    opening.value = true
    try {
      await desktop.openAppPreview({
        projectId: props.projectId,
        selection: {
          entryKey: selectedKey.value, targetId: targetId.value,
          shell: shell.value ? { id: shell.value.id, idShort: shell.value.idShort, displayName: shell.value.displayName } : null,
          submodelId: submodelId.value, subPath: subPath.value,
        },
      })
      emit('close')
    } catch (error_) {
      error.value = error_
    } finally {
      opening.value = false
    }
  }

  // A separate renderer has no chat transcript to trigger a refresh. Keep
  // its preview current after builds, including builds from a new chat.
  let refreshTimer: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    if (props.detached) {
      refreshTimer = setInterval(() => void load(), 2000)
    } else {
      window.addEventListener('keydown', cancelOnEscape, true)
    }
  })
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', cancelOnEscape, true)
    clearInterval(refreshTimer)
    loadVersion++
  })

  // Each build event of the chat may have changed the preview.
  watch(() => [props.projectId, props.buildSeq], load, { immediate: true })

  const entries = computed(() => {
    const contributions = preview.value?.contributions
    return [
      ...(contributions?.modules ?? []).map(entry => ({ key: `module:${entry.id}`, title: label(entry.title), entry: entry as AppContributionInfo })),
      ...(contributions?.submodelViews ?? []).map(entry => ({ key: `view:${entry.id}`, title: label(entry.title), entry: entry as AppContributionInfo })),
    ]
  })
  watch(entries, list => {
    if (preview.value && !list.some(entry => entry.key === selectedKey.value)) {
      selectedKey.value = list[0]?.key ?? null
    }
  }, { immediate: true })
  const selected = computed(() => entries.value.find(entry => entry.key === selectedKey.value)?.entry ?? null)

  const needsTarget = computed(() => selected.value?.kind === 'submodelView' || (selected.value?.kind === 'module' && selected.value.context !== 'global'))
  const needsShell = computed(() => selected.value?.kind === 'submodelView' || (selected.value?.kind === 'module' && selected.value.context === 'shell'))

  const targets = useQuery({
    key: ['targets'],
    query: ({ signal }) => api<{ items: Target[] }>('/targets', { signal }),
  })
  const target = useTarget(() => targetId.value ?? '')
  watch(targetId, () => {
    shell.value = null
    submodelId.value = null
    subPath.value = ''
  })

  const shellLabel = computed(() => {
    const value = shell.value
    return value ? (value.displayName[0]?.text ?? value.idShort ?? value.id) : ''
  })

  function choose (picked: ShellSummary) {
    shell.value = picked
    submodelId.value = null
    subPath.value = ''
  }

  const refs = useQuery({
    key: () => ['app-builder-preview-refs', targetId.value ?? '', shell.value?.id ?? ''],
    query: ({ signal }) => api<{ items: SubmodelRef[] }>(`/targets/${targetId.value}/shells/${resourceKey(shell.value!.id)}/submodel-refs`, { signal }),
    enabled: () => targetId.value !== null && shell.value !== null && selected.value?.kind === 'submodelView',
  })

  const submodels = computed(() => {
    const view = selected.value
    const semanticId = view?.kind === 'submodelView' ? view.reason.semanticId : null
    const available = (refs.data.value?.items ?? []).filter(item => item.status === 'available')
    const matching = available.filter(item => item.semanticId === semanticId)
    return (matching.length > 0 ? matching : available).map(item => ({ id: item.submodelId, title: item.idShort ?? item.submodelId, semanticId: item.semanticId }))
  })
  watch(submodels, list => {
    if (!refs.isPending.value && !list.some(item => item.id === submodelId.value)) {
      submodelId.value = list[0]?.id ?? null
    }
  })
  const submodel = computed(() => {
    const found = submodels.value.find(item => item.id === submodelId.value)
    return found ? { id: found.id, semanticId: found.semanticId } : null
  })

  // A new build (digest), app part, target, shell or submodel is a new frame.
  const frameKey = computed(() => JSON.stringify([selected.value?.installationId, selected.value?.digest, selectedKey.value, targetId.value, shell.value?.id, submodel.value?.id]))
  const annotationKey = computed(() => JSON.stringify([frameKey.value, subPath.value]))
  const annotationScope = computed(() => JSON.stringify([props.conversationId, annotationKey.value]))
  const nextAnnotationNumber = computed(() => (props.notes?.at(-1)?.number ?? 0) + 1)
  const annotationMarkers = computed(() => (props.notes ?? [])
    .filter(note => note.previewKey === annotationKey.value && !note.earlierBuild)
    .map(note => ({ number: note.number, id: note.element.markerId })))
  watch(annotationKey, key => {
    if (selected.value) {
      emit('annotation-context', key)
    }
  }, { immediate: true })
  watch(() => [annotationScope.value, props.buildSeq, building.value, approving.value, props.annotationDisabled], () => {
    annotating.value = false
  }, { flush: 'sync' })

  function addAnnotation (element: PreviewElement) {
    if (props.conversationId && selectedKey.value && selected.value && !props.annotationDisabled) {
      emit('annotate', {
        element,
        number: nextAnnotationNumber.value,
        previewName: label(selected.value.title),
        contribution: selectedKey.value,
        subPath: subPath.value,
        digest: selected.value.digest,
        previewKey: annotationKey.value,
      })
    }
  }

  function pickerAvailability (ready: boolean) {
    pickerReady.value = ready
    if (!ready) {
      annotating.value = false
    }
  }

  function cancelOnEscape (event: KeyboardEvent) {
    if (event.key === 'Escape' && annotating.value) {
      event.preventDefault()
      event.stopPropagation()
      annotating.value = false
      annotateButton.value?.$el.focus({ preventScroll: true })
    }
  }
</script>
