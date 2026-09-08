# Smart Survey X — Product Requirements Document (PRD)

**Version:** 1.0 (Locked)
**Status:** Approved for build (MVP scope)
**Owner:** Product
**Audience:** Engineering (human + AI code agents), Design, QA

---

## 0. How to use this document (for code agents)

This PRD is the source of truth for **what** to build and **why**. It is followed by:

- `02-BRS.md` — Business Requirements
- `03-FRS.md` — Functional Requirements (module-by-module, testable)
- `04-BUSINESS-RULES.md` — Validation & business logic rules engine spec
- `05-SYSTEM-DESIGN.md` — Architecture, service boundaries, sync protocol
- `06-DATABASE-DESIGN.md` — ER diagram + full schema DDL
- `07-API-SPEC.md` — REST endpoints (OpenAPI-style)
- `08-UXUI-SPEC.md` — Screens, flows, component states
- `09-ANALYTICS-SPEC.md` — Dashboard/report metadata schema
- `10-SECURITY.md` — AuthN/AuthZ, tenant isolation, data protection
- `11-TESTING-STRATEGY.md`
- `12-DEPLOYMENT.md`
- `13-ADR-LOG.md` — Architecture Decision Records

**Build order for agents:** Database Design → System Design → API Spec → Backend modules (per FRS) → Admin Portal (Next.js) → Surveyor App (Flutter) → Analytics → Deployment.

Do not invent entities, fields, or endpoints not defined in these documents. If a gap is found, flag it in `13-ADR-LOG.md` as an open decision rather than silently assuming.

---

## 1. Product Vision

Smart Survey X is a **metadata-driven, multi-tenant survey and election intelligence platform**. It is a platform, not a single app: every survey, form field, validation rule, dashboard widget, and report is generated from stored metadata rather than hardcoded per-client.

**Core philosophy:**
- Configuration over hardcoding — new survey types ship without code changes.
- Metadata drives forms, dashboards, reports, and validation.
- Offline-first mobile data collection.
- Enterprise-grade multi-tenant architecture, cost-efficient at MVP stage.

## 2. Problem Statement

Organizations running large-scale field surveys (political/election intelligence being the flagship use case) need to:
1. Design survey instruments without engineering involvement.
2. Deploy field surveyors who often work with unreliable connectivity.
3. Capture verifiable evidence (GPS, photo, audio) alongside answers.
4. Get near-real-time, drillable analytics (by constituency, booth, demographic, etc.) without custom dashboard builds per campaign.

Existing tools are either generic form builders (no offline evidence chain, no election-specific analytics) or bespoke one-off builds (expensive, slow to extend).

## 3. Goals & Non-Goals (MVP)

### 3.1 MVP Goals
1. **Core operational loop**: Question Bank → Survey Template → Campaign → Assignment → Submission → Validation → Processing → Analytics → Reports — fully working end to end.
2. **Full election analytics from day 1**: election-specific templates (MLA, MP, Municipal, District, State), GIS mapping, and the full widget set (KPI, bar, pie, trend, map, surveyor performance).
3. Multi-tenant data isolation sufficient for production use (shared DB, `tenant_id` scoping), functionally correct but **not** yet a polished self-service admin UX.

### 3.2 Explicitly Deferred (Phase 2+)
- Fully polished, self-service multi-tenant admin portal UX (tenant onboarding wizards, billing, white-labeling).
- Survey Supervisor role and its workflows.
- Advanced conflict-resolution UI for sync (server-side merge with review queue) — MVP uses **client-wins** sync.
- Splitting the modular monolith into independent services.
- Schema-per-tenant or DB-per-tenant isolation (explicitly rejected for MVP cost reasons; revisit if a tenant requires contractual data isolation).

### 3.3 Non-Goals
- This is not a general-purpose survey tool for consumer NPS/CSAT use cases (e.g., Typeform competitor). Election/field-intelligence workflows are the design center.
- Not building real-time chat/collaboration features.

## 4. Users & Roles

| Role | Description | MVP? |
|---|---|---|
| **Super Admin** | Platform operator. Up to **3 Super Admin accounts platform-wide**, all with identical full permissions. Creates and monitors tenants (clients), manages global Question Bank templates, platform-wide configuration, seat-limit upgrade approvals, and can export a structured data download for any selected tenant. | Yes |
| **Client Admin (Main)** | The primary admin account for a tenant, created by Super Admin (e.g. tenant "X" → main admin "X1"). Full tenant-scoped control: surveys, campaigns, surveyors, review/approval, creating Sub Admins **and** Dashboard Viewers, and exporting a structured data download scoped to their own tenant only. | Yes |
| **Sub Admin** | Created by the tenant's Client Admin (Main), up to a tenant seat limit (default **2**, e.g. "X2", "X3"). Has **the same operational permissions as Client Admin (Main)** — manage surveyors, campaigns, review/approval, export tenant data — **except** a Sub Admin cannot create another Client Admin, another Sub Admin, **or a Dashboard Viewer**. | Yes |
| **Dashboard Viewer** | Read-only account created **only by Client Admin (Main)**, up to a tenant seat limit (default **2**, e.g. "X-Viewer1", "X-Viewer2"). Can view dashboards/analytics for their tenant only. Cannot edit surveys, campaigns, users, or review records; cannot export reports or data at MVP. | Yes |
| **Surveyor** | Field agent. Mobile-only. Downloads assigned campaigns, submits survey responses with evidence. Has a Client-Admin-managed profile (photo, name, phone, government ID, unique Surveyor ID) that is read-only from the app. | Yes |
| **Survey Supervisor** | Reviews/validates surveyor submissions, manages territory-level oversight. | Phase 2 |

**Note on review responsibility at MVP:** until Survey Supervisor ships (Phase 2), the record review/approval workflow (PRD §8a) is performed by **Client Admin (Main) or Sub Admin**.

### 4.1 Tenant Account Hierarchy & Seat Limits

```
Super Admin (up to 3 accounts platform-wide, equal permissions)
   └── creates Tenant (e.g. "X") + its Client Admin (Main) account "X1"
              │
              └── Client Admin (Main) "X1" can create:
                      ├── up to 2 Sub Admins        ("X2", "X3")            [default limit, upgradeable]
                      └── up to 2 Dashboard Viewers  ("X-Viewer1/2")        [default limit, upgradeable]

              Sub Admin ("X2"/"X3"): same operational permissions as Main,
              EXCEPT cannot create Client Admins, Sub Admins, or Dashboard Viewers.
              (Dashboard Viewer creation is Client Admin (Main) ONLY.)
```

- Seat limits (**Sub Admin count**, **Dashboard Viewer count**) are set **per tenant**, default 2 each, enforced server-side at account-creation time.
- **Dashboard Viewer accounts can only be created by Client Admin (Main)** — Sub Admins have every other operational permission Main has, but not this one.
- **Upgrading a limit** (more Sub Admins or Viewers) follows a **request → approval flow, no payment processing at MVP**: Client Admin (Main) submits an upgrade request (new desired limit + reason); Super Admin approves or denies; on approval, the tenant's limit is raised. This models "extra charges" as a business/sales process outside the app for MVP — the platform tracks the *request and approved limit*, not billing/invoicing.
- Only **Super Admin** creates Tenants and their first Client Admin (Main). A Client Admin (Main) cannot self-register or create another tenant.
- **Super Admin itself** supports up to **3 accounts platform-wide**, all with identical, full permissions (no owner/primary distinction at MVP).

## 5. Key Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Multi-tenancy model | Shared database, `tenant_id` column on every tenant-scoped table, enforced via row-level security + application-layer guards | Lowest cost/complexity at MVP scale; revisit per-tenant isolation only if contractually required |
| Offline sync conflict strategy | **Client-wins for own submissions.** The surveyor's device is the source of truth for a draft until `submit`; server never silently overwrites a not-yet-submitted local draft. Post-submission, the submission is immutable. | Surveyors work solo on their own assignments; collision risk is low. Simplicity favored over building a merge-review UI in MVP. |
| MVP breadth | Core loop **and** full election analytics, admin portal UX polish deferred | Analytics is the product's differentiator and must be validated early; admin portal usability can iterate post-launch |
| Backend architecture | Modular monolith (FastAPI), clean module boundaries, split into services later only if justified | Avoids premature microservices overhead |
| Frontend | Flutter (Surveyor App), Next.js/React (Admin Portals) | Per existing technology decision |
| Storage | PostgreSQL (relational + metadata JSONB), Cloudflare R2 (media, separate audio/image stores), background workers (processing) | Per existing technology decision |
| Submission compute strategy | Lightweight structural validation on sync (real-time); heavy analytics aggregation batched (default end-of-day, tunable per campaign) | Minimizes DB compute at scale while keeping obviously-broken records visible immediately |
| Analytics visibility gate | A record only enters analytics aggregation after **Client Admin approval** (audio cross-check against typed answers) | Data quality/integrity requirement — audio is the source of truth for verifying field accuracy |
| Surveyor profile editability | Read-only from Surveyor App; only Client Admin can edit | Prevents identity/credential tampering by field agents |
| Sub Admin / Dashboard Viewer seat limits | Default 2 Sub Admins + 2 Dashboard Viewers per tenant; upgrade via Super-Admin-approved request, no payment processing in MVP | Models commercial "extra charges" as a business process without building billing infrastructure prematurely |
| Platform surface per role | **Surveyor: Flutter mobile app only.** Super Admin, Client Admin (Main/Sub), Dashboard Viewer: **web portal only** (Next.js/React, responsive), no native admin app. | Admin/review/analytics work is desk-first, keyboard/mouse-driven, and needs zero app-store distribution friction; only field data collection needs offline-capable native app. Responsive web covers "check on my phone" adequately for admins. |

**Terminology note used throughout this document set:** "Client Admin" (unqualified) refers to either **Client Admin (Main)** or **Sub Admin**, since both have identical operational permissions (survey/campaign/surveyor management, record review). Where the distinction matters — creating other admin accounts, tenant-level settings — the specific role (**Main** vs **Sub**) is named explicitly.

## 6. Core Domain Model (conceptual)

```
Question Bank ──┐
                 ├──> Survey Template (versioned) ──> Campaign ──> Assignment ──> Submission (Record)
                 │                                                                    │
                 │                                                                    ▼
                 │                                                       Evidence (GPS+Photo locked at start,
                 │                                                              Audio locked at submit)
                 │                                                                    │
                 │                                                                    ▼
                 └──────────────────────────────────────────────────>  Structural Validation (real-time)
                                                                                        │
                                                                                        ▼
                                                                     Client Admin Review (audio cross-check)
                                                                                        │
                                                                              Approved  │  Rejected
                                                                                        ▼         ▼
                                                                     Batched Aggregation      Surveyor Activity
                                                                     (Processing)              Log (flagged)
                                                                                        │
                                                                                        ▼
                                                                            Analytics ──> Dashboards / Reports
```

Full entity definitions live in `06-DATABASE-DESIGN.md`. Full lifecycle/state machine lives in `04-BUSINESS-RULES.md`.

## 7. Metadata-Driven Engine — Product Requirement

This is the platform's defining requirement. Every **question** in the Question Bank must store, as structured metadata (not code):

- Validation rules (type, range, regex, required, cross-field rules)
- Required flag
- Analytics filter eligibility (can this be used as a dashboard filter?)
- Group-by eligibility (can results be grouped/aggregated by this?)
- Chart type hint (bar / pie / trend / map / KPI)
- Conditional visibility rules (show if / hide if, referencing other question IDs)
- GPS requirement (does answering this require a GPS capture?)
- Photo requirement (min/max count)
- Audio requirement (max duration)
- Display order

**Publishing a survey template must, in one transaction/workflow:**
1. Persist and version the template (immutable version snapshot).
2. Auto-generate the dashboard configuration from question metadata.
3. Auto-generate the analytics configuration (aggregation definitions).
4. Push the survey to all currently assigned surveyors' sync queues.

No manual dashboard-building step should be required for a standard survey. Custom widget arrangement is an enhancement, not a prerequisite for a working dashboard.

## 8. Surveyor Flow (product requirement, not implementation)

```
Login -> Profile displayed (read-only: photo, name, phone, govt ID, unique surveyor ID)
  -> Download assigned campaigns (offline-capable) -> Start new record
  -> Photo + GPS captured and LOCKED immediately -> Audio recording auto-starts
  -> Surveyor conducts survey verbally while audio records -> Pause (record moves to Drafts)
  -> Fill form fields, replaying audio as needed -> Submit final record
  -> Sync -> Client Admin review (audio cross-check against typed answers) -> Approved
  -> Record becomes visible on Analytics Dashboard
```

Requirements:
- App must be usable with **zero connectivity** from login (cached session) through draft completion.
- **Surveyor profile is read-only from the app.** Photo, name, phone number, government ID/authorized proof, and a platform-issued unique Surveyor ID are displayed on login but cannot be edited by the surveyor. Only Client Admin can edit a surveyor's profile.
- **Capture order is fixed and enforced by the app**: starting a new record immediately captures and locks photo + GPS before any question is answered; audio recording then begins automatically and captures the surveyor's verbal conduct of the interview. The surveyor may **pause** (saving the in-progress record to local Drafts) and resume filling the form fields, replaying the recorded audio as a reference while typing answers.
- GPS, timestamps, and evidence become **immutable** the moment they are captured (photo/GPS lock immediately; audio locks on submit). Pre-submission, the surveyor may re-record audio and retake photos, but once a take is accepted it follows the same lock/immutability rule as final submission evidence for that take.
- Autosave must not lose data on app kill/crash/battery death — local persistence on every field change, not just on screen transition.
- **Surveyor Activity Log**: the app shows a list of the surveyor's own submitted records (view-only). A surveyor can see that a record exists and its status but **cannot open, edit, or view the filled answers/evidence** of an already-submitted record from the app.
- **Record ID**: every record's unique identifier is a composite of the Survey/Campaign ID and a record sequence — human-traceable (e.g. `CMP-2031-000842`), not an opaque UUID alone (an internal UUID may still exist for DB keys, but the composite ID is the human/reporting-facing identifier).

## 8a. Review & Validation Workflow (Client Admin)

- A submitted record is **not visible on the live analytics dashboard** until a Client Admin reviews and approves it.
- Review UI presents, per record: all typed answers, the locked photo, the locked GPS/map pin, and the recorded audio - playable inline.
- The Client Admin's core review action is a **cross-check**: listen to the audio and verify the surveyor's typed answers accurately reflect what was said, then Approve or Reject (with a reason) the record.
- Rejected records are flagged back to the surveyor's Activity Log as "Rejected" (view-only, with reason), with **one lightweight resubmission attempt** offered: the surveyor may start a fresh new record (full re-capture of evidence, not an edit) linked to the original. A second rejection is final — see `04-BUSINESS-RULES.md` §1.4 for the exact rule.
- Approved records flow into analytics aggregation (see §8b).

## 8b. Processing & Compute Strategy

To minimize database compute while keeping the dashboard trustworthy:
- **On sync (near real-time):** lightweight structural validation only - required fields present, format/type rules satisfied, evidence files present per metadata requirements. This is cheap and prevents obviously-broken records from queuing for review.
- **On Client Admin approval:** the record is marked `approved` and queued for aggregation. Approval is the gate - nothing reaches analytics before a human has cross-checked it against its audio.
- **Heavy aggregation (dashboard rollups, GIS aggregates, trend computation):** runs as a **batched background job**, default cadence end-of-day, configurable per tenant/campaign down to near-real-time if a campaign needs it. This is an operational/cost tuning knob, not a hard architectural limit - see `05-SYSTEM-DESIGN.md` §Processing Pipeline.

## 8c. Data Stamps — Product Requirement

Every record must carry a full, visible, immutable timeline of stamps, distinct from the answer content:
- `captured_at` — device timestamp when photo+GPS were captured (record start)
- `paused_at` — timestamp(s) whenever the surveyor pauses to Drafts (may occur multiple times)
- `resumed_at` — timestamp(s) whenever the surveyor resumes a draft
- `submitted_at` — device timestamp when the surveyor finalizes/submits
- `synced_at` — server timestamp when the record successfully reaches the backend
- `reviewed_at` — timestamp of Client Admin's Approve/Reject decision

These stamps are shown together in the Client Admin's Review UI and in Reports, giving a full field-to-approval audit trail per record, and are never editable by any role (system-generated only).

## 8d. Offline & Low-Connectivity Resilience — Product Requirement

Because target field conditions include remote areas with poor/no signal, the Surveyor App must be architected so that **connectivity never blocks data entry**:
- All form structure, question metadata, and validation rules for assigned campaigns are downloaded and cached on first sync; filling a form never requires a live network call.
- Media (photo, audio) is compressed on-device before being queued for upload; the queue is independent of the UI thread — the surveyor is never blocked waiting on an upload.
- A record can be paused to Drafts at any point and resumed later with zero data loss (PRD §8, §8b), including across multiple app sessions and days if needed.
- Submission is a **local action first** (saved to local Drafts/Submitted state immediately) and syncs to the server opportunistically in the background with visible per-record sync status (queued/syncing/synced/failed-retry). The surveyor's local action never appears to fail due to network state.
- Sync uses retry with backoff; failed syncs remain visibly queued (not silently dropped) and retry automatically when connectivity returns.

## 8e. Admin-Defined Input Types — Product Requirement

When building a survey template, the Client Admin selects each question's input type from a **fixed, closed set** (no free-form/custom type creation in MVP, to keep the metadata-driven engine and validation rule generator predictable):

`text (short)` · `text (long/paragraph)` · `number` · `single_select` · `multi_select` · `date` · `date_time` · `scale/rating` · `yes_no` · `gps` (auto, record-level) · `photo` (auto or per-question) · `audio` (auto, record-level)

Each type has a fixed set of configurable validation parameters (e.g. `number` → min/max; `text` → max length, regex; `single_select`/`multi_select` → option list) exposed in the Survey Builder UI per PRD §7. The Surveyor App renders the correct native input control for each type (e.g. numeric keypad for `number`, calendar picker for `date`) — the surveyor never sees a generic text box for a typed field.

## 9. Evidence Engine — Product Requirement

- Evidence types: GPS coordinates, timestamp, image(s), audio.
- Media is stored in Cloudflare R2, in **separate logical stores/buckets (or prefixes) for audio vs. images**, keeping large audio files operationally and cost-wise separate from smaller image assets. The database stores references (URLs/keys) only, never binary blobs, and every submission record links both its image reference(s) and its audio reference so a Client Admin can view/play both from the same record.
- Photo and GPS are captured and **locked at the start of a record** (before questions are answered); audio is captured through the interview and locked at submission. See PRD §8.
- Audio can be replayed by the surveyor while still drafting (pre-submit), and by the Client Admin during review (post-submit).
- All evidence is **finalized** (locked, hashed, immutable) at the point described above — photo/GPS immediately, audio at submit. No role can edit locked evidence.
- Evidence must be tamper-evident: capture timestamp and GPS must come from device sensors, not user-editable fields.
- Every record's evidence and answers are addressable by one **composite Record ID** (Campaign/Survey ID + sequence — see §8) so Client Admin review and reporting always resolve to a single, unambiguous, cross-referenced record.

## 10. Analytics — Product Requirement

- Dashboards are generated dynamically from survey template metadata — not hand-built per campaign.
- Election-specific templates ship in MVP: **MLA, MP, Municipal, District, State.**
- Required widget types: KPI cards, bar charts, pie charts, trend charts, GIS maps, surveyor performance views.
- Full spec (data contracts, aggregation rules, refresh cadence) is in `09-ANALYTICS-SPEC.md`.

## 11. Modular Backend — Product Requirement

Logical modules (deployed as one modular backend at MVP, splittable later):

Authentication · Tenant Management · User Management · Survey Builder · Question Bank · Campaign · Assignment · Evidence · Validation · Processing · Analytics · Dashboard · GIS · Reports · Notifications · Audit

Each module must have a clean internal boundary (own service layer, own data access) so that extraction into a separate service later does not require a rewrite. See `05-SYSTEM-DESIGN.md` §Module Boundaries.

## 11a. Activity / Audit Logging — Product Requirement (per-actor)

- **Every account-creation and administrative action must be logged against the specific account that triggered it** — not just "a Client Admin did X" but "X2 (Sub Admin) did X", "X1 (Main) did Y", "Super Admin account #2 did Z". This is the actor-level granularity required, not just role-level.
- Super Admin's own actions (tenant creation, suspension, seat-limit approvals, data exports) are logged per Super Admin account, since up to 3 exist.
- Each tenant's Client Admin (Main), Sub Admins, and their actions are logged distinctly and are viewable as a **per-tenant activity log**, so a Client Admin (Main) can see "who on my team did what" (e.g. did X2 or X3 assign this surveyor, did X2 or X3 approve this record).
- Full detail and retention rules are in `10-SECURITY.md` and the Audit module (PRD §11, FRS Audit module).

## 11b. Data Export — Product Requirement

- **Super Admin** can export a structured data download (CSV/JSON — all records, answers, and evidence *links*, not binary media) for **any tenant they select**.
- **Client Admin (Main or Sub)** can export the same structured data download, but **scoped only to their own tenant's records** — no tenant selector, no access to other tenants' data.
- Export is a **structured export** (rows of records with their answers flattened, plus reference URLs/keys for photo and audio evidence) — not a literal raw database/SQL dump, and does not include other tenants' data or platform internals (users, credentials, billing/seat-request internals) even for Super Admin's per-tenant export.
- Exports are logged (who exported, which tenant, when) per §11a.

## 11c. Dynamic Dashboard, GIS/GeoJSON Maps & Survey-to-Surveyor Assignment Mechanism — Product Requirement

This is the platform's **second major priority after the core operational loop**.

**Dynamic per-survey dashboard creation:**
- When a Client Admin creates a new survey form, a **corresponding dashboard is created automatically**, named after the survey, and driven by that survey's question metadata (per PRD §7) — filters, widgets, and groupings are derived from metadata, not manually wired per survey.
- Dashboard data must **reflect live, re-filterable results**: selecting any combination of the survey's metadata-eligible filters (geography, demographic questions, date range, surveyor, review status, etc.) re-renders all widgets — KPIs, charts, and the map — scoped to that filter selection.
- The map widget renders using **GeoJSON boundary data** (constituency/booth/district polygons) to produce choropleth/geo visualizations of results, in addition to raw GPS pin plotting (PRD §10, GIS module). GeoJSON source remains a pluggable/TBD provider per PRD §13.

**Assignment mechanism (push survey forms to surveyors):**
- Client Admin assigns a published survey form to one or more surveyors; on assignment, the form is pushed to that surveyor's app sync queue (PRD §8, FRS Assignment module).
- Client Admin can, **at any time**: add a surveyor to a survey's assignment, remove a surveyor from a survey's assignment, or **reassign a surveyor from one survey form to a different one** — all without needing to create a new campaign each time. Changes take effect on the surveyor's next app sync (FR-ASG-03 governs in-flight local drafts on removal/reassignment).

| Metric | Target |
|---|---|
| Survey template → live campaign time (Client Admin, no engineering help) | < 30 minutes for a standard template |
| Surveyor app usable fully offline | 100% of core submission flow |
| Data loss on app crash/kill during draft | 0% (autosave verified) |
| Dashboard availability after campaign publish | Auto-generated, no manual config, < 5 min after first submission sync |
| Tenant data leakage incidents | 0 (verified via automated tenant-isolation test suite, see `11-TESTING-STRATEGY.md`) |

## 13. Assumptions & Open Questions

Tracked formally in `13-ADR-LOG.md`. Key ones surfaced during planning:
- Exact GIS boundary data source (constituency/booth shapefiles) — **TBD placeholder**. `05-SYSTEM-DESIGN.md` and `09-ANALYTICS-SPEC.md` will define a pluggable GIS boundary provider interface so this can be wired in later without a redesign.
- Notification channels (SMS/push/email) and provider — TBD, module is scaffolded but provider-agnostic.
- Report export format — **confirmed: PDF only** for MVP. Excel export explicitly deferred to Phase 2.

## 14. Out of Scope Statement (explicit, for code agents)

Do **not** build, even if adjacent code suggests it'd be easy:
- Payment/billing systems.
- Public-facing self-serve tenant signup.
- Real-time collaborative editing of survey templates.
- Native iOS/Android admin apps (admin is web-only via Next.js).

---
*Next document: `02-BRS.md` (Business Requirements Specification)*
