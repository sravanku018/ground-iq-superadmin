/** Field media size: 16 kHz speech + canvas WebP/JPEG. No extra codec library. */

export const AUDIO_SAMPLE_RATE = 16000
export const AUDIO_BITRATE = 24000
export const PHOTO_MAX_EDGE = 800
export const PHOTO_JPEG_QUALITY = 0.58
export const PHOTO_WEBP_QUALITY = 0.62

export function pickAudioRecorderMime() {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ]
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return ''
  }
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || ''
}

export function pickAudioRecorderOptions() {
  const mimeType = pickAudioRecorderMime()
  const opts = { audioBitsPerSecond: AUDIO_BITRATE }
  if (mimeType) opts.mimeType = mimeType
  return opts
}

function downsampleMono(input, fromRate, toRate) {
  if (!fromRate || fromRate === toRate) return input
  const ratio = fromRate / toRate
  const outLen = Math.max(1, Math.round(input.length / ratio))
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i += 1) {
    const x = i * ratio
    const i0 = Math.min(input.length - 1, Math.floor(x))
    const i1 = Math.min(input.length - 1, i0 + 1)
    const f = x - i0
    out[i] = input[i0] * (1 - f) + input[i1] * f
  }
  return out
}

function mixToMono(buffer) {
  const n = buffer.numberOfChannels
  if (n <= 1) return buffer.getChannelData(0)
  const len = buffer.length
  const out = new Float32Array(len)
  for (let c = 0; c < n; c += 1) {
    const ch = buffer.getChannelData(c)
    for (let i = 0; i < len; i += 1) out[i] += ch[i] / n
  }
  return out
}

function encodeWav16kMono(float32) {
  const n = float32.length
  const bytes = new ArrayBuffer(44 + n * 2)
  const view = new DataView(bytes)
  const writeStr = (off, s) => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(off + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + n * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, AUDIO_SAMPLE_RATE, true)
  view.setUint32(28, AUDIO_SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, n * 2, true)
  let o = 44
  for (let i = 0; i < n; i += 1) {
    const s = Math.max(-1, Math.min(1, float32[i]))
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    o += 2
  }
  return new Blob([bytes], { type: 'audio/wav' })
}

/**
 * Keep Opus/WebM at 24 kbps when MediaRecorder produced it.
 * WAV 16 kHz is only a fallback (much larger) if the blob is not a speech codec.
 */
export async function toSpeechWav16k(blob) {
  if (!blob || !blob.size) return blob
  const mime = String(blob.type || '').toLowerCase()
  if (mime.includes('opus') || mime.includes('webm') || mime.includes('ogg')) {
    return blob
  }
  try {
    const ctx = new AudioContext()
    const buf = await blob.arrayBuffer()
    const decoded = await ctx.decodeAudioData(buf.slice(0))
    await ctx.close().catch(() => {})
    const mono = mixToMono(decoded)
    const speech = downsampleMono(mono, decoded.sampleRate, AUDIO_SAMPLE_RATE)
    const wav = encodeWav16kMono(speech)
    if (wav.size > 680_000 && blob.size < wav.size) return blob
    return wav
  } catch {
    return blob
  }
}

export function compressPhotoFromImage(img) {
  const w0 = img.width || 1
  const h0 = img.height || 1
  const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(w0, h0))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w0 * scale))
  canvas.height = Math.max(1, Math.round(h0 * scale))
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const jpeg = canvas.toDataURL('image/jpeg', PHOTO_JPEG_QUALITY)
  let out = jpeg
  try {
    const webp = canvas.toDataURL('image/webp', PHOTO_WEBP_QUALITY)
    if (webp.startsWith('data:image/webp') && webp.length < jpeg.length) out = webp
  } catch {
    /* WebP not available */
  }
  if (out.length > 550_000) {
    out = canvas.toDataURL('image/jpeg', 0.45)
  }
  return out
}

export function compressImageFile(file, maxDimension = PHOTO_MAX_EDGE, quality = PHOTO_JPEG_QUALITY) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('No file provided'))
      return
    }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Failed to read image file'))
    reader.onload = (e) => {
      const img = new Image()
      img.onerror = () => reject(new Error('Failed to load image'))
      img.onload = () => {
        if (maxDimension === PHOTO_MAX_EDGE && quality === PHOTO_JPEG_QUALITY) {
          resolve(compressPhotoFromImage(img))
          return
        }
        let { width, height } = img
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width)
            width = maxDimension
          } else {
            width = Math.round((width * maxDimension) / height)
            height = maxDimension
          }
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        canvas.getContext('2d').drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.src = e.target?.result
    }
    reader.readAsDataURL(file)
  })
}
