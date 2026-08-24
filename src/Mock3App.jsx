import { useState } from 'react'

const PARTIES = [
  { name: 'Congress', key: 'congress', color: 'var(--party-congress, #16a34a)' },
  { name: 'BJP', key: 'bjp', color: 'var(--party-bjp, #f97316)' },
  { name: 'BRS', key: 'brs', color: 'var(--party-brs, #ec4899)' },
  { name: 'Others', key: 'others', color: 'var(--party-others, #94a3b8)' },
  { name: 'Undecided', key: 'undecided', color: 'var(--party-undecided, #64748b)' },
]

const DISTRICTS_DATA = [
  { d: 'Adilabad', Congress: 78, BJP: 134, BRS: 56, Others: 41, Undecided: 19 },
  { d: 'Nizamabad', Congress: 145, BJP: 203, BRS: 87, Others: 35, Undecided: 12 },
  { d: 'Karimnagar', Congress: 112, BJP: 178, BRS: 156, Others: 29, Undecided: 15 },
  { d: 'Warangal (R)', Congress: 134, BJP: 98, BRS: 201, Others: 22, Undecided: 11 },
  { d: 'Rangareddy', Congress: 312, BJP: 245, BRS: 178, Others: 42, Undecided: 23 },
  { d: 'Medchal', Congress: 198, BJP: 156, BRS: 134, Others: 31, Undecided: 18 },
  { d: 'Hanumakonda', Congress: 167, BJP: 189, BRS: 98, Others: 27, Undecided: 14 },
  { d: 'Khammam', Congress: 189, BJP: 67, BRS: 145, Others: 18, Undecided: 9 },
]

const INITIAL_FEED = [
  {
    init: 'RK', id: '63', name: 'Rajesh Kumar', respondent: 'Anjali Reddy', rinit: 'AR',
    loc: 'Rangareddy · Maheshwaram AC', time: '2 min ago', party: 'congress', plabel: 'Congress',
    sent: 'Positive', sc: '#16a34a', issue: 'Roads', dem: 'Female · 35', voteLikely: 'Certain',
    status: 'confirmed', slabel: 'Confirmed', gps: '17.3210, 78.4001 · ±14 m', audioLen: '0:52',
    proof: { phone: '+91 98490 •••21', phoneOk: true, aadhaar: 'XXXX XXXX 4417', aadhaarOk: true },
    signals: [['📍 GPS', true], ['📷 Photo', true], ['🎤 Voice', true], ['🪪 ID', true]],
  },
  {
    init: 'SP', id: '58', name: 'Sunita Patel', respondent: 'Ibrahim Khan', rinit: 'IK',
    loc: 'Medchal · Kukatpally AC', time: 'syncing…', party: 'bjp', plabel: 'BJP',
    sent: 'Neutral', sc: '#f59e0b', issue: 'Water supply', dem: 'Male · 42', voteLikely: 'Likely',
    status: 'pending', slabel: 'Pending', cls: 'syncing', gps: '17.4948, 78.3996 · ±22 m', audioLen: '0:47',
    proof: { phone: '+91 90000 •••73', phoneOk: true, aadhaar: 'XXXX XXXX 9021', aadhaarOk: true },
    signals: [['📍 GPS', true], ['📷 Photo', true], ['🎤 Voice', true], ['🪪 ID', true]],
  },
  {
    init: 'AK', id: '62', name: 'Amit Kumar', respondent: 'Suresh Yadav', rinit: 'SY',
    loc: 'Hanumakonda · Warangal West AC', time: '5 min ago', party: 'brs', plabel: 'BRS',
    sent: 'Negative', sc: '#ef4444', issue: 'Drainage', dem: 'Male · 28', voteLikely: 'Certain',
    status: 'confirmed', slabel: 'Confirmed', gps: '17.9784, 79.5941 · ±9 m', audioLen: '1:03',
    proof: { phone: '+91 79955 •••08', phoneOk: true, aadhaar: 'XXXX XXXX 3390', aadhaarOk: true },
    signals: [['📍 GPS', true], ['📷 Photo', true], ['🎤 Voice', true], ['🪪 ID', true]],
  },
  {
    init: 'LM', id: '60', name: 'Lakshmi Menon', respondent: 'Fatima Begum', rinit: 'FB',
    loc: 'Nizamabad · Bodhan AC', time: '8 min ago', party: 'congress', plabel: 'Congress',
    sent: 'Positive', sc: '#16a34a', issue: 'Healthcare', dem: 'Female · 55', voteLikely: 'Unsure',
    status: 'rejected', slabel: 'Rejected', cls: 'failed', gps: '18.6650, 78.0750 · ±31 m', audioLen: '0:38',
    proof: { phone: '+91 88012 •••55', phoneOk: true, aadhaar: 'not present', aadhaarOk: false },
    signals: [['📍 GPS', true], ['📷 Photo', false], ['🎤 Voice', true], ['🪪 ID', true]],
  },
  {
    init: 'VR', id: '61', name: 'Venu Rao', respondent: 'Ramesh Goud', rinit: 'RG',
    loc: 'Karimnagar · Huzurabad AC', time: '12 min ago', party: 'bjp', plabel: 'BJP',
    sent: 'Neutral', sc: '#f59e0b', issue: 'Electricity', dem: 'Male · 38', voteLikely: 'Likely',
    status: 'pending', slabel: 'Pending', gps: '18.6725, 79.1330 · ±19 m', audioLen: '0:41',
    proof: { phone: '+91 96180 •••34', phoneOk: true, aadhaar: 'XXXX XXXX 7756', aadhaarOk: true },
    signals: [['📍 GPS', true], ['📷 Photo', true], ['🎤 Voice', true], ['🪪 ID', true]],
  },
]

export default function Mock3App() {
  const [role, setRole] = useState('surveyor')
  const [surveyorScreen, setSurveyorScreen] = useState('s-home')
  const [adminView, setAdminView] = useState('v-overview')
  const [selectedParty, setSelectedParty] = useState('congress')
  const [mapMode, setMapMode] = useState('volume')
  const [feed, setFeed] = useState(INITIAL_FEED)
  const [reviewModal, setReviewModal] = useState(null)
  const [toastMsg, setToastMsg] = useState(null)
  const [navMode, setNavMode] = useState('next')
  const [displayLang, setDisplayLang] = useState('en')
  const [totpRevealed, setTotpRevealed] = useState(false)

  const showToast = (msg, kind = '') => {
    setToastMsg({ msg, kind })
    setTimeout(() => setToastMsg(null), 2800)
  }

  const totalsByDistrict = DISTRICTS_DATA.map((r) => ({
    ...r,
    total: PARTIES.reduce((s, p) => s + r[p.name], 0),
  }))
  const maxTotal = Math.max(...totalsByDistrict.map((r) => r.total))
  const partyTotals = PARTIES.map((p) => ({
    ...p,
    total: DISTRICTS_DATA.reduce((s, r) => s + r[p.name], 0),
  }))
  const grandTotal = partyTotals.reduce((s, p) => s + p.total, 0)
  const leadOf = (r) => PARTIES.reduce((best, p) => (r[p.name] > r[best.name] ? p : best), PARTIES[0])

  const blueRamp = (t) => {
    const clamped = Math.max(0, Math.min(1, t))
    const r = Math.round(219 + (20 - 219) * clamped)
    const g = Math.round(234 + (80 - 234) * clamped)
    const b = Math.round(254 + (159 - 254) * clamped)
    return `rgb(${r},${g},${b})`
  }

  const confirmRecord = (id) => {
    setFeed((prev) =>
      prev.map((c) =>
        c.id === id
          ? { ...c, status: 'confirmed', slabel: 'Confirmed', cls: '', time: 'just now' }
          : c,
      ),
    )
    setReviewModal(null)
    showToast('Record confirmed ✓', 'ok')
  }

  const rejectRecord = (id) => {
    setFeed((prev) =>
      prev.map((c) =>
        c.id === id
          ? { ...c, status: 'rejected', slabel: 'Rejected', cls: 'failed' }
          : c,
      ),
    )
    setReviewModal(null)
    showToast('Record marked rejected', 'bad')
  }

  return (
    <div className="mock3-whole-container" style={{ minHeight: '100vh', background: 'var(--bg, #f8fafc)', color: 'var(--ink, #0f172a)' }}>
      {/* ══════════ Top App Bar ══════════ */}
      <header className="appbar">
        <div className="brand">
          <span className="glyph">◆</span>
          <span>
            Smart Survey X<br />
            <span className="sub">Ground IQ Platform · Mock 3 System</span>
          </span>
        </div>
        <div className="role-tabs" role="tablist">
          <button
            type="button"
            className={`role-tab ${role === 'surveyor' ? 'active' : ''}`}
            onClick={() => setRole('surveyor')}
          >
            📱 Surveyor
          </button>
          <button
            type="button"
            className={`role-tab ${role === 'clientadmin' ? 'active' : ''}`}
            onClick={() => setRole('clientadmin')}
          >
            📊 Client Admin
          </button>
          <button
            type="button"
            className={`role-tab ${role === 'superadmin' ? 'active' : ''}`}
            onClick={() => setRole('superadmin')}
          >
            🛡 Super Admin
          </button>
        </div>
        <div className="appbar-spacer" style={{ flex: 1 }} />
        <span className="sync-chip synced" title="Local-first optimistic sync">
          <span className="sdot" /> Synced just now
        </span>
      </header>

      {/* ══════════ Stage Panels ══════════ */}
      <div className="stage" style={{ padding: '24px 20px' }}>
        {/* ════════════ SURVEYOR (Apple Lens) ════════════ */}
        {role === 'surveyor' && (
          <div className="role-panel active">
            <div className="panel-lead" style={{ maxWidth: 1240, margin: '0 auto 20px' }}>
              <h2 style={{ fontSize: 22, fontWeight: 700 }}>Surveyor · Field Capture</h2>
              <p style={{ fontSize: 13, color: 'var(--ink-muted, #64748b)', margin: '2px 0 0' }}>
                Ruthless subtraction, craft in the feel — 4-step lock flow, centered swipe cards, and optimistic sync.
              </p>
            </div>
            <div className="survey-stage" style={{ display: 'flex', gap: 24, justifyContent: 'center', flexWrap: 'wrap' }}>
              <div className="phone">
                <div className="status-bar">
                  <span className="time">9:41</span>
                  <span>●●●●○ 5G 🔋</span>
                </div>
                <div className="phone-subnav">
                  <button
                    type="button"
                    className={surveyorScreen === 's-home' ? 'active' : ''}
                    onClick={() => setSurveyorScreen('s-home')}
                  >
                    Home
                  </button>
                  <button
                    type="button"
                    className={surveyorScreen === 's-collect' ? 'active' : ''}
                    onClick={() => setSurveyorScreen('s-collect')}
                  >
                    Collect
                  </button>
                  <button
                    type="button"
                    className={surveyorScreen === 's-pending' ? 'active' : ''}
                    onClick={() => setSurveyorScreen('s-pending')}
                  >
                    Pending
                  </button>
                  <button
                    type="button"
                    className={surveyorScreen === 's-profile' ? 'active' : ''}
                    onClick={() => setSurveyorScreen('s-profile')}
                  >
                    Profile
                  </button>
                  <button
                    type="button"
                    className={surveyorScreen === 's-settings' ? 'active' : ''}
                    onClick={() => setSurveyorScreen('s-settings')}
                  >
                    Settings
                  </button>
                </div>

                <div className="phone-body">
                  {/* Home */}
                  {surveyorScreen === 's-home' && (
                    <div className="phone-screen active">
                      <div className="hero-card">
                        <div className="hero-eyebrow">Field survey · Surveyor</div>
                        <div className="hero-name">
                          Hi, Rajesh Kumar
                          <svg className="verified" viewBox="0 0 22 22" aria-label="Verified" style={{ width: 16, height: 16 }}>
                            <path fill="#1D9BF0" d="M11 2l2.2 1.6 2.7-.2 1 2.5 2.3 1.4-.6 2.7.6 2.7-2.3 1.4-1 2.5-2.7-.2L11 20l-2.2-1.6-2.7.2-1-2.5-2.3-1.4.6-2.7-.6-2.7 2.3-1.4 1-2.5 2.7.2z" />
                            <path fill="#fff" d="M9.6 13.4l-2-2 1-1 1 1 3.2-3.2 1 1z" />
                          </svg>
                        </div>
                        <div className="hero-sub">GPS → Photo → Q/A + audio · saved on device · auto next</div>
                      </div>

                      <div className="pill-row">
                        <span className="spill ok"><span className="d" />Network Strong</span>
                        <span className="spill warn"><span className="d" />3 pending on phone</span>
                      </div>

                      <div className="stat-row">
                        <div className="stat"><div className="v tnum">42</div><div className="l">On server</div></div>
                        <div className="stat"><div className="v tnum">3</div><div className="l">Pending</div></div>
                        <div className="stat"><div className="v tnum">12</div><div className="l">Questions</div></div>
                        <div className="stat"><div className="v tnum">84%</div><div className="l">Target</div></div>
                      </div>

                      <div className="cta" style={{ marginTop: 16 }}>
                        <button
                          type="button"
                          className="cta-btn"
                          onClick={() => setSurveyorScreen('s-collect')}
                        >
                          Start collect · GPS → Photo → Q/A
                        </button>
                        <button
                          type="button"
                          className="cta-sub"
                          onClick={() => showToast('Syncing 3 packages now…', 'ok')}
                        >
                          Sync 3 packages now
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Collect */}
                  {surveyorScreen === 's-collect' && (
                    <div className="phone-screen active">
                      <div className="nav-bar">
                        <h1>Maheshwaram AC</h1>
                        <span className="pill-count">Q4 / 12</span>
                      </div>

                      <div className="stepper">
                        <div className="step done"><div className="dot">✓</div><div className="lbl">GPS</div></div>
                        <div className="step done"><div className="dot">✓</div><div className="lbl">Photo</div></div>
                        <div className="step active"><div className="dot">3</div><div className="lbl">Voice + Q/A</div></div>
                        <div className="step"><div className="dot">4</div><div className="lbl">Done</div></div>
                      </div>

                      <div className="lockbar">
                        <div className="hd">Locked requirements · cannot skip</div>
                        <div className="lock-pills">
                          <span className="lock-pill ok">📍 GPS LOCKED · ±8m</span>
                          <span className="lock-pill ok">🧭 Location LOCKED</span>
                          <span className="lock-pill ok">📷 Photo LOCKED</span>
                          <span className="lock-pill ok">🎤 Voice ON</span>
                        </div>
                      </div>

                      <div className="voice-strip">
                        <span className="live" /> Recording interview · Voice locked · Opus 24 kbps
                      </div>

                      <div className="card-stack">
                        <div className="q-card">
                          <div className="q-number">Question 4</div>
                          <div className="q-text">Which party do you support?</div>
                          <div className="options">
                            {PARTIES.map((p) => (
                              <button
                                key={p.key}
                                type="button"
                                className={`opt-btn party-${p.key} ${selectedParty === p.key ? 'selected' : ''}`}
                                onClick={() => setSelectedParty(p.key)}
                              >
                                <span className="swatch" style={{ background: p.color }} />
                                {p.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="bottom-bar">
                        <button type="button" className="btn-ghost" onClick={() => setSurveyorScreen('s-home')}>‹ Prev</button>
                        <button
                          type="button"
                          className="next-btn"
                          onClick={() => {
                            showToast('Survey question saved ✓', 'ok')
                            setSurveyorScreen('s-home')
                          }}
                        >
                          Next ›
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Pending */}
                  {surveyorScreen === 's-pending' && (
                    <div className="phone-screen active">
                      <div className="qhead">
                        <h1 style={{ fontSize: 18, fontWeight: 700 }}>Pending</h1>
                        <p style={{ fontSize: 12, color: '#64748b' }}>3 pending · 1 draft · 2 waiting to sync</p>
                      </div>
                      <div className="queue-card">
                        <div className="qc-top">
                          <span className="qc-title">Kukatpally · Female · 35</span>
                          <span className="kind-pill queued">Queued #64</span>
                        </div>
                        <div className="qc-meta">9:32 AM · default · locks OK · syncs when strong</div>
                        <div className="qc-actions">
                          <button type="button">Show answers ▾</button>
                          <button type="button" className="primary" onClick={() => showToast('Syncing #64…', 'ok')}>Retry sync</button>
                        </div>
                      </div>
                      <div className="queue-card syncing">
                        <div className="qc-top">
                          <span className="qc-title">Maheshwaram · Male · 42</span>
                          <span className="kind-pill queued">Queued #59</span>
                        </div>
                        <div className="qc-meta">Syncing to server…</div>
                      </div>
                      <div className="queue-card">
                        <div className="qc-top">
                          <span className="qc-title">Draft — step 3/4 · 8/12 answered</span>
                          <span className="kind-pill draft">Draft #65</span>
                        </div>
                        <div className="qc-meta">Stays on this phone until you tap Send</div>
                        <div className="qc-actions">
                          <button type="button" onClick={() => setSurveyorScreen('s-collect')}>Edit</button>
                          <button type="button" className="primary" onClick={() => showToast('Sent #65 to queue ✓', 'ok')}>Send</button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Profile */}
                  {surveyorScreen === 's-profile' && (
                    <div className="phone-screen active">
                      <div className="prof">
                        <div className="avatar">
                          RK<span className="lock">🔒</span>
                        </div>
                        <div className="pname">
                          Rajesh Kumar
                          <svg className="verified" viewBox="0 0 22 22" style={{ width: 16, height: 16 }}>
                            <path fill="#1D9BF0" d="M11 2l2.2 1.6 2.7-.2 1 2.5 2.3 1.4-.6 2.7.6 2.7-2.3 1.4-1 2.5-2.7-.2L11 20l-2.2-1.6-2.7.2-1-2.5-2.3-1.4.6-2.7-.6-2.7 2.3-1.4 1-2.5 2.7.2z" />
                            <path fill="#fff" d="M9.6 13.4l-2-2 1-1 1 1 3.2-3.2 1 1z" />
                          </svg>
                        </div>
                        <div className="puser">@rajesh01</div>
                        <div className="keychip">Key ID: GROUND-KEY-2291</div>
                      </div>
                      <div className="idcard">
                        <h4>📞 Phone <span style={{ fontSize: 11 }}>🔒</span></h4>
                        <p>+91 98480 22910 · verified · cannot be changed</p>
                      </div>
                      <div className="idcard">
                        <h4>🪪 Aadhaar Identity <span style={{ fontSize: 11 }}>🔒</span></h4>
                        <p>Verified by Client Admin · documents locked</p>
                        <div className="id-tiles">
                          <div className="id-tile">Front ✓</div>
                          <div className="id-tile">Back ✓</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Settings */}
                  {surveyorScreen === 's-settings' && (
                    <div className="phone-screen active">
                      <div className="qhead">
                        <h1 style={{ fontSize: 18, fontWeight: 700 }}>Settings</h1>
                        <p style={{ fontSize: 12, color: '#64748b' }}>Saved on this device only</p>
                      </div>
                      <div className="set-card">
                        <h4>Display language</h4>
                        <p className="desc">Used when the survey has no language set.</p>
                        <div className="set-chips">
                          <button
                            type="button"
                            className={`set-chip ${displayLang === 'en' ? 'selected' : ''}`}
                            onClick={() => setDisplayLang('en')}
                          >
                            English
                          </button>
                          <button
                            type="button"
                            className={`set-chip ${displayLang === 'te' ? 'selected' : ''}`}
                            onClick={() => setDisplayLang('te')}
                          >
                            తెలుగు
                          </button>
                        </div>
                      </div>
                      <div className="set-card">
                        <h4>Survey question layout</h4>
                        <p className="desc">Choose how questions appear while collecting a survey.</p>
                        <button
                          type="button"
                          className={`nav-mode-opt ${navMode === 'next' ? 'selected' : ''}`}
                          onClick={() => setNavMode('next')}
                        >
                          <span className="radio" />
                          <span>
                            <span className="nm-title">Next button</span>
                            <span className="nm-desc">One question at a time, with Prev / Next buttons.</span>
                          </span>
                        </button>
                        <button
                          type="button"
                          className={`nav-mode-opt ${navMode === 'swipe' ? 'selected' : ''}`}
                          onClick={() => setNavMode('swipe')}
                        >
                          <span className="radio" />
                          <span>
                            <span className="nm-title">Swipe</span>
                            <span className="nm-desc">One question at a time — swipe left or right to move.</span>
                          </span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <aside className="aside">
                <h3>Apple lens — applied here</h3>
                <div className="principle">
                  <span className="tag">SUBTRACT</span>
                  <span>One question per card, 48px targets, save-first, auto-next. Decide what not to show.</span>
                </div>
                <div className="principle">
                  <span className="tag">CRAFT</span>
                  <span>Elevation, press scale, pulsing voice indicator. Motion carries the sense of locked capture.</span>
                </div>
                <div className="principle">
                  <span className="tag">LOCKS</span>
                  <span>GPS, photo, and voice are enforced in the field app to ensure pristine data.</span>
                </div>
              </aside>
            </div>
          </div>
        )}

        {/* ════════════ CLIENT ADMIN (Google + Twitter Lens) ════════════ */}
        {role === 'clientadmin' && (
          <div className="role-panel active">
            <div className="admin-shell">
              <nav className="sidebar">
                <div className="side-brand">
                  ◆ Smart Survey X <span className="role-tag">Client Admin</span>
                </div>
                <div className="side-item">
                  <div className="lbl">Dashboard</div>
                  <button
                    type="button"
                    className={`side-sub ${adminView === 'v-overview' ? 'active' : ''}`}
                    onClick={() => setAdminView('v-overview')}
                  >
                    Overview
                  </button>
                  <button
                    type="button"
                    className={`side-sub ${adminView === 'v-analyze' ? 'active' : ''}`}
                    onClick={() => setAdminView('v-analyze')}
                  >
                    Analyze · charts
                  </button>
                  <button
                    type="button"
                    className={`side-sub ${adminView === 'v-report' ? 'active' : ''}`}
                    onClick={() => setAdminView('v-report')}
                  >
                    Report · review
                  </button>
                </div>
                <div className="side-foot">
                  🔄 Charts update live from Neon submissions.<br />v2.0.1 · Ground IQ Web
                </div>
              </nav>

              <main className="admin-main">
                <div className="subtabs">
                  <button
                    type="button"
                    className={`subtab ${adminView === 'v-overview' ? 'active' : ''}`}
                    onClick={() => setAdminView('v-overview')}
                  >
                    Overview
                  </button>
                  <button
                    type="button"
                    className={`subtab ${adminView === 'v-analyze' ? 'active' : ''}`}
                    onClick={() => setAdminView('v-analyze')}
                  >
                    Analyze
                  </button>
                  <button
                    type="button"
                    className={`subtab ${adminView === 'v-report' ? 'active' : ''}`}
                    onClick={() => setAdminView('v-report')}
                  >
                    Live Feed
                  </button>
                </div>

                {adminView === 'v-overview' && (
                  <div className="admin-view active">
                    <div className="kpi-grid">
                      <div className="kpi"><div className="v tnum">63</div><div className="l">Pending review</div></div>
                      <div className="kpi"><div className="v tnum">4,026</div><div className="l">Confirmed</div></div>
                      <div className="kpi"><div className="v tnum">4,089</div><div className="l">All submissions</div></div>
                      <div className="kpi"><div className="v tnum">8</div><div className="l">Districts in data</div></div>
                    </div>
                    <div className="card">
                      <h3>Pending review</h3>
                      <div className="csub">Oldest first · confirm after Q/A review</div>
                      {feed.filter((c) => c.status === 'pending').map((item) => (
                        <div key={item.id} className="pending-row">
                          <span className="rid tnum">#{item.id}</span>
                          <span className="rmeta">
                            {item.loc} · {item.respondent}
                            <span className="t"> · {item.time} · by {item.name}</span>
                          </span>
                          <span className="badge">Pending</span>
                          <button type="button" className="mini-btn" onClick={() => setReviewModal(item)}>
                            Open Review
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {adminView === 'v-analyze' && (
                  <div className="admin-view active">
                    <div className="kpi-grid">
                      <div className="kpi"><div className="v tnum">4,026</div><div className="l">In this report</div></div>
                      <div className="kpi"><div className="v" style={{ color: 'var(--party-congress, #16a34a)' }}>Congress</div><div className="l">Lead party · 33.2%</div></div>
                      <div className="kpi"><div className="v">Roads</div><div className="l">Top issue · 28%</div></div>
                    </div>

                    <div className="chart-grid">
                      {/* District tile map */}
                      <div className="card">
                        <h3>Responses by district</h3>
                        <div className="csub">Schematic district tiles · click to filter</div>
                        <div className="map-toolbar">
                          <div className="seg">
                            <button
                              type="button"
                              className={mapMode === 'volume' ? 'active' : ''}
                              onClick={() => setMapMode('volume')}
                            >
                              Volume
                            </button>
                            <button
                              type="button"
                              className={mapMode === 'party' ? 'active' : ''}
                              onClick={() => setMapMode('party')}
                            >
                              Lead party
                            </button>
                          </div>
                        </div>
                        <div className="tilemap">
                          {totalsByDistrict.map((r) => {
                            const pct = ((r.total / grandTotal) * 100).toFixed(1)
                            const t = 0.22 + 0.78 * Math.sqrt(r.total / maxTotal)
                            const bg = mapMode === 'volume' ? blueRamp(t) : leadOf(r).color
                            const fg = mapMode === 'volume' ? (t > 0.62 ? '#fff' : '#0d366b') : '#fff'
                            return (
                              <div
                                key={r.d}
                                className="tile"
                                style={{ background: bg, color: fg }}
                              >
                                <div className="tn">{r.d}</div>
                                <div>
                                  <div className="tv tnum">{r.total.toLocaleString()}</div>
                                  <div className="tsub">{pct}%</div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>

                      {/* Party preference */}
                      <div className="card">
                        <h3>Party preference · statewide</h3>
                        <div className="csub">Direct-labeled party distribution</div>
                        <div className="legend">
                          {PARTIES.map((p) => (
                            <span key={p.key} className="legend-item">
                              <span className="legend-swatch" style={{ background: p.color }} />
                              {p.name}
                            </span>
                          ))}
                        </div>
                        <div>
                          {partyTotals.map((p) => {
                            const max = Math.max(...partyTotals.map((x) => x.total))
                            const w = (p.total / max) * 100
                            const pct = ((p.total / grandTotal) * 100).toFixed(1)
                            return (
                              <div key={p.key} className="hbar-row">
                                <div className="hbar-label">
                                  <span className="swatch" style={{ background: p.color }} />
                                  {p.name}
                                </div>
                                <div className="hbar-track">
                                  <div className="hbar-fill" style={{ width: `${w}%`, background: p.color }}>
                                    <span className="hbar-val">{p.total.toLocaleString()} · {pct}%</span>
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {adminView === 'v-report' && (
                  <div className="admin-view active">
                    <div className="feed-head">
                      <h3 style={{ fontSize: 18, fontWeight: 700 }}>Live Intake Feed</h3>
                      <span className="live-dot">LIVE</span>
                    </div>
                    <div>
                      {feed.map((c) => (
                        <div
                          key={c.id}
                          className={`feed-card ${c.cls || ''}`}
                          onClick={() => setReviewModal(c)}
                          style={{ cursor: 'pointer' }}
                        >
                          <div className="fc-head">
                            <div className="fc-surveyor">
                              <div className="fc-avatar">{c.rinit}</div>
                              <div>
                                <div className="fc-name">
                                  {c.respondent} <span style={{ fontWeight: 400, color: '#64748b', fontSize: 11 }}>· {c.dem}</span>
                                </div>
                                <div className="fc-location">{c.loc} · collected by {c.name}</div>
                              </div>
                            </div>
                            <span className="fc-time">{c.time}</span>
                          </div>
                          <div className="fc-answers">
                            <span className="fc-pill">
                              <span className="dot" style={{ background: `var(--party-${c.party})` }} />
                              {c.plabel}
                            </span>
                            <span className="fc-pill">
                              <span className="dot" style={{ background: c.sc }} />
                              {c.sent}
                            </span>
                            <span className="fc-pill">{c.issue}</span>
                          </div>
                          <div className="fc-foot">
                            <div className="fc-signals">
                              {c.signals.map(([icon, ok]) => (
                                <span key={icon} className={`sig ${ok ? 'ok' : 'bad'}`}>
                                  {icon} {ok ? '' : '✕'}
                                </span>
                              ))}
                            </div>
                            <span className={`fc-status ${c.status}`}>{c.slabel}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </main>
            </div>
          </div>
        )}

        {/* ════════════ SUPER ADMIN (Governance) ════════════ */}
        {role === 'superadmin' && (
          <div className="role-panel active">
            <div className="panel-lead" style={{ maxWidth: 1240, margin: '0 auto 20px' }}>
              <h2 style={{ fontSize: 22, fontWeight: 700 }}>Super Admin · Platform Governance</h2>
              <p style={{ fontSize: 13, color: 'var(--ink-muted, #64748b)', margin: '2px 0 0' }}>
                Multi-tenant companies, Client Admin power toggles, and live audit event stream.
              </p>
            </div>
            <div className="admin-shell">
              <main className="admin-main" style={{ gridColumn: '1 / -1' }}>
                <div className="gov-grid">
                  <div>
                    <div className="card">
                      <h3>Companies</h3>
                      <div className="csub">Active client organizations</div>
                      <div className="company-card">
                        <div className="cc-top">
                          <span className="cc-name">Acme Research</span>
                          <span className="cc-pills"><span className="p">▤ 2 projects</span><span className="p">👥 2 admins</span></span>
                        </div>
                        <div className="cc-meta">Members: Priya N (@priya), Ravi T (@ravi)</div>
                      </div>
                      <div className="company-card" style={{ borderLeftColor: 'var(--party-bjp, #f97316)' }}>
                        <div className="cc-top">
                          <span className="cc-name">Deccan Insights</span>
                          <span className="cc-pills"><span className="p">▤ 1 project</span><span className="p">👥 1 admin</span></span>
                        </div>
                        <div className="cc-meta">Members: Kiran M (@kiran)</div>
                      </div>
                    </div>

                    <div className="card">
                      <h3>Client Admin Powers</h3>
                      <div className="csub">Role capabilities and permissions</div>
                      <div className="admin-row">
                        <div className="ar-top">
                          <div className="ar-avatar">PN</div>
                          <div style={{ flex: 1 }}>
                            <div className="ar-name">Priya N</div>
                            <div className="ar-user">@priya · Acme Research</div>
                          </div>
                          <span className="role-pill active">ACTIVE</span>
                        </div>
                        <div className="powers-grid">
                          <span className="power on"><span className="chk">✓</span>🗂 Create surveys</span>
                          <span className="power on"><span className="chk">✓</span>✓ Data review</span>
                          <span className="power on"><span className="chk">✓</span>🛡 Verify surveyors</span>
                          <span className="power on"><span className="chk">✓</span>📞 Proof validation</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="card">
                      <h3>Audit Log</h3>
                      <div className="csub">Platform-wide trail of administrative actions</div>
                      <div className="audit-row">
                        <div className="ico">✓</div>
                        <div className="ainfo">
                          <div className="aact">Review decision <span className="entity-pill">Submissions</span></div>
                          <div className="ameta">@priya · confirmed #62</div>
                        </div>
                        <span className="atime">9:41 AM</span>
                      </div>
                      <div className="audit-row">
                        <div className="ico">🛡</div>
                        <div className="ainfo">
                          <div className="aact">Surveyor verified <span className="entity-pill">Accounts</span></div>
                          <div className="ameta">@priya · verified @rajesh01</div>
                        </div>
                        <span className="atime">9:12 AM</span>
                      </div>
                    </div>

                    <div className="card">
                      <h3>🔐 Authenticator (TOTP)</h3>
                      <div className="csub">Two-factor login authenticator settings</div>
                      <button
                        type="button"
                        className="btn-outline"
                        onClick={() => setTotpRevealed(true)}
                        disabled={totpRevealed}
                      >
                        {totpRevealed ? 'TOTP active' : 'Reset my TOTP'}
                      </button>
                      {totpRevealed && (
                        <div className="totp-secret">
                          <span style={{ fontSize: 12, color: '#64748b' }}>Scan or paste secret into authenticator app:</span>
                          <code>JBSW Y3DP EHPK 3PXP</code>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </main>
            </div>
          </div>
        )}
      </div>

      {/* ══════════ Review Modal ══════════ */}
      {reviewModal && (
        <div className="rv-overlay open" onClick={() => setReviewModal(null)}>
          <div className="rv-panel" onClick={(e) => e.stopPropagation()}>
            <div className="rv-head">
              <button type="button" className="rv-close" onClick={() => setReviewModal(null)}>✕</button>
              <div className="rv-title">🔍 Review · #{reviewModal.id} · {reviewModal.respondent}</div>
              <div className="rv-sub">Client Admin Review · {reviewModal.loc}</div>
            </div>
            <div className="rv-body">
              <div className="rv-card">
                <h5>Record Details</h5>
                <div className="rv-kv"><span className="q">Respondent</span><span className="a">{reviewModal.respondent} · {reviewModal.dem}</span></div>
                <div className="rv-kv"><span className="q">Surveyor</span><span className="a">{reviewModal.name}</span></div>
                <div className="rv-kv"><span className="q">Location</span><span className="a">{reviewModal.loc}</span></div>
              </div>
              <div className="rv-card">
                <h5>Respondent Proof</h5>
                <div className="rv-proof-row"><span>Phone: {reviewModal.proof.phone}</span><span className="rv-chip ok">✓ Valid</span></div>
                <div className="rv-proof-row"><span>Aadhaar: {reviewModal.proof.aadhaar}</span><span className="rv-chip ok">✓ Valid</span></div>
              </div>
            </div>
            <div className="rv-actions">
              {reviewModal.status === 'pending' ? (
                <>
                  <button type="button" className="reject" onClick={() => rejectRecord(reviewModal.id)}>Reject</button>
                  <button type="button" className="confirm" onClick={() => confirmRecord(reviewModal.id)}>✓ Confirm</button>
                </>
              ) : (
                <button type="button" onClick={() => setReviewModal(null)}>Close</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toastMsg && (
        <div id="toast" className={`show ${toastMsg.kind}`}>
          {toastMsg.msg}
        </div>
      )}
    </div>
  )
}
