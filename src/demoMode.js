/**
 * Demo mode — replaces real records and names with random mock data so
 * presentations never expose field data. Persisted per browser; the toggle
 * lives in the portal header. Deterministic per seed, so the same record
 * always shows the same mock name within a mode.
 */

const KEY = 'esurvey_demo_mode'

export function demoOn() {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function setDemoMode(on) {
  try {
    if (on) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {
    /* storage blocked — mode just won't persist */
  }
}

export function toggleDemoMode() {
  const on = demoOn()
  setDemoMode(!on)
  return !on
}

const FIRST = ['Ravi', 'Sunita', 'Imran', 'Lakshmi', 'Kiran', 'Anjali', 'Srinivas', 'Padma', 'Venkatesh', 'Deepika', 'Naveen', 'Harika', 'Mahesh', 'Divya', 'Arjun', 'Kavya', 'Prasad', 'Sneha', 'Vikram', 'Meena', 'Rahul', 'Swathi', 'Gopal', 'Bhavani']
const LAST = ['Kumar', 'Devi', 'Reddy', 'Sharma', 'Rao', 'Nair', 'Yadav', 'Patel', 'Singh', 'Iyer', 'Goud', 'Chowdary']
const DISTRICTS = ['Hanumakonda', 'Siddipet', 'Medchal–Malkajgiri', 'Warangal', 'Nalgonda', 'Karimnagar', 'Khammam', 'Nizamabad']

function hash(str) {
  let h = 0
  const s = String(str || 'x')
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** Stable random person name for a seed. */
export function mockPerson(seed) {
  const h = hash(`p:${seed}`)
  return `${FIRST[h % FIRST.length]} ${LAST[Math.floor(h / FIRST.length) % LAST.length]}`
}

/** Stable random district for a seed. */
export function mockDistrict(seed) {
  const h = hash(`d:${seed}`)
  return DISTRICTS[h % DISTRICTS.length]
}

/** Mock KPI numbers for the Overview cards. */
export const DEMO_KPI = {
  total: 4812,
  confirmed: 4650,
  pending: 120,
  rejected: 42,
  web: 55,
  field: 4650,
  districts: 10,
  surveyors: 38,
}

/** Mock live-activity stream — same fields the real stream renders. */
export function mockStreamItems(n = 48) {
  const now = Date.now()
  const out = []
  for (let i = 0; i < n; i += 1) {
    const r = hash(`st:${i}`)
    const status = i % 9 === 8 ? 'pending' : i % 17 === 5 ? 'rejected' : 'confirmed'
    const isWeb = i % 6 === 3
    const district = mockDistrict(`st${i}`)
    const respondent = isWeb ? 'Web respondent' : mockPerson(`r${i}`)
    const surveyor = isWeb ? 'Web' : mockPerson(`s${i % 9}`)
    out.push({
      id: 90000 + i,
      record_index: 4812 - i,
      source: isWeb ? 'web-survey' : 'field',
      status,
      form_key: 'demo-survey',
      created_at: new Date(now - i * 11 * 60 * 1000).toISOString(),
      submitted_by: surveyor,
      answers: {
        district,
        respondent_name: respondent,
        data_collector: surveyor,
      },
    })
  }
  return out
}

/** Mock per-survey breakdown counts (titles + allocations stay real). */
export function mockBreakdown(list = []) {
  return list.map((s) => {
    const h = hash(`b:${s.form_key || s.id}`)
    const field = 300 + (h % 1200)
    const web = s.web_link ? 40 + (h % 140) : 0
    const pending = h % 30
    const rejected = h % 9
    const confirmed = Math.max(0, field - pending - rejected)
    return {
      ...s,
      field_submissions: field,
      web_submissions: web,
      pending,
      confirmed,
      rejected,
    }
  })
}

/** Mask a user record (surveyor list): random name, handle, phone. */
export function mockUser(user, idx) {
  const id = String(user?.id ?? idx ?? 0)
  return {
    ...user,
    name: mockPerson(`u${id}`),
    display_name: mockPerson(`u${id}`),
    username: `surveyor_${100 + Number(id)}`,
    phone: user?.phone ? '98••••' + String(id).padStart(2, '0').slice(-2) : user?.phone,
  }
}
