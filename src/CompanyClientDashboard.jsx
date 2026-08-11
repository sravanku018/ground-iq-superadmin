import { useCallback, useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { getCompanyDashboard } from './api'

/** Leaflet map icon fix for default markers */
const markerIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})

function CompanyGeoMap({ locations = [] }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markerGroupRef = useRef(null)

  useEffect(() => {
    if (!containerRef.current) return

    if (!mapRef.current) {
      // Default centered over Telangana / India
      const map = L.map(containerRef.current, {
        center: [17.385, 78.4867],
        zoom: 7,
        scrollWheelZoom: true,
      })

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map)

      markerGroupRef.current = L.layerGroup().addTo(map)
      mapRef.current = map
    }

    const map = mapRef.current
    const markerGroup = markerGroupRef.current
    markerGroup.clearLayers()

    if (locations.length === 0) return

    const bounds = L.latLngBounds([])

    locations.forEach((loc) => {
      if (loc.lat && loc.lng && !isNaN(loc.lat) && !isNaN(loc.lng)) {
        const marker = L.marker([loc.lat, loc.lng], { icon: markerIcon })
        const popupContent = `
          <div style="font-family: sans-serif; font-size: 12px; padding: 2px;">
            <strong style="font-size: 13px; color: #0f172a;">${loc.survey_title || 'Survey'}</strong><br/>
            <span style="color: #059669; font-weight: 600;">👤 ${loc.submitted_by || 'Surveyor'}</span><br/>
            ${loc.district ? `<span>📍 District: ${loc.district}</span><br/>` : ''}
            ${loc.constituency ? `<span>🏛 AC: ${loc.constituency}</span><br/>` : ''}
            <span style="color: #64748b;">🕒 ${loc.created_at ? String(loc.created_at).slice(0, 16).replace('T', ' ') : ''}</span><br/>
            <span style="font-family: monospace; font-size: 11px; color: #475569;">(${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)})</span>
          </div>
        `
        marker.bindPopup(popupContent)
        markerGroup.addLayer(marker)
        bounds.extend([loc.lat, loc.lng])
      }
    })

    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 })
    }
  }, [locations])

  return (
    <div style={{ position: 'relative', width: '100%', height: 380, borderRadius: 10, overflow: 'hidden', border: '1px solid #cbd5e1' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {locations.length === 0 && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#64748b', zIndex: 1000 }}>
          📍 No GPS location points recorded for this company yet
        </div>
      )}
    </div>
  )
}

export default function CompanyClientDashboard({ companyIdOrName, onClose, onToast }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('overview') // 'overview' | 'projects' | 'surveyors' | 'map' | 'qa'
  const [expandedSurveyId, setExpandedSurveyId] = useState(null)

  const load = useCallback(async () => {
    if (!companyIdOrName) return
    setLoading(true)
    try {
      const res = await getCompanyDashboard(companyIdOrName)
      setData(res)
    } catch (err) {
      onToast?.(err.message || 'Could not load company dashboard', 'error')
    } finally {
      setLoading(false)
    }
  }, [companyIdOrName, onToast])

  useEffect(() => {
    load()
  }, [load])

  if (loading) {
    return (
      <div className="card" style={{ padding: 24, textAlign: 'center' }}>
        <span className="spinner" /> Loading Company Dashboard…
      </div>
    )
  }

  if (!data || !data.company) {
    return (
      <div className="card" style={{ padding: 24, textAlign: 'center' }}>
        <p style={{ color: '#ef4444' }}>Could not load company dashboard data.</p>
        <button type="button" className="btn small" onClick={onClose}>Close</button>
      </div>
    )
  }

  const { company, summary, admins = [], projects = [], surveyors = [], locations = [], qa_stats } = data

  return (
    <div className="card" style={{ border: '2px solid #059669', background: '#f8fafc', marginBottom: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, borderBottom: '1px solid #e2e8f0', paddingBottom: 12, marginBottom: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: 18, color: '#0f172a' }}>🏢 {company.name} — Company Client Dashboard</h2>
            <span className="pill ok" style={{ fontWeight: 'bold' }}>Company Tenant</span>
          </div>
          <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
            Registered Company ID: {company.id || 'N/A'} · Client Admins: {admins.map((a) => `${a.name} (@${a.username})`).join(', ') || 'None'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn small" onClick={load}>🔄 Refresh</button>
          {onClose && <button type="button" className="btn small danger" onClick={onClose}>✖ Close</button>}
        </div>
      </div>

      {/* Summary KPI Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 16 }}>
        <div className="stat" style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, padding: '10px 12px' }}>
          <strong style={{ fontSize: 20, color: '#2563eb' }}>{summary?.total_projects ?? 0}</strong>
          <span style={{ fontSize: 11, color: '#64748b' }}>📋 Projects</span>
        </div>
        <div className="stat" style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, padding: '10px 12px' }}>
          <strong style={{ fontSize: 20, color: '#7c3aed' }}>{summary?.total_questions ?? 0}</strong>
          <span style={{ fontSize: 11, color: '#64748b' }}>❓ Questions</span>
        </div>
        <div className="stat" style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, padding: '10px 12px' }}>
          <strong style={{ fontSize: 20, color: '#059669' }}>{summary?.total_surveyors ?? 0}</strong>
          <span style={{ fontSize: 11, color: '#64748b' }}>👥 Surveyors</span>
        </div>
        <div className="stat" style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, padding: '10px 12px' }}>
          <strong style={{ fontSize: 20, color: '#d97706' }}>{summary?.total_submissions ?? 0}</strong>
          <span style={{ fontSize: 11, color: '#64748b' }}>📝 Submissions</span>
        </div>
        <div className="stat" style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, padding: '10px 12px' }}>
          <strong style={{ fontSize: 20, color: '#0284c7' }}>{summary?.total_locations ?? 0}</strong>
          <span style={{ fontSize: 11, color: '#64748b' }}>📍 Geo Points</span>
        </div>
        <div className="stat" style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, padding: '10px 12px' }}>
          <strong style={{ fontSize: 20, color: '#10b981' }}>{summary?.confirmed_qa ?? 0}</strong>
          <span style={{ fontSize: 11, color: '#64748b' }}>✅ Verified QA</span>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid #cbd5e1', paddingBottom: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {[
          { id: 'overview', label: '📊 Overview' },
          { id: 'projects', label: `📋 Projects & Questions (${projects.length})` },
          { id: 'surveyors', label: `👥 Surveyors Team (${surveyors.length})` },
          { id: 'map', label: `📍 Geo Location Map (${locations.length})` },
          { id: 'qa', label: `✅ QA Status (${qa_stats?.total ?? 0})` },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            className={`btn small ${tab === t.id ? 'primary' : ''}`}
            onClick={() => setTab(t.id)}
            style={{ fontWeight: tab === t.id ? 'bold' : 'normal' }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab 1: Overview */}
      {tab === 'overview' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
            {/* Quick summary box */}
            <div style={{ background: '#fff', padding: 14, borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <h4 style={{ marginTop: 0, fontSize: 14, color: '#0f172a' }}>🏢 Company Profile</h4>
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <tbody>
                  <tr>
                    <td className="muted" style={{ padding: '4px 0' }}>Company Name:</td>
                    <td style={{ fontWeight: 600, textAlign: 'right' }}>{company.name}</td>
                  </tr>
                  <tr>
                    <td className="muted" style={{ padding: '4px 0' }}>Client Admins:</td>
                    <td style={{ fontWeight: 600, textAlign: 'right' }}>{admins.length} account(s)</td>
                  </tr>
                  <tr>
                    <td className="muted" style={{ padding: '4px 0' }}>Mapped Projects:</td>
                    <td style={{ fontWeight: 600, textAlign: 'right' }}>{projects.length} survey(s)</td>
                  </tr>
                  <tr>
                    <td className="muted" style={{ padding: '4px 0' }}>Total Questions:</td>
                    <td style={{ fontWeight: 600, textAlign: 'right' }}>{summary?.total_questions ?? 0} Qs</td>
                  </tr>
                  <tr>
                    <td className="muted" style={{ padding: '4px 0' }}>Field Collectors:</td>
                    <td style={{ fontWeight: 600, textAlign: 'right' }}>{surveyors.length} surveyor(s)</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* QA Health Box */}
            <div style={{ background: '#fff', padding: 14, borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <h4 style={{ marginTop: 0, fontSize: 14, color: '#0f172a' }}>✅ Data Quality Assurance</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span>Confirmed & Materialized:</span>
                  <strong style={{ color: '#059669' }}>{qa_stats?.confirmed ?? 0} records</strong>
                </div>
                <div style={{ width: '100%', height: 8, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${qa_stats?.total ? Math.round(((qa_stats?.confirmed ?? 0) / qa_stats.total) * 100) : 0}%`,
                      background: '#059669',
                    }}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 4 }}>
                  <span>Pending Verification:</span>
                  <strong style={{ color: '#d97706' }}>{qa_stats?.pending ?? 0} records</strong>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Geo Map preview */}
          <div style={{ marginTop: 16 }}>
            <h4 style={{ fontSize: 14, margin: '0 0 8px' }}>📍 Geo Location Preview ({locations.length} points)</h4>
            <CompanyGeoMap locations={locations} />
          </div>
        </div>
      )}

      {/* Tab 2: Projects & Questions */}
      {tab === 'projects' && (
        <div>
          <h4 style={{ fontSize: 14, margin: '0 0 10px' }}>📋 Projects & Questionnaire Details</h4>
          {projects.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>No projects registered under this company yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {projects.map((p) => {
                const isOpen = expandedSurveyId === p.id
                return (
                  <div key={p.id} style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, padding: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                      <div>
                        <strong style={{ fontSize: 14, color: '#0f172a' }}>📋 {p.title}</strong>
                        <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
                          Key: {p.form_key} · {p.question_count} question(s)
                        </span>
                      </div>
                      <button
                        type="button"
                        className="btn small"
                        onClick={() => setExpandedSurveyId(isOpen ? null : p.id)}
                      >
                        {isOpen ? '▲ Hide Questions' : '▼ View Questions (' + p.question_count + ')'}
                      </button>
                    </div>

                    {isOpen && (
                      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #e2e8f0' }}>
                        <h5 style={{ margin: '0 0 8px', fontSize: 12, color: '#475569', textTransform: 'uppercase' }}>
                          Questionnaire ({p.questions?.length || 0} Questions)
                        </h5>
                        {(!p.questions || p.questions.length === 0) ? (
                          <p className="muted" style={{ fontSize: 12, margin: 0 }}>No questions added to this survey yet.</p>
                        ) : (
                          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                            {p.questions.map((q, idx) => (
                              <li key={q.id || idx} style={{ marginBottom: 6 }}>
                                <strong style={{ color: '#1e293b' }}>{q.title || q.label || q.text || q.id}</strong>{' '}
                                <span className="pill" style={{ fontSize: 10, background: '#e2e8f0', color: '#334155' }}>
                                  {q.type || 'text'}
                                </span>
                                {Array.isArray(q.options) && q.options.length > 0 && (
                                  <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                                    Options: {q.options.map((o) => (typeof o === 'object' ? o.label || o.value : o)).join(', ')}
                                  </div>
                                )}
                              </li>
                            ))}
                          </ol>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Surveyors Team */}
      {tab === 'surveyors' && (
        <div>
          <h4 style={{ fontSize: 14, margin: '0 0 10px' }}>👥 Field Collectors / Surveyors Team ({surveyors.length})</h4>
          {surveyors.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>No surveyors mapped to this company's projects yet.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8 }}>
                <thead>
                  <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #cbd5e1', textAlign: 'left' }}>
                    <th style={{ padding: '8px 10px' }}>Surveyor</th>
                    <th style={{ padding: '8px 10px' }}>Username</th>
                    <th style={{ padding: '8px 10px' }}>Phone</th>
                    <th style={{ padding: '8px 10px' }}>Status</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right' }}>Target Quota</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right' }}>Submissions</th>
                  </tr>
                </thead>
                <tbody>
                  {surveyors.map((s) => (
                    <tr key={s.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={{ padding: '8px 10px', fontWeight: 600 }}>{s.name || s.username}</td>
                      <td className="muted" style={{ padding: '8px 10px' }}>@{s.username}</td>
                      <td style={{ padding: '8px 10px' }}>{s.phone || '—'}</td>
                      <td style={{ padding: '8px 10px' }}>
                        {s.active !== false ? <span className="pill ok">Active</span> : <span className="pill danger">Inactive</span>}
                        {s.verified ? <span className="pill" style={{ background: '#e0f2fe', color: '#0284c7', marginLeft: 4 }}>Verified</span> : null}
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right' }}>{s.target_quota || 0}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: '#059669' }}>
                        {s.submission_count ?? 0}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Geo Location Map */}
      {tab === 'map' && (
        <div>
          <h4 style={{ fontSize: 14, margin: '0 0 10px' }}>📍 Geo Location Map ({locations.length} coordinates captured)</h4>
          <CompanyGeoMap locations={locations} />
          {locations.length > 0 && (
            <div style={{ marginTop: 12, overflowX: 'auto' }}>
              <h5 style={{ margin: '0 0 6px', fontSize: 12, color: '#475569', textTransform: 'uppercase' }}>Recent GPS Captured Records</h5>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', background: '#fff', border: '1px solid #e2e8f0' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left' }}>
                    <th style={{ padding: '6px 8px' }}>Survey</th>
                    <th style={{ padding: '6px 8px' }}>Surveyor</th>
                    <th style={{ padding: '6px 8px' }}>District</th>
                    <th style={{ padding: '6px 8px' }}>Constituency</th>
                    <th style={{ padding: '6px 8px' }}>Coordinates</th>
                    <th style={{ padding: '6px 8px' }}>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {locations.slice(0, 25).map((loc) => (
                    <tr key={loc.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '6px 8px', fontWeight: 600 }}>{loc.survey_title}</td>
                      <td style={{ padding: '6px 8px' }}>{loc.submitted_by}</td>
                      <td style={{ padding: '6px 8px' }}>{loc.district || '—'}</td>
                      <td style={{ padding: '6px 8px' }}>{loc.constituency || '—'}</td>
                      <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>{loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}</td>
                      <td className="muted" style={{ padding: '6px 8px' }}>{loc.created_at ? String(loc.created_at).slice(0, 16).replace('T', ' ') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 5: QA Status */}
      {tab === 'qa' && (
        <div>
          <h4 style={{ fontSize: 14, margin: '0 0 10px' }}>✅ Data Quality Assurance Breakdown</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 8, padding: 14 }}>
              <div style={{ fontSize: 12, color: '#047857', fontWeight: 600 }}>CONFIRMED / MATERIALIZED FACTS</div>
              <strong style={{ fontSize: 24, color: '#059669' }}>{qa_stats?.confirmed ?? 0}</strong>
              <div style={{ fontSize: 11, color: '#065f46', marginTop: 4 }}>Verified records included in analytics dashboards</div>
            </div>
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: 14 }}>
              <div style={{ fontSize: 12, color: '#b45309', fontWeight: 600 }}>PENDING VERIFICATION</div>
              <strong style={{ fontSize: 24, color: '#d97706' }}>{qa_stats?.pending ?? 0}</strong>
              <div style={{ fontSize: 11, color: '#92400e', marginTop: 4 }}>Awaiting Client Admin review/verification</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
