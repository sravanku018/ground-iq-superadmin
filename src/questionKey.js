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

/** Always copy unique key from the question text as it is typed. */
export function labelPatch(q, label) {
  const next = String(label || '')
  const auto = slugQuestionKey(next)
  const patch = { label: next }
  if (auto) patch.id = auto
  if (!q?.speak || q.speak === q.label) patch.speak = next
  return patch
}
