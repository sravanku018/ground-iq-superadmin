import { useCallback, useEffect, useState } from 'react'
import Papa from 'papaparse'
import { getGeoSummary, uploadSurveys } from './api'
import SurveyMap from './SurveyMap'
import { getAnalytics } from './api'

/**
 * Admin-only: 2 tabs
 * 1) Geography — uploaded districts, mandals, assembly, MP + map
 * 2) Survey upload — CSV/JSON survey responses into Neon
 */
export default function AdminDataScreen({ onToast }) {
  const [tab, setTab] = useState('geography') // geography | surveys
  const [geo, setGeo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState([])
  const [fileName, setFileName] = useState('')
  const [mapAnalytics, setMapAnalytics] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [summary, analytics] = await Promise.all([
        getGeoSummary(),
        getAnalytics({}).catch(() => null),
      ])
      setGeo(summary)
      setMapAnalytics(analytics)
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [onToast])

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

  return (
    <div className="screen admin-data-screen">
      <header className="screen-head">
        <h2>Admin data</h2>
        <p>Geography inventory + survey upload (2 tabs)</p>
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
                  <SurveyMap analytics={mapAnalytics} filters={{}} />
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
    </div>
  )
}
