import type { MaybeRefOrGetter, WritableComputedRef } from 'vue'

/**
 * Page state that survives leaving the page, such as a search or the chosen
 * filters, kept under `key` in the navigation store until the next reload.
 * State the URL holds (selection, tabs) needs no copy here.
 */
export function usePageState<T> (key: MaybeRefOrGetter<string>, initial: () => T): WritableComputedRef<T> {
  const navigation = useNavigationStore()
  return computed({
    get: () => {
      const name = toValue(key)
      return name in navigation.pageState ? navigation.pageState[name] as T : initial()
    },
    set: value => {
      navigation.pageState[toValue(key)] = value
    },
  })
}
