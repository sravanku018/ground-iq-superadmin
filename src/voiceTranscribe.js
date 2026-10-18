/**
 * Batch voice → English transcription helper.
 *
 * The phone records first; this helper uploads the recording only when it is
 * called (i.e. when connectivity exists) and polls the server-side Soniox job.
 * Nothing here holds an API key — the server owns it.
 */
import { getVoiceTranscription, startVoiceTranscription } from './api'

/** Reserved answer keys: never treated as survey questions by the server. */
export const VOICE_TRANSCRIPT_KEY = '_voice_transcript_en'
export const VOICE_TRANSCRIPT_ORIGINAL_KEY = '_voice_transcript_original'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Accept a Blob, ArrayBuffer, or data URL and return a Blob. */
export async function toAudioBlob(audio, fallbackMime = 'audio/webm') {
  if (!audio) return null
  if (typeof Blob !== 'undefined' && audio instanceof Blob) return audio
  if (audio instanceof ArrayBuffer) {
    return new Blob([audio], { type: fallbackMime })
  }
  const s = String(audio)
  if (/^data:/i.test(s)) {
    const comma = s.indexOf(',')
    if (comma < 0) throw new Error('Invalid audio data URL')
    const header = s.slice(5, comma)
    const mime = header.split(';')[0] || fallbackMime
    const b64 = s.slice(comma + 1)
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
    return new Blob([bytes], { type: mime })
  }
  throw new Error('Unsupported audio input')
}

/**
 * Upload once and poll until the English text is ready.
 * @param {Blob|string} audio
 * @param {{ maxWaitMs?: number, onStatus?: (s: string) => void, signal?: AbortSignal }} opts
 * @returns {Promise<{ text: string, original: string, jobId: string }>}
 */
export async function transcribeVoiceToEnglish(audio, opts = {}) {
  const { maxWaitMs = 120_000, onStatus, signal } = opts
  const blob = await toAudioBlob(audio)
  if (!blob || blob.size < 100) throw new Error('Recording is empty')

  onStatus?.('uploading')
  const started = await startVoiceTranscription(blob, { mime: blob.type })
  const jobId = String(started?.job_id || '')
  if (!jobId) throw new Error('Server did not return a transcription job')

  onStatus?.('translating')
  const began = Date.now()
  let delay = 1500
  while (Date.now() - began < maxWaitMs) {
    if (signal?.aborted) {
      const err = new Error('Translation cancelled')
      err.name = 'AbortError'
      throw err
    }
    await sleep(delay)
    const res = await getVoiceTranscription(jobId)
    if (res.status === 'completed') {
      onStatus?.('done')
      return {
        text: String(res.text || '').trim(),
        original: String(res.source_text || '').trim(),
        jobId,
      }
    }
    if (res.status === 'error') {
      throw new Error(res.error || 'Translation failed')
    }
    delay = Math.min(Math.round(delay * 1.25), 5000)
  }
  throw new Error('Translation is still running. It will continue when you are online.')
}
