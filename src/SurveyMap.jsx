import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  countColor,
  countMap,
  leadPartyMap,
  lookup,
  partyColor,
  PARTY_HEX,
  canonicalKey,
} from './mapUtils'

// Keep callbacks stable across parent re-renders
function useStableHandler(fn) {
  const ref = useRef(fn)
  ref.current = fn
  return useMemo(() => (...args) => ref.current?.(...args), [])
}

const LAYERS = [
  {
    id: 'district',
    label: 'Districts',
    url: `${import.meta.env.BASE_URL}geojson/telangana-districts.json`,
    nameProp: 'D_NAME',
  },
  {
    id: 'assembly',
    label: 'Assembly',
    url: `${import.meta.env.BASE_URL}geojson/telangana-assembly.geojson`,
    nameProp: 'AC_NAME',
  },
  {
    id: 'parliament',
    label: 'Parliament',
    url: `${import.meta.env.BASE_URL}geojson/telangana-parliament.geojson`,
    nameProp: 'pc_name',
  },
]

const COLOR_MODES = [
  { id: 'count', label: 'Volume' },
  { id: 'party', label: 'Lead party' },
]

// Telangana-ish center
const DEFAULT_VIEW = [17.9, 79.5]
const DEFAULT_ZOOM = 7

function featureName(feature, nameProp) {
  const p = feature?.properties || {}
  return p[nameProp] || p.D_NAME || p.AC_NAME || p.pc_name || p.PC_NAME || ''
}

export default function SurveyMap({
  analytics,
  filters,
  onSelectDistrict,
  onSelectConstituency,
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const geoLayerRef = useRef(null)
  const [layerId, setLayerId] = useState('district')
  const [colorMode, setColorMode] = useState('count')
  const [geo, setGeo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [hover, setHover] = useState(null)

  const selectDistrict = useStableHandler(onSelectDistrict)
  const selectConstituency = useStableHandler(onSelectConstituency)

  const layerCfg = LAYERS.find((l) => l.id === layerId) || LAYERS[0]

  // Counts / party lead from analytics — use full series for maps
  const dataMaps = useMemo(() => {
    const charts = analytics?.charts || {}
    // Prefer full district matrix rows as count source when byDistrict is thin
    const fromMatrix = (charts.partyByDistrictFull || charts.partyByDistrict)?.rows
      ?.filter((r) => r.name && r.name !== 'Unknown')
      ?.map((r) => ({ name: r.name, value: r.total || 0, pct: 0 }))
    const districtSeries =
      (charts.byDistrict || []).filter((d) => d.name !== 'Unknown').length >=
      (fromMatrix || []).length
        ? (charts.byDistrict || []).filter((d) => d.name !== 'Unknown')
        : fromMatrix || charts.byDistrict || []

    return {
      districtCounts: countMap(districtSeries),
      acCounts: countMap(
        (charts.byConstituency || []).filter((d) => d.name !== 'Unknown'),
      ),
      districtLead: leadPartyMap(
        charts.partyByDistrictFull || charts.partyByDistrict,
      ),
      acLead: leadPartyMap(charts.partyByConstituency),
      pcCounts: countMap(charts.byMp || []),
      pcLead: leadPartyMap(charts.partyByMp || { columns: [], rows: [] }),
      districtCount: districtSeries.length,
    }
  }, [analytics])

  // Load geojson when layer changes
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    fetch(layerCfg.url)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load ${layerCfg.label} map`)
        return r.json()
      })
      .then((fc) => {
        if (!cancelled) {
          setGeo(fc)
          setLoading(false)
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message)
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [layerCfg.url, layerCfg.label])

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true,
      minZoom: 6,
      maxZoom: 12,
    }).setView(DEFAULT_VIEW, DEFAULT_ZOOM)

    L.control.zoom({ position: 'topright' }).addTo(map)

    // Dark basemap without road/place labels — clean choropleth, no visual cross-clutter
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map)

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
      geoLayerRef.current = null
    }
  }, [])

  // Draw / redraw choropleth
  useEffect(() => {
    const map = mapRef.current
    if (!map || !geo) return

    if (geoLayerRef.current) {
      map.removeLayer(geoLayerRef.current)
      geoLayerRef.current = null
    }

    const nameProp = layerCfg.nameProp
    const isDistrict = layerId === 'district'
    const isAssembly = layerId === 'assembly'

    const counts = isDistrict
      ? dataMaps.districtCounts
      : isAssembly
        ? dataMaps.acCounts
        : dataMaps.pcCounts

    const leads = isDistrict
      ? dataMaps.districtLead
      : isAssembly
        ? dataMaps.acLead
        : dataMaps.pcLead

    let max = 1
    for (const v of counts.values()) {
      if (v.value > max) max = v.value
    }

    const selectedKey = isDistrict
      ? canonicalKey(filters?.district)
      : isAssembly
        ? canonicalKey(filters?.constituency)
        : ''

    const layer = L.geoJSON(geo, {
      style: (feature) => {
        const name = featureName(feature, nameProp)
        const key = canonicalKey(name)
        const stat = lookup(counts, name)
        const lead = lookup(leads, name)
        const value = stat?.value || 0
        const isSelected = selectedKey && key === selectedKey

        let fillColor
        if (colorMode === 'party') {
          fillColor = partyColor(lead?.party || 'Unknown', value ? 0.82 : 0.25)
        } else {
          fillColor = countColor(value, max)
        }

        return {
          fillColor,
          fillOpacity: 1,
          color: isSelected ? '#ffffff' : 'rgba(148, 163, 184, 0.45)',
          weight: isSelected ? 2.5 : 0.8,
          opacity: 1,
        }
      },
      onEachFeature: (feature, lyr) => {
        const name = featureName(feature, nameProp)
        const stat = lookup(counts, name)
        const lead = lookup(leads, name)
        const value = stat?.value || 0
        const pct = stat?.pct

        const html = `
          <div class="map-popup">
            <strong>${name}</strong>
            <div>Responses: <b>${value.toLocaleString()}</b>${pct != null ? ` (${pct}%)` : ''}</div>
            ${lead?.party ? `<div>Lead: <b style="color:${PARTY_HEX[lead.party] || '#fff'}">${lead.party}</b></div>` : ''}
          </div>
        `
        lyr.bindTooltip(html, {
          sticky: true,
          opacity: 0.95,
          className: 'survey-map-tooltip',
        })

        lyr.on('mouseover', () => {
          setHover({
            name,
            value,
            pct,
            party: lead?.party,
          })
          lyr.setStyle({ weight: 2, color: '#059669' })
        })
        lyr.on('mouseout', () => {
          setHover(null)
          layer.resetStyle(lyr)
        })
        lyr.on('click', () => {
          if (isDistrict) selectDistrict(name)
          if (isAssembly) selectConstituency(name)
        })
      },
    }).addTo(map)

    geoLayerRef.current = layer

    try {
      const b = layer.getBounds()
      if (b.isValid()) {
        map.fitBounds(b, { padding: [18, 18], maxZoom: 8 })
      }
    } catch {
      /* ignore */
    }
  }, [
    geo,
    layerId,
    layerCfg.nameProp,
    colorMode,
    dataMaps,
    filters?.district,
    filters?.constituency,
    selectDistrict,
    selectConstituency,
  ])

  const legend = useMemo(() => {
    if (colorMode === 'party') {
      return Object.entries(PARTY_HEX)
        .filter(([k]) => k !== 'Unknown')
        .map(([name, color]) => ({ name, color }))
    }
    return [
      { name: 'Low', color: countColor(1, 100) },
      { name: 'Mid', color: countColor(40, 100) },
      { name: 'High', color: countColor(100, 100) },
    ]
  }, [colorMode])

  return (
    <section className="map-panel">
      <header className="map-toolbar">
        <div className="map-tabs">
          {LAYERS.map((l) => (
            <button
              key={l.id}
              type="button"
              className={layerId === l.id ? 'map-tab active' : 'map-tab'}
              onClick={() => setLayerId(l.id)}
            >
              {l.label}
            </button>
          ))}
        </div>
        <div className="map-tabs">
          {COLOR_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={colorMode === m.id ? 'map-tab active' : 'map-tab'}
              onClick={() => setColorMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </header>

      <div className="map-stage">
        {loading && <div className="map-overlay">Loading map…</div>}
        {error && <div className="map-overlay error">{error}</div>}
        <div ref={containerRef} className="leaflet-host" />

        {hover && (
          <div className="map-hover-card">
            <strong>{hover.name}</strong>
            <span>
              {hover.value?.toLocaleString?.() ?? 0} responses
              {hover.pct != null ? ` · ${hover.pct}%` : ''}
            </span>
            {hover.party && colorMode === 'party' && (
              <span style={{ color: PARTY_HEX[hover.party] || '#fff' }}>
                Lead: {hover.party}
              </span>
            )}
          </div>
        )}
      </div>

      <footer className="map-legend">
        {legend.map((item) => (
          <span key={item.name} className="legend-item">
            <i style={{ background: item.color }} />
            {item.name}
          </span>
        ))}
        <span className="legend-hint">
          {layerId === 'district' &&
            `${dataMaps.districtCount || 0} districts with data · tap to filter`}
          {layerId === 'assembly' &&
            `${dataMaps.acCounts?.size || 0} ACs with data · tap to filter`}
          {layerId === 'parliament' && 'Parliament map · party/volume'}
        </span>
      </footer>
    </section>
  )
}
