import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { agentCatalog } from '../../server/lib/agents/catalog'

describe('App Builder agent catalog', () => {
  it('finds the installed Claude ACP executable declared by the package', () => {
    const require = createRequire(import.meta.url)
    const manifestPath = require.resolve('@agentclientprotocol/claude-agent-acp/package.json')
    const manifest = require(manifestPath) as { bin: Record<string, string> }
    const executable = require.resolve(resolve(dirname(manifestPath), manifest.bin['claude-agent-acp']!))

    const claude = agentCatalog(require.resolve).find(entry => entry.id === 'claude')

    expect(claude?.launch.adapterScript).toBe(executable)
  })
})
