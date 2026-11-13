import type { Translate } from './i18n'
import type { Problem, Stack, StackComponentId, StackSpec, StudioClient } from '@basyx/studio-sdk'
import type { InjectionKey } from 'vue'
import { StudioError } from '@basyx/studio-sdk'
import { inject } from 'vue'

/** The defaults of a preset, as Studio's contract defines them. */
export { presetSpec } from '@basyx/studio-sdk'

export interface DockerClient {
  containers: StudioClient['containers']
  ui: Pick<StudioClient['ui'], 'copyText' | 'notify' | 'openExternal' | 'openTarget'>
}

export const clientKey: InjectionKey<DockerClient> = Symbol('docker-client')

export interface ErrorPresentation {
  action: string
  cause: string
  code: string
  detail: string | null
  message: string
  status: number | null
  violations: { path: string, message: string }[]
}

export function useClient (): DockerClient {
  const client = inject(clientKey)
  if (!client) {
    throw new Error('The Studio client is not provided.')
  }
  return client
}

export function problemOf (error: unknown): Problem | null {
  if (error instanceof StudioError) {
    return error.problem
  }
  if (!error || typeof error !== 'object') {
    return null
  }
  if ('problem' in error) {
    return (error as { problem?: Problem | null }).problem ?? null
  }
  return 'code' in error && 'status' in error && 'title' in error && 'retryable' in error
    ? error as Problem
    : null
}

/** A sentence for people, by problem code (plan U2). */
export function problemText (t: Translate, problem: Problem | null | undefined): string {
  if (!problem) {
    return t('problem.generic')
  }
  if (problem.code === 'container_start_failed') {
    const component = problem.violations?.[0]?.path as StackComponentId | undefined
    return t('problem.container_start_failed', { component: component ? t(`component.${component}`) : '?' })
  }
  const key = `problem.${problem.code}`
  const text = t(key)
  return text === key ? (problem.title || t('error.unexpected')) : text
}

const actions: Record<string, string> = {
  container_busy: 'error.actionWait',
  container_disk_full: 'error.actionDisk',
  container_engine_unavailable: 'error.actionEngine',
  container_image_unavailable: 'error.actionNetwork',
  container_operation_failed: 'error.actionEngineLogs',
  container_port_in_use: 'error.actionPorts',
  container_start_failed: 'error.actionLogs',
  csrf_rejected: 'error.actionReload',
  forbidden: 'error.actionPermission',
  invalid_request: 'error.actionReview',
  not_found: 'error.actionRefresh',
  unauthenticated: 'error.actionSignIn',
  validation_failed: 'error.actionReview',
}

/** Turns any Docker-page failure into recovery guidance without discarding diagnostics. */
export function errorPresentation (t: Translate, error: unknown): ErrorPresentation {
  const problem = problemOf(error)
  const cause = problem?.title
    ?? (error instanceof Error
      ? error.message
      : (typeof error === 'string' && error ? error : t('error.unknownCause')))
  const specificAction = problem ? actions[problem.code] : undefined
  const action = specificAction
    ? t(specificAction)
    : [problem?.retryable === false ? null : t('error.actionRetry'), t('error.actionReport')].filter(Boolean).join(' ')

  return {
    action,
    cause,
    code: problem?.code ?? 'unexpected_error',
    detail: problem?.detail ?? (error instanceof Error && error.message !== cause ? error.message : null),
    message: problem ? problemText(t, problem) : t('error.unexpected'),
    status: problem?.status ?? null,
    violations: problem?.violations ?? [],
  }
}

export const presetIcons: Record<StackSpec['preset'], string> = {
  quick: 'mdi-lightning-bolt-outline',
  full: 'mdi-puzzle-outline',
  secured: 'mdi-shield-lock-outline',
}

/** The colour of an instance's status dot; `undefined` keeps it neutral. */
export const statusColors: Record<Stack['status'], string | undefined> = {
  running: 'success',
  busy: 'info',
  partial: 'warning',
  stopped: undefined,
  error: 'error',
  missing: 'warning',
  orphan: undefined,
  unknown: 'warning',
}

/** Presets offered for new or changed instances. `full` remains readable for legacy stacks. */
export const selectablePresets = ['quick', 'secured'] as const satisfies readonly StackSpec['preset'][]

/** Describe the effective port policy, including ports kept while editing. */
export function portSummary (t: Translate, basePort: number | null): string {
  return basePort === null ? t('wizard.portsAuto') : t('facts.portsFrom', { port: basePort })
}

export type StackNameProblem = 'required' | 'duplicate'

/** Validates the visible instance name before a plan is requested. */
export function stackNameProblem (value: string, existing: string[], current?: string): StackNameProblem | null {
  const normalized = value.trim().toLocaleLowerCase()
  if (!normalized) {
    return 'required'
  }
  const currentNormalized = current?.trim().toLocaleLowerCase()
  return normalized !== currentNormalized && existing.some(name => name.trim().toLocaleLowerCase() === normalized)
    ? 'duplicate'
    : null
}

/** The first human-readable default name which does not collide with an existing instance. */
export function nextStackName (existing: string[]): string {
  for (let index = 1; ; index++) {
    const name = `BaSyx ${index}`
    if (!stackNameProblem(name, existing)) {
      return name
    }
  }
}

/** Copies only the declarative settings, including when Vue wraps them in proxies. */
export function cloneSpec (spec: StackSpec): StackSpec {
  return {
    ...spec,
    security: { ...spec.security },
    features: { ...spec.features },
    network: { ...spec.network },
    images: { ...spec.images, ...(spec.images.digests ? { digests: { ...spec.images.digests } } : {}) },
    aasxFiles: [...spec.aasxFiles],
  }
}
