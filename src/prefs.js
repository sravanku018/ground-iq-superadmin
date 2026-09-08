/**
 * Device-local UI preferences (per-phone, not synced to the account).
 * Stored in localStorage under the app's existing `esurvey_` prefix, matching
 * the ad-hoc preference pattern already used elsewhere (e.g. esurvey_queue_meta_v2).
 *
 *  - Survey navigation mode: how questions are presented during collection.
 *  - Font scale: an app-wide display-size increaser for outdoor readability.
 */

const NAV_MODE_KEY = 'esurvey_survey_nav_mode'
const FONT_SCALE_KEY = 'esurvey_font_scale'
const DISPLAY_LANG_KEY = 'esurvey_display_lang'
const LEGACY_FILTER_LANG_KEY = 'esurvey_filter_lang'


const OPTION_TE = {
  Yes: 'అవును',
  No: 'కాదు',
  Positive: 'సానుకూలం',
  Neutral: 'తటస్థం',
  Negative: 'ప్రతికూలం',
}

export function getDisplayLang() {
  try {
    const v = localStorage.getItem(DISPLAY_LANG_KEY) || localStorage.getItem(LEGACY_FILTER_LANG_KEY)
    return v === 'te' ? 'te' : 'en'
  } catch {
    return 'en'
  }
}

export function setDisplayLang(lang) {
  const v = lang === 'te' ? 'te' : 'en'
  try {
    localStorage.setItem(DISPLAY_LANG_KEY, v)
    localStorage.setItem(LEGACY_FILTER_LANG_KEY, v)
    window.dispatchEvent(new Event('esurvey-display-lang'))
  } catch {
    /* ignore */
  }
  return v
}

/** Typed question text in the chosen display language. */
export function displayQuestion(q, lang = getDisplayLang()) {
  const en = String(q?.label || q?.label_en || '').trim()
  const te = String(q?.label_te || '').trim()
  if (lang === 'te') return te || en || 'Question'
  return en || 'Question'
}

/** Option text in the chosen language. Stored answer value stays English. */
export function displayOption(opt, q, index, lang = getDisplayLang()) {
  const en = String(opt ?? '')
  if (lang !== 'te') return en
  const te = Array.isArray(q?.options_te) ? String(q.options_te[index] || '').trim() : ''
  if (te) return te
  return OPTION_TE[en] || en
}

/** 'next' = one question + Next/Prev buttons; 'swipe' = swipe gestures; 'scroll' = all in one column. */
export const NAV_MODES = ['next', 'swipe', 'scroll']
/** Normal → Largest. Applied as a document-root zoom. */
export const FONT_SCALES = [1, 1.15, 1.3, 1.5]

export function getNavMode() {
  try {
    const v = localStorage.getItem(NAV_MODE_KEY)
    return NAV_MODES.includes(v) ? v : 'next'
  } catch {
    return 'next'
  }
}

export function setNavMode(mode) {
  const v = NAV_MODES.includes(mode) ? mode : 'next'
  try {
    localStorage.setItem(NAV_MODE_KEY, v)
  } catch {
    /* ignore */
  }
  return v
}

export function getFontScale() {
  try {
    const n = Number(localStorage.getItem(FONT_SCALE_KEY))
    return FONT_SCALES.includes(n) ? n : 1
  } catch {
    return 1
  }
}

export function setFontScale(scale) {
  const n = FONT_SCALES.includes(Number(scale)) ? Number(scale) : 1
  try {
    localStorage.setItem(FONT_SCALE_KEY, String(n))
  } catch {
    /* ignore */
  }
  return n
}

/**
 * Apply the display-size scale to the whole app.
 *
 * Most text in this app carries inline `px` styles, so scaling the root
 * font-size alone won't touch it — CSS `zoom` on the document root is the only
 * reliable full-UI scale in the Chromium Android WebView + web portals. We use
 * zoom where supported and fall back to root font-size otherwise (never both,
 * so the two never compound).
 */
export function applyFontScale(scale) {
  if (typeof document === 'undefined') return
  const el = document.documentElement
  if (!el) return
  const n = FONT_SCALES.includes(Number(scale)) ? Number(scale) : 1
  const zoomOk =
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('zoom', '1.5')
  if (zoomOk) {
    try {
      el.style.zoom = n === 1 ? '' : String(n)
    } catch {
      /* ignore */
    }
  } else {
    try {
      el.style.fontSize = n === 1 ? '' : `${(16 * n).toFixed(1)}px`
    } catch {
      /* ignore */
    }
  }
}
