import type { Problem } from '@basyx/studio-sdk'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { errorPresentation, nextStackName, portSummary, presetSpec, selectablePresets, stackNameProblem } from '../../app/components/basyx-docker/support'

const messages: Record<string, string> = {
  'error.actionEngine': 'Start Docker or Podman, then try again.',
  'error.actionRetry': 'Try the action again.',
  'error.actionReport': 'Open the technical details and include them when reporting the problem.',
  'error.code': 'Error code',
  'error.status': 'Status',
  'error.title': 'The action could not be completed',
  'error.unexpected': 'An unexpected error occurred.',
  'problem.container_engine_unavailable': 'Docker or Podman does not answer.',
}
const t = (key: string) => messages[key] ?? key

describe('BaSyx Docker presets', () => {
  it('offers only the supported setup choices for new instances', () => {
    expect(selectablePresets).toEqual(['quick', 'secured'])
  })

  it('does not mount a persistent data volume by default', () => {
    expect(presetSpec('quick', 'Demo').persistence).toBe('ephemeral')
  })
})

describe('BaSyx Docker wizard translations', () => {
  const locales = ['de', 'en', 'es', 'fr', 'ja', 'nl', 'zh-Hans'] as const
  const stepLabels = {
    'de': 'Template auswählen',
    'en': 'Select template',
    'es': 'Seleccionar plantilla',
    'fr': 'Choisir un modèle',
    'ja': 'テンプレートを選択',
    'nl': 'Template selecteren',
    'zh-Hans': '选择模板',
  }

  it.each(Object.entries(stepLabels))('labels the first step in %s', (locale, label) => {
    const messages = JSON.parse(readFileSync(new URL(`../../app/components/basyx-docker/locales/${locale}.json`, import.meta.url), 'utf8')) as {
      wizard: { stepWhat: string }
    }
    expect(messages.wizard.stepWhat).toBe(label)
  })

  it.each(locales)('explains both secured access models completely in %s', locale => {
    const messages = JSON.parse(readFileSync(new URL(`../../app/components/basyx-docker/locales/${locale}.json`, import.meta.url), 'utf8')) as {
      access: Record<string, string>
    }
    const required = [
      'title', 'hint',
      'roles', 'rolesTechnology', 'rolesText', 'rolesUsers', 'rolesAdmin', 'rolesViewer', 'rolesUseCase',
      'sharing', 'sharingTechnology', 'sharingText', 'sharingUsers', 'sharingOwner', 'sharingAdmin', 'sharingUseCase',
      'includedUsers', 'permissions', 'bestFor',
    ]

    expect(Object.fromEntries(required.map(key => [key, messages.access[key]]))).toEqual(
      Object.fromEntries(required.map(key => [key, expect.any(String)])),
    )
    expect(required.every(key => messages.access[key].trim().length > 0)).toBe(true)
  })

  it.each(locales)('names the credential user in password action labels in %s', locale => {
    const messages = JSON.parse(readFileSync(new URL(`../../app/components/basyx-docker/locales/${locale}.json`, import.meta.url), 'utf8')) as {
      signIn: Record<string, string>
    }

    for (const action of ['showPassword', 'hidePassword', 'copyPassword']) {
      expect(messages.signIn[action]).toContain('{user}')
    }
    expect(messages.signIn.showPassword).not.toBe(messages.signIn.hidePassword)
  })
})

describe('BaSyx Docker visual language', () => {
  const component = (name: string) => readFileSync(new URL(`../../app/components/basyx-docker/${name}.vue`, import.meta.url), 'utf8')

  it('uses neutral cards at rest and a tonal brand treatment only for selected choices', () => {
    const wizard = component('NewInstanceWizard')

    expect(wizard).not.toContain('color="surface-light"')
    expect(wizard).toContain(':color="preset === option ? \'primary\' : undefined"')
    expect(wizard).toContain(':variant="preset === option ? \'tonal\' : undefined"')
    expect(wizard).toContain(':color="access === option ? \'primary\' : undefined"')
    expect(wizard).toContain(':variant="access === option ? \'tonal\' : undefined"')
  })

  it('renders engine and instance states as quiet icon-and-text readouts', () => {
    const app = component('App')
    const engineStatus = component('EngineStatus')
    const instanceDetail = component('InstanceDetail')

    // The engine is a list row with a status dot, not a coloured button.
    expect(engineStatus).toContain('data-test="engine"')
    expect(engineStatus).toContain('icon="mdi-circle" :size="10"')
    expect(engineStatus).not.toContain('<v-btn-primary\n        v-bind="activator"')
    // Rows and the detail share one status colour per state.
    expect(app).toContain(':color="statusColors[stack.status]" icon="mdi-circle"')
    expect(instanceDetail).toContain(':color="statusColors[stack.status]" data-test="status" prepend-icon="mdi-circle"')
  })

  it('reuses Studio button and card defaults for secondary actions and inset panels', () => {
    const engineMissing = component('EngineMissing')
    const logs = component('LogsPanel')
    const signIn = component('SignInDetails')
    const wizard = component('NewInstanceWizard')

    expect(engineMissing).toContain('<v-btn-secondary')
    expect(wizard).toContain('<v-btn-secondary')
    expect(wizard).not.toContain('variant="outlined"')
    expect(logs.trimStart()).toMatch(/^<template>\s*<v-card/)
    expect(signIn.trimStart()).toMatch(/^<template>\s*<v-card/)
  })

  it('lays the page out like the App Builder: a sidebar beside the selected instance', () => {
    const app = component('App')
    const instanceDetail = component('InstanceDetail')
    const wizard = component('NewInstanceWizard')

    // A full page without an app bar: the sidebar holds the title, the actions, the list and the engine.
    expect(app.trimStart()).toMatch(/^<template>\s*<v-sheet-full-page>/)
    expect(app).not.toContain('<PageHeader')
    expect(app).toContain('class="d-flex flex-column flex-shrink-0 border-e" width="280"')
    expect(app).toMatch(/data-test="new"[\s\S]*data-test="import"[\s\S]*<v-list[\s\S]*<EngineStatus/)
    expect(app).toContain('class="d-flex align-center ga-5 ps-6 pe-4 pt-4 pb-4"')
    // The detail uses the same compact title/action header as the wizard, with settings and tabs below.
    expect(instanceDetail).toContain('data-test="instance-header" height="56"')
    expect(instanceDetail).toContain('<h1 class="text-title-medium font-weight-medium text-truncate flex-grow-1 ma-0">{{ stack.name }}</h1>')
    expect(instanceDetail).toContain('<v-tabs v-model="tab" density="compact">')
    // Containers without a stored instance stay out of the list.
    expect(app).toContain('stack.status !== \'orphan\'')
    expect(instanceDetail).toContain('<DialogCard data-test="remove-confirm"')
    // The wizard fills the work area; step 3 shows the facts in the page.
    expect(wizard).toContain('data-test="wizard"')
    // A summary beside steps 1 and 2 folds into a rail on wide screens; narrow forms use the full width.
    expect(wizard).toContain('v-if="summaryOpen && step < 3"')
    expect(wizard).toContain('data-test="toggle-summary"')
    expect(wizard).toContain('data-test="summary-rail"')
    expect(wizard).toContain('v-else-if="lgAndUp && step < 3"')
    expect(wizard).toContain('const summaryOpen = ref(lgAndUp.value)')
    expect(wizard).toContain('data-test="summary-facts"')
    expect(wizard).toContain('v-for="fact in summaryFacts"')
  })
})

describe('BaSyx Docker instance names', () => {
  it('requires a non-empty name', () => {
    expect(stackNameProblem(' '.repeat(3), [])).toBe('required')
  })

  it('rejects an existing name regardless of whitespace and case', () => {
    expect(stackNameProblem(' demo LINE ', ['Demo line'])).toBe('duplicate')
  })

  it('allows an unchanged name while editing an instance', () => {
    expect(stackNameProblem('Demo line', ['Demo line'], 'Demo line')).toBeNull()
  })

  it('picks the first unused default name regardless of case', () => {
    expect(nextStackName(['BaSyx 1', 'basyx 2', 'Demo'])).toBe('BaSyx 3')
  })
})

describe('BaSyx Docker port summaries', () => {
  const translate = (key: string, params?: Record<string, string | number>) => key === 'wizard.portsAuto'
    ? 'Pick free ports'
    : `Fixed, from ${params?.port}`

  it('describes automatic allocation when the effective specification has no base port', () => {
    expect(portSummary(translate, null)).toBe('Pick free ports')
  })

  it('shows the base port retained by an edited instance', () => {
    expect(portSummary(translate, 18_190)).toBe('Fixed, from 18190')
  })
})

describe('BaSyx Docker errors', () => {
  it('keeps a known problem actionable and exposes its diagnostics', () => {
    const problem: Problem = {
      code: 'container_engine_unavailable',
      detail: 'connect ENOENT /var/run/docker.sock',
      retryable: true,
      status: 503,
      title: 'No container engine is running',
    }

    expect(errorPresentation(t, problem)).toMatchObject({
      action: 'Start Docker or Podman, then try again.',
      cause: 'No container engine is running',
      code: 'container_engine_unavailable',
      detail: 'connect ENOENT /var/run/docker.sock',
      message: 'Docker or Podman does not answer.',
      status: 503,
    })
  })

  it('turns an unexpected error into useful recovery and technical information', () => {
    expect(errorPresentation(t, new Error('socket closed while reading response'))).toMatchObject({
      action: 'Try the action again. Open the technical details and include them when reporting the problem.',
      cause: 'socket closed while reading response',
      code: 'unexpected_error',
      message: 'An unexpected error occurred.',
    })
  })
})
