import { Capacitor, registerPlugin } from '@capacitor/core'

const ConverseRecorder = registerPlugin('ConverseRecorder')

/** True on the Android APK, where the native foreground service is available. */
export function backgroundRecordingAvailable() {
  return (
    typeof Capacitor !== 'undefined' &&
    Capacitor.isNativePlatform?.() &&
    Capacitor.getPlatform?.() === 'android'
  )
}

/** Start the native microphone foreground service. */
export async function startBackgroundRecording({ maxSeconds = 600 } = {}) {
  return ConverseRecorder.start({ maxSeconds: Number(maxSeconds) || 600 })
}

/** Stop and return `{ base64, mime, durationMs, size }`. */
export async function stopBackgroundRecording() {
  return ConverseRecorder.stop()
}

/** `{ recording, startedAt, elapsedMs, durationMs }` */
export async function backgroundRecordingStatus() {
  return ConverseRecorder.status()
}

export async function cancelBackgroundRecording() {
  try {
    await ConverseRecorder.cancel()
  } catch {
    /* ignore */
  }
}
