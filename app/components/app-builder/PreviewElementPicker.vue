<template>
  <v-sheet
    v-if="active && ready"
    class="position-absolute top-0 left-0 w-100 h-100 overflow-hidden cursor-pointer"
    color="transparent"
    data-test="app-builder-picker-surface"
    @click.stop="inspect('pick', $event)"
    @pointerleave="clearHover"
    @pointermove="inspect('hover', $event)"
  >
    <svg
      ref="surface"
      :aria-label="t('annotations.picking')"
      class="d-block text-primary"
      height="100%"
      role="group"
      tabindex="0"
      width="100%"
    >
      <rect
        v-if="highlight"
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
    </svg>
  </v-sheet>
</template>

<script lang="ts" setup>
  import type { PreviewElement, PreviewElementRect } from '#shared/app-preview-picker'
  import { previewPickerProtocol } from '#shared/app-preview-picker'
  import { useI18n } from './i18n'
  import { previewPickerReply } from './preview-picker-reply'

  const props = defineProps<{ frame: HTMLIFrameElement, origin: string, loadSequence: number }>()
  const active = defineModel<boolean>({ required: true })
  const emit = defineEmits<{ ready: [ready: boolean], pick: [element: PreviewElement] }>()
  const { t } = useI18n()
  const surface = useTemplateRef<SVGSVGElement>('surface')
  const ready = ref(false)
  const highlight = shallowRef<PreviewElementRect | null>(null)
  let session = ''
  let requestSequence = 0
  let hoverRequest = 0
  let pickRequest = 0

  function send (type: 'probe' | 'hover' | 'pick', point?: { request: number, x: number, y: number }) {
    props.frame.contentWindow?.postMessage({ protocol: previewPickerProtocol, session, type, ...point }, props.origin)
  }

  function clearHover () {
    highlight.value = null
    hoverRequest = 0
  }

  function inspect (type: 'hover' | 'pick', event: MouseEvent) {
    if (!event.isTrusted || !active.value || (type === 'pick' && event.button !== 0)) {
      return
    }
    const bounds = props.frame.getBoundingClientRect()
    const request = ++requestSequence
    if (type === 'hover') {
      hoverRequest = request
    } else {
      pickRequest = request
    }
    send(type, { request, x: event.clientX - bounds.x, y: event.clientY - bounds.y })
  }

  function onMessage (event: MessageEvent) {
    const remote = props.frame.contentWindow
    const message = remote && previewPickerReply(event, remote, props.origin, session)
    if (message?.type === 'ready') {
      ready.value = true
      emit('ready', true)
    } else if (active.value && message?.type === 'hover' && message.request === hoverRequest) {
      highlight.value = message.rect
    } else if (active.value && message?.type === 'pick' && message.request === pickRequest) {
      pickRequest = 0
      if (message.element) {
        active.value = false
        emit('pick', message.element)
      }
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
    if (value) {
      void nextTick(() => surface.value?.focus())
    }
  }, { flush: 'sync' })
</script>
