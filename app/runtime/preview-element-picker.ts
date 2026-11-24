import type { PreviewAnnotationMarker } from '../../shared/app-preview-picker'
import { previewAnnotationLimit, previewElementTag, previewMarkerId, previewPickerPathLimit, previewPickerProtocol } from '../../shared/app-preview-picker'

// The helper has no visual DOM of its own and should not affect the app's
// structural selectors or hydration.
document.currentScript?.remove()

/** Describe page structure without reading text, attributes, or form values. */
function elementPath (element: Element): string | null {
  const parts: string[] = []
  let length = 0
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node === document.body || node === document.documentElement) {
      parts.push(node.localName)
      return length + node.localName.length <= previewPickerPathLimit ? parts.toReversed().join(' > ') : null
    }
    if (!previewElementTag.test(node.localName)) {
      return null
    }
    let index = 1
    for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
      if (sibling.localName === node.localName && sibling.namespaceURI === node.namespaceURI) {
        index++
      }
    }
    const part = `${node.localName}:nth-of-type(${index})`
    length += part.length + ' > '.length
    if (length > previewPickerPathLimit) {
      return null
    }
    parts.push(part)
  }
  return null
}

const controls = 'button, a, input, select, textarea, label, summary, [role="button"], [role="link"], [role="tab"]'
const unavailable = 'html, body, iframe, frame, embed, object, script, style'
let highlighted: Element | null = null
let markerFrame = 0
const pickedElements = new Map<string, WeakRef<Element>>()
const markerIds = new WeakMap<Element, string>()

function elementAt (x: number, y: number): Element | null {
  const hit = document.elementFromPoint(x, y)
  return hit && !hit.matches(unavailable) ? hit.closest(controls) ?? hit : null
}

function visibleRect (element: Element) {
  if (!element.checkVisibility({ visibilityProperty: true })) {
    return null
  }
  const bounds = element.getBoundingClientRect()
  let left = Math.max(0, bounds.left)
  let top = Math.max(0, bounds.top)
  let right = Math.min(window.innerWidth, bounds.right)
  let bottom = Math.min(window.innerHeight, bounds.bottom)
  for (let ancestor = element.parentElement; ancestor && ancestor !== document.documentElement && right > left && bottom > top; ancestor = ancestor.parentElement) {
    const { display, overflowX, overflowY } = getComputedStyle(ancestor)
    if (display !== 'contents' && (overflowX !== 'visible' || overflowY !== 'visible')) {
      const box = ancestor.getBoundingClientRect()
      if (overflowX !== 'visible') {
        const clipLeft = box.left + ancestor.clientLeft
        left = Math.max(left, clipLeft)
        right = Math.min(right, clipLeft + ancestor.clientWidth)
      }
      if (overflowY !== 'visible') {
        const clipTop = box.top + ancestor.clientTop
        top = Math.max(top, clipTop)
        bottom = Math.min(bottom, clipTop + ancestor.clientHeight)
      }
    }
  }
  return right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : null
}

function registerPick (element: Element, id: string): string {
  for (const [key, reference] of pickedElements) {
    if (!reference.deref()?.isConnected) {
      pickedElements.delete(key)
    }
  }
  const existing = markerIds.get(element)
  if (existing && pickedElements.has(existing)) {
    return existing
  }
  markerIds.set(element, id)
  pickedElements.set(id, new WeakRef(element))
  return id
}

/** Measure while notes have live anchors, including shifts with no scroll or resize event. */
function followMarkers (markers: PreviewAnnotationMarker[], request: number, reply: (message: object) => void) {
  cancelAnimationFrame(markerFrame)
  let previous: string | undefined
  let sampledAt = -Infinity
  function update (time: number) {
    if (time - sampledAt < 32) {
      markerFrame = requestAnimationFrame(update)
      return
    }
    sampledAt = time
    let hasLiveAnchors = false
    const positions = markers.flatMap(({ id, number }) => {
      const element = pickedElements.get(id)?.deref()
      if (!element?.isConnected) {
        pickedElements.delete(id)
        return []
      }
      hasLiveAnchors = true
      const rect = visibleRect(element)
      return rect ? [{ number, rect }] : []
    })
    const serialized = JSON.stringify(positions)
    if (previous !== serialized) {
      previous = serialized
      reply({ type: 'markers', request, markers: positions })
    }
    markerFrame = hasLiveAnchors ? requestAnimationFrame(update) : 0
  }
  update(performance.now())
}

/** Walk usable DOM elements with the keyboard, without moving focus into app code. */
function moveHighlight (direction: number): Element | null {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, node => {
    const element = node as Element
    if (element.matches(unavailable) || !element.checkVisibility({ visibilityProperty: true })) {
      return NodeFilter.FILTER_SKIP
    }
    const control = element.closest(controls)
    const selectable = control === element || (!control && (element.children.length === 0 || element.matches('h1, h2, h3, h4, h5, h6, p, th, td, img')))
    return selectable && element.getClientRects().length > 0 && elementPath(element) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
  })

  if (highlighted?.isConnected) {
    walker.currentNode = highlighted
    const next = (direction > 0 ? walker.nextNode() : walker.previousNode()) as Element | null
    return next ?? highlighted
  }
  for (let node = walker.nextNode() as Element | null; node; node = walker.nextNode() as Element | null) {
    if (visibleRect(node)) {
      return node
    }
  }
  return null
}

/** Apply a wheel gesture to the nested scroll area under the pointer, then its ancestors. */
function scrollFromPoint (x: number, y: number, deltaX: number, deltaY: number) {
  const root = document.scrollingElement
  for (let element = document.elementFromPoint(x, y); element && (deltaX || deltaY); element = element.parentElement) {
    const style = getComputedStyle(element)
    const scrollX = element.scrollWidth > element.clientWidth && (element === root || /auto|scroll/.test(style.overflowX))
    const scrollY = element.scrollHeight > element.clientHeight && (element === root || /auto|scroll/.test(style.overflowY))
    if (!scrollX && !scrollY) {
      continue
    }
    const beforeX = element.scrollLeft
    const beforeY = element.scrollTop
    element.scrollBy({ left: scrollX ? deltaX : 0, top: scrollY ? deltaY : 0, behavior: 'instant' })
    deltaX = scrollX && style.overscrollBehaviorX !== 'auto' ? 0 : deltaX - (element.scrollLeft - beforeX)
    deltaY = scrollY && style.overscrollBehaviorY !== 'auto' ? 0 : deltaY - (element.scrollTop - beforeY)
  }
}

function validMarker (value: unknown): value is PreviewAnnotationMarker {
  if (!value || typeof value !== 'object' || !('number' in value) || !('id' in value)) {
    return false
  }
  return typeof value.number === 'number' && Number.isSafeInteger(value.number) && value.number > 0
    && typeof value.id === 'string' && previewMarkerId.test(value.id)
}

function inspect ({ type, session, request, x, y, direction, deltaX, deltaY }: {
  type: string
  session: string
  request: number
  x: number
  y: number
  direction: number
  deltaX: number
  deltaY: number
}, reply: (message: object) => void) {
  if (type === 'move' && (direction === -1 || direction === 1)) {
    highlighted = moveHighlight(direction)
    highlighted?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
  } else if (type !== 'pick-highlighted') {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !['hover', 'pick', 'scroll'].includes(type)) {
      return
    }
    if (type === 'scroll' && Number.isFinite(deltaX) && Number.isFinite(deltaY)) {
      scrollFromPoint(x, y, deltaX, deltaY)
    }
    highlighted = elementAt(x, y)
  }

  const element = highlighted?.isConnected ? highlighted : null
  const path = element ? elementPath(element) : null
  const rect = element && path ? visibleRect(element) : null
  if (type === 'pick' || type === 'pick-highlighted') {
    reply({ type: 'pick', request, element: element && path && rect ? { tag: element.localName, path, markerId: registerPick(element, `${session}:${request}`) } : null })
  } else {
    reply({ type: 'hover', request, rect, tag: rect && element ? element.localName : null })
  }
}

window.addEventListener('message', event => {
  if (window.parent === window || window.parent !== window.top || event.source !== window.parent || event.origin === 'null' || !event.data || event.data.protocol !== previewPickerProtocol) {
    return
  }
  const { type, session, request, markers } = event.data
  if (typeof session !== 'string') {
    return
  }
  const reply = (message: object) => window.parent.postMessage({ protocol: previewPickerProtocol, session, ...message }, event.origin)
  if (type === 'probe') {
    highlighted = null
    cancelAnimationFrame(markerFrame)
    markerFrame = 0
    reply({ type: 'ready' })
    return
  }
  if (type === 'reset') {
    highlighted = null
    return
  }
  if (!Number.isSafeInteger(request) || request < 1) {
    return
  }
  if (type === 'markers' && Array.isArray(markers) && markers.length <= previewAnnotationLimit && markers.every(validMarker)) {
    followMarkers(markers, request, reply)
    return
  }
  inspect(event.data, reply)
})
