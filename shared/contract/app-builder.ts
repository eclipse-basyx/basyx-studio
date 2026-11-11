import type { AppInstallation, AppPackageInspection } from './apps'
import { z } from 'zod'
import { appContributionsSchema } from './apps'

// The App Builder (ADR 0054): chats with coding agents that Studio runs
// over the Agent Client Protocol on the desktop. The page sends operations;
// each conversation's progress arrives as numbered events (Server-Sent
// Events), which the page folds into a transcript.

export const agentIds = ['claude', 'codex', 'opencode'] as const
export const agentIdSchema = z.enum(agentIds)
export type AgentId = z.infer<typeof agentIdSchema>

/**
 * `ready`: installed and signed in; `missing`: the CLI was not found;
 * `signedOut`: installed, but the CLI has no account; `error`: the check
 * failed (see `detail`).
 */
export const agentStateSchema = z.enum(['ready', 'missing', 'signedOut', 'error'])
export type AgentState = z.infer<typeof agentStateSchema>

/** A choice the agent offers for a session setting (model, mode, effort). */
export const agentOptionSchema = z.object({
  value: z.string(),
  name: z.string(),
  description: z.string().nullable(),
})
export type AgentOption = z.infer<typeof agentOptionSchema>

export const agentSettingSchema = z.object({
  id: z.string(),
  name: z.string(),
  current: z.string(),
  options: z.array(agentOptionSchema),
})
export type AgentSetting = z.infer<typeof agentSettingSchema>

export const agentStatusSchema = z.object({
  id: agentIdSchema,
  name: z.string(),
  state: agentStateSchema,
  /** The CLI's version as it reports it. */
  version: z.string().nullable(),
  /** Where the CLI was found. */
  path: z.string().nullable(),
  /** The terminal command that signs the CLI in. */
  signInCommand: z.string(),
  /** Where to get the CLI. */
  installUrl: z.string(),
  detail: z.string().nullable(),
  /**
   * The models the agent offered in its last chat, so a new chat can start
   * with one; null until the agent has run once in the App Builder.
   */
  model: agentSettingSchema.nullable(),
})
export type AgentStatus = z.infer<typeof agentStatusSchema>

export const toolStatusSchema = z.object({
  name: z.enum(['node', 'pnpm', 'git']),
  path: z.string().nullable(),
  version: z.string().nullable(),
})
export type ToolStatus = z.infer<typeof toolStatusSchema>

export const appBuilderStatusSchema = z.object({
  agents: z.array(agentStatusSchema),
  tools: z.array(toolStatusSchema),
  checkedAt: z.string(),
})
export type AppBuilderStatus = z.infer<typeof appBuilderStatusSchema>

/**
 * `inactive`: saved, without a running agent; the next prompt starts it.
 * `starting`: the agent process and session are being set up; `idle`:
 * waiting for a prompt; `working`: a turn runs; `closed`: deleted by the
 * user; `failed`: the agent stopped or could not start.
 */
export const conversationStateSchema = z.enum(['inactive', 'starting', 'idle', 'working', 'closed', 'failed'])
export type ConversationState = z.infer<typeof conversationStateSchema>

/**
 * How freely the agent works in a chat (ADR 0054). `ask`: Studio allows edits
 * in the app's folder and a few build and git commands, and asks for the
 * rest. `auto`: Studio also allows commands that run in the folder and name
 * no path outside it, and asks only for what leaves the folder. `unrestricted`:
 * Studio allows every request and switches the agent to its own mode without
 * checks, where it has one; only for this chat, after the user acknowledged
 * the risk, and not kept when Studio restarts.
 */
export const permissionModes = ['ask', 'auto', 'unrestricted'] as const
export const permissionModeSchema = z.enum(permissionModes)
export type PermissionMode = z.infer<typeof permissionModeSchema>

export const conversationSummarySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  agentId: agentIdSchema,
  title: z.string(),
  folder: z.string(),
  state: conversationStateSchema,
  /** The model the agent offers to switch between, when it offers one. */
  model: agentSettingSchema.nullable(),
  permissionMode: permissionModeSchema,
  createdAt: z.string(),
  /** The number of the last event, for resuming the event stream. */
  lastSeq: z.number().int().nonnegative(),
})
export type ConversationSummary = z.infer<typeof conversationSummarySchema>

export const toolCallKinds = ['read', 'edit', 'delete', 'move', 'search', 'execute', 'think', 'fetch', 'switch_mode', 'other'] as const
export const toolCallKindSchema = z.enum(toolCallKinds)
export type ToolCallKind = z.infer<typeof toolCallKindSchema>

export const toolCallStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'failed'])
export type ToolCallStatus = z.infer<typeof toolCallStatusSchema>

export const toolCallDiffSchema = z.object({
  path: z.string(),
  oldText: z.string().nullable(),
  newText: z.string(),
})
export type ToolCallDiff = z.infer<typeof toolCallDiffSchema>

export const planEntrySchema = z.object({
  content: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed']),
})
export type PlanEntry = z.infer<typeof planEntrySchema>

/**
 * `pending`: waits for the user; `allowed` and `denied`: the user's answer;
 * `autoAllowed`: Studio's policy allowed it (inside the folder, or allowed in
 * this chat); `cancelled`: the turn ended before an answer.
 */
export const approvalStateSchema = z.enum(['pending', 'allowed', 'denied', 'autoAllowed', 'cancelled'])
export type ApprovalState = z.infer<typeof approvalStateSchema>

export const approvalDecisionSchema = z.enum(['allowOnce', 'allowInChat', 'deny'])
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>

/** A bundled app whose sources a project can start from (plan P4). */
export interface BundledAppSource {
  /** Its folder in Studio's apps. */
  source: string
  appId: string
  title: string
  description: string | null
  version: string
}

/** `new`: from Studio's template; `copy`: of a bundled app; `folder`: a folder the user chose. */
export const appProjectOrigins = ['new', 'copy', 'folder'] as const
export const appProjectOriginSchema = z.enum(appProjectOrigins)
export type AppProjectOrigin = z.infer<typeof appProjectOriginSchema>

export const appProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  appId: z.string(),
  folder: z.string(),
  origin: appProjectOriginSchema,
  source: z.string().nullable(),
  createdAt: z.string(),
  /** Newest first. */
  conversations: z.array(conversationSummarySchema),
})
export type AppProject = z.infer<typeof appProjectSchema>

export const changedFileSchema = z.object({
  path: z.string(),
  status: z.enum(['added', 'modified', 'deleted', 'renamed']),
})
export type ChangedFile = z.infer<typeof changedFileSchema>

const text = z.string()

/** What happened in a conversation. `toolCall` events carry only the fields that changed. */
export const conversationEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('userMessage'), text }),
  z.object({ type: z.literal('agentMessage'), text }),
  z.object({ type: z.literal('agentThought'), text }),
  z.object({
    type: z.literal('toolCall'),
    toolCallId: z.string(),
    title: z.string().optional(),
    kind: toolCallKindSchema.optional(),
    status: toolCallStatusSchema.optional(),
    locations: z.array(z.string()).optional(),
    diffs: z.array(toolCallDiffSchema).optional(),
    output: z.string().optional(),
  }),
  z.object({ type: z.literal('plan'), entries: z.array(planEntrySchema) }),
  z.object({
    type: z.literal('approval'),
    approvalId: z.string(),
    toolCallId: z.string().nullable(),
    title: z.string(),
    kind: toolCallKindSchema,
    command: z.string().nullable(),
    paths: z.array(z.string()),
    state: approvalStateSchema,
    /** Why Studio allowed it without asking, for `autoAllowed`. */
    reason: z.enum(['folder', 'chat', 'auto', 'unrestricted']).optional(),
    /** Whether the agent stops its turn when this is denied (opencode). */
    denyEndsTurn: z.boolean(),
  }),
  z.object({ type: z.literal('turnEnded'), stopReason: z.string() }),
  /** Studio committed what a turn changed in the project's git repository. */
  z.object({ type: z.literal('checkpoint'), commit: z.string(), message: z.string(), files: z.array(changedFileSchema) }),
  /** The user undid this turn and the ones after it. */
  z.object({ type: z.literal('checkpointUndone'), commit: z.string() }),
  /** Studio built the project after a turn (plan B1); a failed build has its log. */
  z.object({ type: z.literal('build'), state: z.enum(['running', 'succeeded', 'failed']), log: z.string().nullable(), consentNeeded: z.boolean() }),
  /** Something Studio tells about the chat, such as a session that could not be resumed. */
  z.object({ type: z.literal('notice'), text: z.string() }),
  z.object({ type: z.literal('state'), state: conversationStateSchema, model: agentSettingSchema.nullable(), permissionMode: permissionModeSchema.optional() }),
  z.object({ type: z.literal('error'), message: z.string() }),
])
export type ConversationEvent = z.infer<typeof conversationEventSchema>

export const conversationEventEnvelopeSchema = z.object({
  seq: z.number().int().positive(),
  at: z.string(),
  event: conversationEventSchema,
})
export type ConversationEventEnvelope = z.infer<typeof conversationEventEnvelopeSchema>

const conversationId = z.string().min(1).max(64)

/** What the preview's package asks for that the user has not allowed yet (plan B4). */
export const previewConsentSchema = z.object({
  /** No preview was installed before. */
  first: z.boolean(),
  permissions: z.array(z.string()),
  /** Permissions, origins, sandbox features and connections new since the last preview. */
  added: z.array(z.string()),
})
export type PreviewConsent = z.infer<typeof previewConsentSchema>

/** A project's preview (plan B3): the last build, and the preview installation's views and modules. */
export const appPreviewSchema = z.object({
  projectId: z.string(),
  build: z.object({
    state: z.enum(['none', 'running', 'succeeded', 'failed']),
    log: z.string().nullable(),
    at: z.string().nullable(),
  }),
  /** Set while a built package waits for the user to allow what it asks for. */
  consent: previewConsentSchema.nullable(),
  installationId: z.string().nullable(),
  contributions: appContributionsSchema.nullable(),
})
export type AppPreview = z.infer<typeof appPreviewSchema>

/** How an installed release is signed (plan B6): developer mode, this computer's key, or the user's own key. */
export const releaseSigningSchema = z.enum(['unsigned', 'machine', 'own'])
export type ReleaseSigning = z.infer<typeof releaseSigningSchema>

/** What installing a project's app would replace, and the versions it could take (plan B5). */
export const releaseInfoSchema = z.object({
  projectId: z.string(),
  appId: z.string(),
  version: z.string(),
  installed: z.object({ version: z.string(), trust: z.string(), publisher: z.string().nullable() }).nullable(),
  /** Whether `version` is higher than the installed one, so it can update it as it is. */
  newVersion: z.boolean(),
  patch: z.string(),
  minor: z.string(),
  /** This computer's key, once created; it signs only `local.*` apps. */
  machineKey: z.object({ publicKey: z.string(), fingerprint: z.string() }).nullable(),
  machineKeyApplies: z.boolean(),
})
export type ReleaseInfo = z.infer<typeof releaseInfoSchema>

const projectId = z.string().min(1).max(64)
const prompt = z.string().trim().min(1).max(100_000)
/** A model's value, as the agent offers it. */
const model = z.string().min(1).max(200)
const commit = z.string().regex(/^[\da-f]{7,64}$/, 'must be a commit hash')

/** A project's name: one line, and something that gives a folder name. */
export const appProjectNameSchema = z.string().trim().min(1).max(80).regex(/^\P{Cc}*$/u, 'must be one line without control characters').refine(name => /[\p{L}\p{N}]/u.test(name), 'must contain a letter or digit')

/** Parameters of `POST /app-builder/{operation}`. */
export const appBuilderOperationSchemas = {
  getStatus: z.object({ refresh: z.boolean().default(false) }),
  listProjects: z.object({}),
  /** From the template, or as a copy of a bundled app (`source`: its folder in Studio's apps); the prompt starts the first chat. */
  createProject: z.object({ name: appProjectNameSchema, agentId: agentIdSchema, model: model.optional(), prompt: prompt.optional(), source: z.string().regex(/^[a-z\d][a-z\d-]{0,63}$/).optional() }),
  /** An app's folder the user chose (an `app-project` grant), registered where it is (plan P5). */
  addFolder: z.object({ folderHandle: z.string().min(1).max(200), agentId: agentIdSchema, model: model.optional(), name: appProjectNameSchema.optional() }),
  listBundledApps: z.object({}),
  /** The models an agent offers, for a new chat; asks the agent once when no chat has shown them. */
  getAgentModels: z.object({ agentId: agentIdSchema }),
  removeProject: z.object({ projectId, deleteFolder: z.boolean().default(false) }),
  openFolder: z.object({ projectId }),
  startConversation: z.object({ projectId, agentId: agentIdSchema, model: model.optional() }),
  deleteConversation: z.object({ conversationId }),
  sendPrompt: z.object({ conversationId, text: prompt }),
  cancelTurn: z.object({ conversationId }),
  answerApproval: z.object({ conversationId, approvalId: z.string().min(1).max(64), decision: approvalDecisionSchema }),
  setModel: z.object({ conversationId, value: model }),
  /** `unrestricted` only with `acknowledgeRisk`, after the page warned the user. */
  setPermissionMode: z.object({ conversationId, mode: permissionModeSchema, acknowledgeRisk: z.boolean().default(false) }),
  getChanges: z.object({ projectId, commit }),
  getPreview: z.object({ projectId }),
  buildPreview: z.object({ projectId }),
  approvePreview: z.object({ projectId }),
  getReleaseInfo: z.object({ projectId }),
  inspectRelease: z.object({
    projectId,
    bump: z.enum(['none', 'patch', 'minor']).default('none'),
    signing: releaseSigningSchema,
    /** A `signing-key` file grant, for `own`. */
    keyHandle: z.string().min(1).max(200).optional(),
    /** The passphrase of an encrypted own key; used once, never stored. */
    passphrase: z.string().max(1024).optional(),
  }),
  installRelease: z.object({ projectId, digest: z.string().regex(/^sha256:[\da-f]{64}$/) }),
  exportRelease: z.object({ projectId, digest: z.string().regex(/^sha256:[\da-f]{64}$/), fileHandle: z.string().min(1).max(200) }),
  getMachineKey: z.object({}),
  undoTurn: z.object({ conversationId, commit }),
} as const
export type AppBuilderOperation = keyof typeof appBuilderOperationSchemas
export type AppBuilderOperationParams<O extends AppBuilderOperation> = z.input<(typeof appBuilderOperationSchemas)[O]>

export interface AppBuilderOperationResults {
  getStatus: AppBuilderStatus
  listProjects: AppProject[]
  createProject: { project: AppProject, conversation: ConversationSummary }
  addFolder: { project: AppProject, conversation: ConversationSummary }
  listBundledApps: BundledAppSource[]
  getAgentModels: AgentSetting | null
  removeProject: null
  openFolder: null
  startConversation: ConversationSummary
  deleteConversation: null
  sendPrompt: null
  cancelTurn: null
  answerApproval: null
  setModel: ConversationSummary
  setPermissionMode: ConversationSummary
  /** The commit as a patch, and its files. */
  getChanges: { patch: string, files: ChangedFile[] }
  undoTurn: null
  getPreview: AppPreview
  buildPreview: AppPreview
  approvePreview: AppPreview
  getReleaseInfo: ReleaseInfo
  /** The built package as the install dialog shows it; `digest` installs or exports it. */
  inspectRelease: { inspection: AppPackageInspection, digest: string, version: string, signed: boolean }
  installRelease: AppInstallation
  exportRelease: { fileName: string }
  getMachineKey: { publicKey: string, fingerprint: string }
}
