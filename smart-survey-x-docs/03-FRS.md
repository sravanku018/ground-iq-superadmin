# Smart Survey X — Functional Requirements Specification (FRS)

**Version:** 1.0 (Locked)
**Depends on:** `01-PRD.md`, `02-BRS.md`
**Feeds into:** `05-SYSTEM-DESIGN.md`, `06-DATABASE-DESIGN.md`, `07-API-SPEC.md`

---

## 0. Format

Each functional requirement is `FR-<MODULE>-<NUM>`, states a testable behavior, traces to a `BR-xxx`, and notes which app surface it applies to (Admin Portal / Surveyor App / Backend-only). Code agents: implement exactly the stated behavior; if a requirement is ambiguous, log it in `13-ADR-LOG.md` rather than guessing silently.

---

## MODULE: Authentication

**FR-AUTH-01** (BR-060) — System supports email+password login for Admin Portal users (Super Admin, Client Admin) issuing a short-lived access token + refresh token.

**FR-AUTH-02** (BR-060) — Surveyor App supports login with credentials issued by Client Admin; session is cached on-device to survive offline periods (configurable TTL, default 14 days).

**FR-AUTH-03** (BR-060) — All tokens are JWT, carry `user_id`, `tenant_id`, `role`, and expiry; server validates signature + expiry on every request.

**FR-AUTH-04** — Password reset flow via emailed time-limited token (Admin Portal only; Surveyor accounts are reset by their Client Admin).

**FR-AUTH-05** — Failed login attempts are rate-limited (lockout after 5 failures / 15 min per account).

## MODULE: Tenant Management

**FR-TEN-01** (BR-002) — Super Admin creates a tenant with: name, status (active/suspended), default locale/timezone, **and** the tenant's first Client Admin (Main) account (name, email, phone) in the same workflow. A tenant cannot exist without exactly one Client Admin (Main).

**FR-TEN-02** (BR-001) — Suspending a tenant blocks all login for that tenant's users (Client Admin Main/Sub, Dashboard Viewer, Surveyor) without deleting data.

**FR-TEN-03** (BR-001) — Every tenant-scoped table row carries a non-nullable `tenant_id`; every query touching such a table is filtered by the requesting user's `tenant_id` at the service layer (defense in depth: also enforced via Postgres row-level security — see `05-SYSTEM-DESIGN.md` §Tenant Isolation).

**FR-TEN-04** (BR-004, BR-005) — Tenant record stores `sub_admin_limit` (default 2) and `dashboard_viewer_limit` (default 2). Account-creation endpoints for Sub Admin / Dashboard Viewer enforce these limits by counting active accounts of that role for the tenant before allowing creation.

**FR-TEN-05** (BR-003) — Super Admin has a monitoring view listing all tenants with high-level activity metrics (active campaigns, total surveyors, submission volume, pending seat-upgrade requests) without exposing individual survey answer content.

**FR-TEN-06** (BR-006) — Seat-limit upgrade requests are a tenant-scoped entity: `requested_by`, `role_type` (sub_admin/dashboard_viewer), `requested_limit`, `reason`, `status`, `reviewed_by`, `reviewed_at`. Approval mutates `sub_admin_limit`/`dashboard_viewer_limit` on the tenant record.

## MODULE: User Management

**FR-USR-01** (BR-004) — Client Admin (Main or Sub) can create/deactivate Surveyor accounts within their own tenant.

**FR-USR-02** (BR-004) — Client Admin (Main) can create Sub Admin accounts within their own tenant, up to the tenant's Sub Admin seat limit (default 2). Sub Admin accounts cannot create other Sub Admin, Client Admin, or Dashboard Viewer accounts (enforced server-side by role check, not just hidden in UI).

**FR-USR-03** — User profile stores: name, contact, role, tenant_id, status, last_login_at.

**FR-USR-04** — Deactivating a Surveyor immediately blocks new logins but does not delete their historical submissions.

**FR-USR-05** (BR-035) — Surveyor profile additionally stores: profile photo, government ID/authorized proof (type + reference), and a platform-issued unique Surveyor ID (immutable once assigned).

**FR-USR-06** (BR-035) — Surveyor profile fields are editable only via Client Admin (Admin Portal); the Surveyor App profile screen renders these fields as read-only, with no edit affordance in the UI and no corresponding write permission on the API for the `surveyor` role.

**FR-USR-07** (BR-036, BR-044) — Surveyor App provides an Activity Log screen listing the surveyor's own submitted records (record ID, campaign name, submitted timestamp, review status). Tapping a record shows only this metadata — the API does not return answer/evidence payloads to the `surveyor` role for already-submitted records under any endpoint. The **one exception** is a `rejected` record with `attempt_number = 1`, which additionally shows a Resubmit action (per `04-BUSINESS-RULES.md` §1.4) — this still does not expose the rejected record's own answers/evidence, it only offers starting a new linked record.

**FR-USR-08** (BR-005) — **Only** Client Admin (Main) can create Dashboard Viewer accounts within their own tenant, up to the tenant's Dashboard Viewer seat limit (default 2). A Sub Admin invoking this endpoint receives 403 regardless of remaining seat capacity.

**FR-USR-09** (BR-005) — Dashboard Viewer role has read-only permissions enforced server-side: any request to a create/update/delete or export endpoint (surveys, campaigns, users, assignments, review actions, data export) from a `dashboard_viewer` role token returns 403, regardless of UI state.

**FR-USR-10** (BR-006) — Client Admin (Main) can submit a seat-limit upgrade request (`sub_admin` or `dashboard_viewer`, desired new limit, optional reason) which is queryable by status (`pending`/`approved`/`denied`). Only Super Admin can approve/deny; approval updates the tenant's stored limit immediately.

**FR-USR-11** (BR-007) — The platform supports up to 3 Super Admin accounts, created by an existing Super Admin (bootstrap: first Super Admin account is provisioned via deployment/seed script, not through the app itself — see `12-DEPLOYMENT.md`). All Super Admin accounts have identical permissions; no role field distinguishes them beyond `role = super_admin`.

## MODULE: Question Bank

**FR-QB-01** (BR-010, BR-040a) — A question entity stores: text, input type (drawn from the closed set: `text_short` / `text_long` / `number` / `single_select` / `multi_select` / `date` / `date_time` / `scale` / `yes_no` / `gps` / `photo` / `audio`), options (for select types), and the full metadata block defined in PRD §7. No custom/free-form input type may be created via the Survey Builder UI or API in MVP.

**FR-QB-02** (BR-010) — Questions can be marked **global** (Super Admin authored, available to all tenants) or **tenant-owned** (Client Admin authored, private to their tenant).

**FR-QB-03** (BR-010) — Cloning a global question into a tenant's survey creates a tenant-local copy; edits to the copy never mutate the global original.

**FR-QB-04** (BR-011) — Questions are individually versioned; a template version pins exact question versions it uses.

## MODULE: Survey Builder

**FR-SB-01** (BR-010) — Client Admin can create a Survey Template: name, description, election-type tag (MLA/MP/Municipal/District/State/Generic), list of questions with per-template display order.

**FR-SB-02** (BR-010) — Survey Builder UI supports drag-and-drop question ordering, inline metadata editing (see PRD §7 fields), and live preview of the form as a surveyor would see it.

**FR-SB-03** (BR-041) — Conditional visibility rules are authored referencing other question IDs within the same template (`show_if question_id = value`); builder validates no circular references at save time.

**FR-SB-04** (BR-011) — "Publish" action is a single transaction: creates immutable template version snapshot → generates dashboard config → generates analytics config → marks template version as `published`. If any step fails, the whole publish is rolled back and the admin sees a specific error.

**FR-SB-05** (BR-011) — Previously published versions remain viewable (read-only) for audit/reference even after a new version is published.

## MODULE: Campaign

**FR-CMP-01** (BR-020) — Client Admin creates a Campaign referencing one published Survey Template version, with: name, start date, end date, target geography scope, status (draft/active/paused/closed).

**FR-CMP-02** (BR-021) — Campaign supports geography scope definition (list of constituencies/districts/booths) used both for assignment filtering and analytics rollups.

**FR-CMP-03** — Pausing a campaign stops new submissions from that campaign from being accepted server-side (mobile app shows a "campaign paused" state) but does not affect already-submitted data.

## MODULE: Assignment

**FR-ASG-01** (BR-020, BR-021) — Client Admin assigns one or more Surveyors to a Campaign, optionally scoped to a sub-territory within the campaign's geography.

**FR-ASG-02** — On assignment creation, the campaign+template version is queued for that surveyor's next app sync.

**FR-ASG-03** — Reassigning/unassigning a surveyor stops new campaign data from appearing in their app on next sync, but does not retroactively delete already-downloaded local drafts (those must still be submittable, then the campaign disappears from their active list).

**FR-ASG-04** (BR-022) — Client Admin can, at any time, from a single assignment-management view: add a surveyor to a survey form's assignment, remove a surveyor, or reassign a surveyor from one survey form/campaign to a different one — all as direct mutations to the assignment entity, without requiring a new Campaign to be created for the change.

**FR-ASG-05** (BR-022) — Every add/remove/reassign action is audit-logged (FR-AUD-01) with the specific admin actor, the surveyor affected, and the old/new campaign reference.

## MODULE: Evidence

**FR-EVD-01** (BR-032, BR-034) — Evidence records (GPS, photo, audio) are linked to a specific record (submission). Photo and GPS are captured at **record start** (before any question is shown) and are root-level record evidence; audio is captured across the interview duration and is also root-level record evidence (not per-question) unless a specific question additionally requires its own photo/audio per its metadata (PRD §7), in which case that question's evidence is linked to the question within the record.

**FR-EVD-02** (BR-032) — Media files are uploaded to Cloudflare R2 in **separate key prefixes/buckets for audio vs. images** (e.g. `audio/{tenant_id}/{record_id}/...` and `images/{tenant_id}/{record_id}/...`); the database stores only the object key/URL + metadata (size, mime type, capture timestamp, checksum) for each, cross-referenced to the same record so both are retrievable together in one query.

**FR-EVD-03** (BR-034) — On starting a new record, the app immediately triggers photo capture and GPS capture; both are locked (write-once) the moment capture succeeds, before the form's first question is rendered. Audio recording auto-starts at the same point and continues (with pause/resume for the surveyor's own workflow, not evidence deletion) until the surveyor submits.

**FR-EVD-04** (BR-033) — Pre-submission (while in Drafts, post-pause), the Surveyor App allows the surveyor to play back the recorded audio while filling form fields, and to re-record audio or retake the photo, which overwrites the local draft's evidence reference. Once overwritten, the new take becomes the locked take following the same immediate-lock rule.

**FR-EVD-05** (BR-032) — On submission finalize, each evidence file's checksum (SHA-256) is computed and stored; any subsequent request to modify a finalized submission's evidence is rejected at the API layer (403) for all roles including Client Admin — review is read/listen-only, never edit.

**FR-EVD-06** — GPS capture failure (no signal) at record start blocks record creation locally with a clear message and retry option; a record cannot be started without a successful GPS + photo capture (this evidence pair is always mandatory at the record level, independent of per-question GPS/photo metadata flags).

**FR-EVD-07** (BR-037) — Every record is assigned a composite Record ID (`{campaign_code}-{sequence}`) at creation time, generated server-side on first successful sync (client may hold a temporary local draft ID beforehand) to guarantee platform-wide uniqueness.

**FR-EVD-08** (BR-038) — Every record stores a system-generated stamp timeline: `captured_at`, `paused_at`/`resumed_at` (array, supports multiple pause cycles), `submitted_at`, `synced_at`, `reviewed_at`. All stamps are set by the server/device clock at the relevant lifecycle transition, never accepted as client-supplied editable values, and are surfaced in the Review UI (FR-REV-02) and Reports.

**FR-EVD-09** (BR-039) — All template/question metadata for a surveyor's assigned campaigns is cached to local device storage on sync and used for rendering + client-side validation with zero live network calls during form-filling. Media capture (photo/audio) is written to local device storage immediately and queued for background upload independently of the form-filling UI thread.

**FR-EVD-10** (BR-039) — Record submission is a local state transition (`draft` → `submitted_locally`) that succeeds regardless of connectivity; a background sync worker uploads queued submissions with retry/exponential backoff, and the app displays a per-record sync status (`queued` / `syncing` / `synced` / `sync_failed_retrying`) rather than silently failing.

## MODULE: Review

**FR-REV-01** (BR-042) — A record's `review_status` field (`pending_review` / `approved` / `rejected`) gates analytics visibility: only `approved` records are included in any analytics aggregation or dashboard query.

**FR-REV-02** (BR-043) — Client Admin Review screen displays, for one record at a time: all typed answers (grouped by question, in template order), the locked photo, the locked GPS pin on a small map, and an inline audio player for the locked audio — all sourced from the same Record ID.

**FR-REV-03** (BR-043) — Review screen provides Approve and Reject actions. Reject requires a free-text reason (min length enforced) before submission of the review decision.

**FR-REV-04** (BR-044) — On Reject, the record's status and reason are written back such that the originating surveyor's Activity Log (FR-USR-07) displays "Rejected" plus the reason, read-only, **with a Resubmit action** that starts a new linked record (`original_record_id` set, `attempt_number` incremented) per the resubmission flow in `04-BUSINESS-RULES.md` §1.4. A record already at `attempt_number = 2` that is rejected again shows no further Resubmit action ("Rejected (Final)").

**FR-REV-06** — Review screen, when opening a record with `attempt_number = 2`, displays the original rejection reason alongside the current submission for reviewer context.

**FR-REV-05** — Review actions are themselves audit-logged (actor, record ID, decision, reason if rejected, timestamp) per FR-AUD-01.

## MODULE: Validation

**FR-VAL-01** (BR-040) — A shared validation rule definition (JSON schema per question, generated from question metadata) is used identically by: (a) Flutter client-side validation, (b) FastAPI server-side validation on sync. Rule definitions live in one place (template version snapshot) and are fetched by the client, not duplicated/hardcoded in Dart.

**FR-VAL-02** (BR-040) — Validation errors returned by the API are question-level: `{question_id, error_code, message}`, not a single generic failure.

**FR-VAL-03** (BR-041) — Skip-logic (conditional visibility) evaluation must produce identical shown/hidden state given the same answer set, whether evaluated on-device or server-side (same rule engine logic, ported deliberately — see `04-BUSINESS-RULES.md`).

## MODULE: Processing

**FR-PRC-01** (BR-045, BR-042) — A submission's lifecycle status is: `syncing` → `synced` (structural validation passed, real-time) → `pending_review` → (Client Admin decision) → `approved` | `rejected`. Only `approved` records proceed to analytics eligibility. See `17-ANALYTICS-PROCESSING-SEQUENCE.md` for the exact approve path.

**FR-PRC-02** (BR-046) — **Fact materialization** (insert into `record_facts`) runs as a **Processing module service call** invoked from the Review approve path (same or immediately following transaction). It is idempotent (`ON CONFLICT DO NOTHING`). Continuous-aggregate **refresh** remains a scheduled background job (default daily via Timescale policy; per-campaign override via `campaigns.aggregation_refresh_interval` + Celery Beat). The scheduled job does **not** re-scan raw records to build facts.

**FR-PRC-03** — Structural validation (FR-VAL-01/02) and media upload handling are processed by a background worker (queue-based) at sync time, not inline in the sync HTTP request, so large media uploads don't block the API response — this is real-time-ish (seconds, not end-of-day) and distinct from fact materialization and continuous-aggregate refresh.

**FR-PRC-04** — Failed fact materialization after a successful approve sets `fact_status='failed'` (record remains `status='approved'`). The record is visible to Client Admin for retry and is **excluded** from dashboards until `fact_status='materialized'`. Failed structural processing at sync time remains a separate path that prevents the record from reaching `pending_review`.

**FR-PRC-05** (BR-046) — Fact materialization and continuous-aggregate refresh are both idempotent. Re-running materialization does not double-insert. Re-running refresh does not double-count. A watermark (`campaigns.last_analytics_refresh_at` or equivalent) is updated after successful refresh and exposed as `data_as_of` on dashboard responses.

**FR-PRC-06** — Processing exposes a service interface `materialize_fact(record_id)` callable only from the Review module (and from the retry worker). Analytics module may only **read** `record_facts` / continuous aggregates, never write them.

## MODULE: Analytics

**FR-ANL-01** (BR-050, BR-012, BR-050a) — Analytics configuration is auto-derived from template metadata at publish time: each question flagged `analytics_filter=true` becomes a dashboard filter; each flagged with a `chart_type` becomes a widget. This auto-derivation is what creates the survey's dashboard — no separate manual dashboard-creation step exists in the Client Admin workflow.

**FR-ANL-02** (BR-051) — Election-type templates (MLA/MP/Municipal/District/State) each ship a default widget set defined in `09-ANALYTICS-SPEC.md`.

**FR-ANL-03** (BR-050, BR-050b) — Dashboard supports drill-down and multi-filter combination: selecting any combination of available filters (geography unit, metadata-flagged questions, date range, surveyor, review status) re-queries and re-renders all widgets on that dashboard scoped to the combined filter, client-side filter state persisting across widget re-renders (no full page reload).

**FR-ANL-04** — Analytics visibility is driven by `record_facts` (populated on approve via FR-PRC-02). Continuous aggregates refresh incrementally (Timescale policy or campaign override). Dashboard responses always include `data_as_of` (FR-DSH-03).

**FR-ANL-05** (BR-050a) — Each survey template, on publish, is assigned a dedicated dashboard record named after the survey (editable display name, immutable link to the template). One dashboard per survey/campaign is the default; the dashboard is queryable immediately once any records reach `approved` status (FR-PRC-01).

## MODULE: Dashboard

**FR-DSH-01** (BR-012) — Dashboard layout (widget positions) has a sensible auto-generated default; Client Admin can rearrange widgets (drag/resize), persisted per-campaign / per-template version.

**FR-DSH-02** — Dashboard always includes system widgets: submissions KPI, Surveyor Performance (submissions per surveyor, avg completion time, evidence completeness rate), and map (choropleth or pins). See `09-ANALYTICS-SPEC.md` §3.

**FR-DSH-03** — Every dashboard data response includes `data_as_of` (timestamp of last successful analytics refresh or max approved_at in the underlying data). The UI must display this freshness indicator. If lag exceeds 2× the expected refresh interval, a non-blocking warning chip is shown.

**FR-DSH-04** — Dashboard widgets support explicit states: loading, empty (zero approved facts for current filters), degraded (e.g. map without boundary data), and error. Empty is distinct from loading and from error — copy must explain "No approved records yet" when the campaign is live but nothing is approved.

## MODULE: GIS

**FR-GIS-01** (BR-050, BR-050c) — Dashboard supports a map widget that plots submissions by GPS coordinate (pin view) and/or shades by geography unit (choropleth) using **GeoJSON boundary data** (source: TBD, pluggable provider — see PRD §13).

**FR-GIS-02** (BR-050c) — Map widget must degrade gracefully (list/table or pin-only view) if GeoJSON boundary data for a given geography type is not yet configured, rather than erroring the whole dashboard.

**FR-GIS-03** (BR-050c) — Choropleth shading value is driven by the current dashboard filter selection (FR-ANL-03) — e.g. shading by approved-submission count, or by an aggregated metric from a metadata-flagged question — recalculated as filters change.

## MODULE: Reports

**FR-RPT-01** (BR-052) — Client Admin can generate a PDF export of any dashboard view, capturing current filter state and a generation timestamp.

**FR-RPT-02** — PDF generation is asynchronous (background job) for large datasets; Client Admin is notified in-app when ready to download.

## MODULE: Notifications

**FR-NOT-01** — Notification module is provider-agnostic (interface-based); MVP ships with in-app notifications only. SMS/push/email providers are pluggable, not hardcoded (see PRD §13, open question).

**FR-NOT-02** — Surveyor is notified in-app when newly assigned to a campaign (next app open/sync).

## MODULE: Audit

**FR-AUD-01** (BR-061) — Every template publish, campaign create/pause/close, assignment change (add/remove/reassign), account creation (Sub Admin, Dashboard Viewer, Surveyor), seat-limit request/decision, data export, review decision, and cross-tenant access attempt is written to an append-only audit log: **specific actor account id** (not just role), actor role, tenant_id (null for Super Admin platform-level actions), action, entity_type, entity_id, timestamp, metadata.

**FR-AUD-02** (BR-061) — Audit log is queryable, filterable by actor/date/action/entity, by: **Super Admin** (platform-wide, all tenants) and **Client Admin (Main or Sub)** (their own tenant's actors only — i.e. a Client Admin (Main) can see which specific Sub Admin performed which action within their tenant).

**FR-AUD-03** (BR-061) — Audit log entries are immutable (no update/delete API) and attributed at write time from the authenticated actor's token, never from a client-supplied "acted as" field.

## MODULE: Data Export

**FR-EXP-01** (BR-062) — Super Admin can request a structured data export for a selected tenant: an async job producing a downloadable file (CSV or JSON) containing that tenant's records — flattened answers per record, plus evidence reference URLs/keys (not binary media, not raw SQL).

**FR-EXP-02** (BR-063) — Client Admin (Main or Sub) can request the same structured export, with the tenant scope implicitly fixed to their own `tenant_id` — no tenant selector is exposed, and the API rejects any attempt to pass a different tenant_id (403).

**FR-EXP-03** — Export excludes platform-internal data (user credentials, other tenants' seat-limit/upgrade-request records, cross-tenant audit entries) even within the exporting tenant's own scope.

**FR-EXP-04** (BR-061) — Every export request is audit-logged per FR-AUD-01 (actor, tenant exported, timestamp, format).

**FR-EXP-05** — Export is asynchronous (background job) for large tenants; requester is notified in-app when the file is ready, with a time-limited download link.

---
*Next document: `04-BUSINESS-RULES.md` (Validation & Business Logic Rules Engine)*
