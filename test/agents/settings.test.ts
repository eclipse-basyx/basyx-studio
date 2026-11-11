import type { SessionConfigOption } from '@agentclientprotocol/sdk'
import { describe, expect, it } from 'vitest'
import { effortSetting, eventsFromUpdate, mergeSetting, modelSetting, speedSetting } from '../../server/lib/agents/events'

// What Claude Code's adapter reports (claude-agent-acp): model, effort and fast mode as session config options.
const options = [
  { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'opus', options: [{ value: 'opus', name: 'Opus 5.5' }, { value: 'sonnet', name: 'Sonnet 5.5' }] },
  { id: 'effort', name: 'Effort', category: 'thought_level', type: 'select', currentValue: 'medium', options: [{ value: 'low', name: 'Low' }, { value: 'medium', name: 'Medium' }, { value: 'high', name: 'High' }] },
  { id: 'fast', name: 'Fast mode', category: 'model_config', type: 'select', currentValue: 'off', options: [{ value: 'on', name: 'On' }, { value: 'off', name: 'Off' }] },
] as SessionConfigOption[]

describe('App Builder agent settings (ADR 0054)', () => {
  it('reads the model, effort and fast mode the agent offers', () => {
    expect(modelSetting(options)).toMatchObject({ id: 'model', current: 'opus', options: [{ value: 'opus', name: 'Opus 5.5' }, { value: 'sonnet' }] })
    expect(effortSetting(options)).toMatchObject({ id: 'effort', current: 'medium' })
    expect(effortSetting(options)?.options).toHaveLength(3)
    expect(speedSetting(options)).toMatchObject({ id: 'fast', current: 'off' })
    // An agent without them offers none.
    expect(effortSetting([options[0]!])).toBeNull()
    expect(speedSetting([options[0]!])).toBeNull()
  })

  it('keeps the known choices when an update reports only the current value', () => {
    const effort = effortSetting(options)!
    const reported = effortSetting([{ ...options[1]!, currentValue: 'high', options: [{ value: 'high', name: 'High' }] } as SessionConfigOption])!
    expect(mergeSetting(effort, reported)).toMatchObject({ current: 'high', options: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }] })
    // A new model may offer other choices: a full list replaces the old one.
    const other = effortSetting([{ ...options[1]!, currentValue: 'max', options: [{ value: 'max', name: 'Max' }, { value: 'low', name: 'Low' }] } as SessionConfigOption])!
    expect(mergeSetting(effort, other).options.map(option => option.value)).toEqual(['max', 'low'])
  })

  it('reports how much of the context window the chat uses', () => {
    expect(eventsFromUpdate({ sessionUpdate: 'usage_update', used: 45_000, size: 200_000 })).toEqual([{ type: 'usage', used: 45_000, size: 200_000 }])
  })
})
