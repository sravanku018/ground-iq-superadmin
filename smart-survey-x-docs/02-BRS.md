# Smart Survey X — Business Requirements Specification (BRS)

**Version:** 1.0 (Locked)
**Depends on:** `01-PRD.md`
**Feeds into:** `03-FRS.md`, `04-BUSINESS-RULES.md`

---

## 0. Purpose

This document translates the PRD's product goals into numbered business requirements (`BR-xxx`), each with an acceptance criterion. Every functional requirement in `03-FRS.md` must trace back to a `BR-xxx` here. Code agents should treat a `BR` as non-negotiable business intent — implementation details are theirs to decide, but the outcome described must hold.

---

## 1. Tenant & Account Management

**BR-001** — The platform must support multiple independent client organizations (tenants) on shared infrastructure.
*Acceptance:* A Super Admin can create a new tenant; a Client Admin under Tenant A can never read, list, or infer the existence of Tenant B's data through any API response, error message, or ID enumeration.

**BR-002** — Only Super Admin can create a new tenant, and creating a tenant creates its first Client Admin (Main) account in the same action.
*Acceptance:* No API/UI path allows a Client Admin (Main or Sub) to create a new tenant or a second "Main" admin for their own tenant.

**BR-003** — Super Admins manage the global Question Bank templates and platform-wide configuration, and can provision/suspend tenants, and monitor all tenants' high-level activity (e.g. campaign counts, submission volume) without accessing tenant survey answer content.
*Acceptance:* Only Super Admin role can create/edit global (cross-tenant) question templates; tenant-specific question customization does not alter the global template. Super Admin dashboard lists all tenants with activity summaries.

**BR-004** — A Client Admin (Main) can create up to a tenant-configured limit (default 2) of Sub Admin accounts. Sub Admins have the same operational permissions as Client Admin (Main) — surveys, campaigns, surveyors, review/approval, tenant data export — **except** they cannot create Client Admin, Sub Admin, **or Dashboard Viewer** accounts.
*Acceptance:* Creating a 3rd Sub Admin (at default limit) is rejected with a clear "seat limit reached" error; a Sub Admin attempting to create another Sub Admin or a Dashboard Viewer is rejected with a 403 regardless of seat availability.

**BR-005** — **Only** a Client Admin (Main) can create Dashboard Viewer accounts, up to a tenant-configured limit (default 2). Dashboard Viewers have read-only access to their tenant's dashboards/analytics only — no create/edit/delete on surveys, campaigns, users, or records, and no report/data export.
*Acceptance:* A Sub Admin attempting to create a Dashboard Viewer receives 403. A Dashboard Viewer session can view a dashboard but every mutating or export endpoint returns 403 for that role.

**BR-006** — Seat limit upgrades (more Sub Admins or Dashboard Viewers) follow a request-and-approval workflow: Client Admin (Main) submits a request with desired new limit; Super Admin approves or denies. No payment/billing processing is part of the MVP system.
*Acceptance:* An approved request immediately raises the tenant's stored limit, permitting the next account creation up to the new limit; a denied or pending request leaves the limit unchanged and the requester sees the current status.

**BR-007** — The platform supports up to 3 Super Admin accounts platform-wide, all with identical full permissions (no owner/primary distinction).
*Acceptance:* Any of the up-to-3 Super Admin accounts can perform any Super Admin action (tenant creation/suspension, seat-limit approval, cross-tenant data export, global question bank management) with no permission difference between them.

## 2. Question Bank & Survey Template

**BR-010** — Client Admins must be able to build a survey from reusable questions without engineering involvement.
*Acceptance:* A Client Admin can create a new survey template, add questions (new or from bank), configure metadata (validation, visibility, evidence requirements), and publish it — entirely through the Admin Portal UI, no API calls or code changes required.

**BR-011** — Survey templates must be versioned; publishing changes creates a new version rather than mutating history.
*Acceptance:* A campaign always references a specific, immutable template version. Editing a template after a campaign is live does not alter that campaign's live version.

**BR-012** — Publishing a template must automatically produce a working dashboard and analytics configuration.
*Acceptance:* Within 5 minutes of the first submission syncing, a dashboard is viewable for the campaign with no manual dashboard-building step.

## 3. Campaign & Assignment

**BR-020** — A Client Admin must be able to create a campaign from a published template and assign it to one or more surveyors.
*Acceptance:* Assigned surveyors see the campaign in their app (once synced) and can begin submissions immediately.

**BR-021** — Assignments must support territory/geography scoping (e.g., a surveyor assigned to specific booths/constituencies).
*Acceptance:* A surveyor only sees campaigns/territories they've been assigned; Client Admin can filter analytics by assignment scope.

**BR-022** — Client Admin can add a surveyor to a survey form's assignment, remove a surveyor from it, or reassign a surveyor from one survey form to a different one, at any time, without creating a new campaign for each change.
*Acceptance:* Adding/removing/reassigning takes effect on the affected surveyor's next app sync; a surveyor removed or reassigned mid-cycle can still submit already-started local drafts for the prior form (per FR-ASG-03) but the prior form no longer appears as active for new records.

## 4. Data Collection (Surveyor)

**BR-030** — Surveyors must be able to complete and submit surveys with zero network connectivity.
*Acceptance:* Airplane-mode device, from login (previously cached session) through full survey completion and local save, works with no errors; sync occurs automatically once connectivity returns.

**BR-031** — In-progress survey data must never be lost due to app crash, device restart, or battery death.
*Acceptance:* Kill the app mid-survey at any field; relaunch; all previously entered answers are restored.

**BR-032** — Evidence (GPS, photo, audio) must be tamper-evident and immutable after capture.
*Acceptance:* No API or UI path exists, for any role, to edit GPS coordinates, timestamps, or replace photo media once captured, or replace audio once a record is submitted.

**BR-033** — Audio evidence must be reviewable by the surveyor before submission, but only locked/finalized at submission.
*Acceptance:* Surveyor can play back recorded audio and re-record before hitting Submit; after Submit, the audio file is fixed and a checksum/hash is stored.

**BR-034** — A new record must capture and lock photo + GPS immediately at record start, before any question is answered, and must auto-start audio recording at that point.
*Acceptance:* Attempting to answer a question before photo+GPS capture completes is not possible in the UI flow; audio recording indicator is active from record start through pause/submit.

**BR-035** — A surveyor's profile (photo, name, phone, government ID/authorized proof, unique Surveyor ID) is visible on login but not editable from the Surveyor App.
*Acceptance:* No UI control exists in the Surveyor App to modify any profile field; only Client Admin (via Admin Portal) can edit a surveyor's profile.

**BR-036** — A surveyor can view a list of their own submitted records (Activity Log) but cannot open, view, or edit the filled content/evidence of an already-submitted record.
*Acceptance:* Tapping a submitted record in Activity Log shows only status metadata (record ID, campaign, submitted date, review status) — not the answers, photo, GPS, or audio.

**BR-037** — Every record has a human-traceable unique Record ID composed of the Campaign/Survey identifier and a record sequence.
*Acceptance:* Record IDs follow a consistent, documented format (e.g. `<CAMPAIGN_CODE>-<SEQUENCE>`) and are unique platform-wide.

**BR-038** — Every record carries a full, system-generated, immutable timeline of data stamps (captured, paused/resumed, submitted, synced, reviewed), never editable by any role.
*Acceptance:* Client Admin Review UI and Reports display the complete stamp timeline for any record; no API path allows modifying a stamp value.

**BR-039** — The Surveyor App must never block data entry due to lack of connectivity; all form structure/validation is cached locally, media uploads are queued and asynchronous, and submission is a local-first action.
*Acceptance:* In airplane mode, a surveyor can complete and submit an entire survey, including pausing/resuming across app restarts; sync happens automatically and visibly once connectivity returns, without the surveyor needing to retry manually.

**BR-040a** — Question input types are drawn from a fixed, closed set defined by the platform (not free-form/custom types); the Surveyor App renders the correct native control per type.
*Acceptance:* A Client Admin building a survey selects an input type from a fixed dropdown; the corresponding field in the Surveyor App uses the appropriate native control (e.g. numeric keypad for number, calendar for date) — never a generic text box for a typed field.

**BR-041a** — The platform's native mobile app is Surveyor-only; Super Admin, Client Admin (Main/Sub), and Dashboard Viewer access the platform exclusively via a responsive web portal — no native admin/reviewer/viewer app is built.
*Acceptance:* No app-store listing or native build exists for any role other than Surveyor; all admin/review/dashboard-viewer workflows are verified functional on desktop and mobile-web browsers.

## 5. Validation & Processing

**BR-040** — Submitted data must be validated against the template's metadata-defined rules before being marked complete.
*Acceptance:* A submission violating a required-field or format rule is rejected with a specific, question-level error — not a generic failure.

**BR-041** — Conditional (skip-logic) questions must be evaluated consistently on both the mobile app (offline) and server (on sync) using the same rule definitions.
*Acceptance:* A question hidden by skip logic on-device is never flagged as "missing required field" server-side.

## 5a. Review & Approval Workflow

**BR-042** — A submitted record must not appear in analytics or dashboards until a Client Admin has reviewed and approved it.
*Acceptance:* Querying analytics endpoints/dashboards for a campaign never includes a record with review status other than `approved`.

**BR-043** — Review must let the Client Admin cross-check typed answers against the recorded audio and locked photo/GPS from within a single record view, then Approve or Reject with a reason.
*Acceptance:* Review screen plays audio, displays photo and GPS pin, and shows all answers together; Reject requires a non-empty reason, stored with the record.

**BR-044** — Rejected records are surfaced back to the originating surveyor's Activity Log (view-only, with reason), and the surveyor is offered **exactly one resubmission attempt** as a fresh new record (not an edit of the rejected one), after which the flow is final.
*Acceptance:* Surveyor sees "Rejected" status, reason text, and a Resubmit action; tapping it starts a brand-new record (fresh evidence capture) linked to the original via `original_record_id`; if that second attempt is also rejected, no further Resubmit action is offered.

## 5b. Compute & Processing Strategy

**BR-045** — Structural validation (required fields, formats, evidence presence) runs at sync time, near-real-time, so broken records are caught immediately rather than discovered at day's end.
*Acceptance:* A sync with a missing required field is rejected in the sync response, not silently accepted and only caught later.

**BR-046** — Heavy analytics aggregation (dashboard rollups, GIS aggregates, trend computation) runs as a batched background process (default: end of day) rather than per-submission, to minimize database compute load, and is configurable to run more frequently per tenant/campaign if needed.
*Acceptance:* Under load testing, per-submission sync latency is not measurably affected by dashboard aggregation complexity; aggregation batch job is independently schedulable/configurable.

## 6. Analytics & Reporting

**BR-050** — Dashboards must support drill-down by geography and by any question flagged as filterable/groupable in its metadata.
*Acceptance:* Client Admin can filter a live dashboard by constituency/booth and by any eligible question without engineering changes.

**BR-050a** — Creating a new survey form must automatically create a corresponding, uniquely named dashboard for that survey, driven entirely by that survey's question metadata, with **no manual dashboard-building step** by the Client Admin. This is the platform's second-highest priority capability after the core submission loop.
*Acceptance:* Immediately after a survey is published (and first data syncs/is approved per BR-042), a dashboard named after the survey exists and is populated with metadata-derived filters and widgets without any additional configuration action.

**BR-050b** — Dashboard results must re-render live based on whichever combination of available filters the Client Admin selects (geography, metadata-flagged questions, date range, surveyor, review status).
*Acceptance:* Changing any filter selection updates all widgets on the dashboard (KPIs, charts, map) to reflect only the filtered record set, without a page reload losing other filter selections.

**BR-050c** — The map widget must support GeoJSON-based boundary visualization (choropleth by constituency/district/booth), not only raw GPS pin plotting.
*Acceptance:* Given configured GeoJSON boundary data for a geography type, the map widget renders a shaded boundary view reflecting the current filter's aggregated results; absent boundary data, it degrades to pin/list view (FR-GIS-02) rather than erroring.

**BR-051** — Election-specific analytics templates (MLA, MP, Municipal, District, State) must be available at MVP launch.
*Acceptance:* Creating a campaign under any of these five template types produces the correct pre-built widget set for that election type.

**BR-052** — Reports must be exportable as PDF.
*Acceptance:* Client Admin can export a dashboard/report view to a PDF file matching the on-screen data as of export time.

## 7. Security & Compliance

**BR-060** — All access must be authenticated and role-scoped; no anonymous access to tenant data.
*Acceptance:* Every API endpoint (except login/health) requires a valid session/token; role checks enforced server-side, not just hidden in UI.

**BR-061** — An audit trail must exist for sensitive actions (template publish, campaign assignment changes, submission access by non-owning roles, account creation, seat-limit decisions, data exports), attributed to the **specific individual account** that performed it — not merely its role.
*Acceptance:* Audit log entries are queryable by Super Admin (platform-wide) and by Client Admin (Main/Sub, scoped to their own tenant's actors), showing the exact actor account (e.g. "X2", "Super Admin #2"), action, timestamp, and affected entity. A Client Admin (Main) can distinguish which of their Sub Admins performed a given action.

**BR-062** — Super Admin can export a structured data download (records, answers, evidence references — not raw media, not a raw SQL/DB dump) for any tenant they select.
*Acceptance:* Export UI/API requires explicit tenant selection by Super Admin; resulting export contains only that tenant's data.

**BR-063** — Client Admin (Main or Sub) can export the same structured data download, scoped only to their own tenant — no tenant selector, no cross-tenant access.
*Acceptance:* Attempting to request another tenant's export (e.g. by manipulating a tenant ID parameter) is rejected with 403, verified by automated test.

## 8. Non-Functional Business Requirements

**BR-070** — The system must remain usable for a Client Admin building a standard survey in under 30 minutes end-to-end (template → published campaign).

**BR-071** — The platform must be built so that adding a new survey/election type requires **configuration, not code** — a new template type must not require a backend deployment.

**BR-072** — Architecture must allow the modular monolith to be split into independently deployable services later without a full rewrite (module boundary discipline, see `05-SYSTEM-DESIGN.md`).

---
*Next document: `03-FRS.md` (Functional Requirements Specification)*
