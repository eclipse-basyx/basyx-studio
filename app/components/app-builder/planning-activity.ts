import type { Transcript } from './transcript'
import { computed, ref } from 'vue'

/** Whether the planning controls wait for an agent or a request to start it. */
export function usePlanningActivity (draftId: () => string | null, transcript: () => Transcript) {
  const pending = ref(false)
  const writing = computed(() => pending.value || (draftId() !== null && (transcript().state === 'starting' || transcript().state === 'working')))

  async function request<T> (action: () => Promise<T>): Promise<T> {
    pending.value = true
    try {
      return await action()
    } finally {
      pending.value = false
    }
  }

  return { writing, request }
}
