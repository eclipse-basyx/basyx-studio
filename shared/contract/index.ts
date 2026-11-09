// Versioned Studio UI <-> BFF contract (`/api/studio/v1`). These Zod schemas
// are the authoritative source for implemented routes.
export * from './app-builder'
export * from './apps'
export * from './connections'
export * from './containers'
export * from './copies'
export * from './infrastructure'
export * from './preferences'
export * from './problem'
export * from './session'
export * from './settings'
export * from './target'
export * from './timeseries'
export * from './workspace'

export const apiBasePath = '/api/studio/v1'
