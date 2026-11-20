import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export function resolveClaudeAdapter (resolveModule: (specifier: string) => string): string {
  // The CLI is declared in the exported manifest. The package root exports the library.
  const manifestPath = resolveModule('@agentclientprotocol/claude-agent-acp/package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { bin?: Record<string, string> }
  const executable = manifest.bin?.['claude-agent-acp']
  if (!executable) {
    throw new Error('The Claude ACP package does not declare its executable')
  }

  return resolveModule(resolve(dirname(manifestPath), executable))
}
