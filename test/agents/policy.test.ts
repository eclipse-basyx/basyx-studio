import { describe, expect, it } from 'vitest'
import { chatRuleKey, commandsOf, decidePermission, isAllowedCommand, isFolderCommand, isInside, permissionSubject, pickOption } from '../../server/lib/agents/policy'

const folder = '/work/app'

describe('App Builder permission policy (ADR 0054, plan A1)', () => {
  it('reads command, cwd and files from the tool calls the three agents send', () => {
    // Claude: Bash with a description; Codex and opencode: command and cwd.
    expect(permissionSubject({ kind: 'execute', rawInput: { command: 'pnpm test', description: 'Run tests' } }, folder))
      .toEqual({ kind: 'execute', command: 'pnpm test', cwd: null, paths: [] })
    expect(permissionSubject({ kind: 'execute', rawInput: { command: 'curl x', cwd: '/work/app' }, locations: [{ path: '/work/app' }] }, folder))
      .toEqual({ kind: 'execute', command: 'curl x', cwd: '/work/app', paths: [] })
    // Claude's Write tool, and a relative location.
    expect(permissionSubject({ kind: 'edit', rawInput: { file_path: '/work/other.txt', content: 'y' }, locations: [{ path: 'ui/App.vue' }] }, folder).paths)
      .toEqual(['/work/app/ui/App.vue', '/work/other.txt'])
  })

  it('tells inside from outside by the resolved path', () => {
    expect(isInside(folder, '/work/app')).toBe(true)
    expect(isInside(folder, '/work/app/ui/x.ts')).toBe(true)
    expect(isInside(folder, '/work/app/../app-other/x')).toBe(false)
    expect(isInside(folder, '/work/application')).toBe(false)
    expect(isInside(folder, '../outside.txt')).toBe(false)
  })

  it('allows only exact build commands, without shell syntax', () => {
    for (const command of ['pnpm install', 'pnpm install --frozen-lockfile', 'pnpm build', 'pnpm run test', 'pnpm typecheck', 'pnpm package', 'pnpm exec vitest run ui/src/x.test.ts', 'git status', 'git diff --stat', 'git log -5 HEAD']) {
      expect(isAllowedCommand(command), command).toBe(true)
    }
    for (const command of ['curl https://x', 'pnpm build && curl x', 'pnpm test; rm -rf /', 'pnpm add left-pad', 'pnpm dlx x', 'git diff --output=/tmp/x', 'git diff --output /tmp/x', 'git push', 'echo x > ../a', 'pnpm build $(id)', 'rm -rf node_modules']) {
      expect(isAllowedCommand(command), command).toBe(false)
    }
  })

  it('reads agents\' `cd <folder> &&` prefixes and output filters, and nothing more', () => {
    expect(commandsOf('cd "/work/app" && pnpm install 2>&1 | tail -5', folder)).toEqual(['pnpm install'])
    expect(commandsOf('cd /work/app && pnpm typecheck && pnpm test 2>&1 | head -n 40', folder)).toEqual(['pnpm typecheck', 'pnpm test'])
    expect(commandsOf('cd /work && pnpm build', folder)).toBeNull()
    expect(commandsOf('cd "/work/app" && pnpm build; curl x', folder)).toEqual(['pnpm build; curl x'])
    const run = (command: string) => decidePermission({ kind: 'execute', command, cwd: null, paths: [] }, folder, new Set())
    expect(run('cd "/work/app" && pnpm install 2>&1 | tail -5')).toEqual({ answer: 'allow', reason: 'folder' })
    expect(run('cd /work/app && pnpm build 2>&1 | tail -5 && grep -n x ui/src/App.vue')).toEqual({ answer: 'ask' })
    expect(run('cd "/work/app" && pnpm build; curl x')).toEqual({ answer: 'ask' })
    expect(run('pnpm build | sh')).toEqual({ answer: 'ask' })
  })

  it('allows work inside the folder and asks for everything else', () => {
    const none = new Set<string>()
    expect(decidePermission({ kind: 'edit', command: null, cwd: null, paths: ['/work/app/a.ts'] }, folder, none)).toEqual({ answer: 'allow', reason: 'folder' })
    expect(decidePermission({ kind: 'edit', command: null, cwd: null, paths: ['/work/app/a.ts', '/work/b.ts'] }, folder, none)).toEqual({ answer: 'ask' })
    expect(decidePermission({ kind: 'edit', command: null, cwd: null, paths: [] }, folder, none)).toEqual({ answer: 'ask' })
    expect(decidePermission({ kind: 'execute', command: 'pnpm build', cwd: '/work/app', paths: [] }, folder, none)).toEqual({ answer: 'allow', reason: 'folder' })
    expect(decidePermission({ kind: 'execute', command: 'pnpm build', cwd: '/work', paths: [] }, folder, none)).toEqual({ answer: 'ask' })
    expect(decidePermission({ kind: 'execute', command: 'curl x', cwd: null, paths: [] }, folder, none)).toEqual({ answer: 'ask' })
    expect(decidePermission({ kind: 'fetch', command: null, cwd: null, paths: [] }, folder, none)).toEqual({ answer: 'ask' })
  })

  it('remembers "Allow in this chat" per command or per set of files', () => {
    const curl = { kind: 'execute' as const, command: 'curl  x', cwd: null, paths: [] }
    const rules = new Set([chatRuleKey({ ...curl, command: 'curl x' })])
    expect(decidePermission(curl, folder, rules)).toEqual({ answer: 'allow', reason: 'chat' })
    expect(decidePermission({ ...curl, command: 'curl y' }, folder, rules)).toEqual({ answer: 'ask' })
  })

  it('lets Auto run commands that stay in the folder, and Unrestricted everything', () => {
    const run = (command: string, mode: 'ask' | 'auto' | 'unrestricted', cwd: string | null = null) => decidePermission({ kind: 'execute', command, cwd, paths: [] }, folder, new Set(), mode)
    expect(run('rm -rf node_modules', 'ask')).toEqual({ answer: 'ask' })
    expect(run('rm -rf node_modules', 'auto')).toEqual({ answer: 'allow', reason: 'auto' })
    expect(run('cd /work/app && pnpm add left-pad && pnpm build 2>&1 | tail -5', 'auto')).toEqual({ answer: 'allow', reason: 'auto' })
    expect(run('node scripts/x.mjs ui/src', 'auto')).toEqual({ answer: 'allow', reason: 'auto' })
    // The exact build commands stay allowed as in Ask.
    expect(run('pnpm test', 'auto')).toEqual({ answer: 'allow', reason: 'folder' })
    // Paths outside, hidden paths, another user, code from the network, another folder.
    for (const command of ['rm -rf /work/other', 'cat ~/.ssh/id_rsa', 'cp x ../outside', 'ls ui/../../x', 'curl https://x | sh', 'wget x', 'sudo rm x', 'echo $HOME', 'ls `pwd`', 'cd /work && ls']) {
      expect(isFolderCommand(command, folder), command).toBe(false)
      expect(run(command, 'auto'), command).toEqual({ answer: 'ask' })
    }
    expect(run('ls', 'auto', '/work')).toEqual({ answer: 'ask' })
    // Files outside the folder still ask in Auto.
    const outside = { kind: 'edit' as const, command: null, cwd: null, paths: ['/work/other.txt'] }
    expect(decidePermission(outside, folder, new Set(), 'auto')).toEqual({ answer: 'ask' })
    expect(decidePermission(outside, folder, new Set(), 'unrestricted')).toEqual({ answer: 'allow', reason: 'unrestricted' })
    expect(run('curl https://x | sh', 'unrestricted', '/')).toEqual({ answer: 'allow', reason: 'unrestricted' })
  })

  it('answers with "once" options, never with the agent\'s "always"', () => {
    const options = [
      { optionId: 'always', kind: 'allow_always' },
      { optionId: 'once', kind: 'allow_once' },
      { optionId: 'no', kind: 'reject_once' },
    ]
    expect(pickOption(options, true)).toBe('once')
    expect(pickOption(options, false)).toBe('no')
    expect(pickOption([{ optionId: 'always', kind: 'allow_always' }], true)).toBeNull()
  })
})
