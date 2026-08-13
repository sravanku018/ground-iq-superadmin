/** Indian mobile: +91 and exactly 10 digits. */

export function digits10(raw) {
  let d = String(raw || '').replace(/\D/g, '')
  if (d.startsWith('91') && d.length >= 12) d = d.slice(2)
  if (d.startsWith('0') && d.length === 11) d = d.slice(1)
  return d.slice(0, 10)
}

export function toE164In(raw) {
  const d = digits10(raw)
  return d.length === 10 ? `+91${d}` : ''
}

export function isValidInMobile(raw) {
  return digits10(raw).length === 10
}

export function formatInMobile(raw) {
  const d = digits10(raw)
  if (!d) return ''
  return d.length === 10 ? `+91 ${d}` : `+91 ${d}`
}
