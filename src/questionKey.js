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

/** Telugu add / type / auto-translate — question-management powers only. */
export function canTeluguQuestions(user) {
  return (
    user?.role === 'super_admin' ||
    !!user?.can_manage_questions ||
    !!user?.can_crud_questionnaire
  )
}

/** Question text stays exactly as typed. Field ID is created once, internally. */
export function labelPatch(q, label) {
  const next = String(label || '')
  const patch = { label: next }
  const existingId = String(q?.id || '').trim()
  if (!existingId) {
    const auto = slugQuestionKey(next)
    if (auto) patch.id = auto
  }
  if (!q?.speak || q.speak === q.label) patch.speak = next
  return patch
}

export function nextQuestionId(label, existingId, used) {
  const set = used || new Set()
  let id = String(existingId || '').trim()
  if (!id) id = slugQuestionKey(label) || `q_${Date.now().toString(36)}`
  const base = id
  let n = 2
  while (set.has(id)) id = `${base}_${n++}`
  set.add(id)
  return id
}

export function isQuestionVisible(q) {
  return q?.visible !== false
}
