# Ground IQ — schema & access-control reference

Read this before touching anything related to permissions, companies,
projects, or `ensureSchema()`. Update it in the same change whenever you
touch any of those. This file exists because `main.ts` has been edited by
more than one person/assistant, and two access-control decisions were
silently reversed once already because the reasoning behind them lived only
in a chat, not in the repo. Don't let that happen a third time.

## Core rule — read this first

**Super Admin is the only source of any cross-admin data sharing.**
`survey_admin_access` (per-admin, per-project grants) is the single source
of truth for who can see what. Company and Project are a *display and
grouping* layer on top — never a live access check.

- A Client Admin can never grant another Client Admin access to anything.
  Confirmed: `PUT /api/surveys/:id/admins` is `super_admin`-only;
  `POST /api/surveys` only auto-grants other admins when
  `me.role === "super_admin"`.
- `adminFormKeyScope()` resolves access as `created_by = me.id OR id IN
  (survey_admin_access WHERE admin_id = me.id)` — nothing else. **Do not
  add a live `company_name`/`company_id` match back into this function.**
  That was tried once (see "Decisions log" below) and reverted — it silently
  gives every admin in a company access to every project that company has
  ever had, with no grant event and no audit trail.
- "Share this project with the whole company" is a real, explicit action
  (the `grantIds` block in `POST /api/surveys`, run only for
  `super_admin`) that writes real `survey_admin_access` rows at the moment
  it's clicked. It is not, and must not become, a background condition
  re-evaluated on every read.

## Tables (as of this file's last update — verify against `ensureSchema()`
if this doc looks stale)

**`app_users`** — every account (super_admin / admin / surveyor).
| Column | Notes |
|---|---|
| `company_id` | Real FK → `companies.id`. Reliable. |
| `company_name` | Denormalized label, kept in sync by `ensureCompanyExists`. |
| `phone` | Surveyor contact. Field app / Client Admin UI require `+91` + 10 digits. **PATCH `/api/users/:id` does not yet enforce that format.** |
| `photo`, `aadhaar_front`, `aadhaar_back` | Verification images (data URL or R2 URL). Returned on `GET /api/users` and `GET /api/auth/me`. **Not** returned on login (login stays slim). Locked after `verified = true` except for portal admins. |
| `verified` | Identity verified by a Client Admin who has `can_verify_surveyors` (or Super Admin). |
| `can_manage_questions`, `can_edit_surveys`, `can_review_data`, `can_verify_surveyors`, `can_assign_surveyors`, `can_crud_questionnaire`, `can_validate_proof` | Super-Admin-grantable powers. All 7 enforced via `hasPower(me, "...")`. Settable only by `super_admin` (`canSuper` at creation, `POWER_KEYS` loop at edit). Client Admin Photo/Aadhaar columns show only when verify or proof is granted. |
| `max_questions_per_survey`, `max_surveys`, `max_surveyors`, `max_records` | Super-Admin-set numeric caps, 0 = unlimited. All 4 have real enforcement, not just storage. |
| `created_by` | Who created this account. Drives per-admin surveyor caps and Client Admin inbox scope. |

**`companies`** — `id` (PK), `name UNIQUE`, `created_by`, `created_at`. Nothing else.

**`survey_form`** (the "project") — `id`, `form_key UNIQUE`, `title`,
`questions JSONB`, `created_by`, `company_name TEXT`, **`company_id INT`**
(added this session — FK to `companies.id`, backfilled from the old text
match on boot; use this for anything that needs a reliable company↔project
link, never `company_name` string comparison).

**`submissions`** — `id`, `payload JSONB` (answers/form_key/GPS all live
inside this blob), `created_at`, `fact_status`, `fact_error`.
**No `survey_id` column exists on this table.** Any query referencing
`submissions.survey_id` is querying a phantom column and will silently fail
via `.catch()`. Known broken instance: the submissions/geo section of
`GET /api/companies/:id/dashboard` — currently always returns empty.

**`survey_admin_access`** — junction: `survey_id → survey_form`,
`admin_id → app_users`. **This is the access-control source of truth.**

**`survey_assignments`** — junction: `survey_id → survey_form`,
`user_id → app_users`. Surveyor↔project (separate from admin access).

**`record_facts`**, **`survey_media`**, **`survey_respondents`**,
**`question_bank`**, **`seat_limit_requests`**, **`seat_limits`** — see
`ensureSchema()` directly.

**`audit_log`** — append-only. Also the inbox source for Client Admin /
Super Admin bells. Relevant `action` values written **at upload time**:
| action | When | Who |
|---|---|---|
| `profile_media` | Surveyor POSTs photo / Aadhaar to `/api/users/profile-media` (or `/:id/media`) | actor = surveyor |
| `submission_create` | Surveyor POSTs `/api/submissions` | actor = surveyor |

`GET /api/notifications` and `GET /api/notifications/stream` (SSE, token
query) return those two actions only. Client Admin sees events whose
`actor_id` is a surveyor they created (`created_by = me.id`). Super Admin
sees all. The portal bell must **not** poll `GET /api/users` on a timer
to invent these events — it listens to the stream after the upload
writes the audit row.

## Live inbox (Client Admin + Super Admin)

- **Write path:** `logAudit(...)` immediately after a successful surveyor
  verification-doc upload or field-record insert.
- **Read path:** `GET /api/notifications?after=` (snapshot) then
  `GET /api/notifications/stream?token=&after=` (live).
- Each item includes `page` plus `userId` (docs) or `submissionId`
  (activity) so the bell can open that surveyor profile or Review row.
- Docs items include `verified`. Client Admin **Clear** must not dismiss
  a docs notification until that surveyor is verified.
- Field-app Home / Collect stay locked until `app_users.verified = true`.
- Do not add a 45s (or any) full-user-list poll as the source of truth.

## Field My activity

The field-app **My activity** tab (`MyRecordsScreen`) lists the
surveyor's own sent items from `GET /api/submissions/me`. The list is
**grouped by calendar date only** (IST / `Asia/Kolkata` from
`created_at`). Each group header is the date plus how many were sent,
e.g. `13 Aug 2026` · `4 sent`. Then that day's cards.

- Do **not** put daily counts on Home. Home stays overall
  done/target, queued, questions, status.
- Do **not** label groups Today / Yesterday / Day before, and do
  **not** add weekday names. Date is enough.
- Do **not** add a `by_day` payload to `GET /api/progress/me` for this.
  Grouping is client-side. `GET /api/progress/me` stays overall
  `done` / `target` / `status` only.

## Decisions log

| Decision | Why | Status |
|---|---|---|
| No live `company_name`/`company_id` match in `adminFormKeyScope` | Company-wide auto-share means a new admin silently inherits a company's entire history with no grant event or audit trail — unacceptable for this data (caste/party/respondent-level survey answers) | **Settled.** Reintroduced 3 times and removed again. Scope is `created_by = me.id OR id IN survey_admin_access`. Do not reintroduce a company predicate. |
| `GET /api/companies/:id/dashboard` is `super_admin`-only | This screen only exists inside the Super-Admin-only `AdminCompaniesScreen`; a Client Admin has no legitimate reason to reach it | **Settled.** Reopened to any portal admin twice and locked again. Check is `me.role !== "super_admin"` → 403. |
| `survey_form.company_id` added, backfilled from `company_name` text match | `company_name` is a free-text label with no FK — a company rename silently breaks project↔company grouping unless every dependent row is updated; ID-based linking survives renames | **Done.** Column + FK + boot backfill + writes on starter project, POST `/api/surveys`, bank-copy, and company remap. Not a live access check. |
| Every Client Admin gets a starter `survey_form` project at account creation | Removes dependency on the old shared `legacy`/`default` fallback bucket | **Done**, live. |
| `can_manage_questions` enforcement unified to `hasPower()` | Was 3 inline `me.role !== "super_admin" && me.can_manage_questions !== true` checks duplicating `hasPower`'s logic — drift risk if `hasPower` ever changes | **Done.** Question-bank POST/PUT/DELETE use `hasPower(me, "can_manage_questions")`. |
| Submission status stats read `payload->>'status'`, not `fact_status` | Two similarly-named fields, different meanings — `payload.status` is the real review outcome (`confirmed`/`rejected`/`pending`, set by the PATCH/PUT status endpoints, mirrored by `payloadStatus()`); `fact_status` only tracks the fact-materialization pipeline (`materialized`/`failed`/`NULL`) and is set to `NULL` on both rejection and never-touched-pending — filtering by it silently merged "rejected" into "pending" | **Settled rule.** `/api/stats` now counts `COALESCE(payload->>'status', 'pending')`. `fact_status` is only for "has this confirmed record been materialized into `record_facts` yet." |
| Client Admin bell is event-driven from `audit_log` | A 45s poll of `GET /api/users` + submissions was slow and late. Uploads now write `profile_media` / `submission_create` and the UI streams those rows. | **Done.** Do not go back to interval polling as the inbox source. |
| Field daily sent counts live on My activity, grouped by date only | Home progress is allotment (done/target), not a diary. Today/Yesterday/weekday labels were tried and rejected — date is enough. | **Settled.** Do not put `by_day` on Home or on `GET /api/progress/me`. |

## Known open items — not yet fixed, don't assume they are

- **Surveyor submissions tagged `form_key: "default"` skip the assignment
  check entirely** (`if (fk !== "default")` guard in the submission-intake
  handler). Any surveyor can currently write into the shared `default`
  bucket regardless of their actual project assignment. Write-side twin of
  the read-side leak that was already closed.
- **`submissions.survey_id` phantom-column query** in
  `GET /api/companies/:id/dashboard` — the submissions/geo section always
  returns empty. Either wire it to `payload->>'form_key'` (the real column)
  or remove that section.
- **Backfill for pre-existing Client Admins** created before the
  starter-project auto-provision fix — they have no owned `survey_form` row
  and will see zero data. One-time SQL given in chat history; confirm
  whether it's been run before relying on old accounts having data.
- **`legacy` demo project** — no admin has been granted access via
  `survey_admin_access` yet. Also unconfirmed whether `legacy`'s existing
  submissions are real historical respondent data or safe placeholder data
  — check before presenting it as a "demo" to anyone.
- **GET `/api/surveys` (and GET `/api/surveys/:id`) still has a live
  `company_name` match** for Client Admin listing/open. That is the same
  class of leak as the old `adminFormKeyScope` company predicate — they
  can see/open a sibling admin's project title and questions without a
  `survey_admin_access` row. Record-layer reads that go through
  `adminFormKeyScope` are already owned+grant only. Do not "fix" those
  list/open queries by switching the match to `company_id`; drop the
  company predicate so only `created_by` + `survey_admin_access` remain.
- **Surveyor profile phone format** is enforced in the UI (`+91` + 10
  digits) but not in `POST`/`PATCH /api/users`.
- **`GET /api/users` still returns full photo/Aadhaar blobs.** Fine for
  the ID columns; do not use it as a notification poll.

## Rule for whoever edits this file next (human, Claude, Grok, anyone)

If your change touches `ensureSchema()`, `adminFormKeyScope`, any
`hasPower()` call site, any `/api/companies*` route,
`/api/notifications*`, field-app **My activity** grouping, or
`GET /api/progress/me`: update the relevant section above **in the same
change**. If you're about to reintroduce something listed as "Settled"
above, stop and re-read the "Why" column first — it was tried and
reverted for a specific reason, not by accident.
