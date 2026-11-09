import type { AgentSetting, ConversationEvent, ToolCallDiff, ToolCallKind } from '#shared/contract'
import type { ContentBlock, SessionConfigOption, SessionUpdate, ToolCallContent } from '@agentclientprotocol/sdk'
import { toolCallKinds } from '#shared/contract'

// Maps the agent's ACP `session/update` notifications onto the App Builder's
// conversation events (ADR 0054). Updates the page does not show (commands,
// usage, session titles) map to nothing.

const maxOutputLength = 20_000

function textOf (content: ContentBlock): string {
  switch (content.type) {
    case 'text': {
      return content.text
    }
    case 'resource_link': {
      return content.uri
    }
    case 'resource': {
      return 'text' in content.resource ? content.resource.text : content.resource.uri
    }
    default: {
      return ''
    }
  }
}

function kindOf (kind: string | null | undefined): ToolCallKind | undefined {
  if (!kind) {
    return undefined
  }
  return (toolCallKinds as readonly string[]).includes(kind) ? kind as ToolCallKind : 'other'
}

function toolContent (content: ToolCallContent[] | null | undefined): { diffs?: ToolCallDiff[], output?: string } {
  if (!content) {
    return {}
  }
  const diffs = content.flatMap(entry => entry.type === 'diff' ? [{ path: entry.path, oldText: entry.oldText ?? null, newText: entry.newText }] : [])
  const output = content.flatMap(entry => entry.type === 'content' ? [textOf(entry.content)] : []).join('\n')
  return {
    ...(diffs.length > 0 ? { diffs } : {}),
    ...(output.length > 0 ? { output: output.length > maxOutputLength ? `${output.slice(0, maxOutputLength)}\n…` : output } : {}),
  }
}

/** The events one `session/update` adds to the conversation. */
export function eventsFromUpdate (update: SessionUpdate): ConversationEvent[] {
  switch (update.sessionUpdate) {
    case 'user_message_chunk': {
      return [{ type: 'userMessage', text: textOf(update.content) }]
    }
    case 'agent_message_chunk': {
      const text = textOf(update.content)
      return text ? [{ type: 'agentMessage', text }] : []
    }
    case 'agent_thought_chunk': {
      const text = textOf(update.content)
      return text ? [{ type: 'agentThought', text }] : []
    }
    case 'tool_call':
    case 'tool_call_update': {
      const kind = kindOf(update.kind)
      return [{
        type: 'toolCall',
        toolCallId: update.toolCallId,
        ...(update.title ? { title: update.title } : {}),
        ...(kind ? { kind } : {}),
        ...(update.status ? { status: update.status } : {}),
        ...(update.locations ? { locations: update.locations.map(location => location.path) } : {}),
        ...toolContent(update.content),
      }]
    }
    case 'plan': {
      return [{ type: 'plan', entries: update.entries.map(entry => ({ content: entry.content, status: entry.status })) }]
    }
    default: {
      return []
    }
  }
}

/** The agent's model setting, from its session config options. */
export function modelSetting (options: SessionConfigOption[] | null | undefined): AgentSetting | null {
  const option = options?.find(entry => entry.category === 'model') ?? options?.find(entry => entry.id === 'model')
  if (!option || option.type !== 'select') {
    return null
  }
  const values = option.options.flatMap(entry => 'group' in entry ? entry.options : [entry])
  return {
    id: option.id,
    name: option.name,
    current: option.currentValue,
    options: values.map(value => ({ value: value.value, name: value.name, description: value.description ?? null })),
  }
}

/** The session mode option's ID, for setting the edit mode through config options. */
export function modeOptionId (options: SessionConfigOption[] | null | undefined): string | null {
  return options?.find(entry => entry.category === 'mode')?.id ?? null
}
