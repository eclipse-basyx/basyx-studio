import { previewElementTag, previewPickerPathLimit, previewPickerProtocol } from '../../shared/app-preview-picker'

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

window.addEventListener('message', event => {
  if (window.parent === window || window.parent !== window.top || event.source !== window.parent || event.origin === 'null' || !event.data || event.data.protocol !== previewPickerProtocol) {
    return
  }
  const { type, session, request, x, y } = event.data
  if (typeof session !== 'string') {
    return
  }
  const reply = (message: object) => window.parent.postMessage({ protocol: previewPickerProtocol, session, ...message }, event.origin)
  if (type === 'probe') {
    reply({ type: 'ready' })
    return
  }
  if ((type !== 'hover' && type !== 'pick') || !Number.isSafeInteger(request) || !Number.isFinite(x) || !Number.isFinite(y)) {
    return
  }
  const hit = document.elementFromPoint(x, y)
  const element = hit && !hit.matches('html, body, iframe, frame, embed, object')
    ? hit.closest('button, a, input, select, textarea, label, summary, [role="button"], [role="link"]') ?? hit
    : null
  const rect = element?.getBoundingClientRect()
  const path = type === 'pick' && element ? elementPath(element) : null
  reply({
    type,
    request,
    ...(type === 'hover'
      ? { rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null }
      : { element: element && path ? { tag: element.localName, path } : null }),
  })
})
