import type { AgentId } from '#shared/contract'
import type { CommandResult } from './environment'

// The coding agents the App Builder runs (ADR 0054), each through the Agent
// Client Protocol. Claude and Codex go through the ACP project's adapters,
// which drive the user's installed CLI; opencode speaks ACP itself.
// The edit modes and opencode's permission rules come from the Phase 0
// spikes (docs/development/app-builder-plan.md, "Phase 0 results").

/**
 * opencode's rules (plan A1): every edit and command asks, so Studio's policy
 * (policy.ts) decides each one. Rules that allow by themselves would skip
 * Studio, which then could neither keep the planning chat read-only nor
 * refuse what its own command list leaves out (`git diff --output=<file>`).
 */
export const opencodePermissionRules = {
  permission: {
    edit: 'ask',
    bash: { '*': 'ask' },
    webfetch: 'ask',
    external_directory: 'ask',
  },
} as const

export interface AgentLaunch {
  /** `adapter`: Studio's Node runs the package's script; `cli`: the installed CLI runs. */
  runner: 'adapter' | 'cli'
  /** The adapter script, resolved from Studio's own dependencies; `null` when it is missing from the build. */
  adapterScript?: string | null
  args: string[]
  /** Variables that tell the agent which CLI and rules to use. */
  env: (cliPath: string) => NodeJS.ProcessEnv
}

export interface AgentDefinition {
  id: AgentId
  name: string
  /** The CLI on the user's PATH. */
  cli: string
  installUrl: string
  signInCommand: string
  /** The session mode in which edits in the folder run without asking. */
  editMode: string | null
  /** The session mode without the agent's own checks, for `unrestricted`; `null` when Studio's answers are the only checks. */
  unrestrictedMode: string | null
  /** The session mode for a read-only chat (the planning chat), where edits ask; Studio denies them. */
  readOnlyMode: string | null
  /** Whether a denied permission request ends the agent's turn. */
  denyEndsTurn: boolean
  launch: AgentLaunch
  /** Reads the CLI's sign-in status; `null` when the CLI needs no account. */
  signInCheck: { args: string[], signedIn: (result: CommandResult) => boolean } | null
}

export function agentCatalog (resolve: (specifier: string) => string): AgentDefinition[] {
  const resolveAdapter = (specifier: string) => {
    try {
      return resolve(specifier)
    } catch {
      return null
    }
  }
  return [
    {
      id: 'claude',
      name: 'Claude Code',
      cli: 'claude',
      installUrl: 'https://docs.anthropic.com/en/docs/claude-code/setup',
      signInCommand: 'claude auth login',
      editMode: 'acceptEdits',
      unrestrictedMode: 'bypassPermissions',
      readOnlyMode: 'default',
      denyEndsTurn: false,
      launch: {
        runner: 'adapter',
        adapterScript: resolveAdapter('@agentclientprotocol/claude-agent-acp/dist/index.js'),
        args: [],
        env: cliPath => ({ CLAUDE_CODE_EXECUTABLE: cliPath }),
      },
      // The adapter reports a missing sign-in only when the first prompt
      // fails, so the CLI is asked first.
      signInCheck: {
        args: ['auth', 'status'],
        signedIn: ({ stdout }) => {
          try {
            return (JSON.parse(stdout) as { loggedIn?: unknown }).loggedIn === true
          } catch {
            return false
          }
        },
      },
    },
    {
      id: 'codex',
      name: 'Codex',
      cli: 'codex',
      installUrl: 'https://developers.openai.com/codex/cli',
      signInCommand: 'codex login',
      editMode: 'workspace-write',
      // No sandbox and no approvals; network and files outside the folder too.
      unrestrictedMode: 'agent-full-access',
      readOnlyMode: 'read-only',
      denyEndsTurn: false,
      launch: {
        runner: 'adapter',
        adapterScript: resolveAdapter('@agentclientprotocol/codex-acp/dist/index.js'),
        args: [],
        env: cliPath => ({ CODEX_PATH: cliPath }),
      },
      signInCheck: {
        args: ['login', 'status'],
        signedIn: ({ code }) => code === 0,
      },
    },
    {
      id: 'opencode',
      name: 'opencode',
      cli: 'opencode',
      installUrl: 'https://opencode.ai/download',
      signInCommand: 'opencode auth login',
      editMode: null,
      // opencode asks Studio for every edit and command, and Studio allows it.
      unrestrictedMode: null,
      readOnlyMode: null,
      denyEndsTurn: true,
      launch: {
        runner: 'cli',
        args: ['acp'],
        env: () => ({ OPENCODE_CONFIG_CONTENT: JSON.stringify(opencodePermissionRules) }),
      },
      // opencode has free models, so it works without an account.
      signInCheck: null,
    },
  ]
}
