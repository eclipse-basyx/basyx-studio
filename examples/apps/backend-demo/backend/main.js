/* global Deno */
// Runs in Studio's backend runner: an isolated Deno process that can reach
// nothing but Studio's capability endpoint. Each exported function is a
// method the UI can call with client.backend.call(name, params).

/** @type {import('@basyx/studio-sdk/backend').BackendHandler} */
export async function summarize (_params, { studio }) {
  const assetKinds = {}
  let shells = 0
  let cursor
  do {
    const page = await studio.call('studio.aas.listShells', { limit: 100, cursor })
    for (const shell of page.items) {
      shells++
      const kind = shell.assetKind ?? 'Unknown'
      assetKinds[kind] = (assetKinds[kind] ?? 0) + 1
    }
    cursor = page.page.nextCursor ?? undefined
  } while (cursor && shells < 1000)
  return { shells, assetKinds, runtime: `Deno ${Deno.version.deno}` }
}

/** Shows what the sandbox denies. */
export async function isolation () {
  const attempts = {
    readFiles: () => Deno.readTextFile('/etc/hosts'),
    environment: () => Deno.env.get('HOME'),
    internet: () => fetch('https://example.com/'),
    subprocesses: () => new Deno.Command('ls').output(),
  }
  const outcome = {}
  for (const [name, attempt] of Object.entries(attempts)) {
    try {
      await attempt()
      outcome[name] = 'allowed'
    } catch {
      outcome[name] = 'denied'
    }
  }
  return outcome
}
