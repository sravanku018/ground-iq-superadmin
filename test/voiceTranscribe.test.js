import { afterEach, describe, expect, it, vi } from 'vitest'
import { VOICE_TRANSCRIPT_KEY, toAudioBlob } from '../src/voiceTranscribe.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('voiceTranscribe helpers', () => {
  it('uses a reserved underscore key so transcripts never count as answers', () => {
    expect(VOICE_TRANSCRIPT_KEY.startsWith('_')).toBe(true)
  })

  it('decodes an audio data URL into a typed Blob', async () => {
    const payload = Buffer.from([0x1a, 0x45, 0xdf, 0xa3])
    const blob = await toAudioBlob(
      `data:audio/webm;codecs=opus;base64,${payload.toString('base64')}`,
    )

    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('audio/webm')
    expect(blob.size).toBe(payload.length)
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array(payload))
  })

  it('passes an existing Blob through unchanged', async () => {
    const blob = new Blob(['audio'], { type: 'audio/webm' })
    expect(await toAudioBlob(blob)).toBe(blob)
  })

  it('rejects non-audio input instead of uploading an empty body', async () => {
    await expect(toAudioBlob('not-a-data-url')).rejects.toThrow('Unsupported audio input')
  })
})
