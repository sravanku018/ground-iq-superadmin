# Product & Data Policy — Smart Survey X / Ground IQ (Election Survey)

**App:** Smart Survey X — Election Survey Field App + Client Admin Portal + Super Admin Console
**Package:** `com.groundiq.electionsurvey` · **Version:** 2.0.66 (versionCode 20066)
**Source of truth:** this repo (`src/`, `hono-api/`, `android/`, `smart-survey-x-docs/`)
**Last updated:** 2026-10-02

This document describes **what is actually in the project** — what the app does,
what data it collects, what device permissions it uses, where data is stored,
who can see what, how security works, and the rules operators must follow.
Use it as the internal policy; `PRIVACY_POLICY.md` is the public privacy policy derived from it.

---

## 1. What the product is

| Surface | Who uses it | How | Code |
|---|---|---|---|
| Surveyor field app | Surveyors (`surveyor` role, e.g. `s001` / `agent2`) | Android APK (Capacitor) + mobile web | `src/SurveyorApp.jsx`, `src/FieldCollect.jsx` |
| Client Admin portal | Client Admins (`admin` role) | Desktop browser (`/admin`) | `src/AdminPortal.jsx` |
| Super Admin console | Super Admins (`super_admin`, max 3 accounts) | Separate site / `?super=1` | `src/AdminCompanies.jsx`, `src/AdminClientAdmins.jsx` |
| Public web-fill | Anonymous respondents with a link (`?fill=<formKey>&k=<token>`) | Browser | `src/PublicWebFill.jsx` |
| Backend API | All surfaces | HTTPS API → Neon PostgreSQL + Cloudflare R2 | `hono-api/` (Hono on Deno Deploy / Oracle VPS) |

Field flow is enforced in order: **GPS lock → photo capture → voice recording + Q/A → offline queue → sync**
(`src/FieldCollect.jsx`: `step 0 geo, 1 photo, 2 voice+qa`; `questionsOpen = geoLocked && photoLocked`).
Questions cannot be answered before GPS + photo are locked. Records sync through a
device queue (`queued → qa → photo → audio → done`; `src/localStore.js`, `src/syncEngine.js`).

Question types: `text`, `choice`, `multi_select`, `yesno`, `abc`,
`sentiment` / `sentiment_text` (Positive/Neutral/Negative), `range`, `numeric_range`,
`age`, plus voice-required toggles and Telugu translations (`src/AdminQuestions.jsx`).

Default/legacy questionnaire (10 questions): Gender, Caste, Age, Education,
Employment, Performance, Party, PM choice, Ward, Issues — plus District / Assembly /
Constituency / Mandal selectors and Telangana GeoJSON maps (`public/geojson/`).

---

## 2. Data the project collects

### 2.1 Respondent (voter/citizen) data — per survey submission
Stored as `payload.answers` + `payload.geo` + media rows in `submissions` / `survey_media`.

- **Survey answers:** whatever the Client Admin configured (text, single/multi choice,
  yes/no, sentiment, numeric/range, age buckets like "26-35 years"). Legacy data holds
  Gender/Caste/Age/Education/Employment/Performance/Party/PM/Ward/Issues.
- **Location:** GPS latitude/longitude, accuracy (must be <= 120 m, `MAX_ACCURACY_M`),
  capture timestamp, reverse-geocoded display name, district, mandal, state.
- **Photo evidence:** one required field photo per record (compressed to WebP/JPEG on-device,
  `src/mediaOptimize.js`; minimum-size check `MIN_PHOTO_CHARS`).
- **Audio evidence:** voice recording (16 kHz speech) when the survey requires it;
  Super Admin sets auto-stop limit (Off / 2 / 5 / 10 / 15 min, `voice_time_limit`).
- **Metadata:** form id/key, submitted-by, timestamps, app version/build, completeness
  (`complete`/`incomplete`), review status (`pending`/`confirmed`/`rejected`/`flagged`).

> Respondent name/phone is collected **only if** the survey form asks for it.
> There is no separate voter-ID field in the current code. Treat any free-text answer
> as potentially identifying and handle per section 6.

### 2.2 Surveyor (field staff) data — account + profile
Managed in Client Admin -> Surveyors (`src/AdminUsers.jsx`); profile in `src/SurveyorApp.jsx`.

- **Account:** username, display name, password hash (never plaintext), role=`surveyor`,
  active flag, company/tenant link, unique surveyor code, capability flags.
- **Contact:** phone number, validated as `+91` + 10 digits (`src/phoneIn.js`).
- **Identity documents:** profile photo, **Aadhaar front + back images**
  (`aadhaar_front`, `aadhaar_back`), `verified` flag set only by a Client Admin
  with `can_verify_surveyors` (or Super Admin).
- **Activity:** own submission metadata (record id, campaign, timestamp, review status).
  Surveyors **cannot** re-fetch answer/evidence payloads of submitted records
  (exception: a rejected record with `attempt_number = 1` shows a Resubmit action).

### 2.3 Admin data
Client Admin / Sub Admin / Dashboard Viewer / Super Admin accounts: username, display
name, password hash, role, tenant/company scope, capability flags, TOTP state
(Super Admin only). Login/session events and admin actions go to `audit_log`
(actor id/name/role, action, entity type/id, metadata, timestamp).

### 2.4 Automatically collected / technical data
- Session token (random 256-bit, `app_sessions.token`, 30-day expiry), expiry timestamps.
- Device queue metadata (package id, phase, attempts, last error) in IndexedDB
  (`esurvey_local_v2`) + localStorage (`esurvey_queue_meta_v2`).
- App version/build/versionCode sent with API calls (`src/version.js`).
- Server logs: IP (login rate-limiting only), request path/method, timestamps.

### 2.5 Data the project does NOT collect
- No advertising ID, no third-party analytics SDK, no crash-reporter SDK in the bundle.
- No background location tracking — GPS is captured **once per record** at collection time.
- No access to contacts, SMS, call logs, or files outside the record photo/audio.
- Government ID is collected **only for surveyors** (staff KYC), never for respondents.

---

## 3. Device permissions (Android) — why each exists

From `android/app/src/main/AndroidManifest.xml`:

| Permission | Used for | Code |
|---|---|---|
| `INTERNET` | Sync records/media, login, fetch surveys, maps/analytics | `src/api.js`, `src/syncEngine.js` |
| `ACCESS_FINE_LOCATION` + `ACCESS_COARSE_LOCATION` | One-time GPS lock per record (120 m accuracy gate) | `src/FieldCollect.jsx` |
| `CAMERA` | Required field photo per record | `src/FieldCollect.jsx` |
| `RECORD_AUDIO` (+ `MODIFY_AUDIO_SETTINGS`) | Voice recording evidence when survey requires it | `src/FieldCollect.jsx` |
| `REQUEST_INSTALL_PACKAGES` | In-app APK update prompt | `src/appUpdate.js`, `src/AppUpdateModal.jsx` |

Dangerous permissions (location/camera/mic) are requested **at point of use** in the
record flow, not at app launch. Denying GPS/photo blocks that record (by design);
voice is required only when the survey `voice_required` flag is on.

---

## 4. Where data lives and how it moves

- **On device:** offline-first queue. Record packages (answers + geo + photo/audio data URLs)
  persist in IndexedDB; small meta index in localStorage. Queue drains via
  `syncEngine`/`syncBackground` + `sync.worker.js`. Auth token in localStorage
  (`esurvey_token`), user profile (`esurvey_user`), app version keys.
- **In transit:** HTTPS/TLS everywhere. Production API base is fixed in-app
  (`src/api.js` `DENO_API_URL`, override `VITE_API_BASE_URL`); no HTTP fallback.
  Media downloads go through the API (`/api/media/:id/file` with `Authorization: Bearer`),
  never direct public bucket links from the browser (CORS + auth).
- **At rest (server):** Neon PostgreSQL (submissions, users, sessions, audit log, survey
  forms, web links); Cloudflare R2 bucket `election-survey-media` for photo/audio objects
  (private bucket; served via authenticated `/api/media/:id/file`, `hono-api/legacy/handler.ts`).
  `survey_media.url` is stored as the relative API path, expanded to absolute URLs only
  on export with the request origin.
- **Front door:** CORS allowlist (`hono-api/legacy/handler.ts`): GitHub Pages
  `https://sravanku018.github.io`, `ground-iq-web*` / `ground-iq-superadmin*` Vercel hosts,
  localhost/127.0.0.1, `capacitor://localhost`, `ionic://localhost`, plus `ALLOWED_ORIGINS`
  env merge. Disallowed origins get **no** `Access-Control-Allow-Origin` (blocked).
- **Web hosting:** Client Admin on GitHub Pages / Vercel (`vercel.json` SPA rewrite);
  PWA service worker (`public/sw.js`) registers on web only, never inside the Capacitor APK.
- **Maps:** Leaflet + bundled Telangana GeoJSON (`public/geojson/`); no respondent data
  is sent to any map provider.

---

## 5. Who can see / do what (access control)

- **Surveyor:** sees assigned surveys, own progress/activity metadata; submits records;
  edits own phone number only. Cannot view other surveyors records, others analytics,
  exports, user management, or review queues. Submitted payloads are not re-readable
  by the surveyor role.
- **Client Admin (Main):** full tenant scope — surveys/questions/team, surveyor create +
  verify, review confirm/reject with mandatory reject reason, analytics/report, CSV export
  (`/api/admin/export` with day/month/today/total/surveyor/survey/district/assembly/status
  filters), web-survey links (token + `max_uses` cap + expiry), seat-limit requests.
  Can set voice **Off vs Required**; **cannot** set minute limits (API ignores
  `voice_time_limit` from non-Super-Admin).
- **Sub Admin / Dashboard Viewer:** Sub Admin = same ops as Main except cannot create
  admins/viewers; Viewer = read-only dashboards, no edit/export/review (per
  `smart-survey-x-docs/01-PRD.md` roles; flags in `src/AdminClientAdmins.jsx`).
- **Super Admin (max 3 seats):** cross-tenant companies, quotas/seat limits, voice minute
  chips (2/5/10/15), question-bank globals, platform audit log (`/api/audit-log`),
  super-admin create/reset. Minute-limit and bootstrap paths are Super-Admin-only.
- **Public web-fill respondent:** can submit **one** survey via a capped token link;
  cannot list, read, or export any data.
- **Enforcement:** role check on every endpoint server-side; tenant scope derived from
  the authenticated token, never from client-supplied parameters; review decisions are
  1:1 with a record and immutable (corrections are out-of-band ops, not a routine undo);
  rejected records get one resubmission attempt.

---

## 6. Security rules (as implemented — do not weaken)

1. **Passwords:** PBKDF2-HMAC-SHA256, 600,000 iterations, random 16-byte salt
   (`pbkdf2:salt:hash`); legacy scrypt `salt:hash` and 100k-iteration PBKDF2 accepted
   for backward compatibility on verify. Constant-time comparison. Hashes never
   returned by any API.
2. **Sessions:** `crypto.getRandomValues` 32-byte opaque tokens in `app_sessions`,
   30-day expiry (`expires_at`), deleted on logout; all of a user sessions deleted on
   user delete/deactivate. DB-backed revocable tokens (not stateless JWT).
3. **Super Admin 2FA:** password + RFC 6238 TOTP (SHA-1, 30 s, 6 digits, +/-1 window);
   secret issued at create/reset/first-enroll only, never on `GET /api/users` or `/api/auth/me`.
4. **Login throttling:** in-memory rate limit — 5 attempts/min per IP (30/min for `web:` keys);
   over-limit logins rejected before password check. Generic "Invalid username or password"
   message (no user-enumeration). Repeated 403s are audit-logged as a security signal.
5. **Evidence integrity:** GPS/timestamp written once at sync; no PATCH endpoint exists for
   `gps_point`/`captured_at`/`submitted_at`. Locked evidence files/checksums cannot be
   replaced via any role API. Review immutability per section 5.
6. **Secrets:** `DATABASE_URL`, R2 keys (`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`),
   deploy tokens live in env/secret-manager only — never committed.
7. **Transport and origins:** HTTPS only; CORS allowlist per section 4; `cache-control`
   allowed on preflight; geo reference data cached publicly for 24 h (static, safe),
   everything else `no-store`.
8. **PII minimization:** exports include only the exporting tenant survey records + media
   links; credentials, other tenants data, and other surveyors raw government-ID
   references are excluded from data exports.

---

## 7. Data retention and deletion

- **Active records:** retained while the tenant account is active (election analysis purpose).
- **On request (respondent / surveyor):** Client Admin can edit/delete survey answers
  before or after confirm (`src/AdminAnalyze.jsx`, `submission_delete` audit event);
  surveyor accounts can be deactivated (blocks login immediately, preserves historical
  submissions) or deleted (sessions revoked).
- **Sessions:** expire after 30 days; revoked on logout, password reset, deactivation, deletion.
- **Device copies:** drafts/queued packages live in the surveyor IndexedDB until synced;
  uninstalling the app or clearing site data removes them. Confirm sync completion
  before asking staff to clear devices.
- **Backups:** Neon point-in-time recovery + R2 versioning (provider-managed); restores are
  Super-Admin ops actions with an audit entry, not a self-service flow.
- **Legacy migration:** rows without `geo` are labelled `legacy (no GPS/camera)`,
  `form_key='legacy'`, `status='confirmed'`, `confirmed_by='system (legacy migration)'` —
  idempotent, auditable, and exportable with the same filters.

---

## 8. Operator obligations (Client Admin / Super Admin)

1. **Consent in the field:** tell every respondent **before** capturing: what is collected
   (answers + GPS + photo + voice if required), why (election survey research for the named
   client), and that participation is voluntary. Do not collect from anyone who declines.
   Do not photograph or record anyone who has not agreed.
2. **Adults only:** survey only adults (18+). If a respondent appears under 18, do not record.
3. **Sensitive questions:** caste/religion/political-opinion answers are voluntary —
   always offer skip/undecided where the form allows, and never coerce.
4. **Aadhaar and staff KYC:** surveyor Aadhaar images are HR identity proof, stored
   access-controlled. Never copy, forward, or include them in data exports or reports.
   Show only to staff with `can_verify_surveyors`.
5. **Credentials:** never share logins; Super Admin TOTP secrets are issued once —
   store in an authenticator app, not screenshots/chat. Report suspected compromise for
   immediate session revocation + password reset.
6. **Exports:** CSV/ZIP exports contain personal data. Share only with the contracted
   client over a private channel, never public links; delete local copies when done.
7. **Public links:** web-fill links are capped (`max_uses`) and expirable — deactivate
   the moment a survey closes.
8. **Breach response:** on suspected breach/leak, Super Admin revokes sessions, rotates
   R2/DB credentials, preserves `audit_log`, and notifies affected tenants within 72 hours.

---

## 9. User rights (how to exercise them)

Any respondent, surveyor, or admin may request: **access** (what data is held about them),
**correction**, **deletion**, **export**, or **withdrawal of consent** (stop further collection).
Route requests to the Client Admin of the tenant that collected the data (or the Super Admin
for platform accounts). The project supports each right via: Review/QA screens + submission
edit/delete, surveyor profile edit, session revocation, `/api/admin/export`, and `audit_log`
evidence. Target response: 30 days.

---

## 10. Third parties and subprocessors

| Party | Purpose | Data shared |
|---|---|---|
| Neon (PostgreSQL) | Primary database | Encrypted-at-rest app data |
| Cloudflare R2 | Photo/audio object storage | Media bytes (private bucket) |
| Deno Deploy / Oracle VPS | API hosting | In-transit API payloads |
| GitHub Pages / Vercel | Portal hosting (static) | No respondent data (UI shell only) |
| Leaflet + bundled GeoJSON | Maps rendering | No personal data sent |

No ads, no data brokers, no sale of personal data — ever.

---

## 11. Changes to this policy

Material changes (new data collected, new permission, new subprocessor, new retention rule)
require a version bump + changelog entry here and an update to `PRIVACY_POLICY.md` **before**
the APK/portal build that introduces them ships. The running app version
(`src/version.js` label `v2.0.66`) lets any user confirm which policy version applies.

## 12. Contact

- **Policy / privacy requests:** [ADD — privacy contact name + email/phone]
- **Security issues:** [ADD — security contact]
- **Super Admin console:** `https://sravanku018.github.io/ground-iq-superadmin/`
- **Client portal:** `https://sravanku018.github.io/ground-iq-web/`
