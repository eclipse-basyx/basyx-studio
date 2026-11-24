import type { PreviewAnnotationMarker } from '../../shared/app-preview-picker'
import { previewAnnotationLimit, previewElementPath, previewElementTag, previewPickerPathLimit, previewPickerProtocol } from '../../shared/app-preview-picker'

// The helper has no visual DOM of its own and should not affect the app's
// structural selectors or hydration.
document.currentScript?.remove()

/** Describe page structure without reading text, attributes, or form values. */
function elementPath (element: Element): string | null {
  const parts: string[] = []
  for (let node: Element | null = element; node && parts.length < 32; node = node.parentElement) {
    if (node === document.body || node === document.documentElement) {
      parts.unshift(node.localName)
      const path = parts.join(' > ')
      return path.length <= previewPickerPathLimit ? path : null
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
    parts.unshift(`${node.localName}:nth-of-type(${index})`)
  }
  return null
}

const controls = 'button, a, input, select, textarea, label, summary, [role="button"], [role="link"], [role="tab"]'
const unavailable = 'html, body, iframe, frame, embed, object, script, style'
let highlighted: Element | null = null
let publishMarkers: (() => void) | undefined
let markerFrame = 0

function scheduleMarkers () {
  if (!markerFrame && publishMarkers) {
    markerFrame = requestAnimationFrame(() => {
      markerFrame = 0
      publishMarkers?.()
    })
  }
}

window.addEventListener('scroll', scheduleMarkers, { capture: true, passive: true })
window.addEventListener('resize', scheduleMarkers)

function elementAt (x: number, y: number): Element | null {
  const hit = document.elementFromPoint(x, y)
  return hit && !hit.matches(unavailable) ? hit.closest(controls) ?? hit : null
}

function visibleRect (element: Element) {
  const bounds = element.getBoundingClientRect()
  const x = Math.max(0, bounds.left)
  const y = Math.max(0, bounds.top)
  const width = Math.min(window.innerWidth, bounds.right) - x
  const height = Math.min(window.innerHeight, bounds.bottom) - y
  return width > 0 && height > 0 ? { x, y, width, height } : null
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
  if (!value || typeof value !== 'object' || !('number' in value) || !('path' in value)) {
    return false
  }
  return typeof value.number === 'number' && Number.isSafeInteger(value.number) && value.number > 0
    && typeof value.path === 'string' && value.path.length <= previewPickerPathLimit && previewElementPath.test(value.path)
}

function inspect ({ type, request, x, y, direction, deltaX, deltaY }: {
  type: string
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
  if (type === 'pick' || type === 'pick-highlighted') {
    const path = element ? elementPath(element) : null
    reply({ type: 'pick', request, element: element && path ? { tag: element.localName, path } : null })
  } else {
    reply({ type: 'hover', request, rect: element ? visibleRect(element) : null, tag: element?.localName ?? null })
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
    publishMarkers = undefined
    reply({ type: 'ready' })
    return
  }
  if (type === 'reset') {
    highlighted = null
    return
  }
  if (!Number.isSafeInteger(request)) {
    return
  }
  if (type === 'markers' && Array.isArray(markers) && markers.length <= previewAnnotationLimit && markers.every(validMarker)) {
    const update = () => reply({
      type,
      request,
      markers: markers.flatMap(({ path, number }) => {
        const element = document.querySelector(path)
        const rect = element?.checkVisibility({ visibilityProperty: true }) ? visibleRect(element) : null
        return rect ? [{ number, rect }] : []
      }),
    })
    publishMarkers = markers.length > 0 ? update : undefined
    update()
    return
  }
  inspect(event.data, reply)
})
