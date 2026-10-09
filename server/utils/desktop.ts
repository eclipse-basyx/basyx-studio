import type { WorkspaceManager } from '../lib/workspaces/manager'
import type { StudioRuntime } from './studio'
import type { RequestEvent } from 'nuxt/server'
import { timingSafeEqual } from 'node:crypto'
import { getRequestHeader } from 'nuxt/server'
import { StudioProblem } from '../lib/problem'
import { useStudio } from './studio'

export function requireWorkspaces (studio: StudioRuntime): WorkspaceManager {
  if (!studio.workspaces) {
    throw new StudioProblem('not_found', 'Local AASX workspaces are only available in the desktop app.')
  }
  return studio.workspaces
}

/** Whether the request comes from the Electron main process (broker secret). */
export function hasBrokerSecret (event: RequestEvent): boolean {
  const expected = process.env.STUDIO_BROKER_SECRET
  const provided = getRequestHeader(event, 'x-studio-broker-secret') ?? ''
  if (!expected) {
    return false
  }
  const expectedBytes = Buffer.from(expected)
  const providedBytes = Buffer.from(provided)
  return expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes)
}

/**
 * Authenticates the Electron main process, which alone may turn native paths
 * into file grants. The renderer's requests carry the launch secret, but
 * never this broker secret.
 */
export async function requireBroker (event: RequestEvent): Promise<WorkspaceManager> {
  const studio = await useStudio()
  const expected = process.env.STUDIO_BROKER_SECRET
  const provided = getRequestHeader(event, 'x-studio-broker-secret') ?? ''
  if (studio.config.deploymentMode !== 'desktop' || !expected) {
    throw new StudioProblem('not_found')
  }
  const expectedBytes = Buffer.from(expected)
  const providedBytes = Buffer.from(provided)
  if (expectedBytes.length !== providedBytes.length || !timingSafeEqual(expectedBytes, providedBytes)) {
    throw new StudioProblem('forbidden')
  }
  return requireWorkspaces(studio)
}
