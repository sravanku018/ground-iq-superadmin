# Smart Survey X — API Specification

**Version:** 1.0 (Locked)
**Depends on:** `03-FRS.md`, `04-BUSINESS-RULES.md`, `06-DATABASE-DESIGN.md`
**Style:** REST over HTTPS, JSON bodies, OpenAPI-generatable from FastAPI (per System Design §1a)

---

## 0. Conventions

- Base path: `/api/v1`
- Auth: `Authorization: Bearer <JWT>` on every endpoint except `POST /auth/login`, `POST /auth/refresh`, `GET /health`.
- `tenant_id` is **never** accepted as a request parameter for tenant-scoped endpoints — it is derived server-side from the JWT (System Design §3). Any endpoint below marked "(tenant-scoped)" follows this rule implicitly.
- Standard error shape:
```json
{ "error_code": "VALIDATION_FAILED", "message": "...", "details": [ { "question_id": "q_042", "error_code": "OUT_OF_RANGE", "message": "..." } ] }
```
- Pagination: `?page=1&page_size=50` (default 50, max 200), response envelope `{ "items": [...], "page": 1, "page_size": 50, "total": 412 }`.
- All list endpoints support filtering via query params documented per-endpoint; unknown query params are ignored, not errored.

---

## 1. Authentication

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/auth/login` | any | `{email/phone, password}` → `{access_token, refresh_token, user}` (FR-AUTH-01/02) |
| POST | `/auth/refresh` | any | `{refresh_token}` → new `access_token` |
| POST | `/auth/logout` | authenticated | invalidates refresh token |
| POST | `/auth/password-reset/request` | any | Admin Portal only (FR-AUTH-04) |
| POST | `/auth/password-reset/confirm` | any | `{token, new_password}` |

---

## 2. Tenant Management (Super Admin)

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/tenants` | super_admin | Creates tenant + first Client Admin (Main) in one call (FR-TEN-01). Body: `{tenant: {...}, main_admin: {name, email, phone}}` |
| GET | `/tenants` | super_admin | List all tenants with activity summary (FR-TEN-05) |
| GET | `/tenants/{id}` | super_admin | Full tenant detail |
| PATCH | `/tenants/{id}` | super_admin | Update status (suspend/activate), locale, timezone |
| GET | `/tenants/{id}/seat-limit-requests` | super_admin | List pending/all requests for a tenant |
| POST | `/seat-limit-requests/{id}/approve` | super_admin | (FR-USR-10) |
| POST | `/seat-limit-requests/{id}/deny` | super_admin | |

## 3. User Management

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/users/sub-admins` | client_admin_main | Enforces seat limit (FR-USR-02) |
| POST | `/users/dashboard-viewers` | client_admin_main **only** | 403 for sub admin (FR-USR-08) |
| POST | `/users/surveyors` | client_admin_main, client_admin_sub | Includes profile fields §2.2 (FR-USR-01/05) |
| GET | `/users` | client_admin_main, client_admin_sub | tenant-scoped list, filter by role |
| PATCH | `/users/{id}` | client_admin_main, client_admin_sub | Cannot change `role`; surveyor profile fields editable here only (FR-USR-06) — role check rejects if `id` belongs to a surveyor and requester is not admin |
| PATCH | `/users/{id}/deactivate` | client_admin_main, client_admin_sub | (FR-USR-04) |
| POST | `/seat-limit-requests` | client_admin_main | Submit upgrade request (FR-USR-10) |
| GET | `/me` | authenticated | Current user profile (surveyor sees own read-only profile, FR-USR-06/BR-035) |

## 4. Question Bank

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/questions` | super_admin (global), client_admin_main/sub (tenant) | `is_global` forced `true` only for super_admin (FR-QB-02) |
| GET | `/questions` | client_admin_main/sub | Returns global + own-tenant questions |
| POST | `/questions/{id}/clone` | client_admin_main/sub | Clones a global question into tenant scope (FR-QB-03) |
| POST | `/questions/{id}/versions` | owner role | New version (FR-QB-04) |

## 5. Survey Builder

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/survey-templates` | client_admin_main/sub | (FR-SB-01) |
| PATCH | `/survey-templates/{id}` | client_admin_main/sub | Only while `status=draft` |
| POST | `/survey-templates/{id}/questions` | client_admin_main/sub | Add/reorder/configure metadata (FR-SB-02) |
| POST | `/survey-templates/{id}/publish` | client_admin_main/sub | Atomic transaction: snapshot + dashboard + analytics config (FR-SB-04). Returns the new `survey_template_version` and created `dashboard` |
| GET | `/survey-templates/{id}/versions` | client_admin_main/sub | Read-only history (FR-SB-05) |
| GET | `/survey-templates/{id}/preview` | client_admin_main/sub | Renders the form as the Surveyor App would (mirrors mobile rendering, per UX spec §4.3) |

## 6. Campaign & Assignment

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/campaigns` | client_admin_main/sub | References a published template version (FR-CMP-01) |
| GET | `/campaigns` | client_admin_main/sub, dashboard_viewer (read-only) | |
| PATCH | `/campaigns/{id}/status` | client_admin_main/sub | pause/resume/close (FR-CMP-03) |
| GET | `/campaigns/{id}/assignments` | client_admin_main/sub | Assignment Manager matrix view (UX §4.4) |
| POST | `/campaigns/{id}/assignments` | client_admin_main/sub | Add surveyor(s) (FR-ASG-01/04) |
| DELETE | `/assignments/{id}` | client_admin_main/sub | Remove (FR-ASG-04) |
| POST | `/assignments/{id}/reassign` | client_admin_main/sub | Body: `{new_campaign_id}` (FR-ASG-04/05) |

## 7. Surveyor Sync (Flutter app — per System Design §4)

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/sync/campaigns` | surveyor | Returns new/changed assignments + template versions since last pull (delta sync) |
| POST | `/sync/records` | surveyor | Idempotent upsert via `local_draft_id` (System Design §4.2). Runs structural validation synchronously in the request path only for the fast checks; heavier media handling is async |
| POST | `/sync/records/{id}/evidence/upload-url` | surveyor | Returns pre-signed R2 upload URL for photo/audio (System Design §4.2) |
| POST | `/sync/records/{id}/evidence/confirm` | surveyor | Confirms upload complete; triggers checksum finalize job |
| GET | `/sync/review-status` | surveyor | Pull-back of approved/rejected outcomes for own records (System Design §4.3) |
| GET | `/surveyor/activity-log` | surveyor | Metadata-only list (FR-USR-07); does not return answers/evidence |
| POST | `/records/{id}/resubmit` | surveyor | Starts new linked record per Business Rules §1.4 — only valid if `status=rejected AND attempt_number=1` |

## 8. Evidence & Review

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/records/{id}` | client_admin_main/sub | Full record: answers + evidence + stamps (FR-REV-02). 403 for surveyor role (FR-USR-07 boundary) |
| GET | `/records` | client_admin_main/sub, dashboard_viewer (read-only, approved only) | Filterable by status/campaign/surveyor/date |
| GET | `/records/{id}/audio` | client_admin_main/sub | Streams/returns signed URL for audio playback |
| POST | `/records/{id}/review/approve` | client_admin_main/sub | (FR-REV-03). Response includes `{status:'approved', fact_status:'materialized'|'failed', fact_error?}`. Approve commits even if materialization fails. |
| POST | `/records/{id}/review/reject` | client_admin_main/sub | Body requires `{reason}` (FR-REV-03/BR-043) |

## 9. Analytics, Dashboard, GIS

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/dashboards/{id}` | client_admin_main/sub, dashboard_viewer | Layout + widget configs (FR-DSH-01) |
| PATCH | `/dashboards/{id}/layout` | client_admin_main/sub | Persist rearranged widgets |
| GET | `/dashboards/{id}/data` | client_admin_main/sub, dashboard_viewer | Query params = active filters (BR-050b). Response envelope per widget: `{widget_id, type, title, data_as_of, filters_applied, payload, empty, degraded, degraded_reason?}`. Reads continuous aggregates / `record_facts` only (System Design §6, Analytics Spec §5). |
| POST | `/records/{id}/retry-fact` | client_admin_main/sub | Re-run fact materialization for `fact_status='failed'` records (FR-PRC-04). Idempotent. |
| GET | `/geo-boundaries` | client_admin_main/sub, dashboard_viewer | Filter by `geo_type`; used for choropleth rendering (FR-GIS-01) |

## 10. Reports & Data Export

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/reports/export` | client_admin_main/sub | Body: `{dashboard_id, filters}` → async job (FR-RPT-01/02) |
| GET | `/reports/export/{job_id}` | client_admin_main/sub | Poll status, get download link when ready |
| POST | `/data-export` | super_admin (any tenant, `{tenant_id}` required in body), client_admin_main/sub (own tenant implicit, no `tenant_id` field accepted) | (FR-EXP-01/02) |
| GET | `/data-export/{job_id}` | matching requester role | Poll status/download |

## 11. Notifications & Audit

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/notifications` | authenticated | Own notifications |
| PATCH | `/notifications/{id}/read` | authenticated | |
| GET | `/audit-log` | super_admin (platform-wide), client_admin_main/sub (own tenant's actors only) | (FR-AUD-02) |

---

## 12. Key Cross-Cutting Behaviors for Code Agents

1. **Validation errors are always question-level** (FR-VAL-02) — `POST /sync/records` never returns a bare "invalid" with no detail; the `details` array in the error shape (§0) is mandatory whenever `error_code=VALIDATION_FAILED`.
2. **Role checks are server-side on every endpoint**, never inferred from the client hiding a button. Every table in this document's "Role" column is the authoritative permission list — a code agent implementing an endpoint must add the role guard even if no test currently exercises the negative case.
3. **`dashboard_viewer` is read-only everywhere** — any POST/PATCH/DELETE endpoint in this spec implicitly excludes `dashboard_viewer` even where not explicitly written; only GET endpoints marked with `dashboard_viewer` in the Role column are accessible to that role.
4. **Async job endpoints** (`/reports/export`, `/data-export`) always return `202 Accepted` with a job id immediately — never block the HTTP response on the underlying work (System Design §7).

---
*Next document: `09-ANALYTICS-SPEC.md` (Dashboard & Analytics Configuration)*
