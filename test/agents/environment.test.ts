import { describe, expect, it } from 'vitest'
import { agentProcessEnv, findExecutable, loginShellPath, mergePaths, pathFromShellOutput, versionFromOutput } from '../../server/lib/agents/environment'
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
