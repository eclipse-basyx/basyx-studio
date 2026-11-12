import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { usePlanningActivity } from '../../app/components/app-builder/planning-activity'
import { emptyTranscript } from '../../app/components/app-builder/transcript'

describe('App Builder planning activity', () => {
  it('enables planning controls after startup fails and accepts a successful retry', async () => {
    const draftId = ref<string | null>(null)
    const transcript = ref(emptyTranscript())
    const activity = usePlanningActivity(() => draftId.value, () => transcript.value)
    const unavailable = new Error('The agent is unavailable.')
    let rejectStart: (error: Error) => void = () => {}
    const start = activity.request(async () => await new Promise<void>((_resolve, reject) => {
      rejectStart = reject
    }))
    expect(activity.writing.value).toBe(true)
    rejectStart(unavailable)
    await expect(start).rejects.toBe(unavailable)
    // No draft was created: Send, document editing and Next are available again.
    expect(activity.writing.value).toBe(false)

    await activity.request(async () => {
      expect(activity.writing.value).toBe(true)
      draftId.value = 'retry'
      transcript.value.state = 'working'
    })
    expect(activity.writing.value).toBe(true)
    transcript.value.state = 'idle'
    expect(activity.writing.value).toBe(false)
  })

  it('waits for the request before a session exists and preserves real agent activity on errors', async () => {
    const draftId = ref<string | null>(null)
    const transcript = ref(emptyTranscript())
    const activity = usePlanningActivity(() => draftId.value, () => transcript.value)
    expect(activity.writing.value).toBe(false)

    draftId.value = 'draft'
    transcript.value.state = 'working'
    const busy = new Error('The agent is busy.')
    await expect(activity.request(async () => {
      throw busy
    })).rejects.toBe(busy)
    expect(activity.writing.value).toBe(true)
    expect(transcript.value.state).toBe('working')
    transcript.value.state = 'failed'
    expect(activity.writing.value).toBe(false)
  })
})
