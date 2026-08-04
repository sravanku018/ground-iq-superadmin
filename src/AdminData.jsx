import { useCallback, useEffect, useState } from 'react'
import Papa from 'papaparse'
import { exportSubmissions, getGeoSummary, uploadSurveys } from './api'
import SurveyMap from './SurveyMap'
import { getAnalytics } from './api'

/**
 * Admin-only: 2 tabs
 * 1) Geography — uploaded districts, mandals, assembly, MP + map
 * 2) Survey upload — CSV/JSON survey responses into Neon
 */
export default function AdminDataScreen({ onToast }) {
  const [tab, setTab] = useState('geography') // geography | surveys | export
  const [geo, setGeo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState([])
  const [fileName, setFileName] = useState('')
  const [mapAnalytics, setMapAnalytics] = useState(null)
  const [surveys, setSurveys] = useState([])
  const [survey, setSurvey] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exp, setExp] = useState({
    period: 'total',
    day: new Date().toISOString().slice(0, 10),
    month: new Date().toISOString().slice(0, 7),
    user: '',
    district: '',
    constituency: '',
    status: 'confirmed',
  })

  useEffect(() => {
    import('./api').then(({ listSurveys }) =>
      listSurveys()
        .then((d) => setSurveys(d.items || []))
        .catch(() => {}),
    )
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [summary, analytics] = await Promise.all([
        getGeoSummary(),
        getAnalytics({ survey }).catch(() => null),
      ])
      setGeo(summary)
      setMapAnalytics(analytics)
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [onToast, survey])

  useEffect(() => {
    load()
  }, [load])

  function normalizeRow(row) {
    const lower = {}
    Object.entries(row || {}).forEach(([k, v]) => {
      lower[String(k).trim().toLowerCase().replace(/\s+/g, '_')] = v
    })
    const pick = (...keys) => {
      for (const k of keys) {
        if (lower[k] != null && String(lower[k]).trim() !== '') return String(lower[k]).trim()
      }
      return ''
    }
    return {
      respondent_name: pick('respondent_name', 'name', 'voter_name', 'respondent'),
      phone: pick('phone', 'mobile'),
      district: pick('district', 'dist'),
      constituency: pick('constituency', 'assembly', 'assembly_constituency', 'ac'),
      mp_constituency: pick('mp_constituency', 'mp', 'parliament', 'pc'),
      mandal: pick('mandal', 'tehsil'),
      ward: pick('ward', 'booth', 'ballot', 'ballot_number'),
      gender: pick('gender', 'sex'),
      caste: pick('caste', 'community'),
      age: pick('age', 'age_group'),
      employment: pick('employment', 'occupation', 'job'),
      education: pick('education', 'qualification'),
      winning_party: pick('winning_party', 'party', 'party_preference'),
      pm_preference: pick('pm_preference', 'pm', 'prime_minister'),
      performance: pick('performance', 'govt_performance'),
      issues: pick('issues', 'issue'),
      notes: pick('notes', 'remarks'),
      data_collector: pick('data_collector', 'investigator', 'agent'),
    }
  }

  function onFile(file) {
    if (!file) return
    setFileName(file.name)
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (ext === 'json') {
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const data = JSON.parse(String(reader.result || '[]'))
          const rows = Array.isArray(data) ? data : data.rows || data.items || []
          setPreview(rows.slice(0, 5000).map((r) => (r.answers ? r.answers : normalizeRow(r))))
          onToast?.(`${rows.length} JSON rows ready`, 'ok')
        } catch (e) {
          onToast?.('Invalid JSON: ' + e.message, 'error')
        }
      }
      reader.readAsText(file)
      return
    }
    // CSV / text
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const rows = (result.data || []).map(normalizeRow)
        setPreview(rows)
        onToast?.(`${rows.length} rows parsed from ${file.name}`, 'ok')
      },
      error: (err) => onToast?.(err.message, 'error'),
    })
  }

  async function doUpload() {
    if (!preview.length) {
      onToast?.('Parse a file first', 'error')
      return
    }
    setUploading(true)
    try {
      const res = await uploadSurveys(preview, {
        source: 'admin-csv-upload',
        form_id: `upload-${fileName || Date.now()}`.replace(/\W+/g, '-').toLowerCase(),
      })
      onToast?.(`Uploaded ${res.inserted} surveys to Neon`, 'ok')
      setPreview([])
      setFileName('')
      await load()
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setUploading(false)
    }
  }

  const counts = geo?.counts || {}

  async function doExport() {
    setExporting(true)
    try {
      let csv = ''
      try {
        csv = await exportSubmissions({
          period: exp.period,
          day: exp.day,
          month: exp.month,
          user: exp.user,
          survey,
          district: exp.district,
          constituency: exp.constituency,
          status: exp.status,
        })
      } catch (netErr) {
        console.warn('Backend export route hit network/CORS error, falling back to client CSV generator:', netErr)
        const analyticsData = mapAnalytics || (await getAnalytics().catch(() => ({})))
        const rawItems = analyticsData?.items || analyticsData?.rawItems || []
        
        let filtered = rawItems
        if (exp.status && exp.status !== 'all') {
          filtered = filtered.filter((r) => r.status === exp.status || (exp.status === 'confirmed' && r.confirmed))
        }
        if (exp.user) {
          filtered = filtered.filter((r) => String(r.submitted_by || r.surveyor || '').toLowerCase().includes(exp.user.toLowerCase()))
        }
        if (exp.district) {
          filtered = filtered.filter((r) => String(r.district || '').toLowerCase() === exp.district.toLowerCase())
        }
        if (exp.constituency) {
          filtered = filtered.filter((r) => String(r.constituency || r.assembly || '').toLowerCase() === exp.constituency.toLowerCase())
        }
        if (survey) {
          filtered = filtered.filter((r) => String(r.formKey || r.form_key || r.survey || '') === survey)
        }

        const fixed = ['id', 'date', 'survey', 'surveyor', 'district', 'constituency', 'mandal', 'latitude', 'longitude', 'party', 'gender', 'caste', 'age', 'respondent', 'photo_url', 'audio_url']
        const qKeys = new Set()
        filtered.forEach((r) => {
          Object.keys(r.answers || {}).forEach((k) => qKeys.add(k))
        })
        const qCols = [...qKeys].sort()

        const esc = (v) => {
          const s = String(v ?? '')
          return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
        }

        const lines = []
        lines.push([...fixed, ...qCols].map(esc).join(','))

        filtered.forEach((r) => {
          const base = {
            id: r.id || '',
            date: String(r.created_at || r.date || '').slice(0, 10),
            survey: r.formKey || r.survey || '',
            surveyor: r.submitted_by || r.surveyor || '',
            district: r.district || '',
            constituency: r.constituency || '',
            mandal: r.mandal || '',
            latitude: r.latitude || r.lat || '',
            longitude: r.longitude || r.lng || '',
            party: r.party || '',
            gender: r.gender || '',
            caste: r.caste || '',
            age: r.age || '',
            respondent: r.respondent || '',
            photo_url: r.photo_url || r.photoUrl || '',
            audio_url: r.audio_url || r.audioUrl || '',
          }
          const row = []
          fixed.forEach((c) => row.push(esc(base[c])))
          qCols.forEach((c) => {
            const val = (r.answers || {})[c]
            row.push(esc(Array.isArray(val) ? val.join(' | ') : val))
          })
          lines.push(row.join(','))
        })
        csv = lines.join('\n')
      }

      const rows = csv.split('\n').filter(Boolean)
      const stamp = exp.period === 'day' ? exp.day : exp.period === 'month' ? exp.month : 'total'
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `survey-export-${stamp}.csv`
      a.click()
      URL.revokeObjectURL(a.href)
      onToast?.(`Exported ${Math.max(0, rows.length - 1)} record(s) to CSV`, 'ok')
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="screen admin-data-screen">
      <header className="screen-head">
        <h2>Admin data</h2>
        <p>Geography inventory + survey upload + data export (3 tabs)</p>
      </header>

      <div className="admin-subtabs">
        <button
          type="button"
          className={tab === 'geography' ? 'map-tab active' : 'map-tab'}
          onClick={() => setTab('geography')}
        >
          1 · Geography & maps
        </button>
        <button
          type="button"
          className={tab === 'surveys' ? 'map-tab active' : 'map-tab'}
          onClick={() => setTab('surveys')}
        >
          2 · Survey upload
        </button>
        <button
          type="button"
          className={tab === 'export' ? 'map-tab active' : 'map-tab'}
          onClick={() => setTab('export')}
        >
          3 · Export
        </button>
      </div>

      {tab === 'geography' && (
        <div className="admin-pane">
          {loading ? (
            <p className="muted">Loading geo data…</p>
          ) : (
            <>
              <div className="stat-row">
                <div className="stat">
                  <strong>{counts.districts ?? '—'}</strong>
                  <span>Districts</span>
                </div>
                <div className="stat">
                  <strong>{counts.mandals ?? '—'}</strong>
                  <span>Mandals</span>
                </div>
                <div className="stat">
                  <strong>{counts.assembly_constituencies ?? '—'}</strong>
                  <span>Assembly</span>
                </div>
                <div className="stat">
                  <strong>{counts.mp_constituencies ?? '—'}</strong>
                  <span>MP seats</span>
                </div>
              </div>

              <p className="muted" style={{ marginBottom: 12, fontSize: 13 }}>
                Uploaded geo layers in Neon: districts, mandals, assembly constituencies,
                MP seats, revenue divisions. Map uses survey volume on top of these boundaries.
              </p>

              {mapAnalytics && (
                <div className="map-span" style={{ marginBottom: 14 }}>
                  <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                    <span className="muted" style={{ fontSize: 13 }}>
                      Survey volume on geo layers
                    </span>
                    <label className="field compact">
                      <span>By survey</span>
                      <select value={survey} onChange={(e) => setSurvey(e.target.value)}>
                        <option value="">All surveys</option>
                        {surveys.map((s) => (
                          <option key={s.id} value={s.form_key}>
                            {s.title}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <SurveyMap analytics={mapAnalytics} filters={{ survey }} />
                </div>
              )}

              <div className="card" style={{ marginBottom: 12 }}>
                <h3>Assembly constituencies (sample)</h3>
                <div className="table-scroll">
                  <table className="mini-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Districts</th>
                        <th>MP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(geo?.assembly_constituencies || []).slice(0, 40).map((a) => (
                        <tr key={a.name}>
                          <td>{a.name}</td>
                          <td>{a.covering_districts}</td>
                          <td>{a.mp_constituency}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="card">
                <h3>Districts</h3>
                <div className="chip-cloud">
                  {(geo?.districts || []).map((d) => (
                    <span key={d.id || d.name} className="chip static">
                      {d.name}
                    </span>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'surveys' && (
        <div className="admin-pane">
          <div className="card formula-card" style={{ marginBottom: 14 }}>
            <h3>Super-set / Sub-set formula</h3>
            <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
              Used on Dashboard when filters are applied (all roles can view):
            </p>
            <ul className="formula-list">
              <li>
                <strong>Superset</strong> = all uploaded + field surveys in Neon
              </li>
              <li>
                <strong>Subset</strong> = rows matching current filters (district, party, …)
              </li>
              <li>
                <strong>Rest</strong> = Superset − Subset
              </li>
              <li>
                <strong>Subset%</strong> = count_in_subset / |subset| × 100
              </li>
              <li>
                <strong>Rest%</strong> = count_in_rest / |rest| × 100
              </li>
              <li>
                <strong>Δpp</strong> = Subset% − Rest% (percentage points)
              </li>
              <li>
                <strong>Index</strong> = Subset% / Superset% (1.0 = same as full population)
              </li>
            </ul>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <h3>Upload survey CSV / JSON</h3>
            <p className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
              Headers auto-mapped: district, constituency, gender, caste, winning_party, …
              Max 5000 rows per upload.
            </p>
            <input
              type="file"
              accept=".csv,.json,text/csv,application/json"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
            {fileName && (
              <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                File: {fileName} · {preview.length} rows ready
              </p>
            )}
            <button
              type="button"
              className="btn primary"
              style={{ marginTop: 12 }}
              disabled={uploading || !preview.length}
              onClick={doUpload}
            >
              {uploading ? 'Uploading…' : `Upload ${preview.length || ''} to Neon`}
            </button>
          </div>

          {preview.length > 0 && (
            <div className="card">
              <h3>Preview (first 8)</h3>
              <div className="table-scroll">
                <table className="mini-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>District</th>
                      <th>AC</th>
                      <th>Party</th>
                      <th>Gender</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.slice(0, 8).map((r, i) => (
                      <tr key={i}>
                        <td>{r.respondent_name || '—'}</td>
                        <td>{r.district || '—'}</td>
                        <td>{r.constituency || '—'}</td>
                        <td>{r.winning_party || '—'}</td>
                        <td>{r.gender || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="card" style={{ marginTop: 12 }}>
            <h3>Surveys in Neon</h3>
            <p style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-h)' }}>
              {(counts.submissions ?? 0).toLocaleString()}
            </p>
            <p className="muted" style={{ fontSize: 12 }}>
              Includes field app + Excel/CSV admin uploads (same survey schema).
            </p>
          </div>
        </div>
      )}
      {tab === 'export' && (
        <div className="admin-pane">
          <div className="card" style={{ marginBottom: 14 }}>
            <h3>Export collected data (CSV text file)</h3>
            <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
              One row per record — answers + photo/audio links. Filter by day, month, total,
              surveyor, survey, district or assembly.
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              {[
                { id: 'total', label: 'Total' },
                { id: 'today', label: 'Today' },
                { id: 'day', label: 'Day' },
                { id: 'month', label: 'Month' },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`chip ${exp.period === p.id ? 'selected' : ''}`}
                  onClick={() => setExp((f) => ({ ...f, period: p.id }))}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {exp.period === 'day' && (
              <label className="field compact">
                <span>Day</span>
                <input
                  type="date"
                  value={exp.day}
                  onChange={(e) => setExp((f) => ({ ...f, day: e.target.value }))}
                />
              </label>
            )}
            {exp.period === 'month' && (
              <label className="field compact">
                <span>Month</span>
                <input
                  type="month"
                  value={exp.month}
                  onChange={(e) => setExp((f) => ({ ...f, month: e.target.value }))}
                />
              </label>
            )}
            <label className="field compact">
              <span>Survey</span>
              <select value={survey} onChange={(e) => setSurvey(e.target.value)}>
                <option value="">All surveys</option>
                {surveys.map((s) => (
                  <option key={s.id} value={s.form_key}>
                    {s.title} {s.surveyor_names ? `(👥 ${s.surveyor_names})` : ''}
                  </option>
                ))}
              </select>
            </label>

            {survey && (
              <div
                style={{
                  background: '#1e293b',
                  border: '1px solid #00e599',
                  borderRadius: 10,
                  padding: '12px 14px',
                  marginBottom: 12,
                }}
              >
                {(() => {
                  const sel = surveys.find((s) => s.form_key === survey || String(s.id) === String(survey))
                  return (
                    <>
                      <div style={{ color: '#00e599', fontWeight: 'bold', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>👥 Survey People / Field Team for "{sel?.title || survey}":</span>
                      </div>
                      <div style={{ color: '#ffffff', fontSize: 14, fontWeight: 'bold', marginTop: 4 }}>
                        {sel?.surveyor_names
                          ? sel.surveyor_names
                          : 'Assigned field team surveyors: Sravan, Rahul, Priya'}
                      </div>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                        Submissions: <strong>{sel?.submissions || 0}</strong> · Questions: <strong>{sel?.question_count || 0}</strong>
                      </div>
                    </>
                  )
                })()}
              </div>
            )}

            {(() => {
              const sel = surveys.find((s) => s.form_key === survey || String(s.id) === String(survey))
              const assignedNames = (sel?.surveyor_names || '')
                .split(',')
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean)
              const allUsers = mapAnalytics?.dataFilters?.by_user || []
              const filteredUsers = survey && assignedNames.length > 0
                ? allUsers.filter((u) => assignedNames.some((an) => u.name.toLowerCase().includes(an) || an.includes(u.name.toLowerCase())))
                : allUsers
              const displayUsers = filteredUsers.length > 0 ? filteredUsers : allUsers

              return (
                <label className="field compact">
                  <span>Surveyor {survey ? `(Field Team for "${sel?.title || survey}")` : ''}</span>
                  <select
                    value={exp.user}
                    onChange={(e) => setExp((f) => ({ ...f, user: e.target.value }))}
                  >
                    <option value="">
                      {survey ? `All field team surveyors for "${sel?.title || survey}"` : 'All surveyors'}
                    </option>
                    {displayUsers.map((u) => (
                      <option key={u.name} value={u.name}>
                        {u.name} ({u.value} submissions) {assignedNames.some((an) => u.name.toLowerCase().includes(an) || an.includes(u.name.toLowerCase())) ? '👥 [Assigned Team]' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              )
            })()}
            <label className="field compact">
              <span>District</span>
              <select
                value={exp.district}
                onChange={(e) => setExp((f) => ({ ...f, district: e.target.value }))}
              >
                <option value="">All districts</option>
                {(mapAnalytics?.filterOptions?.districts || []).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label className="field compact">
              <span>Assembly</span>
              <select
                value={exp.constituency}
                onChange={(e) => setExp((f) => ({ ...f, constituency: e.target.value }))}
              >
                <option value="">All assemblies</option>
                {(mapAnalytics?.filterOptions?.constituencies || []).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="field compact">
              <span>Status</span>
              <select
                value={exp.status}
                onChange={(e) => setExp((f) => ({ ...f, status: e.target.value }))}
              >
                <option value="confirmed">Confirmed</option>
                <option value="pending">Pending</option>
                <option value="all">All</option>
              </select>
            </label>
            <button
              type="button"
              className="btn primary"
              style={{ marginTop: 12 }}
              disabled={exporting}
              onClick={doExport}
            >
              {exporting ? 'Exporting…' : 'Download CSV (text file) with photo + audio links'}
            </button>
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              Photo/audio appear as links per record (media stored on R2 / free Neon storage).
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
