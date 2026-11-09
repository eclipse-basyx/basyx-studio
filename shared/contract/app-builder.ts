import { z } from 'zod'

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

/**
 * `starting`: the agent process and session are being set up; `idle`:
 * waiting for a prompt; `working`: a turn runs; `closed`: ended by the
 * user; `failed`: the agent stopped or could not start.
 */
export const conversationStateSchema = z.enum(['starting', 'idle', 'working', 'closed', 'failed'])
export type ConversationState = z.infer<typeof conversationStateSchema>

export const conversationSummarySchema = z.object({
  id: z.string(),
  agentId: agentIdSchema,
  title: z.string(),
  folder: z.string(),
  state: conversationStateSchema,
  /** The model the agent offers to switch between, when it offers one. */
  model: agentSettingSchema.nullable(),
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
    /** Whether the agent stops its turn when this is denied (opencode). */
    denyEndsTurn: z.boolean(),
  }),
  z.object({ type: z.literal('turnEnded'), stopReason: z.string() }),
  z.object({ type: z.literal('state'), state: conversationStateSchema, model: agentSettingSchema.nullable() }),
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

/** Parameters of `POST /app-builder/{operation}`. */
export const appBuilderOperationSchemas = {
  getStatus: z.object({ refresh: z.boolean().default(false) }),
  listConversations: z.object({}),
  startConversation: z.object({ agentId: agentIdSchema }),
  sendPrompt: z.object({ conversationId, text: z.string().trim().min(1).max(100_000) }),
  cancelTurn: z.object({ conversationId }),
  answerApproval: z.object({ conversationId, approvalId: z.string().min(1).max(64), decision: approvalDecisionSchema }),
  setModel: z.object({ conversationId, value: z.string().min(1).max(200) }),
  closeConversation: z.object({ conversationId }),
} as const
export type AppBuilderOperation = keyof typeof appBuilderOperationSchemas
export type AppBuilderOperationParams<O extends AppBuilderOperation> = z.input<(typeof appBuilderOperationSchemas)[O]>

export interface AppBuilderOperationResults {
  getStatus: AppBuilderStatus
  listConversations: ConversationSummary[]
  startConversation: ConversationSummary
  sendPrompt: null
  cancelTurn: null
  answerApproval: null
  setModel: ConversationSummary
  closeConversation: null
}
