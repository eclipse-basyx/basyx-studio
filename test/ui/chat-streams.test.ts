import { describe, expect, it } from 'vitest'
import { chatStreamIds } from '../../app/components/app-builder/chat-streams'

describe('App Builder chat streams', () => {
  it('releases inactive chats and keeps the selected chat connected', () => {
    expect(chatStreamIds([{ id: 'old', state: 'idle' }, { id: 'selected', state: 'inactive' }], 'selected')).toEqual(['selected'])
    expect(chatStreamIds([{ id: 'old', state: 'idle' }], null)).toEqual([])
  })

  it('keeps background work connected while reserving connections for files and previews', () => {
    const chats = Array.from({ length: 10 }, (_, index) => ({ id: String(index), state: 'working' as const }))
    expect(chatStreamIds(chats, '9')).toEqual(['9', '0', '1', '2'])
    expect(chatStreamIds([{ id: 'starting', state: 'starting' }, { id: 'waiting', state: 'idle' }], 'waiting')).toEqual(['waiting', 'starting'])
  })
})
