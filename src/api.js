/** API client — always uses Deno Deploy (Neon behind Deno) */

const TOKEN_KEY = 'esurvey_token'
const USER_KEY = 'esurvey_user'
const LEGACY_API_KEY = 'esurvey_api_base'

/** Fixed production API — Oracle Cloud VPS */
export const DENO_API_URL = 'https://162.35.96.65.sslip.io'

export function getApiBase() {
  // Clear any old local/PC URL the user may have saved earlier
  try {
    localStorage.removeItem(LEGACY_API_KEY)
  } catch {
    /* ignore */
  }

  const env = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
  if (env) return env

  // Always Deno in production / native
  return DENO_API_URL
}

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function setSession(token, user) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user))
    else localStorage.removeItem(USER_KEY)
  } catch {
    /* ignore */
  }
}

export function setStoredUser(user) {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user))
    else localStorage.removeItem(USER_KEY)
  } catch {
    /* ignore */
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
  } catch {
    /* ignore */
  }
}

async function request(path, options = {}) {
  const base = getApiBase()
  const url = `${base}${path}`
  const headers = {
    Accept: 'application/json',
    ...options.headers,
  }

  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(url, { cache: 'no-store', ...options, headers })
  const data = await res.json().catch(() => ({}))

  if (res.status === 401) {
    if (data.totp_required) {
      const err = new Error(data.error || 'Authenticator code required')
      err.status = 401
      err.data = data
      err.totp_required = true
      throw err
    }
    clearSession()
    try {
      window.dispatchEvent(
        new CustomEvent('esurvey-unauthorized', { detail: data }),
      )
    } catch {
      /* ignore */
    }
    const err = new Error(
      data.error || 'Account updated or session expired. Please log in again.',
    )
    err.status = 401
    throw err
  }
  if (!res.ok) {
    const err = new Error(data.error || data.detail || data.message || `HTTP ${res.status}`)
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}

export function health() {
  return request('/api/health')
}

/** Login as admin or surveyor (created in admin dashboard) */
export async function login(username, password, expected_role, totp) {
  const data = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password,
      ...(expected_role ? { expected_role } : {}),
      ...(totp ? { totp } : {}),
    }),
  })
  setSession(data.token, data.user)
  return data
}

export async function logout() {
  try {
    await request('/api/auth/logout', { method: 'POST' })
  } catch {
    /* ignore */
  }
  clearSession()
}

export async function me() {
  const data = await request('/api/auth/me')
  if (data?.user) {
    const token = getToken()
    if (token) setSession(token, data.user)
  }
  return data
}

export function listUsers() {
  return request('/api/users')
}

export function listNotifications(after = 0) {
  const q = after ? `?after=${encodeURIComponent(String(after))}` : ''
  return request(`/api/notifications${q}`)
}

export function notificationsStreamUrl(after = 0) {
  const token = getToken()
  const q = new URLSearchParams()
  if (token) q.set('token', token)
  if (after) q.set('after', String(after))
  return `${getApiBase()}/api/notifications/stream?${q}`
}

export function createUser(body) {
  return request('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Bulk generate surveyor accounts: { count, prefix, password } or { usernames_list, password } */
export function generateUsers(body) {
  return request('/api/users/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Client Admin: edit username, password, name, active, target; revoke sessions */
export function updateUser(id, body) {
  return request(`/api/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Kick all sessions for a user (force re-login on field app) */
export function revokeUserSessions(id) {
  return updateUser(id, { revoke_sessions: true })
}

/** Disable + revoke (block app login) */
export function disableUser(id) {
  return updateUser(id, { active: false, revoke_sessions: true })
}

/** Re-enable field app login */
export function enableUser(id) {
  return updateUser(id, { active: true })
}

/** Hard delete user (prefer disable) */
/** Create an additional Super Admin account (cap 3 platform-wide) — Super Admin only */
export function createSuperAdmin(body) {
  return request('/api/super-admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function resetSuperAdminTotp(id) {
  return request(`/api/super-admin/${id}/totp/reset`, { method: 'POST' })
}

export function seedSuperAdminSlots() {
  return request('/api/super-admin/seed-slots', { method: 'POST' })
}


/** Platform-wide audit log (Super Admin only) — FR-AUD-02 */
export function getAuditLog(params = {}) {
  const qs = new URLSearchParams()
  if (params.action) qs.set('action', params.action)
  if (params.actor) qs.set('actor', params.actor)
  if (params.entity) qs.set('entity', params.entity)
  if (params.limit) qs.set('limit', params.limit)
  const q = qs.toString()
  return request(`/api/audit-log${q ? `?${q}` : ''}`)
}

/** Global Question Bank (FR-QB-02) */
export function listQuestionBank() {
  return request('/api/question-bank')
}

export function createQuestionBank(body) {
  return request('/api/question-bank', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function updateQuestionBank(id, body) {
  return request(`/api/question-bank/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function deleteQuestionBank(id) {
  return request(`/api/question-bank/${id}`, { method: 'DELETE' })
}

export function copyQuestionBank(id, opts = {}) {
  return request(`/api/question-bank/${id}/copy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question_count: opts.question_count }),
  })
}

/** Seat-limit upgrade requests (BR-006 / FR-USR-10) */
export function getSeatRequests() {
  return request('/api/seat-limit-requests')
}

export function createSeatRequest(body) {
  return request('/api/seat-limit-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function decideSeatRequest(id, decision) {
  return request(`/api/seat-limit-requests/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision }),
  })
}

export function approveSeatRequest(id) {
  return decideSeatRequest(id, 'approve')
}

export function denySeatRequest(id) {
  return decideSeatRequest(id, 'deny')
}

export function deleteUser(id) {
  return request(`/api/users/${id}`, {
    method: 'DELETE',
  })
}

/** Upload surveyor profile media (photo, aadhaar_front, aadhaar_back) */
export function uploadProfileMedia(field, data, userId) {
  const url = userId ? `/api/users/${userId}/media` : '/api/users/profile-media'
  return request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ field, data }),
  })
}

/** Surveyor: my done/target ticks */
export function getMyProgress() {
  return request('/api/progress/me')
}

/** Admin: all surveyors progress board */
export function getProgressBoard() {
  return request('/api/progress')
}

/** Admin set quota: { user_id } or { all_surveyors: true }, target */
export function setProgressQuota(body) {
  return request('/api/progress/quota', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** KPI summary counts (pending, confirmed, rejected, submissions, districts) */
export function getStats() {
  return request('/api/analytics?group_by=kpi')
}

/** Combined geo children (mandals + revenue divisions) for a district */
export function getGeoChildren(district) {
  const q = district ? `?district=${encodeURIComponent(district)}` : ''
  return request(`/api/geo/children${q}`)
}

export function getMandals(district) {
  const q = district ? `?district=${encodeURIComponent(district)}` : ''
  return request(`/api/geo/mandals${q}`)
}

export function getRevenueDivisions(district) {
  const q = district ? `?district=${encodeURIComponent(district)}` : ''
  return request(`/api/geo/revenue_divisions${q}`)
}

export function listSubmissions(limit = 100, status = '', extra = {}) {
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  if (status) params.set('status', status)
  Object.entries(extra || {}).forEach(([k, v]) => {
    if (v) params.set(k, String(v))
  })
  return request(`/api/submissions?${params}`)
}

/** Client Admin: analyze by date + user + complete/incomplete */
export function getAdminAnalyze(filters = {}) {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([k, v]) => {
    if (v) params.set(k, String(v))
  })
  const q = params.toString()
  return request(`/api/admin/analyze${q ? `?${q}` : ''}`)
}

/** Confirm / reject after Q/A review (strict complete unless force) */
export function setSubmissionStatus(id, status, note = '', force = false) {
  return request(`/api/submissions/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, note, force: !!force }),
  })
}

/** Client Admin: load one survey for edit */
export function getSubmission(id) {
  return request(`/api/submissions/${id}`)
}


/**
 * Client Admin: edit survey data
 * body: { answers?, submitted_by?, geo?, status?, has_audio?, has_photo?, note?, force? }
 */
export function updateSubmission(id, body) {
  return request(`/api/submissions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  })
}

/** Client Admin: delete a survey record */
export function deleteSubmission(id) {
  return request(`/api/submissions/${id}`, {
    method: 'DELETE',
  })
}

export function confirmAllPending(limit = 500, note = '') {
  return request('/api/submissions/confirm-pending', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit, note }),
  })
}

/** Client Admin: re-run fact materialization for a failed record (FR-PRC-04) */
export function retryFact(id) {
  return request(`/api/submissions/${id}/retry-fact`, { method: 'POST' })
}

export function getAnalytics(filters = {}) {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([k, v]) => {
    if (v) params.set(k, String(v))
  })
  // Default report = confirmed only (set explicitly if missing)
  if (!params.has('status')) params.set('status', 'confirmed')
  // Dashboard passes report=locked → server forces confirmed + complete
  const q = params.toString()
  return request(`/api/analytics${q ? `?${q}` : ''}`)
}

/** One-point unified API for Analytics & Report: fetches metrics + intake stream in parallel */
export async function getUnifiedAnalytics(filters = {}) {
  const [analytics, analyze] = await Promise.all([
    getAnalytics(filters).catch(() => null),
    getAdminAnalyze(filters).catch(() => null),
  ])
  return { analytics, analyze }
}


/** List photo/audio URLs for an export (same filters as CSV). Files are named {id}.jpg / {id}.webm. */
export function exportSubmissionMedia(filters = {}) {
  return request(
    `/api/admin/export?${new URLSearchParams(
      Object.entries({ ...filters, format: 'media' })
        .filter(([, v]) => v != null && v !== '')
        .map(([k, v]) => [k, String(v)]),
    )}`,
  )
}

/** Download collected data as CSV/text with photo + audio links (day/month/surveyor/geo filters) */
export async function exportSubmissions(filters = {}) {
  const base = getApiBase()
  const q = new URLSearchParams(
    Object.entries(filters)
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => [k, String(v)]),
  ).toString()
  const url = `${base}/api/admin/export${q ? `?${q}` : ''}`
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      const err = new Error(data.error || `Export failed with HTTP status ${res.status}`)
      err.status = res.status
      throw err
    }
    return res.text()
  } catch (err) {
    if (err.name === 'TypeError' || String(err.message).includes('Failed to fetch') || String(err.message).includes('NetworkError')) {
      throw new Error(`Network error accessing ${base}. Please ensure the backend server is reachable and CORS headers are allowed.`)
    }
    throw err
  }
}

export function getGeoSummary() {
  return request('/api/admin/geo-summary')
}

export function uploadSurveys(rows, { source, form_id } = {}) {
  return request('/api/admin/upload-surveys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows, source, form_id }),
  })
}

export function createSubmission({ form_id, source, submitted_by, answers }) {
  // Lazy import to avoid circular deps at module init
  const version = (() => {
    try {
      // eslint-disable-next-line no-undef
      return {
        app_version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : undefined,
        app_build: typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : undefined,
      }
    } catch {
      return {}
    }
  })()
  return request('/api/submissions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      form_id: form_id || `field-${Date.now()}`,
      source: source || 'mobile-field-survey',
      submitted_by: submitted_by || null,
      answers,
      ...version,
    }),
  })
}

/** Portal web fill — requires can_web_survey on the server. */
export function createWebSurvey({ form_key, form_id, submitted_by, answers }) {
  return request('/api/web-survey', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      form_key,
      form_id: form_id || form_key,
      source: 'web-survey',
      submitted_by: submitted_by || null,
      answers,
    }),
  })
}

export function webFillUrl(formKey, token) {
  if (!formKey) return ''
  const superConsole = (import.meta.env.VITE_SUPER_ADMIN ?? '0') === '1'
  let root = CANONICAL_FIELD_APP
  if (!superConsole && typeof window !== 'undefined') {
    const base = String(import.meta.env.BASE_URL || '/')
    root = `${window.location.origin}${base.endsWith('/') ? base : `${base}/`}`
  }
  const u = new URL(root)
  u.searchParams.set('fill', formKey)
  if (token) u.searchParams.set('k', token)
  return u.toString()
}

/** Mint a public fill token. Expires after max_uses submissions (Client Admin picker). */
export function createWebFillLink(formKey, maxUses = 1) {
  const n = Math.min(9999, Math.max(1, Math.floor(Number(maxUses) || 1)))
  return request('/api/web-survey/link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ form_key: formKey, max_uses: n }),
  })
}

export async function mintWebFillUrl(formKey, maxUses = 1) {
  const d = await createWebFillLink(formKey, maxUses)
  return webFillUrl(formKey, d.token)
}

const GITHUB_WEB_REPO = 'sravanku018/ground-iq-web'
/** Canonical Client Admin / field-app origin (used from Super Admin console). */
const CANONICAL_FIELD_APP = 'https://ground-iq-web-lake.vercel.app/'

export function apkDownloadUrl() {
  return `${getApiBase()}/api/app.apk`
}

/** Shareable field-app URL. Portal-only builds open the collector via ?app=1. */
export function fieldAppUrl() {
  const superConsole = (import.meta.env.VITE_SUPER_ADMIN ?? '0') === '1'
  let root = CANONICAL_FIELD_APP
  if (!superConsole && typeof window !== 'undefined') {
    const base = String(import.meta.env.BASE_URL || '/')
    root = `${window.location.origin}${base.endsWith('/') ? base : `${base}/`}`
  }
  const u = new URL(root)
  u.searchParams.set('app', '1')
  return u.toString()
}

export function fieldAppShareText() {
  return `Smart Survey X — Android app\n${apkDownloadUrl()}`
}

export function getPublicWebSurvey(formKey, token) {
  const q = new URLSearchParams()
  q.set('form_key', formKey)
  if (token) q.set('k', token)
  return request(`/api/web-survey?${q.toString()}`)
}

export function submitPublicWebSurvey({ form_key, token, submitted_by, answers }) {
  return request('/api/web-survey/public', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      form_key,
      token: token || '',
      submitted_by: submitted_by || 'Web',
      answers,
    }),
  })
}

/** Telugu auto-translate — requires can_manage_questions or can_crud_questionnaire. */
export function translateQuestion({ text, options }) {
  return request('/api/questions/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, options: options || [] }),
  })
}

/** Load questions from admin dashboard (auto for field app) */
export function getQuestions() {
  return request('/api/questions')
}


/**
 * Form for the field app: surveys assigned to this surveyor (GET /api/my-surveys).
 * Returns { form_key, title, questions, surveys: [...] }.
 */
function asQuestionList(raw) {
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

/** Field app: surveys assigned to this surveyor. */
export function getMySurveys() {
  return request('/api/my-surveys')
}

/** Alias used by some field screens. */
export function getSurveys() {
  return getMySurveys()
}

export async function getSurveyForm() {
  const mine = await getMySurveys()
  const items = Array.isArray(mine?.items) ? mine.items : []
  if (items.length) {
    const item = items[0]
    return {
      ...item,
      questions: asQuestionList(item.questions),
      surveys: items.map((s) => ({ ...s, questions: asQuestionList(s.questions) })),
    }
  }
  // Do not fall back to the platform Field Survey — that is a different form
  // and looks like "the survey would not load" after assigning a surveyor.
  return {
    form_key: '',
    title: 'No survey assigned',
    questions: [],
    surveys: [],
  }
}

/** Admin: list surveys (q = name search filter) */
export function listSurveys(q = '') {
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  const qs = params.toString()
  return request(`/api/surveys${qs ? `?${qs}` : ''}`)
}

/**
 * Admin: create survey/project (name + questions). 409 + existing_id if name exists.
 * Super Admin may also register the company this project is mapped under and the
 * Client Admins who are part of it (company_name, admin_ids).
 */
export function createSurvey({ title, questions, company_name, admin_ids, voice_required, voice_time_limit }) {
  const body = { title, questions }
  if (company_name != null && company_name !== '') body.company_name = company_name
  if (Array.isArray(admin_ids) && admin_ids.length > 0) body.admin_ids = admin_ids
  if (voice_required !== undefined) body.voice_required = !!voice_required
  if (voice_time_limit !== undefined) body.voice_time_limit = Number(voice_time_limit) || 0
  return request('/api/surveys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Admin: full survey detail (questions + team + respondents) */
export function getSurvey(id) {
  return request(`/api/surveys/${id}`).then((d) => {
    if (d?.survey) d.survey.questions = asQuestionList(d.survey.questions)
    return d
  })
}

/** Admin: update title/questions; Super Admin may also update company_name */
export function updateSurvey(id, { title, questions, company_name, display_lang, voice_required, voice_time_limit }) {
  const body = { title, questions }
  if (company_name !== undefined) body.company_name = company_name
  if (display_lang !== undefined) body.display_lang = display_lang
  if (voice_required !== undefined) body.voice_required = !!voice_required
  if (voice_time_limit !== undefined) body.voice_time_limit = Number(voice_time_limit) || 0
  return request(`/api/surveys/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Admin: delete survey (removes team + respondent list) */
export function deleteSurvey(id) {
  return request(`/api/surveys/${id}`, { method: 'DELETE' })
}

/** Admin: replace surveyor team for a survey (survey-centric) */
export function setSurveySurveyors(id, userIds) {
  return request(`/api/surveys/${id}/surveyors`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_ids: userIds }),
  })
}

/**
 * Admin: replace which surveys a surveyor is assigned to (user-centric).
 * Field app loads these via GET /api/my-surveys.
 */
export function getUserSurveys(userId) {
  return request(`/api/users/${userId}/surveys`)
}

export function setUserSurveys(userId, surveyIds, extra = {}) {
  const body = { survey_ids: surveyIds }
  if (Array.isArray(extra.add)) body.add_survey_ids = extra.add
  if (Array.isArray(extra.remove)) body.remove_survey_ids = extra.remove
  return request(`/api/users/${userId}/surveys`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Super Admin: replace which Client Admins have access to a survey (shared surveys) */
export function setSurveyAdmins(id, adminIds) {
  return request(`/api/surveys/${id}/admins`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ admin_ids: adminIds }),
  })
}

/** Super Admin: companies registry — list registered companies (with their Client Admins) */
export function listCompanies() {
  return request('/api/companies')
}

/** Super Admin: create a company */
export function createCompany(name) {
  return request('/api/companies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

/** Super Admin: rename a company (member profiles stay in sync) */
export function updateCompany(id, { name }) {
  return request(`/api/companies/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

/** Super Admin: delete a company (Client Admins are unlinked) */
export function deleteCompany(id) {
  return request(`/api/companies/${id}`, { method: 'DELETE' })
}

/** Super Admin: replace which Client Admins belong to a company */
export function setCompanyAdmins(id, adminIds) {
  return request(`/api/companies/${id}/admins`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ admin_ids: adminIds }),
  })
}

/** Super Admin / Client Admin: fetch full Company Dashboard data */
export function getCompanyDashboard(idOrName) {
  return request(`/api/companies/${encodeURIComponent(idOrName)}/dashboard`)
}


export function saveQuestions({ title, questions }) {
  return request('/api/admin/questions', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, questions }),
  })
}


export function listSubmissionMedia(submissionId, full = false) {
  return request(`/api/submissions/${submissionId}/media${full ? '?full=1' : ''}`)
}

/** Surveyor's own submitted records (field app "My records") */
export function getMySubmissions() {
  return request('/api/submissions?mine=1')
}

/**
 * Load Neon-hosted media as a browser blob URL (no external card service).
 * pathOrUrl: full https URL, or /api/media/:id/file
 */
export async function fetchMediaBlobUrl(pathOrUrl) {
  if (!pathOrUrl) return ''
  if (/^https?:\/\//i.test(pathOrUrl) && !pathOrUrl.includes('/api/media/')) {
    return pathOrUrl
  }
  const base = getApiBase()
  const path = pathOrUrl.startsWith('http')
    ? pathOrUrl
    : `${base}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`
  const headers = { Accept: '*/*' }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(path, { headers })
  if (!res.ok) throw new Error(`Media load failed (${res.status})`)
  const blob = await res.blob()
  return URL.createObjectURL(blob)
}

/**
 * Helper to download photo, audio, or video files to device with admin auth token.
 */
/** Fetch media bytes with admin auth (for zip export). */
export async function fetchMediaBytes(pathOrUrl) {
  if (!pathOrUrl) return null
  const token = getToken()
  const base = getApiBase()
  // Never fetch R2/storage directly — CORS fails in the browser.
  // Always go through our API file route when the path is /api/media/:id/file
  // or when we can rewrite a full API URL.
  let url = String(pathOrUrl)
  const mediaMatch = url.match(/\/api\/media\/(\d+)\/file/)
  if (mediaMatch) {
    url = `${base}/api/media/${mediaMatch[1]}/file`
  } else if (!/^https?:\/\//i.test(url)) {
    url = `${base}${url.startsWith('/') ? '' : '/'}${url}`
  } else if (!url.includes(new URL(base).host)) {
    throw new Error('Media must be loaded through the API')
  }
  const headers = { Accept: '*/*' }
  if (token) headers.Authorization = `Bearer ${token}`
  let res
  try {
    res = await fetch(url, { headers, redirect: 'manual' })
  } catch (e) {
    throw new Error(
      e?.message || 'NetworkError when fetching media — redeploy the API so files are proxied.',
    )
  }
  if (res.status >= 300 && res.status < 400) {
    throw new Error('Media is on external storage — redeploy the Deno API so the zip can load it.')
  }
  if (!res.ok) throw new Error(`Media load failed (${res.status})`)
  return new Uint8Array(await res.arrayBuffer())
}

export async function downloadMediaFile(pathOrUrl, filename = 'media-file') {
  if (!pathOrUrl) return
  const token = getToken()
  let url = pathOrUrl
  if (!/^https?:\/\//i.test(url)) {
    const base = getApiBase()
    url = `${base}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`
  }
  
  let urlObj
  try {
    urlObj = new URL(url)
  } catch {
    urlObj = new URL(url, window.location.origin)
  }
  if (token && !urlObj.searchParams.has('token')) {
    urlObj.searchParams.set('token', token)
  }
  urlObj.searchParams.set('download', '1')

  try {
    const headers = {}
    if (token) headers.Authorization = `Bearer ${token}`
    const res = await fetch(urlObj.toString(), { headers })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    const blobUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = filename
    a.click()
    URL.revokeObjectURL(blobUrl)
  } catch (e) {
    console.warn('Direct fetch download failed, attempting window open fallback:', e)
    window.open(urlObj.toString(), '_blank')
  }
}

/**
 * Always save to device queue first (systematic sync later).
 * No direct upload from callers.
 */
export async function submitSurveyOrQueue({
  form_id,
  source,
  submitted_by,
  answers,
  geo,
  photoDataUrl,
  audioDataUrl,
}) {
  const { savePackageLocal } = await import('./localStore')
  const { forceSyncNow } = await import('./syncEngine')
  const id = await savePackageLocal({
    form_id: form_id || `field-${Date.now()}`,
    source: source || 'mobile-field-survey',
    submitted_by: submitted_by || null,
    answers,
    geo,
    photoDataUrl: photoDataUrl || null,
    audioDataUrl: audioDataUrl || null,
  })
  void forceSyncNow()
  return { mode: 'queued', id }
}
