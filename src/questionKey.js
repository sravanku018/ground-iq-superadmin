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

/** Question text stays exactly as typed. Field ID is synced cleanly to the slug. */
export function labelPatch(q, label) {
  const next = String(label || '')
  const patch = { label: next }
  const existingId = String(q?.id || '').trim()
  const slug = slugQuestionKey(next)
  if (!existingId || existingId.startsWith('q_') || existingId.length <= 2 || (slug && slug.startsWith(existingId))) {
    if (slug) patch.id = slug
  }
  if (!q?.speak || q.speak === q.label) patch.speak = next
  return patch
}

export function nextQuestionId(label, existingId, used) {
  const set = used || new Set()
  let id = String(existingId || '').trim()
  const slug = slugQuestionKey(label)
  if (!id || id.startsWith('q_') || id.length <= 2) {
    if (slug) id = slug
  }
  if (!id) id = slug || `q_${Date.now().toString(36)}`
  const base = id
  let n = 2
  while (set.has(id)) id = `${base}_${n++}`
  set.add(id)
  return id
}

export function isQuestionVisible(q) {
  return q?.visible !== false
}
