import type { AppCallResult, AppContext, AppContributionInfo, Problem } from '#shared/contract'
import type { Ref } from 'vue'
import { useQueryCache } from '@pinia/colada'
import { appHelloSchema, appMethodNameSchema, appMethodParamsSchemas, appProtocol, appRequestMessageSchema } from '#shared/contract'
import { StudioApiError } from '~/composables/useStudioApi'

export interface AppBridgeOptions {
  contribution: () => AppContributionInfo
  /** The target the frame is bound to; fixed for the frame's lifetime. */
  targetId: string | null
  context: () => AppContext
  onNavigate: (subPath: string) => void
}

function problemOf (error: unknown): Problem {
  if (error instanceof StudioApiError && error.problem) {
    return error.problem
  }
  return { type: 'about:blank', title: 'Studio could not be reached.', status: 0, code: 'internal_error', requestId: '', retryable: true }
}

/**
 * The host side of the `studio-sdk/0` bridge (ADR 0018). It answers only the
 * frame it created, hands that frame one MessagePort per load of its entry,
 * validates every request, and forwards capability calls to Studio, which
 * checks them against the installed manifest and the user's rights. A frame
 * that navigates away from its entry loses its port and is reloaded.
 */
export function useAppBridge (frame: Ref<HTMLIFrameElement | null>, options: AppBridgeOptions) {
  const api = useStudioApi()
  const queryCache = useQueryCache()
  const notifications = useNotificationsStore()
  const label = useLocalizedLabel()
  const connected = ref(false)

  let port: MessagePort | null = null
  let handedOut = false
  let loads = 0
  let reloading = false
  let lastContext = ''

  function respond (message: unknown) {
    port?.postMessage(message)
  }

  async function onRequest (event: MessageEvent) {
    const parsed = appRequestMessageSchema.safeParse(event.data)
    if (!parsed.success) {
      return
    }
    const { id, method: name, params } = parsed.data
    const method = appMethodNameSchema.safeParse(name)
    if (!method.success) {
      respond({ type: 'error', id, problem: { ...problemOf(null), title: `Unknown method ${name}.`, code: 'invalid_request', status: 400, retryable: false } })
      return
    }
    if (method.data === 'studio.ui.getContext') {
      respond({ type: 'response', id, result: options.context() })
      return
    }
    const contribution = options.contribution()
    try {
      const { result } = await api<AppCallResult>('/app-calls', {
        method: 'POST',
        body: { installationId: contribution.installationId, targetId: options.targetId, method: method.data, params },
      })
      // Studio authorized the call; UI methods are carried out here.
      if (method.data === 'studio.ui.notify') {
        const notice = appMethodParamsSchemas['studio.ui.notify'].parse(params)
        notifications.notify({ text: `${label(contribution.appTitle)}: ${notice.message}`, color: notice.level })
      } else if (method.data === 'studio.ui.navigate' && contribution.kind === 'module') {
        options.onNavigate(appMethodParamsSchemas['studio.ui.navigate'].parse(params).subPath)
      } else if (method.data === 'studio.aas.setElementValue' && options.targetId) {
        // Studio's own views show the new value, and a workspace its unsaved state.
        void queryCache.invalidateQueries({ key: ['targets', options.targetId], exact: true })
        void queryCache.invalidateQueries({ key: ['targets', options.targetId, 'details'] })
      }
      respond({ type: 'response', id, result })
    } catch (error) {
      respond({ type: 'error', id, problem: problemOf(error) })
    }
  }

  function closePort () {
    port?.close()
    port = null
    connected.value = false
  }

  function onMessage (event: MessageEvent) {
    const window = frame.value?.contentWindow
    if (!window || event.source !== window || handedOut || !appHelloSchema.safeParse(event.data).success) {
      return
    }
    handedOut = true
    const channel = new MessageChannel()
    port = channel.port1
    port.addEventListener('message', event => void onRequest(event))
    port.start()
    // The frame's origin is opaque, so it cannot be named as target origin;
    // the message goes to this frame's window only.
    const context = options.context()
    lastContext = JSON.stringify(context)
    window.postMessage({ protocol: appProtocol, type: 'connect', context }, '*', [channel.port2])
    connected.value = true
  }

  /** Each load of the entry may connect once; any other navigation reloads the entry. */
  function onLoad () {
    loads++
    if (loads === 1 || reloading) {
      reloading = false
      return
    }
    closePort()
    handedOut = false
    reloading = true
    if (frame.value) {
      frame.value.src = options.contribution().entryUrl
    }
  }

  // Sent only when something changed, not on every render of the host page.
  watch(() => options.context(), context => {
    const serialized = JSON.stringify(context)
    if (serialized !== lastContext) {
      lastContext = serialized
      respond({ type: 'context', context })
    }
  }, { deep: true })

  onMounted(() => window.addEventListener('message', onMessage))
  onBeforeUnmount(() => {
    window.removeEventListener('message', onMessage)
    closePort()
  })

  /** Bind to the frame's `load` event. */
  return { connected, onLoad }
}
