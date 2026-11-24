<template>
  <div class="d-flex flex-column flex-grow-1 position-relative">
    <!-- A frame that never connects (D14) says so, and why, instead of staying blank. -->
    <v-alert
      v-if="startProblem && !connected"
      class="ma-2"
      :text="startProblemText"
      :title="t('apps.notStarted')"
      type="warning"
    >
      <template #append>
        <v-btn :text="t('problem.retry')" @click="retry" />
      </template>
    </v-alert>

    <!-- Over the frame's top edge, taking no space: a widget fitted to the
         frame's height does not grow a scrollbar while the app starts. -->
    <v-progress-linear v-else-if="!connected" absolute location="top" />

    <!-- Created only on the client, after the bridge listens: a frame in
         server-rendered HTML would load before hydration, and after the
         target's settings arrived, so the first context has them (ADR 0048).
         Hidden until the app connects, so its blank (white) page does not
         flash in dark mode; while the start problem shows, it takes no
         space, so a widget fits the alert and does not scroll. -->
    <iframe
      v-if="mounted && targetContext.status.value !== 'pending'"
      :key="attempt"
      ref="frame"
      :class="['w-100 border-0', startProblem && !connected ? 'd-none' : 'd-block', fit ? undefined : 'flex-grow-1', connected ? undefined : 'opacity-0']"
      :height="fit ? (height ?? 480) : undefined"
      referrerpolicy="no-referrer"
      :sandbox="contribution.frameOrigin ? 'allow-scripts allow-same-origin' : 'allow-scripts'"
      :src="contribution.entryUrl"
      :title="t('apps.frameTitle', { name: label(contribution.title) })"
      @load="onLoad"
    />

    <!-- The same view again, filling the window (studio.ui.openFullscreen):
         a second frame, so the embedded one keeps its size and state. Without
         Studio's header, the frame alone shows over the dimmed page, e.g. a
         file preview, and closes itself (studio.ui.closeFullscreen). The
         frame is created once the dialog has scaled in: Chromium may keep
         a cross-origin frame created while the dialog is still hidden
         (visibility: hidden) throttled, and then hit-tests clicks only to
         the iframe element, never into the app. -->
    <v-dialog
      v-if="!nested"
      v-model="fullscreenOpen"
      fullscreen
      :opacity="fullscreenHeader ? undefined : 0.84"
      @after-enter="fullscreenShown = true"
      @after-leave="fullscreenShown = false"
    >
      <v-card-fullscreen class="d-flex flex-column" :color="fullscreenHeader ? undefined : 'transparent'" data-test="app-fullscreen" height="100%">
        <template v-if="fullscreenHeader">
          <v-toolbar class="flex-shrink-0" :title="label(contribution.title)">
            <template #append>
              <v-btn :aria-label="t('common.close')" data-test="app-fullscreen-close" icon="mdi-close" @click="fullscreenOpen = false" />
            </template>
          </v-toolbar>

          <v-divider />
        </template>

        <app-frame
          v-if="fullscreenShown"
          :contribution="contribution"
          fullscreen
          :nested="fullscreen"
          :shell-id="shellId"
          :sub-path="subPath"
          :submodel="submodel"
          :target="target"
          :view-state="fullscreenState"
          @close-fullscreen="fullscreenOpen = false"
        />
      </v-card-fullscreen>
    </v-dialog>

    <!-- Another app's view of a submodel (studio.ui.openView, ADR 0051): a
         frame with its own contribution, permissions and origin over this
         one, which stays as it is underneath until the dialog closes. A
         view embedded in this frame's page opens itself here as well. Its
         frame, too, is created once the dialog has scaled in. -->
    <v-dialog
      v-if="!fullscreen"
      v-model="viewOpen"
      fullscreen
      @after-enter="viewShown = true"
      @after-leave="viewShown = false"
    >
      <v-card-fullscreen v-if="openedView" class="d-flex flex-column" data-test="app-view-dialog" height="100%">
        <AppOpenedView
          :opened="openedView"
          :shown="viewShown"
          :target="target"
          :view-state="openedViewState"
          @close="viewOpen = false"
        />
      </v-card-fullscreen>
    </v-dialog>
  </div>
</template>

<script lang="ts" setup>
  import type { AppContext, AppContributionInfo, AppTargetContext, OpenedView, Target } from '#shared/contract'
  import type { AppStartProblem } from '~/utils/app-start'
  import { useQuery } from '@pinia/colada'
  import { useTheme } from 'vuetify'
  import { appProtocol } from '#shared/contract'

  // A sandboxed app frame (ADR 0017): no popups, forms or top navigation, and
  // an opaque origin, unless the installation has an origin of its own
  // (ADR 0045), which it then keeps, so pages it embeds keep theirs. Key it by
  // target (and submodel), so a new target always gets a new frame and never
  // sees the previous target's data.
  const props = defineProps<{
    contribution: AppContributionInfo
    target: Target | null
    shellId?: string | null
    submodel?: { id: string, semanticId: string | null } | null
    subPath?: string
    /** Size the frame to the app's content (`studio.ui.setHeight`) instead of filling the container. */
    fit?: boolean
    /** The frame inside a full-screen dialog; it may open one more, without Studio's header. */
    fullscreen?: boolean
    /** The frame of such a second dialog; it opens no further one. */
    nested?: boolean
    /** In that dialog, the state the embedded view passed to `studio.ui.openFullscreen`. */
    viewState?: string
    /** Studio draws a full-screen button for the frame, e.g. on an Overview card (`context.fullscreenControl`). */
    fullscreenControl?: boolean
  }>()
  const emit = defineEmits<{
    'navigate': [subPath: string, history: 'push' | 'replace']
    /** The app's content height (`studio.ui.setHeight`), for a container that sizes itself to it. */
    'content-height': [height: number]
    /** The app closed the full-screen dialog it runs in (`studio.ui.closeFullscreen`). */
    'close-fullscreen': []
  }>()

  const { t, locale } = useI18n()
  const api = useStudioApi()
  const theme = useTheme()
  const preferences = usePreferences()
  const ui = useUiStore()
  const label = useLocalizedLabel()
  const frame = useTemplateRef<HTMLIFrameElement>('frame')

  const themeColors = computed(() => Object.fromEntries(Object.entries(theme.current.value.colors)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')))

  // The app's settings and connection status on this target (ADR 0048).
  // Without them (an error), the app sees no values and no bindings.
  const targetContext = useQuery({
    key: () => ['app-context', props.contribution.installationId, props.target?.id ?? ''],
    query: ({ signal }) => api<AppTargetContext>(`/app-installations/${props.contribution.installationId}/context`, {
      query: props.target ? { targetId: props.target.id } : {},
      signal,
    }),
  })

  const context = computed<AppContext>(() => ({
    protocol: appProtocol,
    installationId: props.contribution.installationId,
    appId: props.contribution.appId,
    contribution: { kind: props.contribution.kind, id: props.contribution.id },
    target: props.target
      ? {
        id: props.target.id,
        name: props.target.name,
        write: props.target.capabilities.write,
        persistence: props.target.capabilities.persistence,
      }
      : null,
    shell: props.shellId ? { id: props.shellId } : null,
    submodel: props.submodel ? { ...props.submodel } : null,
    subPath: props.subPath ?? '',
    mode: ui.mode,
    fullscreen: props.fullscreen ?? false,
    fills: !props.fit,
    fullscreenOpen: fullscreenOpen.value || viewOpen.value,
    fullscreenControl: props.fullscreenControl ?? false,
    viewState: props.viewState ?? '',
    locale: locale.value,
    theme: { dark: theme.current.value.dark, colors: themeColors.value, shape: preferences.preferences.value.shape },
    settings: targetContext.data.value?.settings ?? {},
    connections: targetContext.data.value?.connections ?? {},
  }))

  const mounted = ref(false)
  const fullscreenOpen = ref(false)
  /** Whether the full-screen dialog has scaled in, so its frame may be created. */
  const fullscreenShown = ref(false)
  /** Another app's view this frame opened (`studio.ui.openView`), shown until the user closes it. */
  const openedView = shallowRef<OpenedView | null>(null)
  /** The state a view embedded in this frame's page opens itself with (ADR 0051). */
  const openedViewState = ref('')
  const viewOpen = ref(false)
  /** Whether the dialog of another app's view has scaled in, so its frame may be created. */
  const viewShown = ref(false)
  function openView (view: OpenedView, state = '') {
    openedView.value = view
    openedViewState.value = state
    viewOpen.value = true
  }
  /** What the view handed to `studio.ui.openFullscreen`, for the frame in the dialog. */
  const fullscreenState = ref('')
  /** Whether the dialog shows Studio's header with the view's title and a close button. */
  const fullscreenHeader = ref(true)
  /** What the view last said it shows (`studio.ui.setViewState`); Studio's full-screen button opens it with that. */
  const reportedState = ref('')
  function openFullscreen (state = '', header = true) {
    // Inside a full-screen dialog, only a header-less one opens above it.
    if (props.fullscreen && header) {
      return
    }
    fullscreenState.value = state
    fullscreenHeader.value = header
    fullscreenOpen.value = true
  }
  /** Seconds an app may take to connect before the frame offers a retry. */
  const startTimeoutMs = 15_000
  /** Set once the start timed out and the entry file was checked. */
  const startProblem = ref<AppStartProblem | null>(null)
  const attempt = ref(0)
  let startTimer: ReturnType<typeof setTimeout> | undefined
  function watchStart () {
    startProblem.value = null
    clearTimeout(startTimer)
    const started = attempt.value
    startTimer = setTimeout(async () => {
      const problem = await diagnoseAppStart(props.contribution.entryUrl)
      // A retry or a late connection while the check ran wins.
      if (started === attempt.value && !connected.value) {
        startProblem.value = problem
      }
    }, startTimeoutMs)
  }
  const startProblemText = computed(() => {
    const problem = startProblem.value
    const host = URL.parse(props.contribution.entryUrl)?.host ?? props.contribution.entryUrl
    switch (problem?.kind) {
      case 'unreachable': {
        return t('apps.notStartedUnreachable', { host })
      }
      case 'error': {
        return t('apps.notStartedError', { host, status: problem.status })
      }
      default: {
        return t('apps.notStartedBlocked', { host })
      }
    }
  })
  function retry () {
    attempt.value++
    watchStart()
  }
  // An update in place keeps the entry URL: load the new version, whose
  // package the bridge then binds the frame's calls to (ADR 0044).
  watch(() => props.contribution.digest, retry)
  onMounted(() => {
    mounted.value = true
    watchStart()
  })
  onBeforeUnmount(() => clearTimeout(startTimer))

  const { connected, height, onLoad } = useAppBridge(frame, {
    contribution: () => props.contribution,
    targetId: props.target?.id ?? null,
    context: () => context.value,
    onNavigate: (subPath, history) => emit('navigate', subPath, history),
    onOpenFullscreen: props.nested ? undefined : openFullscreen,
    onCloseFullscreen: props.fullscreen ? () => emit('close-fullscreen') : undefined,
    onViewState: state => {
      reportedState.value = state
    },
    onOpenView: props.fullscreen ? undefined : openView,
    shownView: () => viewOpen.value ? openedView.value : null,
  })
  watch(height, value => {
    if (value !== null) {
      emit('content-height', value)
    }
  })
  defineExpose({ openFullscreen: () => openFullscreen(reportedState.value) })
  watch(connected, value => {
    if (value) {
      clearTimeout(startTimer)
      startProblem.value = null
    }
  })
</script>
