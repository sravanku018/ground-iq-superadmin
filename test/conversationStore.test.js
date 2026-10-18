import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubStorage } from './stubs.js'
import {
  conversationSummary,
  deleteConversationLocal,
  getConversationLocal,
  listConversationsLocal,
  saveConversationLocal,
  updateConversationLocal,
} from '../src/conversationStore.js'

// These tests run without IndexedDB so they exercise the LocalStorage fallback,
// which is the path used by restricted WebViews and private browsing.
beforeEach(() => {
  stubStorage()
  vi.stubGlobal('indexedDB', undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const AUDIO = `data:audio/webm;base64,${Buffer.from('voice-bytes').toString('base64')}`

describe('conversationStore offline fallback', () => {
  it('saves a conversation with its audio and lists it', async () => {
    await saveConversationLocal({
      id: 'c1',
      title: 'Ward 12 interview',
      recordedAt: '2026-10-18T10:00:00.000Z',
      durationMs: 65_000,
      audioDataUrl: AUDIO,
      audioMime: 'audio/webm',
    })

    const rows = await listConversationsLocal()
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe('Ward 12 interview')
    expect(rows[0].audioDataUrl).toBe(AUDIO)
    expect(rows[0].transcriptStatus).toBe('queued')
    expect(rows[0].status).toBe('local')
  })

  it('keeps the audio when the transcript arrives', async () => {
    await saveConversationLocal({ id: 'c2', audioDataUrl: AUDIO })
    const updated = await updateConversationLocal('c2', {
      transcript: 'The respondent supports the ruling party.',
      transcriptStatus: 'completed',
      serverId: 42,
      status: 'sent',
    })

    expect(updated.transcript).toContain('ruling party')
    expect(updated.audioDataUrl).toBe(AUDIO)
    expect(updated.serverId).toBe(42)
    expect(updated.status).toBe('sent')
  })

  it('sorts conversations newest first', async () => {
    await saveConversationLocal({ id: 'old', recordedAt: '2026-10-01T10:00:00.000Z' })
    await saveConversationLocal({ id: 'new', recordedAt: '2026-10-18T10:00:00.000Z' })

    const rows = await listConversationsLocal()
    expect(rows.map((c) => c.id)).toEqual(['new', 'old'])
  })

  it('removes both the record and its audio on delete', async () => {
    await saveConversationLocal({ id: 'c3', audioDataUrl: AUDIO })
    await deleteConversationLocal('c3')

    expect(await getConversationLocal('c3')).toBeNull()
    expect(localStorage.getItem('esurvey_conv_audio_c3')).toBeNull()
    expect(await listConversationsLocal()).toHaveLength(0)
  })

  it('summarises waiting, translating, and ready conversations', async () => {
    await saveConversationLocal({ id: 'local-only' })
    await saveConversationLocal({
      id: 'translating',
      serverId: 7,
      transcriptStatus: 'processing',
      status: 'sent',
    })
    await saveConversationLocal({
      id: 'ready',
      serverId: 8,
      transcriptStatus: 'completed',
      transcript: 'done',
      status: 'sent',
    })

    const summary = await conversationSummary()
    expect(summary.total).toBe(3)
    expect(summary.pending).toBe(1)
    expect(summary.translating).toBe(1)
    expect(summary.ready).toBe(1)
  })
})
