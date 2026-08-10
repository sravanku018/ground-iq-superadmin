/** API client — always uses Deno Deploy (Neon behind Deno) */

const TOKEN_KEY = 'esurvey_token'
const USER_KEY = 'esurvey_user'
const LEGACY_API_KEY = 'esurvey_api_base'

/** Fixed production API — Deno Deploy → Neon */
export const DENO_API_URL = 'https://jazzy-crocodile-7790.sravanku018.deno.net'

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
  localStorage.setItem(TOKEN_KEY, token || '')
  localStorage.setItem(USER_KEY, JSON.stringify(user || null))
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

  const res = await fetch(url, { ...options, headers })
  const data = await res.json().catch(() => ({}))

  if (res.status === 401) {
    const err = new Error(data.error || 'Login required')
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
export async function login(username, password, expected_role) {
  const data = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password,
      ...(expected_role ? { expected_role } : {}),
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

export function me() {
  return request('/api/auth/me')
}

export function listUsers() {
  return request('/api/users')
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

/** Reset the ONLY existing Super Admin's password (bootstrap escape hatch) — portal admin */
export function resetSuperAdminPassword(password) {
  return request('/api/super-admin/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
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

export function getStats() {
  return request('/api/stats')
}

export function getGeo() {
  return request('/api/geo')
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

/** Load questions from admin dashboard (auto for field app) */
export function getQuestions() {
  return request('/api/questions')
}

/** Surveyor's assigned surveys with their questions (field app) */
export function getMySurveys() {
  return request('/api/my-surveys')
}

/**
 * Form for the field app: assigned survey if any, else the default form.
 * Returns { form_key, title, questions, surveys: [...] }.
 */
export async function getSurveyForm() {
  try {
    const mine = await getMySurveys()
    if (mine.items && mine.items.length) {
      return { ...mine.items[0], surveys: mine.items }
    }
  } catch {
    /* fall back to default */
  }
  const d = await getQuestions()
  return { ...d, surveys: [] }
}

/** Admin: list surveys (q = name search filter) */
export function listSurveys(q = '') {
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  const qs = params.toString()
  return request(`/api/surveys${qs ? `?${qs}` : ''}`)
}

/** Admin: create survey (name + questions). 409 + existing_id if name exists */
export function createSurvey({ title, questions }) {
  return request('/api/surveys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, questions }),
  })
}

/** Admin: full survey detail (questions + team + respondents) */
export function getSurvey(id) {
  return request(`/api/surveys/${id}`)
}

/** Admin: update title/questions */
export function updateSurvey(id, { title, questions }) {
  return request(`/api/surveys/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, questions }),
  })
}

/** Admin: delete survey (removes team + respondent list) */
export function deleteSurvey(id) {
  return request(`/api/surveys/${id}`, { method: 'DELETE' })
}

/** Admin: replace surveyor team for a survey */
export function setSurveySurveyors(id, userIds) {
  return request(`/api/surveys/${id}/surveyors`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_ids: userIds }),
  })
}

/** Admin: add respondent to a survey */
export function addRespondent(id, { name, phone }) {
  return request(`/api/surveys/${id}/respondents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, phone }),
  })
}

/** Admin: mark respondent done/pending */
export function setRespondentStatus(surveyId, respondentId, status) {
  return request(`/api/surveys/${surveyId}/respondents/${respondentId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
}

/** Admin: remove respondent */
export function deleteRespondent(surveyId, respondentId) {
  return request(`/api/surveys/${surveyId}/respondents/${respondentId}`, {
    method: 'DELETE',
  })
}

/** Admin save question bank */
export function saveQuestions({ title, questions }) {
  return request('/api/admin/questions', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, questions }),
  })
}

/** Q/A only (no media blobs) */
export function submitSurveyQA({
  form_key,
  form_id,
  source,
  submitted_by,
  answers,
  geo,
}) {
  return request('/api/submissions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      form_key,
      form_id,
      source: source || 'mobile-field-survey',
      submitted_by,
      answers,
      geo,
      app_version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : undefined,
      app_build: typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : undefined,
    }),
  })
}

/** Separate photo/audio upload */
export function uploadSubmissionMedia(submissionId, { kind, data, mime, meta }) {
  return request(`/api/submissions/${submissionId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, data, mime, meta }),
  })
}

export function listSubmissionMedia(submissionId, full = false) {
  return request(`/api/submissions/${submissionId}/media${full ? '?full=1' : ''}`)
}

/** Surveyor's own submitted records (field app "My records") */
export function getMySubmissions() {
  return request('/api/submissions/me')
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

export const OPTIONS = {
  caste: ['BC', 'SC', 'ST', 'OC', 'Minority', 'Other'],
  party: ['Congress', 'BJP', 'BRS', 'Others', 'Undecided'],
  pm: ['Narendra Modi', 'Rahul Gandhi', 'Other', 'Undecided'],
  issues: ['Water', 'Roads', 'Jobs', 'Electricity', 'Healthcare', 'Education', 'Housing'],
  employment: [
    'Private Sector',
    'Government',
    'Self-Employed',
    'Student',
    'Unemployed',
    'Retired',
    'Farmer',
    'Other',
  ],
  education: ['Illiterate', 'Primary', 'Secondary', 'Graduate', 'Post Graduate', 'Other'],
  gender: ['Male', 'Female', 'Other'],
  performance: ['Excellent', 'Good', 'Average', 'Poor', 'Very Poor'],
}

export const emptyForm = (agentName = '') => ({
  submittedBy: agentName || '',
  respondentName: '',
  phone: '',
  district: '',
  constituency: '',
  mpConstituency: '',
  mandal: '',
  revenueDivision: '',
  ward: '',
  gender: '',
  caste: '',
  age: '',
  employment: '',
  education: '',
  winningParty: '',
  pmPreference: '',
  performance: '',
  issues: [],
  notes: '',
})

