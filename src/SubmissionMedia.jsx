import { useEffect, useState } from 'react'
import { downloadMediaFile, fetchMediaBlobUrl, listSubmissionMedia } from './api'

/**
 * Shared photo/audio viewer for one submission.
 * Shows photo (with external "Open" link) and audio player.
 * item: submission object with id + optional photo_url/audio_url.
 */
export default function SubmissionMedia({ item, compact }) {
  const [media, setMedia] = useState(null)

  useEffect(() => {
    if (!item?.id) return undefined
    let cancelled = false
    const blobUrls = []
    setMedia(null)
    ;(async () => {
      try {
        const d = await listSubmissionMedia(item.id)
        const list = d.media || []
        const resolved = []
        for (const m of list) {
          let playUrl = m.url || ''
          try {
            if (playUrl && (playUrl.startsWith('/api/media/') || playUrl.includes('/api/media/'))) {
              playUrl = await fetchMediaBlobUrl(playUrl)
              blobUrls.push(playUrl)
            }
          } catch {
            /* keep original */
          }
          resolved.push({ ...m, playUrl: playUrl || m.url })
        }
        if (!cancelled) setMedia(resolved)
      } catch {
        if (!cancelled) setMedia([])
      }
    })()
    return () => {
      cancelled = true
      blobUrls.forEach((u) => {
        try {
          URL.revokeObjectURL(u)
        } catch {
          /* ignore */
        }
      })
    }
  }, [item?.id])

  const list = media ?? null
  const photo = list
    ? (list.find((m) => m.kind === 'photo') || null)
    : null
  const audio = list
    ? (list.find((m) => m.kind === 'audio') || null)
    : null
  const photoSrc = (photo && (photo.playUrl || photo.url)) || item?.photo_url || ''
  const audioSrc = (audio && (audio.playUrl || audio.url)) || item?.audio_url || ''
  const rawPhotoUrl = photo?.url || item?.photo_url || photoSrc
  const rawAudioUrl = audio?.url || item?.audio_url || audioSrc

  const isConfirmed =
    item?.status === 'confirmed' ||
    item?.fact_status === 'confirmed' ||
    item?.fact_status === 'materialized'

  const isWeb =
    item?.source === 'web-survey' ||
    item?.source === 'web' ||
    item?.payload?.source === 'web-survey' ||
    item?.payload?.source === 'web' ||
    item?.submitted_by === 'Web' ||
    item?.submitted_by === 'web'

  if (isWeb) return null

  if (isConfirmed) {
    return (
      <div
        className="card"
        style={{
          marginBottom: 10,
          padding: '8px 12px',
          background: '#ecfdf5',
          border: '1px solid #a7f3d0',
          borderRadius: 8,
        }}
      >
        <span style={{ fontSize: 12, color: '#047857', fontWeight: 600 }}>
          ✅ Confirmed Record — Photo & Audio hidden post-verification (Details only)
        </span>
      </div>
    )
  }

  if (!photoSrc && !audioSrc) return null

  return (
    <div className="card" style={{ marginBottom: 10, padding: 10 }}>
      <strong style={{ fontSize: 13 }}>Media (free · Neon · no card)</strong>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {photoSrc && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="muted" style={{ fontSize: 12 }}>
                Photo{photo?.storage ? ` · ${photo.storage}` : ''}
              </span>
              <button
                type="button"
                className="btn small"
                style={{ fontSize: 11, padding: '3px 8px' }}
                onClick={() => downloadMediaFile(rawPhotoUrl, `photo-${item?.id || 'record'}.jpg`)}
              >
                ⬇ Download Photo
              </button>
            </div>
            <img
              src={photoSrc}
              alt="survey photo"
              style={{
                display: 'block',
                maxWidth: '100%',
                maxHeight: compact ? 220 : 360,
                marginTop: 6,
                borderRadius: 8,
                objectFit: 'cover',
              }}
            />
          </div>
        )}
        {audioSrc && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span className="muted" style={{ fontSize: 12 }}>
                Audio Recording{audio?.storage ? ` · ${audio.storage}` : ''}
              </span>
              <button
                type="button"
                className="btn small primary"
                style={{ fontSize: 11, padding: '3px 8px' }}
                onClick={() => downloadMediaFile(rawAudioUrl, `audio-recording-${item?.id || 'record'}.mp3`)}
              >
                ⬇ Download Audio File
              </button>
            </div>
            <audio controls src={audioSrc} style={{ width: '100%', marginTop: 2 }} />
          </div>
        )}
      </div>
    </div>
  )
}
