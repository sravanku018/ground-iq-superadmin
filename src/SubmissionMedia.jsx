import { useEffect, useState } from 'react'
import { fetchMediaBlobUrl, listSubmissionMedia } from './api'

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
  const isHttpPhoto = /^https?:\/\//i.test(photoSrc) && !photoSrc.includes('/api/media/')

  if (!photoSrc && !audioSrc) return null

  return (
    <div className="card" style={{ marginBottom: 10, padding: 10 }}>
      <strong style={{ fontSize: 13 }}>Media (free · Neon · no card)</strong>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {photoSrc && (
          <div>
            <span className="muted" style={{ fontSize: 12 }}>
              Photo{photo?.storage ? ` · ${photo.storage}` : ''}
            </span>
            {isHttpPhoto && (
              <a href={photoSrc} target="_blank" rel="noreferrer">
                {' '}
                Open
              </a>
            )}
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
            <span className="muted" style={{ fontSize: 12 }}>
              Audio{audio?.storage ? ` · ${audio.storage}` : ''}
            </span>
            <audio controls src={audioSrc} style={{ width: '100%', marginTop: 6 }} />
          </div>
        )}
      </div>
    </div>
  )
}
