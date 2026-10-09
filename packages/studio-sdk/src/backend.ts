// Types for backend apps, which run in an isolated Deno process. A backend
// module exports one async function per method; the UI part of the same app
// calls them with `client.backend.call(name, params)`.
//
//   export async function summarize (params, { studio }) {
//     const shells = await studio.call('studio.aas.listShells', { limit: 10 })
//     return { count: shells.items.length }
//   }
//
// The process can reach nothing but Studio's capability endpoint. Each call
// carries a short-lived capability token for the calling user and target.

import type { Methods } from './protocol'

/** Capability methods a backend may call (AAS access on the caller's target). */
export type BackendMethodName = Extract<keyof Methods, `studio.aas.${string}`>

export interface BackendStudio {
  call: <M extends BackendMethodName>(method: M, params: Methods[M]['params']) => Promise<Methods[M]['result']>
}

export interface BackendContext {
  studio: BackendStudio
}

export type BackendHandler<P = unknown, R = unknown> = (params: P, context: BackendContext) => R | Promise<R>
