<template>
  <v-sheet
    v-if="ready && (active || placedMarkers.length > 0)"
    class="position-absolute top-0 left-0 w-100 h-100 overflow-hidden"
    :class="active ? 'cursor-pointer' : 'pointer-events-none'"
    color="transparent"
    :data-test="active ? 'app-builder-picker-surface' : undefined"
    @click.stop="inspect('pick', $event)"
    @pointerleave="leavePointer"
    @pointermove="inspect('hover', $event)"
    @wheel="scroll"
  >
    <svg
      ref="surface"
      :aria-describedby="active ? hintId : undefined"
      :aria-hidden="!active"
      :aria-label="t('annotations.toggle')"
      class="d-block text-primary"
      height="100%"
      role="group"
      :tabindex="active ? 0 : undefined"
      width="100%"
      @keydown="keyNavigate"
    >
      <rect
        v-if="active && highlight"
        data-test="app-builder-picker-highlight"
        fill="currentColor"
        fill-opacity="0.12"
        :height="highlight.height"
        rx="4"
        stroke="currentColor"
        stroke-width="2"
        :width="highlight.width"
        :x="highlight.x"
        :y="highlight.y"
      />

      <g v-for="marker in displayedMarkers" :key="marker.number" :data-test="marker.number === nextNumber ? undefined : 'app-builder-annotation-marker'">
        <circle :cx="marker.x" :cy="marker.y" fill="currentColor" :r="badgeRadius" />

        <text
          dominant-baseline="central"
          fill="rgb(var(--v-theme-on-primary))"
          font-size="12"
          text-anchor="middle"
          :x="marker.x"
          :y="marker.y"
        >{{ marker.number }}</text>
      </g>
    </svg>

    <v-card
      v-if="active"
      :id="hintId"
      class="position-absolute bottom-0 left-0 ma-2 px-3 py-2 d-flex align-center ga-2 text-body-small pointer-events-none"
      color="surface"
      data-test="app-builder-picker-hint"
    >
      <v-icon color="primary" icon="mdi-comment-plus-outline" size="small" />
      {{ t('annotations.picking') }}
    </v-card>

    <span v-if="active" class="d-sr-only" role="status">{{ keyboardTag ? t('annotations.highlighted', { tag: keyboardTag }) : '' }}</span>
  </v-sheet>
</template>

<script lang="ts" setup>
  import type { PreviewAnnotationMarker, PreviewElement, PreviewElementRect } from '#shared/app-preview-picker'
  import { previewPickerProtocol } from '#shared/app-preview-picker'
  import { useI18n } from './i18n'
  import { previewPickerReply } from './preview-picker-reply'

  const props = defineProps<{
    frame: HTMLIFrameElement
    origin: string
    loadSequence: number
    markers: readonly PreviewAnnotationMarker[]
    nextNumber: number
  }>()
  const active = defineModel<boolean>({ required: true })
  const emit = defineEmits<{ ready: [ready: boolean], pick: [element: PreviewElement] }>()
  const { t } = useI18n()
  const hintId = useId()
  const surface = useTemplateRef<SVGSVGElement>('surface')
  const ready = ref(false)
  const highlight = shallowRef<PreviewElementRect | null>(null)
  const placedMarkers = shallowRef<{ number: number, rect: PreviewElementRect }[]>([])
  const keyboardTag = ref<string | null>(null)
  const badgeRadius = 11
  const displayedMarkers = computed(() => {
    const width = props.frame.clientWidth
    const height = props.frame.clientHeight
    const markers = active.value && highlight.value ? [...placedMarkers.value, { number: props.nextNumber, rect: highlight.value }] : placedMarkers.value
    const occupied = new Map<string, number>()
    return markers.map(({ number, rect }) => {
      const anchorX = Math.min(width - badgeRadius, Math.max(badgeRadius, rect.x + rect.width - badgeRadius))
      const y = Math.min(height - badgeRadius, rect.y + badgeRadius)
      const key = `${Math.round(anchorX)},${Math.round(y)}`
      const index = occupied.get(key) ?? 0
      occupied.set(key, index + 1)
      const x = anchorX + index * (badgeRadius * 2 + 2) * (anchorX > width / 2 ? -1 : 1)
      return { number, x: Math.min(width - badgeRadius, Math.max(badgeRadius, x)), y }
    })
  })
  let session = ''
  let requestSequence = 0
  let hoverRequest = 0
  let pickRequest = 0
  let markerRequest = 0
  let usingKeyboard = false

  function send (type: 'probe' | 'reset' | 'hover' | 'pick' | 'move' | 'pick-highlighted' | 'scroll' | 'markers', detail?: object) {
    props.frame.contentWindow?.postMessage({ protocol: previewPickerProtocol, session, type, ...detail }, props.origin)
  }

  function clearHover () {
    highlight.value = null
    keyboardTag.value = null
    hoverRequest = 0
  }

  function leavePointer () {
    if (active.value && !usingKeyboard) {
      clearHover()
      send('reset')
    }
  }

  function point (event: MouseEvent) {
    const bounds = props.frame.getBoundingClientRect()
    return { x: event.clientX - bounds.x, y: event.clientY - bounds.y }
  }

  function inspect (type: 'hover' | 'pick', event: MouseEvent) {
    if (!event.isTrusted || !active.value || (type === 'pick' && event.button !== 0)) {
      return
    }
    usingKeyboard = false
    const request = ++requestSequence
    if (type === 'hover') {
      hoverRequest = request
    } else {
      pickRequest = request
    }
    send(type, { request, ...point(event) })
  }

  function scroll (event: WheelEvent) {
    if (!event.isTrusted || !active.value || event.ctrlKey || event.metaKey) {
      return
    }
    event.preventDefault()
    usingKeyboard = false
    const deltaMode = event.deltaMode
    const scaleX = deltaMode === 2 ? props.frame.clientWidth : (deltaMode === 1 ? 16 : 1)
    const scaleY = deltaMode === 2 ? props.frame.clientHeight : (deltaMode === 1 ? 16 : 1)
    hoverRequest = ++requestSequence
    send('scroll', { request: hoverRequest, ...point(event), deltaX: event.deltaX * scaleX, deltaY: event.deltaY * scaleY })
  }

  function keyNavigate (event: KeyboardEvent) {
    if (!event.isTrusted || !active.value || event.altKey || event.ctrlKey || event.metaKey) {
      return
    }
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowLeft':
      case 'ArrowDown':
      case 'ArrowRight': {
        event.preventDefault()
        usingKeyboard = true
        hoverRequest = ++requestSequence
        send('move', { request: hoverRequest, direction: event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1 })
        break
      }
      case 'Enter':
      case ' ': {
        event.preventDefault()
        pickRequest = ++requestSequence
        send('pick-highlighted', { request: pickRequest })
        break
      }
    }
  }

  function onMessage (event: MessageEvent) {
    const remote = props.frame.contentWindow
    const message = remote && previewPickerReply(event, remote, props.origin, session)
    if (message?.type === 'ready') {
      ready.value = true
      emit('ready', true)
    } else if (active.value && message?.type === 'hover' && message.request === hoverRequest) {
      highlight.value = message.rect
      keyboardTag.value = usingKeyboard ? message.tag : null
    } else if (active.value && message?.type === 'pick' && message.request === pickRequest) {
      pickRequest = 0
      if (message.element) {
        active.value = false
        emit('pick', message.element)
      }
    } else if (message?.type === 'markers' && message.request === markerRequest) {
      const numbers = new Set(props.markers.map(marker => marker.number))
      placedMarkers.value = message.markers.filter(marker => numbers.delete(marker.number))
    }
  }

  onMounted(() => {
    window.addEventListener('message', onMessage)
    watch(() => [props.frame, props.loadSequence], () => {
      active.value = false
      ready.value = false
      emit('ready', false)
      session = crypto.randomUUID()
      send('probe')
    }, { immediate: true })
  })
  onBeforeUnmount(() => {
    window.removeEventListener('message', onMessage)
    emit('ready', false)
  })
  watch(active, value => {
    clearHover()
    pickRequest = 0
    usingKeyboard = false
    send('reset')
    if (value) {
      void nextTick(() => surface.value?.focus({ preventScroll: true }))
    }
  }, { flush: 'sync' })
  watch(() => [ready.value, props.markers], () => {
    placedMarkers.value = []
    if (ready.value) {
      markerRequest = ++requestSequence
      send('markers', { request: markerRequest, markers: props.markers })
    }
  })
</script>
