/** Slug a survey question label into a Field ID (unique key). */
export function slugQuestionKey(label) {
  return String(label || '')
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
}

/** Safely parse questions array from array, JSON string, or nested JSON string. */
export function parseQuestionsArray(raw) {
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try {
      let parsed = JSON.parse(raw)
      if (typeof parsed === 'string') {
        try {
          parsed = JSON.parse(parsed)
        } catch {}
      }
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}


/** Persist Telugu copy only when the author filled it. */
export function teluguFields(q) {
  const label_te = String(q?.label_te || '').trim()
  const fromArr = Array.isArray(q?.options_te)
    ? q.options_te.map((s) => String(s || '').trim())
    : []
  const fromText = String(q?.options_te_text || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const options_te = fromArr.some(Boolean) ? fromArr : fromText
  const extra = {}
  if (label_te) extra.label_te = label_te
  if (options_te.length) extra.options_te = options_te
  return extra
}

/** Telugu add / type / auto-translate — Super Admin grant only. */
export function canTeluguQuestions(user) {
  return user?.role === 'super_admin' || !!user?.can_translate_telugu
}

/** Question text stays exactly as typed. Question ID is never rewritten on label edits. */
export function labelPatch(q, label) {
  const next = String(label || '')
  const patch = { label: next }
  if (!q?.speak || q.speak === q.label) patch.speak = next
  return patch
}

/**
 * Generates or normalizes a database question key in standard q_1, q_2, ... format.
 * Preserves existing q_N identifiers or uses index/sequential number.
 */
export function nextQuestionId(label, existingId, used, index) {
  const set = used || new Set()
  let id = String(existingId || '').trim().toLowerCase()

  // If already a valid q_N format and not used yet, keep it
  if (/^q_\d+$/i.test(id) && !set.has(id)) {
    set.add(id)
    return id
  }

  // If index is supplied (e.g. 1, 2, ...), try q_<index>
  if (index != null && Number.isFinite(Number(index)) && Number(index) > 0) {
    const candidate = `q_${Number(index)}`
    if (!set.has(candidate)) {
      set.add(candidate)
      return candidate
    }
  }

  // Otherwise, find the lowest unused sequential q_1, q_2, ...
  let n = 1
  while (set.has(`q_${n}`)) n++
  id = `q_${n}`
  set.add(id)
  return id
}

export function isQuestionVisible(q) {
  return q?.visible !== false
}

/**
 * Known legacy/transient question keys mapped to current canonical question slugs.
 * Used for backwards-compatibility when rendering or editing older survey submissions.
 */
export const LEGACY_QUESTION_ALIASES = {
  which_you_prefer_to_watch: ['id', 'w', 'which_you_prefer_to_watch', 'q_19', 'q19'],
  are_you_eligible_for_any_present_state_govt_schemes: [
    '2_whats_on',
    'q_mtpkyf2o',
    'whats_on',
    '2_whats_on_gen',
    'are_you_eligible_for_any_present_state_govt_schemes',
    'q_11',
    'q11',
  ],
}

/** Get all potential keys/aliases for a question (canonical ID, q_N, slug, legacy aliases). */
export function getQuestionAliases(q, index) {
  const aliases = new Set()
  if (!q) return []
  const id = String(q.id || '').trim()
  const labelSlug = q.label ? slugQuestionKey(q.label) : ''
  const key = String(q.key || '').trim()

  if (id) {
    aliases.add(id)
    aliases.add(id.toLowerCase())
    const m = id.match(/^q_?(\d+)$/i)
    if (m) {
      aliases.add(`q_${m[1]}`)
      aliases.add(`q${m[1]}`)
    }
  }
  if (index != null && Number.isFinite(Number(index)) && Number(index) > 0) {
    aliases.add(`q_${Number(index)}`)
    aliases.add(`q${Number(index)}`)
  }
  if (labelSlug) {
    aliases.add(labelSlug)
  }
  if (key) {
    aliases.add(key)
    aliases.add(key.toLowerCase())
  }

  const checkKeys = [id, labelSlug, key].filter(Boolean)
  for (const k of checkKeys) {
    const kNorm = k.toLowerCase()
    const legacy = LEGACY_QUESTION_ALIASES[kNorm]
    if (Array.isArray(legacy)) {
      for (const al of legacy) {
        aliases.add(al)
        aliases.add(al.toLowerCase())
      }
    }
  }
  return [...aliases]
}

/**
 * Safely resolves an answer value for a question from an answers map, checking canonical keys,
 * q_N aliases, label slug, and any known legacy aliases.
 */
export function resolveAnswerValue(answers, q, index) {
  if (!answers || typeof answers !== 'object' || !q) return ''
  const id = String(q.id || (index != null ? `q_${index}` : '') || slugQuestionKey(q.label) || '').trim()
  if (answers[id] !== undefined && answers[id] !== null && answers[id] !== '') {
    return answers[id]
  }
  if (q.id && answers[q.id] !== undefined && answers[q.id] !== null && answers[q.id] !== '') {
    return answers[q.id]
  }
  if (index != null) {
    if (answers[`q_${index}`] !== undefined && answers[`q_${index}`] !== null && answers[`q_${index}`] !== '') {
      return answers[`q_${index}`]
    }
    if (answers[`q${index}`] !== undefined && answers[`q${index}`] !== null && answers[`q${index}`] !== '') {
      return answers[`q${index}`]
    }
  }
  if (q.label) {
    const slug = slugQuestionKey(q.label)
    if (answers[slug] !== undefined && answers[slug] !== null && answers[slug] !== '') {
      return answers[slug]
    }
  }
  const aliases = getQuestionAliases(q, index)
  for (const al of aliases) {
    if (answers[al] !== undefined && answers[al] !== null && answers[al] !== '') {
      return answers[al]
    }
  }
  return ''
}

/** Formats user-friendly question title for Client Admin views. */
export function getQuestionDisplayLabel(q, index) {
  if (!q) return index != null ? `Question ${index}` : 'Question'
  const text = q.label || q.label_te || q.id || (index != null ? `Question ${index}` : 'Question')
  if (index != null && !text.toLowerCase().startsWith(`q${index}`) && !text.toLowerCase().startsWith(`q_${index}`)) {
    return `Q${index}. ${text}`
  }
  return text
}


