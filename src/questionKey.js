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

/** Keep unique key in sync with the question text until the admin edits the key. */
export function labelPatch(q, label) {
  const next = String(label || '')
  const auto = slugQuestionKey(next)
  const prevAuto = slugQuestionKey(q?.label)
  const id = String(q?.id || '').trim()
  const keepSync = !id || id === prevAuto
  const patch = { label: next }
  if (keepSync && auto) patch.id = auto
  if (keepSync && (!q?.speak || q.speak === q.label)) patch.speak = next
  return patch
}
