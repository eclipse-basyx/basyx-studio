import { defineStore } from 'pinia'

export interface Notification {
  text: string
  color: 'info' | 'success' | 'warning' | 'error'
}

/** Transient messages shown in the app bar's snackbar queue, e.g. from apps. */
export const useNotificationsStore = defineStore('notifications', () => {
  const queue = ref<Notification[]>([])

  function notify (notification: Notification) {
    queue.value.push(notification)
  }

  return { queue, notify }
})
