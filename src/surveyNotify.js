import { Capacitor, registerPlugin } from '@capacitor/core'

const SurveyNotify = registerPlugin('SurveyNotify')

function native() {
  return typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform?.()
}

export async function startSurveyNotify(text, title = 'Survey running') {
  if (!native()) return
  try {
    await SurveyNotify.start({
      title,
      text: text || 'Tap to return to Collect',
    })
  } catch {
    /* ignore — web / permission */
  }
}

export async function stopSurveyNotify() {
  if (!native()) return
  try {
    await SurveyNotify.stop()
  } catch {
    /* ignore */
  }
}
