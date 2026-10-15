import type { ElementNode, SubmodelRef, TreeNode } from '#shared/contract'
import { StudioApiError } from '~/composables/useStudioApi'

/** One entry of the shell's tree: a submodel or an element below it. */
export interface ShellTreeItem {
  /** `submodelKey` for submodels, `submodelKey/elementKey` for elements. */
  id: string
  title: string
  modelType: string
  submodelKey: string
  elementKey: string | null
  semanticId: string | null
  preview: string | null
  valueType: string | null
  variableGroup: ElementNode['variableGroup']
  /** A submodel that cannot be shown (no access, missing, or absent at the chosen time). */
  unavailable: 'forbidden' | 'not_found' | 'blocked' | 'error' | 'absent' | null
  /** Has numeric properties whose values are re-read. */
  refreshable: boolean
  /** Loaded children; an empty list until the children of an expandable item are loaded. */
  children?: ShellTreeItem[]
  /** `Template` or `Instance` for a submodel, where known. */
  kind?: string | null
  /** The element being created: it exists in the tree only until it is written or cancelled. */
  draft?: boolean
  /** A "show more" row of a long level: its parent and how many children it hides. */
  more?: { parent: string, remaining: number }
}

/** The nodes below one parent: a submodel (its key) or an element (its item id). */
interface Level {
  nodes: TreeNode[] | null
  error: unknown
  loading: boolean
  /** Revision of the children's idShorts, types and order, which structural edits are based on. */
  structureRevision?: string
}

const numericTypes = new Set(['xs:double', 'xs:float', 'xs:decimal', 'xs:int', 'xs:integer', 'xs:long', 'xs:short', 'xs:byte',
  'xs:unsignedInt', 'xs:unsignedLong', 'xs:unsignedShort', 'xs:unsignedByte', 'xs:positiveInteger', 'xs:negativeInteger',
  'xs:nonNegativeInteger', 'xs:nonPositiveInteger'])
const historyLength = 30
const concurrency = 4
/** Elements *expand all* loads at most, so a huge submodel cannot freeze the page (MVP-4 plan, T1). */
export const expandAllCap = 10_000
/**
 * Children shown per level before a "show more" row. Rendering a tree row
 * takes about 2 ms, so a level of 1,000 elements would block the page for
 * two seconds (MVP-4 definition of done 10).
 */
export const levelPageSize = 200

export function itemId (submodelKey: string, elementKey: string | null): string {
  return elementKey ? `${submodelKey}/${elementKey}` : submodelKey
}

function isNumeric (node: Pick<TreeNode, 'modelType' | 'valueType'>): boolean {
  return node.modelType === 'Property' && numericTypes.has(node.valueType ?? '')
}

async function eachLimited<T> (items: T[], run: (item: T) => Promise<void>) {
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      await run(items[next++]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()))
}

/**
 * The element trees of a shell's submodels (MVP-4 plan, T1). Each request
 * returns the children of a submodel or element with as many levels below
 * them as fit into the server's node budget; deeper levels are loaded when
 * they are opened, by *expand all* (up to a cap) or for a deep link. Opened
 * levels are re-read on an interval while the page is visible, keeping a short
 * history of numeric values for this session; the server stores none. With
 * `at`, the trees show the submodels as they were at that time.
 */
export function useShellTrees (options: {
  targetId: () => string
  refs: () => SubmodelRef[]
  at: () => string | null
  /** Seconds between re-reads, or `null` to stop. */
  refreshSeconds: () => number | null
  /** Ids of the opened items; their levels are the ones re-read. */
  opened: () => string[]
  /** Show whole levels, e.g. while a filter needs every loaded element. */
  unpaged: () => boolean
}) {
  const api = useStudioApi()
  const levels = ref<Record<string, Level>>({})
  /** Requests in flight per level, so a second caller waits for the first. */
  const inFlight = new Map<string, Promise<void>>()
  const history = shallowRef(new Map<string, number[]>())
  /** Children shown per paged level, by parent id. */
  const shown = ref<Record<string, number>>({})
  /** All child ids per parent, including those behind a "show more" row (filled while building the items). */
  const childIds = new Map<string, string[]>()
  let generation = 0

  function record (submodelKey: string, nodes: TreeNode[]) {
    const next = new Map(history.value)
    const visit = (items: TreeNode[]) => {
      for (const node of items) {
        if (isNumeric(node) && node.preview !== null && Number.isFinite(Number(node.preview))) {
          const id = itemId(submodelKey, node.key)
          next.set(id, [...(next.get(id) ?? []), Number(node.preview)].slice(-historyLength))
        }
        visit(node.children ?? [])
      }
    }
    visit(nodes)
    history.value = next
  }

  function setLevel (id: string, level: Level) {
    levels.value = { ...levels.value, [id]: level }
  }

  /** Reads the level below a submodel (`elementKey` null) or element. */
  function fetchLevel (submodelKey: string, elementKey: string | null, current: number, quiet: boolean): Promise<void> {
    const id = itemId(submodelKey, elementKey)
    const running = inFlight.get(id)
    if (running) {
      return running
    }
    const request = readLevel(submodelKey, elementKey, id, current, quiet).finally(() => inFlight.delete(id))
    inFlight.set(id, request)
    return request
  }

  async function readLevel (submodelKey: string, elementKey: string | null, id: string, current: number, quiet: boolean) {
    if (!quiet) {
      setLevel(id, { nodes: levels.value[id]?.nodes ?? null, error: null, loading: true, structureRevision: levels.value[id]?.structureRevision })
    }
    try {
      const at = options.at()
      const result = await api<{ items: TreeNode[], structureRevision?: string }>(`/targets/${options.targetId()}/submodels/${submodelKey}/elements`, {
        query: { parentElementKey: elementKey ?? undefined, at: at ?? undefined },
      })
      if (current === generation) {
        setLevel(id, { nodes: result.items, error: null, loading: false, structureRevision: result.structureRevision })
        if (!at) {
          record(submodelKey, result.items)
        }
      }
    } catch (error) {
      if (current === generation && !quiet) {
        setLevel(id, { nodes: null, error, loading: false })
      }
    }
  }

  const availableKeys = () => options.refs().filter(ref => ref.status === 'available').map(ref => ref.key)

  async function loadAll () {
    const current = ++generation
    levels.value = {}
    shown.value = {}
    inFlight.clear()
    await eachLimited(availableKeys(), key => fetchLevel(key, null, current, false))
  }

  /** A level's children, cut after the shown count with a "show more" row. */
  function paged (parent: string, submodelKey: string, children: ShellTreeItem[]): ShellTreeItem[] {
    childIds.set(parent, children.map(child => child.id))
    const count = shown.value[parent] ?? levelPageSize
    if (options.unpaged() || children.length <= count) {
      return children
    }
    return [...children.slice(0, count), {
      id: `${parent}#more`,
      title: '',
      modelType: 'More',
      submodelKey,
      elementKey: null,
      semanticId: null,
      preview: null,
      valueType: null,
      variableGroup: null,
      unavailable: null,
      refreshable: false,
      more: { parent, remaining: children.length - count },
    }]
  }

  function showMore (parent: string) {
    shown.value = { ...shown.value, [parent]: (shown.value[parent] ?? levelPageSize) + levelPageSize }
  }

  /** Extends the page of the level that holds an item, so the item is shown. */
  function showItem (id: string) {
    for (const [parent, ids] of childIds) {
      const index = ids.indexOf(id)
      if (index >= (shown.value[parent] ?? levelPageSize)) {
        shown.value = { ...shown.value, [parent]: Math.ceil((index + 1) / levelPageSize) * levelPageSize }
      }
    }
  }

  function toItem (submodelKey: string, node: TreeNode): ShellTreeItem {
    const id = itemId(submodelKey, node.key)
    const below = node.children ?? levels.value[id]?.nodes ?? undefined
    return {
      id,
      title: node.label,
      modelType: node.modelType,
      submodelKey,
      elementKey: node.key,
      semanticId: node.semanticId,
      preview: node.preview,
      valueType: node.valueType,
      variableGroup: node.variableGroup,
      unavailable: null,
      refreshable: false,
      // An empty list lets the tree ask for the children when it is opened.
      children: node.hasChildren ? (below ? paged(id, submodelKey, below.map(child => toItem(submodelKey, child))) : []) : undefined,
    }
  }

  function hasNumeric (nodes: TreeNode[]): boolean {
    return nodes.some(node => isNumeric(node) || hasNumeric(node.children ?? []))
  }

  const items = computed<ShellTreeItem[]>(() => options.refs().map(ref => {
    const level = levels.value[ref.key]
    const absent = options.at() !== null && level?.error instanceof StudioApiError && level.error.code === 'target_resource_not_found'
    let unavailable: ShellTreeItem['unavailable'] = ref.status === 'available' ? null : ref.status
    if (absent) {
      unavailable = 'absent'
    } else if (!unavailable && level?.error) {
      unavailable = 'error'
    }
    const nodes = level?.nodes
    return {
      id: ref.key,
      title: ref.idShort ?? ref.submodelId,
      modelType: 'Submodel',
      submodelKey: ref.key,
      elementKey: null,
      semanticId: ref.semanticId,
      preview: null,
      valueType: null,
      variableGroup: null,
      kind: ref.kind ?? null,
      unavailable,
      refreshable: nodes ? hasNumeric(nodes) : false,
      children: unavailable ? undefined : (nodes ? paged(ref.key, ref.key, nodes.map(node => toItem(ref.key, node))) : []),
    }
  }))

  function find (list: ShellTreeItem[], id: string): ShellTreeItem | null {
    for (const item of list) {
      if (item.id === id) {
        return item
      }
      const found = find(item.children ?? [], id)
      if (found) {
        return found
      }
    }
    return null
  }

  /** Loads the children of an item that has not got them yet. */
  async function loadChildren (item: Pick<ShellTreeItem, 'submodelKey' | 'elementKey'>) {
    const id = itemId(item.submodelKey, item.elementKey)
    if (!levels.value[id]?.nodes) {
      await fetchLevel(item.submodelKey, item.elementKey, generation, false)
    }
  }

  /**
   * Loads every level below the given submodels, breadth first, until
   * `expandAllCap` elements are loaded. Returns the ids to open and whether
   * the cap stopped it.
   */
  async function expandAll (submodelKeys: string[]): Promise<{ ids: string[], capped: boolean }> {
    const roots = () => items.value.filter(item => submodelKeys.includes(item.id) && !item.unavailable)
    await eachLimited(roots().map(root => root.submodelKey), key => loadChildren({ submodelKey: key, elementKey: null }))
    let capped = false
    for (;;) {
      const pending: ShellTreeItem[] = []
      let count = 0
      const visit = (list: ShellTreeItem[]) => {
        for (const item of list) {
          count++
          // Levels that failed are not retried here.
          if (item.children?.length === 0 && item.elementKey && !levels.value[item.id]) {
            pending.push(item)
          }
          visit(item.children ?? [])
        }
      }
      visit(roots())
      if (pending.length === 0) {
        break
      }
      if (count >= expandAllCap) {
        capped = true
        break
      }
      await eachLimited(pending.slice(0, 50), item => loadChildren(item))
    }
    const ids: string[] = []
    const collect = (list: ShellTreeItem[]) => {
      for (const item of list) {
        if (item.children && item.children.length > 0) {
          ids.push(item.id)
          collect(item.children)
        }
      }
    }
    collect(roots())
    return { ids, capped }
  }

  /**
   * Loads the path to an element (a deep link): its submodel and each
   * ancestor, top-down. Returns the ids to open, or `null` if the path is
   * not in the tree.
   */
  async function reveal (submodelKey: string, ancestorKeys: string[], elementKey: string | null): Promise<string[] | null> {
    await loadChildren({ submodelKey, elementKey: null })
    const trail = [submodelKey]
    const visible = (id: string) => {
      void items.value
      showItem(id)
      return find(items.value, id)
    }
    for (const key of ancestorKeys) {
      const item = visible(itemId(submodelKey, key))
      if (!item) {
        return null
      }
      if (item.children?.length === 0) {
        await loadChildren(item)
      }
      trail.push(item.id)
    }
    if (elementKey) {
      visible(itemId(submodelKey, elementKey))
    }
    return trail
  }

  /** Re-reads the opened levels of the given submodels without a loading state. */
  async function reread (submodelKeys: string[]) {
    const current = generation
    const opened = new Set(options.opened())
    const ids = Object.keys(levels.value).filter(id => {
      const [submodelKey, elementKey] = id.split('/')
      return submodelKeys.includes(submodelKey!) && (elementKey === undefined || opened.has(id))
    })
    await eachLimited(ids, async id => {
      const [submodelKey, elementKey] = id.split('/')
      await fetchLevel(submodelKey!, elementKey ?? null, current, true)
    })
  }

  const loading = computed(() => Object.values(levels.value).some(level => level.loading))

  watch(() => [options.targetId(), options.refs().map(ref => ref.key).join(','), options.at()], () => void loadAll(), { immediate: true })

  if (import.meta.client) {
    let timer: ReturnType<typeof setInterval> | undefined
    watch(() => [options.refreshSeconds(), options.at()] as const, ([seconds, at]) => {
      clearInterval(timer)
      if (seconds && !at) {
        timer = setInterval(() => {
          if (document.visibilityState === 'visible') {
            void reread(availableKeys())
          }
        }, seconds * 1000)
      }
    }, { immediate: true })
    onScopeDispose(() => clearInterval(timer))
  }

  return {
    items,
    levels,
    history,
    loading,
    lookup: (id: string) => find(items.value, id),
    /** The structure revision of the children of a submodel or element, if its level is loaded. */
    structureRevision: (id: string) => levels.value[id]?.structureRevision ?? null,
    /** The item above an item, or `null` for a submodel. */
    parentOf: (id: string): ShellTreeItem | null => {
      const walk = (list: ShellTreeItem[], parent: ShellTreeItem | null): ShellTreeItem | null | undefined => {
        for (const item of list) {
          if (item.id === id) {
            return parent
          }
          const found = walk(item.children ?? [], item)
          if (found !== undefined) {
            return found
          }
        }
        return undefined
      }
      return walk(items.value, null) ?? null
    },
    loadChildren,
    expandAll,
    reveal,
    showMore,
    /** Re-reads one submodel's opened levels, e.g. after a value was changed. */
    refresh: (submodelKey: string) => reread([submodelKey]),
    reload: () => loadAll(),
  }
}
