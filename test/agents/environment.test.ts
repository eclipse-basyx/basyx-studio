import { describe, expect, it } from 'vitest'
import { agentProcessEnv, cmdShimArgument, commandLaunch, findExecutable, loginShellPath, mergePaths, pathFromShellOutput, versionFromOutput } from '../../server/lib/agents/environment'
import { opencodeDesktopCli } from '../../server/lib/agents/manager'

describe('App Builder environment (ADR 0054)', () => {
  it('reads the PATH between the markers, whatever the start files print', () => {
    expect(pathFromShellOutput('Welcome!\n__STUDIO_PATH_START__/a:/b__STUDIO_PATH_END__')).toBe('/a:/b')
    expect(pathFromShellOutput('no markers')).toBeNull()
  })

  it('asks the login shell on macOS and Linux and keeps the first of each entry', async () => {
    const calls: { file: string, args: string[] }[] = []
    const path = await loginShellPath({
      platform: 'darwin',
      env: { HOME: '/Users/a', SHELL: '/bin/zsh', PATH: '/usr/bin:/bin' },
      run: async (file, args) => {
        calls.push({ file, args })
        return { code: 0, stdout: 'motd\n__STUDIO_PATH_START__/Users/a/.local/bin:/usr/bin__STUDIO_PATH_END__', stderr: '' }
      },
    })
    expect(calls[0]?.file).toBe('/bin/zsh')
    expect(calls[0]?.args[0]).toBe('-ilc')
    expect(path.split(':').slice(0, 3)).toEqual(['/Users/a/.local/bin', '/usr/bin', '/bin'])
    expect(path.split(':').filter(entry => entry === '/usr/bin')).toHaveLength(1)
  })

  it('takes the PATH as it is on Windows', async () => {
    expect(await loginShellPath({ platform: 'win32', env: { PATH: String.raw`C:\x` }, run: async () => {
      throw new Error('not called')
    } })).toBe(String.raw`C:\x`)
  })

  it('finds executables along the PATH, with Windows extensions', () => {
    const files = new Set(['/b/claude', String.raw`C:\tools\opencode.cmd`])
    expect(findExecutable('claude', '/a:/b', { platform: 'linux', exists: file => files.has(file) })).toBe('/b/claude')
    expect(findExecutable('codex', '/a:/b', { platform: 'linux', exists: file => files.has(file) })).toBeNull()
    expect(findExecutable('opencode', String.raw`C:\tools`, { platform: 'win32', exists: file => files.has(file.replaceAll('/', '\\')) })).toMatch(/opencode\.cmd$/)
  })

  it('skips the extensionless npm script beside a Windows shim, and uses PATHEXT', () => {
    const files = new Set([String.raw`C:\npm\claude`, String.raw`C:\npm\claude.cmd`, String.raw`C:\bin\git.exe`])
    const exists = (file: string) => files.has(file)
    expect(findExecutable('claude', String.raw`C:\npm`, { platform: 'win32', exists })).toBe(String.raw`C:\npm\claude.cmd`)
    expect(findExecutable('git', String.raw`C:\npm;C:\bin`, { platform: 'win32', exists })).toBe(String.raw`C:\bin\git.exe`)
    expect(findExecutable('claude', String.raw`C:\npm`, { platform: 'win32', pathExt: '.EXE', exists })).toBeNull()
  })

  it('starts Windows shims through cmd.exe, with each argument kept whole', () => {
    expect(commandLaunch('/usr/bin/pnpm', ['build'], {}, 'linux')).toEqual({ file: '/usr/bin/pnpm', args: ['build'], windowsVerbatimArguments: false })
    expect(commandLaunch(String.raw`C:\bin\git.exe`, ['status'], {}, 'win32')).toMatchObject({ file: String.raw`C:\bin\git.exe`, windowsVerbatimArguments: false })
    const shim = commandLaunch(String.raw`C:\Program Files\nodejs\pnpm.cmd`, ['run', 'build'], { ComSpec: String.raw`C:\Windows\system32\cmd.exe` }, 'win32')
    expect(shim).toEqual({
      file: String.raw`C:\Windows\system32\cmd.exe`,
      args: ['/d', '/s', '/c', String.raw`"C:\Program^ Files\nodejs\pnpm.cmd ^^^"run^^^" ^^^"build^^^""`],
      windowsVerbatimArguments: true,
    })
    // Metacharacters stay literal through both of cmd.exe's passes.
    expect(cmdShimArgument('a & b')).toBe('^^^"a^^^ ^^^&^^^ b^^^"')
    expect(cmdShimArgument('say "hi"')).toBe(String.raw`^^^"say^^^ \^^^"hi\^^^"^^^"`)
    expect(() => cmdShimArgument('%PATH%')).toThrow(/cmd\.exe/)
    expect(() => cmdShimArgument('one\ntwo')).toThrow(/cmd\.exe/)
  })

  it('reads versions from the CLIs\' own wording', () => {
    expect(versionFromOutput('2.1.282 (Claude Code)')).toBe('2.1.282')
    expect(versionFromOutput('codex-cli 0.151.0')).toBe('0.151.0')
    expect(versionFromOutput('opencode v2.2.6\n')).toBe('2.2.6')
    expect(versionFromOutput('')).toBeNull()
  })

  it('passes agents what they need, and none of Studio\'s secrets', () => {
    const env = agentProcessEnv({
      HOME: '/Users/a',
      LANG: 'de_DE.UTF-8',
      HTTPS_PROXY: 'http://proxy:8080',
      STUDIO_DATA_KEY: 'secret',
      STUDIO_BROKER_SECRET: 'secret',
      ANTHROPIC_BASE_URL: 'http://x',
      CLAUDE_CODE_SESSION_ID: 'x',
      OPENAI_API_KEY: 'sk',
      PATH: '/usr/bin',
    }, '/login/path')
    expect(env).toEqual({ HOME: '/Users/a', LANG: 'de_DE.UTF-8', HTTPS_PROXY: 'http://proxy:8080', PATH: '/login/path' })
  })

  it('merges PATH lists', () => {
    expect(mergePaths('/a:/b', null, '/b:/c')).toBe('/a:/b:/c')
  })

  it('finds the CLI of the OpenCode desktop app, newest version first', () => {
    const tree: Record<string, string[]> = {
      '/Users/a/Library/Application Support/ai.opencode.desktop/cli': ['2.2.6-arm64', '2.10.0-arm64'],
      '/Users/a/Library/Application Support/ai.opencode.desktop/cli/2.10.0-arm64': ['opencode-cli'],
      '/Users/a/Library/Application Support/ai.opencode.desktop/cli/2.2.6-arm64': ['opencode-cli'],
    }
    expect(opencodeDesktopCli('darwin', { HOME: '/Users/a' }, path => tree[path] ?? []))
      .toBe('/Users/a/Library/Application Support/ai.opencode.desktop/cli/2.10.0-arm64/opencode-cli')
    expect(opencodeDesktopCli('darwin', { HOME: '/Users/b' }, path => tree[path] ?? [])).toBeNull()
  })
})
