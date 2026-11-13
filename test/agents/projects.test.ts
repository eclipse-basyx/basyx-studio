import type { ConversationEventEnvelope } from '#shared/contract'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { agent, methods } from '@agentclientprotocol/sdk'
import { afterEach, describe, expect, it } from 'vitest'
import { agentCatalog } from '../../server/lib/agents/catalog'
import { AgentManager } from '../../server/lib/agents/manager'
import { parseNameStatus } from '../../server/lib/app-projects/git'
import { MemoryProjectStore } from '../../server/lib/app-projects/store'
import { copyFiles, localAppId, packageRange, scaffoldFiles, slugOf } from '../../server/lib/app-projects/template'

const starter = join(import.meta.dirname, '..', '..', 'examples', 'apps', 'starter')

function starterFiles (): Map<string, string> {
  return filesOf(starter)
}

function filesOf (root: string): Map<string, string> {
  const files = new Map<string, string>()
  const walk = (folder: string) => {
    for (const name of readdirSync(folder)) {
      const path = join(folder, name)
      if (name === 'node_modules' || name === 'dist') {
        continue
      }
      if (statSync(path).isDirectory()) {
        walk(path)
      } else {
        files.set(relative(root, path).replaceAll('\\', '/'), readFileSync(path, 'utf8'))
      }
    }
  }
  walk(root)
  return files
}

const bundledRoot = join(import.meta.dirname, '..', '..', 'apps')

function bundledSources (): Map<string, Map<string, string>> {
  return new Map(readdirSync(bundledRoot)
    .filter(name => existsSync(join(bundledRoot, name, 'studio-app.json')))
    .map(name => [name, filesOf(join(bundledRoot, name))]))
}

describe('App Builder project template (ADR 0054, plan P2)', () => {
  it('names folders and app IDs after the project', () => {
    expect(slugOf('Nameplate QR')).toBe('nameplate-qr')
    expect(slugOf('Café Übersicht 2')).toBe('cafe-ubersicht-2')
    expect(slugOf('42 things')).toBe('app-42-things')
    expect(slugOf('!!!')).toBe('app-new')
    expect(localAppId('nameplate-qr')).toBe('local.nameplate-qr')
    expect(packageRange('0.2.0')).toBe('^0.2.0')
    expect(packageRange('1.4.7-rc.1')).toBe('^1.4.0')
  })

  it('makes the starter the project\'s own app, with instructions for the agents', () => {
    const files = scaffoldFiles(starterFiles(), { name: 'Shell List', slug: 'shell-list', appId: 'local.shell-list', studioVersion: '0.2.0' })
    const pkg = JSON.parse(files.get('package.json')!) as { name: string, dependencies: Record<string, string> }
    expect(pkg.name).toBe('shell-list')
    expect(pkg.dependencies['@basyx/studio-sdk']).toBe('^0.2.0')
    expect(pkg.dependencies['@basyx/studio-app-kit']).toBe('^0.2.0')
    const manifest = JSON.parse(files.get('studio-app.json')!) as { id: string, publisher: { name: string }, contributes: { modules: { route: string }[] } }
    expect(manifest.id).toBe('local.shell-list')
    expect(manifest.publisher.name).toBe('This computer')
    expect(manifest.contributes.modules[0]?.route).toBe('shell-list')
    expect(files.get('AGENTS.md')).toContain('local.shell-list')
    expect(files.get('CLAUDE.md')).toContain('@AGENTS.md')
    expect(files.get('README.md')).toContain('# Shell List')
    expect(files.has('ui/src/App.vue')).toBe(true)
    expect(files.get('pnpm-workspace.yaml')).toContain('minimumReleaseAge')
  })

  it('makes a bundled app the project\'s own, outside Studio\'s workspace', () => {
    for (const source of ['nameplate', 'carbon-footprint']) {
      const files = copyFiles(filesOf(join(bundledRoot, source)), starterFiles(), { name: 'My Nameplate', slug: 'my-nameplate', appId: 'local.my-nameplate', studioVersion: '0.2.0', from: 'Digital Nameplate' })
      const pkg = JSON.parse(files.get('package.json')!) as { name: string, version: string, dependencies: Record<string, string>, devDependencies: Record<string, string>, scripts: Record<string, string> }
      expect(pkg).toMatchObject({ name: 'my-nameplate', version: '0.1.0' })
      expect(JSON.stringify(pkg)).not.toContain('workspace:')
      expect(pkg.dependencies['@basyx/studio-app-kit']).toBe('^0.2.0')
      expect(pkg.devDependencies['vue-tsc']).toBeDefined()
      expect(Object.keys(pkg.scripts)).toEqual(expect.arrayContaining(['build', 'typecheck', 'test', 'package']))
      const manifest = JSON.parse(files.get('studio-app.json')!) as { $schema: string, id: string, version: string, publisher: { name: string } }
      expect(manifest).toMatchObject({ $schema: './node_modules/@basyx/studio-sdk/app-manifest.schema.json', id: 'local.my-nameplate', version: '0.1.0', publisher: { name: 'This computer' } })
      expect(files.has('tsconfig.json')).toBe(true)
      expect(files.get('pnpm-workspace.yaml')).toContain('minimumReleaseAge')
      expect(files.get('AGENTS.md')).toContain('copy of Studio\'s bundled app Digital Nameplate')
      expect(files.has('ui/src/App.vue')).toBe(true)
    }
  })

  it('reads git\'s changed files, renames included', () => {
    expect(parseNameStatus('A\0ui/a.ts\0M\0b.ts\0D\0c.ts\0R100\0old.ts\0new.ts\0')).toEqual([
      { path: 'ui/a.ts', status: 'added' },
      { path: 'b.ts', status: 'modified' },
      { path: 'c.ts', status: 'deleted' },
      { path: 'new.ts', status: 'renamed' },
    ])
  })
})

// A fake opencode on the PATH (for the status check) and an in-process
// agent that writes a file in the project on every prompt and offers two models.
interface Fake { prompts: string[], loaded: string[], sessions: string[], models: string[] }

function modelOptions (current: string) {
  return [
    { id: 'model', name: 'Model', category: 'model' as const, type: 'select' as const, currentValue: current, options: [{ value: 'small', name: 'Small' }, { value: 'large', name: 'Large' }] },
    { id: 'effort', name: 'Effort', category: 'thought_level' as const, type: 'select' as const, currentValue: 'medium', options: [{ value: 'low', name: 'Low' }, { value: 'medium', name: 'Medium' }] },
  ]
}

function fakeAgent (folder: string, fake: Fake) {
  let turn = 0
  return agent({ name: 'fake' })
    .onRequest(methods.agent.initialize, () => ({ protocolVersion: 1, agentCapabilities: { loadSession: true } }))
    .onRequest(methods.agent.session.new, ({ params }) => {
      fake.sessions.push(params.cwd)
      return { sessionId: 'session-1', configOptions: modelOptions('small') }
    })
    .onRequest(methods.agent.session.setConfigOption, ({ params }) => {
      fake.models.push(String(params.value))
      return { configOptions: modelOptions(String(params.value)) }
    })
    .onRequest(methods.agent.session.load, ({ params }) => {
      fake.loaded.push(params.sessionId)
      return {}
    })
    .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
      const text = params.prompt.map(block => block.type === 'text' ? block.text : '').join('')
      fake.prompts.push(text)
      turn++
      writeFileSync(join(folder, `turn-${turn}.txt`), text)
      await client.notify(methods.client.session.update, { sessionId: params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Done.' } } })
      return { stopReason: 'end_turn' as const }
    })
}

const temporary: string[] = []
afterEach(() => {
  for (const path of temporary.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

function setup () {
  const root = mkdtempSync(join(tmpdir(), 'app-builder-'))
  temporary.push(root)
  const bin = join(root, 'bin')
  execFileSync('mkdir', ['-p', bin])
  writeFileSync(join(bin, 'opencode'), '#!/bin/sh\necho "opencode v9.9.9"\n')
  chmodSync(join(bin, 'opencode'), 0o755)
  const store = new MemoryProjectStore()
  const fake: Fake = { prompts: [], loaded: [], sessions: [], models: [] }
  const manager = () => new AgentManager({
    projectsDir: join(root, 'Apps'),
    agents: agentCatalog(specifier => specifier),
    nodePath: process.execPath,
    store,
    template: async () => starterFiles(),
    bundledSources: async () => bundledSources(),
    // Tests pass the folder itself as the grant's handle.
    takeFolder: handle => handle,
    studioVersion: '0.2.0',
    // git on the test machine's PATH, the fake opencode first.
    path: async () => `${bin}:${process.env.PATH ?? ''}`,
    env: { HOME: root, PATH: process.env.PATH },
    open: ({ folder }) => ({ target: fakeAgent(folder, fake), stop: () => {}, exited: new Promise(() => {}) }),
    idleStopMs: 0,
    previews: null,
    releases: null,
  })
  return { root, store, fake, manager }
}

async function until (check: () => boolean) {
  for (let attempt = 0; attempt < 400 && !check(); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  expect(check()).toBe(true)
}

function git (folder: string, ...args: string[]): string {
  return execFileSync('git', ['-C', folder, ...args], { encoding: 'utf8' })
}

describe.skipIf(process.platform === 'win32')('App Builder projects (ADR 0054, phase B)', () => {
  it('browses and edits files only in a registered project, detecting newer edits', async () => {
    const { manager } = setup()
    const instance = manager()
    const { project } = await instance.createProject('Source Files', 'opencode', null)
    expect((await instance.listProjectFiles(project.id, '')).map(entry => entry.name)).toContain('package.json')
    const opened = await instance.readProjectFile(project.id, 'README.md')
    const saved = await instance.saveProjectFile(project.id, opened.path, `${opened.content}\nEdited in Studio.\n`, opened.revision)
    expect(saved.content).toContain('Edited in Studio.')
    await expect(instance.saveProjectFile(project.id, opened.path, 'stale', opened.revision)).rejects.toMatchObject({ code: 'revision_conflict' })
    await expect(instance.readProjectFile('missing', 'README.md')).rejects.toMatchObject({ code: 'not_found' })
    await instance.dispose()
  })

  it.each([null, 'nameplate'])('keeps a default preview target when creating from %s and reopening', async source => {
    const { store, manager } = setup()
    const first = manager()
    const { project } = await first.createProject('Preview App', 'opencode', null, source, null, null, 'target-a')
    expect(project.previewTargetId).toBe('target-a')
    expect(store.projects.get(project.id)?.previewTargetId).toBe('target-a')
    await first.dispose()

    const second = manager()
    expect((await second.projects())[0]?.previewTargetId).toBe('target-a')
    await second.dispose()
  })

  it('creates a project, commits each turn, shows and undoes it, and resumes after a restart', async () => {
    const { root, store, fake, manager } = setup()
    const first = manager()
    const { project, conversation } = await first.createProject('Shell List', 'opencode', 'List the shells')
    expect(project).toMatchObject({ name: 'Shell List', appId: 'local.shell-list', folder: join(root, 'Apps', 'shell-list'), origin: 'new', previewTargetId: null })
    expect(existsSync(join(project.folder, 'AGENTS.md'))).toBe(true)

    const live = await first.conversation(conversation.id)
    const events: ConversationEventEnvelope[] = []
    live.subscribe(0, envelope => events.push(envelope))
    await until(() => live.state === 'idle' && events.some(({ event }) => event.type === 'checkpoint'))

    // The template, then the turn.
    expect(git(project.folder, 'log', '--format=%s').trim().split('\n')).toEqual(['opencode: List the shells', 'Create Shell List from the BaSyx Studio template'])
    const checkpoint = events.map(({ event }) => event).find(event => event.type === 'checkpoint')!
    expect(checkpoint).toMatchObject({ message: 'opencode: List the shells', files: [{ path: 'turn-1.txt', status: 'added' }] })
    const commit = (checkpoint as { commit: string }).commit
    expect((await first.changes(project.id, commit)).patch).toContain('+List the shells')

    // A second turn, then undo from the first: both files go, in a new commit.
    await first.prompt(conversation.id, 'Add a filter')
    await until(() => live.state === 'idle' && events.filter(({ event }) => event.type === 'checkpoint').length === 2)
    await first.undo(conversation.id, commit)
    expect(existsSync(join(project.folder, 'turn-1.txt'))).toBe(false)
    expect(existsSync(join(project.folder, 'turn-2.txt'))).toBe(false)
    expect(existsSync(join(project.folder, 'AGENTS.md'))).toBe(true)
    expect(git(project.folder, 'log', '--format=%s').split('\n')).toHaveLength(5)
    expect(events.some(({ event }) => event.type === 'checkpointUndone' && event.commit === commit)).toBe(true)

    // The agent learns of it with the next prompt.
    await first.prompt(conversation.id, 'Go on')
    await until(() => fake.prompts.length === 3 && live.state === 'idle')
    expect(fake.prompts[2]).toMatch(/^\(Note from BaSyx Studio: The user undid the changes .*\)\n\nGo on$/s)
    await first.dispose()

    // After a restart the chat is saved, without a running agent; the next
    // prompt loads the agent's session.
    const second = manager()
    const [saved] = await second.projects()
    expect(saved?.conversations).toMatchObject([{ id: conversation.id, state: 'inactive', title: 'List the shells' }])
    expect(saved!.conversations[0]!.lastSeq).toBe(store.events.get(conversation.id)!.at(-1)!.seq)
    const resumed = await second.conversation(conversation.id)
    const replay: ConversationEventEnvelope[] = []
    resumed.subscribe(0, envelope => replay.push(envelope))
    expect(replay.map(({ seq }) => seq)).toEqual(store.events.get(conversation.id)!.map(({ seq }) => seq))
    await second.prompt(conversation.id, 'And sort them')
    expect(fake.loaded).toEqual(['session-1'])
    await until(() => resumed.state === 'idle' && fake.prompts.length === 4)

    await second.removeProject(project.id, true)
    expect(existsSync(project.folder)).toBe(false)
    expect(await second.projects()).toEqual([])
    await second.dispose()
  })

  it('asks an agent for its models before its first chat, and starts a new app with the chosen one', async () => {
    const { root, fake, manager } = setup()
    const instance = manager()
    // No chat yet: a session of its own, without a prompt, in a folder that is removed again.
    expect(await instance.agentModels('opencode')).toMatchObject({ current: 'small', options: [{ value: 'small' }, { value: 'large' }] })
    expect(fake.prompts).toEqual([])
    expect(fake.sessions).toHaveLength(1)
    expect(existsSync(fake.sessions[0]!)).toBe(false)
    // Asked once; the status has them too.
    await instance.agentModels('opencode')
    expect(fake.sessions).toHaveLength(1)
    expect((await instance.status()).agents.find(agent => agent.id === 'opencode')?.model?.current).toBe('small')

    const { project, conversation } = await instance.createProject('Shell List', 'opencode', null, null, 'large')
    expect(fake.sessions.at(-1)).toBe(join(root, 'Apps', 'shell-list'))
    expect(fake.models).toEqual(['large'])
    expect(conversation.model?.current).toBe('large')
    // The chat keeps it: a second chat in the project starts with the model the agent ran last.
    expect((await instance.status()).agents.find(agent => agent.id === 'opencode')?.model?.current).toBe('large')
    expect(project.conversations).toHaveLength(1)

    // Unrestricted only after the user acknowledged the risk.
    await expect(instance.setPermissionMode(conversation.id, 'unrestricted', false)).rejects.toMatchObject({ code: 'invalid_request' })
    expect((await instance.setPermissionMode(conversation.id, 'unrestricted', true)).permissionMode).toBe('unrestricted')
    expect((await instance.setPermissionMode(conversation.id, 'auto', false)).permissionMode).toBe('auto')
    await instance.dispose()
  })

  it('plans a new app in a read-only chat, then creates it with its requirements and plan', async () => {
    const { fake, manager } = setup()
    const instance = manager()
    const draft = await instance.startDraft('opencode', 'large', 'Shell List')
    expect(draft.projectId).toBe('')
    const live = await instance.conversation(draft.id)
    const events: ConversationEventEnvelope[] = []
    live.subscribe(0, envelope => events.push(envelope))
    // The first draft: no message of the user's, so the chat shows none.
    await instance.draftTurn(draft.id, { stage: 'requirements', message: '', name: 'Shell List', idea: 'List the shells', requirements: '', plan: '' })
    await until(() => live.state === 'idle' && fake.prompts.length === 1)
    const folder = fake.sessions.at(-1)!
    // The template as the app would be created now: its name and ID, not a placeholder's.
    expect(JSON.parse(readFileSync(join(folder, 'studio-app.json'), 'utf8'))).toMatchObject({ id: 'local.shell-list' })
    expect(fake.prompts[0]).toContain('Write the first draft of the requirements')
    expect(events.some(({ event }) => event.type === 'userMessage')).toBe(false)
    // The user's message shows as they wrote it; the agent gets the stage's prompt.
    await instance.draftTurn(draft.id, { stage: 'plan', message: 'Use a table', name: 'Shell List', idea: 'List the shells', requirements: '1. R1', plan: '' })
    await until(() => live.state === 'idle' && fake.prompts.length === 2)
    expect(events.filter(({ event }) => event.type === 'userMessage').map(({ event }) => (event as { text: string }).text)).toEqual(['Use a table'])
    expect(fake.prompts[1]).toContain('`studio-plan`')

    const { project, conversation } = await instance.createProject('Shell List', 'opencode', 'List the shells', null, 'large', { requirements: '# Requirements\n\n1. R1', plan: '# Plan\n\n1. Scaffold', draftId: draft.id })
    // The planning chat ends with its folder; the documents are in the project's first commit.
    expect(existsSync(folder)).toBe(false)
    await expect(instance.draftTurn(draft.id, { stage: 'plan', message: 'More', name: '', idea: '', requirements: '', plan: '' })).rejects.toMatchObject({ code: 'not_found' })
    expect(readFileSync(join(project.folder, 'docs', 'requirements.md'), 'utf8')).toBe('# Requirements\n\n1. R1\n')
    expect(git(project.folder, 'show', '--name-only', '--format=', 'HEAD~0').split('\n')).toEqual(expect.arrayContaining(['docs/plan.md', 'docs/requirements.md']))
    const built = await instance.conversation(conversation.id)
    await until(() => fake.prompts.length === 3 && built.state === 'idle')
    expect(fake.prompts[2]).toMatch(/^Build this app as described in docs\/requirements\.md, following docs\/plan\.md\./)
    expect(conversation.title).toMatch(/^Build this app/)
    await instance.dispose()
  })

  it('shows the effort of a chat saved before Studio knew it, asking the agent once', async () => {
    const { store, fake, manager } = setup()
    const first = manager()
    const { conversation } = await first.createProject('Shell List', 'opencode', 'List the shells')
    const live = await first.conversation(conversation.id)
    await until(() => live.state === 'idle' && fake.prompts.length === 1)
    expect(live.summary().effort?.current).toBe('medium')
    await first.dispose()
    // As saved by an earlier Studio: state events without effort.
    for (const envelope of store.events.get(conversation.id)!) {
      if (envelope.event.type === 'state') {
        delete envelope.event.effort
        delete envelope.event.speed
      }
    }

    const second = manager()
    const sessions = fake.sessions.length
    const saved = await second.conversation(conversation.id)
    expect(saved.state).toBe('inactive')
    // A session of its own, without a prompt; the chat's agent does not start.
    await until(() => saved.summary().effort !== null)
    expect(saved.summary().effort).toMatchObject({ current: 'medium', options: [{ value: 'low' }, { value: 'medium' }] })
    expect(fake.sessions).toHaveLength(sessions + 1)
    expect(fake.prompts).toHaveLength(1)
    expect(saved.state).toBe('inactive')
    await second.dispose()
  })

  it('gives a second project with the same name its own folder', async () => {
    const { root, manager } = setup()
    const instance = manager()
    await instance.createProject('Shell List', 'opencode', 'one')
    const { project } = await instance.createProject('Shell List', 'opencode', 'two')
    expect(project.folder).toBe(join(root, 'Apps', 'shell-list-2'))
    expect(project.appId).toBe('local.shell-list-2')
    await instance.dispose()
  })

  it('copies a bundled app into a project of its own', async () => {
    const { root, manager } = setup()
    const instance = manager()
    const { project, conversation } = await instance.createProject('My Nameplate', 'opencode', null, 'nameplate')
    expect(project).toMatchObject({ folder: join(root, 'Apps', 'my-nameplate'), appId: 'local.my-nameplate', origin: 'copy', source: 'org.eclipse.basyx.studio.nameplate' })
    expect(conversation.state).toBe('idle')
    expect(git(project.folder, 'log', '--format=%s').trim()).toBe('Copy org.eclipse.basyx.studio.nameplate as My Nameplate')
    expect((await instance.bundledApps()).map(app => app.source)).toContain('nameplate')
    await expect(instance.createProject('X', 'opencode', null, 'missing')).rejects.toMatchObject({ code: 'not_found' })
    await instance.dispose()
  })

  it('adds a folder where it is, and keeps git to that folder inside a larger repository', async () => {
    const { root, fake, manager } = setup()
    const instance = manager()
    // A repository with another project beside the app, and nothing uncommitted.
    const repo = join(root, 'work')
    const app = join(repo, 'apps', 'mine')
    execFileSync('mkdir', ['-p', app, join(repo, 'other')])
    writeFileSync(join(app, 'studio-app.json'), JSON.stringify({ id: 'org.example.mine', version: '1.0.0', title: { en: 'Mine' } }))
    writeFileSync(join(repo, 'other', 'keep.txt'), 'before')
    const commit = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args])
    commit('init', '--quiet')
    commit('add', '--all')
    commit('commit', '--quiet', '-m', 'start')

    writeFileSync(join(app, 'draft.txt'), 'uncommitted')
    await expect(instance.addFolder(app, 'opencode', null)).rejects.toMatchObject({ code: 'invalid_request' })
    rmSync(join(app, 'draft.txt'))

    const { project, conversation } = await instance.addFolder(app, 'opencode', null)
    expect(project).toMatchObject({ name: 'Mine', appId: 'org.example.mine', origin: 'folder' })
    await expect(instance.addFolder(app, 'opencode', null)).rejects.toMatchObject({ code: 'invalid_request' })

    // A change outside the app, staged by the user, stays out of the agent's commit.
    writeFileSync(join(repo, 'other', 'keep.txt'), 'changed by the user')
    commit('add', 'other/keep.txt')
    const live = await instance.conversation(conversation.id)
    const events: ConversationEventEnvelope[] = []
    live.subscribe(0, envelope => events.push(envelope))
    await instance.prompt(conversation.id, 'Add a file')
    await until(() => live.state === 'idle' && events.some(({ event }) => event.type === 'checkpoint'))
    expect(fake.prompts[0]).toMatch(/^\(Note from BaSyx Studio: # Mine: instructions for coding agents/)
    expect(git(repo, 'show', '--name-only', '--format=', 'HEAD').trim()).toBe('apps/mine/turn-1.txt')
    expect(git(repo, 'diff', '--cached', '--name-only').trim()).toBe('other/keep.txt')

    const turn = (events.map(({ event }) => event).find(event => event.type === 'checkpoint') as { commit: string }).commit
    await instance.undo(conversation.id, turn)
    expect(existsSync(join(app, 'turn-1.txt'))).toBe(false)
    expect(readFileSync(join(repo, 'other', 'keep.txt'), 'utf8')).toBe('changed by the user')

    await expect(instance.removeProject(project.id, true)).rejects.toMatchObject({ code: 'invalid_request' })
    await instance.removeProject(project.id, false)
    expect(existsSync(app)).toBe(true)
    await instance.dispose()
  })

  it('makes a repository for a folder without one', async () => {
    const { root, manager } = setup()
    const instance = manager()
    const app = join(root, 'plain')
    execFileSync('mkdir', ['-p', app])
    writeFileSync(join(app, 'studio-app.json'), JSON.stringify({ id: 'org.example.plain', version: '1.0.0' }))
    const { project } = await instance.addFolder(app, 'opencode', 'Plain App', null, 'target-b')
    expect(project.name).toBe('Plain App')
    expect(project.previewTargetId).toBe('target-b')
    expect((await instance.projects())[0]?.previewTargetId).toBe('target-b')
    expect(readFileSync(join(app, '.gitignore'), 'utf8')).toContain('node_modules')
    expect(git(app, 'log', '--format=%s').trim()).toBe('Add Plain App to the BaSyx Studio App Builder')
    await expect(instance.addFolder(root, 'opencode', null)).rejects.toMatchObject({ code: 'invalid_request' })
    await instance.dispose()
  })
})
