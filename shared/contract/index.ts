// Versioned Studio UI <-> BFF contract (`/api/studio/v1`). These Zod schemas
// are the authoritative source for implemented routes.
export * from './apps'
export * from './infrastructure'
export * from './problem'
export * from './session'
export * from './target'
export * from './workspace'

export const apiBasePath = '/api/studio/v1'
