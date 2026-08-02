/** Name matching between Neon analytics labels and Telangana GeoJSON */

export function normKey(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Known spelling variants → preferred geo form (normalized key) */
const ALIASES = {
  // districts (survey / neon labels → GeoJSON D_NAME keys)
  jagtial: 'jagitial',
  jagityal: 'jagitial',
  jagitial: 'jagitial',
  'kumuram bheem': 'komarambheem asifabad',
  kumurambheem: 'komarambheem asifabad',
  'komaram bheem': 'komarambheem asifabad',
  komarambheem: 'komarambheem asifabad',
  asifabad: 'komarambheem asifabad',
  yadadri: 'yadadri bhuvanagiri',
  'yadadri bhongir': 'yadadri bhuvanagiri',
  bhuvanagiri: 'yadadri bhuvanagiri',
  medchal: 'medchal malkajgiri',
  'medchal malkajgiri': 'medchal malkajgiri',
  'warangal urban': 'warangal urban',
  'warangal rural': 'warangal rural',
  jayashankar: 'jayashankar bhupalapally',
  bhupalpally: 'jayashankar bhupalapally',
  'jayashankar bhupalapally': 'jayashankar bhupalapally',
  bhadradri: 'bhadradri kothagudem',
  kothagudem: 'bhadradri kothagudem',
  rangareddy: 'rangareddy',
  'ranga reddy': 'rangareddy',
  // ACs
  bellampalle: 'bellampalli',
  maheswaram: 'maheshwaram',
  sathupalle: 'sathupalli',
  vicarabad: 'vikarabad',
  kukatpalle: 'kukatpally',
  brahimpatnam: 'ibrahimpatnam',
  'nizamabad rural': 'nizamabad rural',
  'nizamabad urban': 'nizamabad urban',
  // PCs
  bhongir: 'bhuvanagiri',
  mahbubnagar: 'mahabubnagar',
  peddapalle: 'peddapalli',
}

export function canonicalKey(s) {
  const k = normKey(s)
  return ALIASES[k] || k
}

export function buildLookup(entries, nameFn) {
  const map = new Map()
  for (const e of entries || []) {
    const name = nameFn(e)
    if (!name) continue
    map.set(canonicalKey(name), e)
    map.set(normKey(name), e)
  }
  return map
}

export function lookup(map, name) {
  if (!name || !map) return null
  const c = canonicalKey(name)
  if (map.has(c)) return map.get(c)
  const n = normKey(name)
  if (map.has(n)) return map.get(n)
  // Safe fuzzy only: unique longest contains match (no cross-boundary bleed)
  if (!c || c.length < 5) return null
  let best = null
  let bestLen = 0
  let ties = 0
  for (const [k, v] of map) {
    if (!k || k.length < 5) continue
    const hit =
      k === c ||
      k === n ||
      (k.includes(c) && c.length >= 5) ||
      (c.includes(k) && k.length >= 5)
    if (!hit) continue
    const score = Math.min(k.length, c.length)
    if (score > bestLen) {
      best = v
      bestLen = score
      ties = 1
    } else if (score === bestLen && best !== v) {
      ties += 1
    }
  }
  if (ties > 1) return null
  return best
}

export const PARTY_HEX = {
  Congress: '#16a34a',
  BJP: '#f97316',
  BRS: '#ec4899',
  Others: '#94a3b8',
  Undecided: '#64748b',
  Unknown: '#334155',
}

/** Choropleth green scale for counts — small districts stay visible */
export function countColor(value, max, alpha = 0.78) {
  if (!value || !max) return `rgba(30, 41, 59, ${alpha * 0.45})`
  // floor so tiny counts (e.g. Adilabad=3) still read as "has data"
  const t = Math.min(1, Math.max(0.22, Math.sqrt(value / max)))
  const r = Math.round(15 + (0 - 15) * t)
  const g = Math.round(23 + (229 - 23) * t)
  const b = Math.round(42 + (153 - 42) * t)
  return `rgba(${r},${g},${b},${0.45 + t * 0.5})`
}

export function partyColor(party, alpha = 0.8) {
  const hex = PARTY_HEX[party] || PARTY_HEX.Unknown
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `rgba(${r},${g},${b},${alpha})`
}

/**
 * Derive lead party per region from stacked matrix { columns, rows: [{name, total, Party: n}] }
 */
export function leadPartyMap(matrix) {
  const out = new Map()
  if (!matrix?.rows) return out
  const parties = (matrix.columns || []).filter(Boolean)
  for (const row of matrix.rows) {
    let best = 'Unknown'
    let bestN = -1
    for (const p of parties) {
      const n = row[p] || 0
      if (n > bestN) {
        bestN = n
        best = p
      }
    }
    out.set(canonicalKey(row.name), { party: best, count: bestN, total: row.total || 0 })
  }
  return out
}

export function countMap(series) {
  const out = new Map()
  for (const item of series || []) {
    out.set(canonicalKey(item.name), item)
  }
  return out
}
