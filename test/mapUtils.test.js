import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ALIASES,
  PARTY_HEX,
  canonicalKey,
  countColor,
  countMap,
  leadPartyMap,
  lookup,
  partyColor,
} from '../src/mapUtils.js'

/** 'rgba(0,229,153,0.95)' -> [0, 229, 153, 0.95] */
const rgba = (s) => s.match(/[\d.]+/g).map(Number)

describe('canonicalKey', () => {
  it('lowercases, strips punctuation and collapses spacing', () => {
    expect(canonicalKey('  Ranga   Reddy ')).toBe('rangareddy')
    expect(canonicalKey('Bhadradri-Kothagudem')).toBe('bhadradri kothagudem')
    expect(canonicalKey('')).toBe('')
    expect(canonicalKey(null)).toBe('')
  })

  // A reservation marker is noise; a place qualifier is not.
  it('drops reservation markers but keeps a place qualifier', () => {
    expect(canonicalKey('Bellampalli (SC)')).toBe('bellampalli')
    expect(canonicalKey('Boath (ST)')).toBe('boath')
    expect(canonicalKey('Hyderabad (Urban)')).toBe('hyderabad urban')
    expect(canonicalKey('Nizamabad (Rural)')).toBe('nizamabad rural')
    expect(canonicalKey('Nizamabad (Urban)')).toBe('nizamabad urban')
    expect(canonicalKey('Nizamabad (Rural)')).not.toBe(canonicalKey('Nizamabad (Urban)'))
  })

  it('maps known spelling variants to the geo form', () => {
    expect(canonicalKey('Jagtial')).toBe('jagitial')
    expect(canonicalKey('JAGITYAL')).toBe('jagitial')
    expect(canonicalKey('Warangal Urban')).toBe('hanumakonda')
    expect(canonicalKey('Hanamkonda')).toBe('hanumakonda')
    expect(canonicalKey('Warangal')).toBe('warangal rural')
    expect(canonicalKey('Kumuram Bheem')).toBe('komarambheem asifabad')
    expect(canonicalKey('LB Nagar')).toBe('lal bahadur nagar')
    expect(canonicalKey('Vicarabad')).toBe('vikarabad')
  })

  it('leaves an unknown name as its normalized self', () => {
    expect(canonicalKey('Some New Area')).toBe('some new area')
  })
})

// The alias table and the name normalizer are hand-maintained, and a mistake in
// either fails silently: the map simply renders that place uncoloured, or two
// places as one. These are the tests that catch it, against the real layers.
describe('the alias table', () => {
  const layers = [
    // Mirrors SurveyMap's own property lookup, including the parliament layer's
    // lowercase pc_name — an uppercase-only scan silently skipped all 17 seats.
    ['public/geojson/telangana-districts.json', 'D_NAME'],
    ['public/geojson/telangana-assembly.geojson', 'AC_NAME'],
    ['public/geojson/telangana-parliament.geojson', 'pc_name'],
  ]

  const layersWithNames = layers.map(([file, prop]) => {
    const geo = JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'))
    const names = geo.features.map((f) => f.properties?.[prop]).filter((n) => typeof n === 'string' && n)
    return { file, names, keys: names.map(canonicalKey) }
  })

  const knownNames = new Set(layersWithNames.flatMap((l) => l.keys))

  it('has a bundled geo layer to check against', () => {
    expect(knownNames.size).toBeGreaterThan(100)
    expect(knownNames.has('jagitial')).toBe(true)
    expect(knownNames.has('nizamabad rural')).toBe(true)
    expect(knownNames.has('nizamabad urban')).toBe(true)
  })

  it('resolves every name in every layer to a distinct key', () => {
    const collisions = layersWithNames
      .flatMap(({ file, names, keys }) => {
        const by = new Map()
        keys.forEach((k, i) => by.set(k, [...(by.get(k) || []), names[i]]))
        return [...by].filter(([, v]) => v.length > 1).map(([k, v]) => `${file} ${k} <= ${v.join(' | ')}`)
      })
    expect(collisions).toEqual([])
  })

  it('only points at names that exist in the bundled GeoJSON', () => {
    const offenders = Object.entries(ALIASES)
      .filter(([, target]) => !knownNames.has(target))
      .map(([from, target]) => `${from} -> ${target}`)
    expect(offenders).toEqual([])
  })

  it('keys its entries in normalized form, or they could never match', () => {
    const offenders = Object.keys(ALIASES).filter((k) => !/^[a-z0-9]+( [a-z0-9]+)*$/.test(k))
    expect(offenders).toEqual([])
  })
})

describe('lookup', () => {
  const map = new Map([
    ['jagitial', 'J'],
    ['karimnagar', 'K'],
    ['medchal malkajgiri', 'M'],
    ['alpha district', 'A'],
    ['alpha division', 'B'],
  ])

  it('hits exact and alias spellings', () => {
    expect(lookup(map, 'Jagitial')).toBe('J')
    expect(lookup(map, 'Jagtial')).toBe('J')
    expect(lookup(map, 'Karimnagar')).toBe('K')
  })

  it('falls back to a unique longest-contains match', () => {
    expect(lookup(map, 'Malkajgiri')).toBe('M')
  })

  it('refuses to guess when two names match equally well', () => {
    expect(lookup(map, 'Alpha')).toBeNull()
  })

  it('never fuzzies a name shorter than five characters', () => {
    expect(lookup(map, 'mall')).toBeNull()
    expect(lookup(map, 'x')).toBeNull()
  })

  // By design: a name that occurs inside exactly one longer name resolves to it.
  it('resolves a name that sits inside exactly one longer name', () => {
    expect(lookup(map, 'nagar')).toBe('K')
  })

  it('still matches when the label carries a qualifier the map does not', () => {
    const districts = new Map([['hyderabad', 'H']])
    expect(lookup(districts, 'Hyderabad (Urban)')).toBe('H')
  })

  it('returns null for missing input', () => {
    expect(lookup(map, '')).toBeNull()
    expect(lookup(map, null)).toBeNull()
    expect(lookup(null, 'Jagtial')).toBeNull()
  })
})

describe('countColor', () => {
  it('renders the quiet baseline for empty or zero counts', () => {
    expect(rgba(countColor(0, 100)).slice(0, 3)).toEqual([30, 41, 59])
    expect(rgba(countColor(0, 100))[3]).toBeCloseTo(0.78 * 0.45, 6)
    expect(rgba(countColor(null, 100)).slice(0, 3)).toEqual([30, 41, 59])
    expect(rgba(countColor(10, 0)).slice(0, 3)).toEqual([30, 41, 59])
  })

  it('fades in above the baseline as the share grows', () => {
    const alpha = (v) => rgba(countColor(v, 100))[3]
    expect(alpha(10)).toBeCloseTo(0.45 + Math.sqrt(10 / 100) * 0.5, 6)
    expect(alpha(10)).toBeGreaterThan(0.78 * 0.45)
  })

  it('reaches full green at the max', () => {
    const [r, g, b, alpha] = rgba(countColor(5, 5))
    expect([r, g, b]).toEqual([0, 229, 153])
    expect(alpha).toBeCloseTo(0.95, 6)
  })

  it('floors tiny counts so a district with data never disappears', () => {
    const tiny = rgba(countColor(3, 1000))
    const atFloor = rgba(countColor(48.4, 1000))
    expect(tiny.slice(0, 3)).toEqual(atFloor.slice(0, 3))
    expect(tiny[3]).toBeCloseTo(atFloor[3], 6)
  })

  it('gets greener as the count climbs', () => {
    const g = (v) => rgba(countColor(v, 100))[1]
    expect(g(5)).toBeLessThan(g(50))
    expect(g(50)).toBeLessThan(g(100))
  })
})

describe('partyColor', () => {
  it('defines the palette the dashboard groups parties by', () => {
    expect(Object.keys(PARTY_HEX)).toEqual(['Congress', 'BJP', 'BRS', 'Others', 'Undecided', 'Unknown'])
  })

  it('converts the palette hex to rgba', () => {
    expect(partyColor('Congress')).toBe('rgba(22,163,74,0.8)')
    expect(partyColor('BJP')).toBe('rgba(249,115,22,0.8)')
    expect(partyColor('BRS')).toBe('rgba(236,72,153,0.8)')
    expect(partyColor('Congress', 1)).toBe('rgba(22,163,74,1)')
  })

  it('falls back to the unknown grey', () => {
    expect(partyColor('Not A Party')).toBe('rgba(148,163,184,0.8)')
    expect(partyColor('Not A Party')).toBe(partyColor('Unknown'))
    expect(partyColor(undefined)).toBe(partyColor('Unknown'))
  })
})

describe('leadPartyMap', () => {
  const matrix = {
    columns: ['Congress', 'BJP', ''],
    rows: [
      { name: 'Jagtial', Congress: 10, BJP: 4, total: 14 },
      { name: 'Karimnagar', Congress: 5, BJP: 5, total: 10 },
      { name: 'Adilabad', Congress: 0, BJP: 0, total: 0 },
    ],
  }

  it('keys regions by canonical name and picks the leading party', () => {
    const out = leadPartyMap(matrix)
    expect(out.get('jagitial')).toEqual({ party: 'Congress', count: 10, total: 14 })
  })

  it('gives an exact tie to the first listed party', () => {
    expect(leadPartyMap(matrix).get('karimnagar')).toEqual({ party: 'Congress', count: 5, total: 10 })
  })

  it('falls back to the first party rather than Unknown on an empty row', () => {
    expect(leadPartyMap(matrix).get('adilabad')).toEqual({ party: 'Congress', count: 0, total: 0 })
  })

  it('returns an empty map without rows', () => {
    expect(leadPartyMap({}).size).toBe(0)
    expect(leadPartyMap({ columns: ['Congress'] }).size).toBe(0)
    expect(leadPartyMap(null).size).toBe(0)
  })
})

describe('countMap', () => {
  it('indexes a series by canonical name', () => {
    const out = countMap([{ name: 'Jagtial', total: 3 }])
    expect(out.get('jagitial')).toEqual({ name: 'Jagtial', total: 3 })
  })

  it('is empty for missing input', () => {
    expect(countMap().size).toBe(0)
    expect(countMap(null).size).toBe(0)
  })
})
