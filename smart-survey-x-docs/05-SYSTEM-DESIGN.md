# Smart Survey X — System Design Document

**Version:** 1.0 (Locked)
**Depends on:** `01-PRD.md`, `02-BRS.md`, `03-FRS.md`, `04-BUSINESS-RULES.md`
**Feeds into:** `06-DATABASE-DESIGN.md`, `07-API-SPEC.md`, `12-DEPLOYMENT.md`

---

## 0. Purpose & Architectural Style

Smart Survey X is built as a **modular monolith**: one deployable FastAPI backend, internally organized into strictly-bounded modules (matching the 18 modules in `03-FRS.md`), backed by a single shared PostgreSQL database (shared-DB multi-tenancy, `tenant_id`-scoped) and Cloudflare R2 for media. This is a deliberate choice — see PRD §5 rationale — and this document exists to make sure "monolith now" doesn't become "big ball of mud" that can't later be split.

**Guiding rule for code agents:** a module may only access another module's data through that module's **service interface** (Python function/class calls within the same process at MVP) — never by directly querying another module's tables. This is what makes future service extraction a deployment change, not a rewrite.

---

## 1. High-Level Architecture

```
┌──────────────────┐        ┌──────────────────────┐        ┌─────────────────────┐
│  Flutter Surveyor │        │   Next.js Web Portal   │        │  Background Workers  │
│  App (offline-    │        │   (Super Admin,        │        │  (queue consumers)   │
│  first, mobile)   │        │   Client Admin,        │        │                       │
│                   │        │   Sub Admin,            │        │  - Sync processor    │
│  Local SQLite/    │        │   Dashboard Viewer)     │        │  - Media checksum/    │
│  Drift store for  │        │                         │        │    upload finalize    │
│  drafts + cached  │        │  Responsive, web-only   │        │  - Aggregation batch  │
│  template/rules   │        │  per PRD §5             │        │    job (analytics)    │
└─────────┬─────────┘        └───────────┬─────────────┘        │  - PDF report export  │
          │  HTTPS/REST (sync             │  HTTPS/REST          │  - Data export job    │
          │  batched, resumable)          │                      └──────────┬────────────┘
          └───────────────┬───────────────┘                                  │
                           ▼                                                  │
                 ┌───────────────────────┐          reads/enqueues            │
                 │   FastAPI Backend      │◄──────────────────────────────────┘
                 │   (modular monolith)   │
                 │                        │
                 │  Auth · Tenant · User  │
                 │  QuestionBank · Survey │
                 │  Builder · Campaign ·  │
                 │  Assignment · Evidence │
                 │  · Review · Validation │
                 │  · Processing ·        │
                 │  Analytics · Dashboard │
                 │  · GIS · Reports ·     │
                 │  Notifications · Audit │
                 │  · DataExport          │
                 └──────┬──────────┬──────┘
                        │          │
             ┌──────────▼──┐   ┌───▼─────────────┐
             │ PostgreSQL   │   │ Cloudflare R2    │
             │ (shared DB,  │   │ (audio/ prefix,  │
             │ tenant_id +  │   │  images/ prefix, │
             │ RLS)         │   │  reports/ prefix)│
             └──────────────┘   └──────────────────┘
                        │
             ┌──────────▼──────────┐
             │ Redis / queue broker │
             │ (background jobs)    │
             └───────────────────────┘
```

## 1a. Server-Side Engines — Full Tech Stack by Module

This section answers, concretely, **what actually runs on the server** for each module — the runtime engine, not just the abstraction. Every choice below has a **free/open-source tier** as the default recommendation, with a noted upgrade path only where it genuinely matters at scale. Nothing here requires a paid tool to build or run the MVP.

| Module | Engine that runs it | Why this one (free-first reasoning) |
|---|---|---|
| **API layer** (all 18 modules' HTTP surface) | **FastAPI** on **Uvicorn/Gunicorn** (ASGI, async Python) | Free, async-native (matters for I/O-bound sync/upload endpoints), auto-generates OpenAPI spec for `07-API-SPEC.md` alignment, already the locked tech decision. |
| **Primary datastore** (all relational modules) | **PostgreSQL 16+** | Free, and one engine covers relational + JSON (JSONB for metadata blocks) + geospatial (via PostGIS) + time-series (via TimescaleDB extension) — avoids running 3 separate databases. |
| **Question Bank / Survey Builder metadata** | PostgreSQL **JSONB** columns (validation rules, visibility rules) + GIN index | Free; JSONB is the right shape for the metadata-driven schema (§7 of PRD) — structured enough to query, flexible enough not to need a schema migration per new question type. |
| **Validation Rule Engine** | Pure Python, runs **inside the FastAPI process** (Validation module) | No separate engine needed — it's a rule interpreter (Business Rules §3), not a compute-heavy job. Keeping it in-process also lets Flutter's Dart implementation and the Python implementation both be generated/tested from the same JSON Schema source of truth. |
| **GIS / GeoJSON / choropleth** | **PostGIS** (free Postgres extension) | Free, industry-standard, handles GeoJSON natively (`ST_AsGeoJSON`, `ST_Within` for point-in-polygon booth/constituency lookups), and lives in the same database — no separate GIS server. |
| **Analytics aggregation engine** | **TimescaleDB** (free, open-source Postgres extension) — **continuous aggregates** | This is the direct mechanism for your "less DB computation" requirement: continuous aggregates are incrementally, automatically refreshed materialized views — Postgres recomputes only the changed slice, not the whole table, on each refresh. This replaces hand-rolled watermark/batch-job logic (§5) with a database-native feature, while staying inside Postgres (no second database to run, back up, or pay for). |
| **Background job queue** | **Celery** (free) + **Redis** (free) as broker | Standard, free, well-supported Python async task stack; handles sync processing, media finalize, aggregation triggers, PDF/data export jobs (§7 job table) uniformly. |
| **Media storage** | **Cloudflare R2** (already locked decision) | Free egress (R2's actual differentiator vs S3) matters a lot here since Client Admins will be downloading/streaming audio during review repeatedly — this is the one place a "free tier" choice also happens to be the technically better one, not a compromise. |
| **PDF report generation** | **WeasyPrint** (free, Python, HTML/CSS-to-PDF) | Free, runs server-side in a worker job, lets the PDF layout reuse the same web dashboard's HTML/CSS rendering logic rather than a separate templating system. |
| **Full-text/search needs** (if Question Bank search grows) | Postgres native `tsvector`/`tsquery` | Free, sufficient at MVP scale; only reach for Elasticsearch/Meilisearch if question-bank search becomes a real bottleneck — not needed at launch. |
| **Caching layer** | **Redis** (same instance as the job broker) | Free, dual-purpose — job queue + hot-path caching (e.g. published template metadata, seat-limit checks) avoids a second caching service. |
| **Authentication tokens** | **JWT**, signed with a server-held secret (or asymmetric keypair), no external auth-as-a-service | Free; avoids a recurring per-user cost from a third-party auth provider (e.g. Auth0) which doesn't add real value over a well-implemented JWT + refresh-token flow at this stage. |

### Where the "free" choice has a paid upgrade path (only if/when actually needed)

| Component | Free tier (MVP default) | If you outgrow it |
|---|---|---|
| Postgres hosting | Self-hosted or a free/low-cost managed tier (e.g. Supabase free tier, Neon free tier, or a small managed instance) | Managed Postgres with read replicas (e.g. AWS RDS, Neon Pro, Timescale Cloud) once concurrent write load or analytics query volume grows past a single instance's comfort zone |
| Background workers | Celery workers on the same/adjacent server as the API | Dedicated worker pool/autoscaling group once media-processing or aggregation volume grows |
| Redis | Single free-tier or small managed instance | Managed Redis cluster (e.g. Upstash, ElastiCache) for durability/HA once job volume is business-critical |
| GeoJSON boundary data | Free/open government shapefile sources (converted to GeoJSON, loaded into PostGIS) — per PRD §13 TBD | A paid boundary-data vendor only if free government sources prove incomplete/outdated for a given region |

### Explicit non-choices (and why)

- **No separate analytics database/warehouse (e.g. ClickHouse, BigQuery) at MVP.** TimescaleDB's continuous aggregates keep the analytics read path fast without operating a second system — revisit only if aggregate table sizes or query complexity genuinely outgrow single-instance Postgres+Timescale, which is not expected at MVP tenant/submission volumes.
- **No managed workflow orchestrator (e.g. Airflow, Temporal).** Celery Beat (free, part of the Celery ecosystem) is sufficient to schedule the daily aggregation batch job (§5) and other periodic jobs; introducing a heavier orchestrator before there's a real multi-step pipeline need would be premature.

---

## 1b. How This Maps Back to the Processing Pipeline (§5)

The two-tier compute strategy from Business Rules §1 and this document's §5 is implemented, concretely, as:

- **Real-time structural validation** → Python Validation module, in-process, triggered per sync request via Celery task (fast, seconds).
- **Batched aggregation** → TimescaleDB continuous aggregates, refreshed on a policy (default daily, per BRS BR-046) — the "batch job" is a **database-native refresh policy**, not custom application code re-deriving aggregates from scratch. Celery Beat only needs to trigger/monitor the refresh where a tenant/campaign override cadence is requested (FR-PRC-02), since Timescale can also refresh on its own schedule independently.
- **GIS choropleth** → PostGIS spatial queries feeding the same continuous-aggregate layer, so map data and chart data share one aggregation mechanism rather than two.



## 1c. Read/Write Path Separation (avoiding OLTP/analytics contention)

A single Postgres instance serving both the transactional path (surveyor syncs, review decisions, seat-limit checks — all latency-sensitive, all must stay fast) and the analytics path (aggregation refresh, dashboard queries — potentially heavy, bursty) will eventually contend for the same resources, and the transactional path is the one that must never degrade (a slow sync directly hurts a surveyor in the field).

**Architecture decision:** from launch, provision a **read replica** and route accordingly:
- **Primary instance**: all writes, all transactional reads (auth, sync, review, assignment, seat-limit checks).
- **Read replica**: `GET /dashboards/{id}/data`, `GET /geo-boundaries`, report/data-export job reads, and the TimescaleDB continuous aggregate refresh computation itself where feasible.
- This is a connection-string/routing decision at the FastAPI data-access layer (a second SQLAlchemy engine bound to the replica, used by the Analytics/Dashboard/Reports/Data-Export modules' `service.py` read paths specifically), not a schema change — cheap to add now, expensive to retrofit once traffic patterns are load-bearing on a single instance.
- Free/starter tier note (consistent with §1a): most managed Postgres providers that support the required extensions (Timescale Cloud, some Neon/Supabase tiers) offer a read-replica option even on lower tiers — confirm this specifically when selecting a provider in `12-DEPLOYMENT.md` §2, since it constrains the choice.

**Why this belongs in the architecture doc, not just an ops note:** it changes how modules are written (Analytics/Dashboard/Reports/Data-Export services must accept a read-only session, not assume the default write-capable one), so it needs to be a Day 1 convention, not a later retrofit.

## 1d. Query Performance Budget

Concrete targets, so "optimize the database" isn't left as a vague aspiration for a code agent to guess at:

| Query class | Target (p95) | How it's achieved |
|---|---|---|
| Sync push (structural validation + record upsert) | < 500ms | In-process rule interpreter (Coding Standards §5), no cross-module joins, indexed `local_draft_id` upsert |
| Sync pull (delta campaigns/templates) | < 300ms | Indexed on `assignments.surveyor_id` + `updated_at` watermark, small payload (metadata only, media excluded) |
| Dashboard widget load (pre-aggregated, common filter) | < 800ms | TimescaleDB continuous aggregate hit, read replica, no live JSONB scan over raw `record_answers` |
| Dashboard widget load (uncommon filter combination, fallback path) | < 3s, with a visible loading state (not a spinner-forever) | Scoped live query over `record_facts` (narrow, denormalized) bounded to one campaign — **never** a live query over `record_answers` for dashboard purposes, per §6 below |
| Review Detail load (single record, full answers+evidence+audio) | < 1s | Single-record lookup by indexed `record_id`, no aggregation involved |

**The critical rule this table enforces:** any dashboard-facing query must be answerable from `record_facts` or a continuous aggregate — if a code agent finds itself writing a `GROUP BY` over `record_answers` (the full, wide, JSONB-per-answer table) to serve a dashboard request, that is a sign the metadata's `analytics_filter`/`group_by` flags weren't properly propagated into `record_facts.filterable_answers` at Task 5.2, not a signal to just optimize the live query — fix the aggregation pipeline, don't work around it.

---

## 2. Module Boundaries (backend)

Each module below owns its own tables (per `06-DATABASE-DESIGN.md`) and exposes a service-layer interface. Cross-module reads go through that interface, not raw SQL joins across module boundaries, **except** for read-optimized analytics queries (§5), which are the one deliberate exception (documented there).

| Module | Owns | Exposes to other modules |
|---|---|---|
| Authentication | sessions, tokens, password resets | `get_current_user(token)`, `verify_role()` |
| Tenant Management | tenants, seat limits, upgrade requests | `get_tenant(id)`, `check_seat_available(tenant_id, role)` |
| User Management | users (all roles), surveyor profiles | `get_user(id)`, `list_surveyors(tenant_id)` |
| Question Bank | questions (global + tenant-owned), versions | `get_question(id, version)` |
| Survey Builder | templates, template versions, metadata | `get_published_template(id, version)`, `publish(template_id)` |
| Campaign | campaigns | `get_campaign(id)`, `list_active_campaigns(tenant_id)` |
| Assignment | surveyor↔campaign links | `get_assignments(surveyor_id)`, `assign/unassign/reassign()` |
| Evidence | media references (audio/image), checksums | `get_evidence(record_id)`, `finalize_evidence(record_id)` |
| Review | review decisions, reasons | `approve(record_id, actor)`, `reject(record_id, actor, reason)` |
| Validation | rule engine execution | `validate_structural(record, template_version)` |
| Processing | record lifecycle status, fact materialization, aggregation triggers | `mark_synced()`, `materialize_fact()`, `mark_fact_failed()` |
| Analytics | aggregate tables, dashboard configs | `get_dashboard_data(campaign_id, filters)` |
| Dashboard | widget layout persistence | `get_layout(campaign_id)`, `save_layout()` |
| GIS | boundary data references, choropleth queries | `get_boundary(geo_type)`, `get_choropleth_data()` |
| Reports | PDF export jobs | `request_export(dashboard_id, filters)` |
| Notifications | in-app notification records | `notify(user_id, message)` |
| Audit | append-only audit log | `log(actor_id, action, entity, metadata)` |
| Data Export | tenant data export jobs | `request_data_export(tenant_id, actor)` |

---

## 3. Tenant Isolation (implementation detail)

Two independent enforcement layers, per BRS BR-001 and Business Rules §6:

1. **Application layer**: every service function that reads/writes tenant-scoped data takes `tenant_id` as a parameter **derived from the authenticated request's JWT claims**, never from a URL/body parameter supplied by the client. A shared FastAPI dependency (`get_tenant_scoped_session`) injects this automatically into the DB session context for every request.
2. **Database layer (backstop)**: PostgreSQL Row-Level Security (RLS) policies on every tenant-scoped table, keyed on a `current_setting('app.current_tenant_id')` session variable set at the start of each request's DB transaction. Even a bug in application-layer filtering cannot leak cross-tenant rows, because RLS blocks it at the database engine level. Full policy DDL in `06-DATABASE-DESIGN.md`.

Super Admin requests bypass RLS via a distinct DB role (`super_admin_role`) used only for genuinely platform-wide queries (tenant list, cross-tenant data export target selection) — this role is never used for the default request path.

---

## 4. Offline Sync Protocol (Flutter ↔ FastAPI)

Per BRS BR-039 and Business Rules §1.

### 4.1 Client-side local storage

- Local embedded DB (SQLite via Drift or equivalent) mirrors: assigned campaigns, published template versions (with full metadata/validation schema per Business Rules §3), and the surveyor's own draft/submitted records.
- Media (photo/audio) written directly to device filesystem; DB stores local file paths + upload status per file.

### 4.2 Sync sequence

1. **Pull** (on app open / manual refresh / periodic background if connectivity available): `GET /sync/campaigns` returns any new/changed assignments and template versions for the authenticated surveyor. Client diffs against local cache and stores only what's new/changed (bandwidth-conscious for low connectivity).
2. **Push** (background worker on-device, triggered whenever connectivity is detected and a queue is non-empty): for each `submitted_locally` record, `POST /sync/records` with the answer payload; media files upload via separate pre-signed-URL requests (`POST /sync/records/{id}/evidence/upload-url`) directly to R2, so large media doesn't bottleneck the main API.
3. Each push is **idempotent**: client includes a client-generated `local_draft_id`; server upserts (safe to retry on timeout) rather than double-creating a record.
4. Server responds per record with the outcome: `synced` (with assigned composite Record ID) or `validation_failed` (with question-level errors, Business Rules §3.4) — client updates local status and surfaces errors only for the latter (should be rare, since client already validated).
5. **Client-wins rule (locked decision, PRD §5)**: the client never receives or applies a server-initiated overwrite of a not-yet-submitted local draft. Sync is push-dominant for records; the only pull-side mutation to a local record is the terminal review outcome (`approved`/`rejected`) written back for Activity Log display (§4.3).

### 4.3 Review-outcome pull-back

- `GET /sync/review-status` (polled on app open / pull-to-refresh) returns status changes for the surveyor's own previously submitted records — this is how "Approved"/"Rejected" (+ reason, + Resubmit eligibility) reaches the Activity Log (FR-USR-07) without a push channel.

---

## 5. Processing Pipeline (two-tier compute, refined per fact-materialization design — see `17-ANALYTICS-PROCESSING-SEQUENCE.md`)

```
Sync push (per record)
        │
        ▼
Structural Validation (Validation module, real-time, seconds)
        │
   pass ┴ fail → validation_failed (rare; Client Admin visible)
        │
  pending_review
        │
        ▼
Client Admin Review (Review module)
        │
 approve ┴ reject → resubmission flow (Business Rules §1.4)
        │
        ▼
Fact Materialization (Processing module, same transaction as approve preferred)
        │  INSERT into record_facts (idempotent, ON CONFLICT DO NOTHING)
        │  only analytics-flagged answers + geo + surveyor + timestamps
        │
        ├── success → record visible to continuous aggregates on next refresh
        └── failure → records.fact_status='failed' (retryable; not yet in dashboards;
                       the approve decision itself still stands — see rationale below)
        │
        ▼
Continuous Aggregate Refresh (Timescale policy, default daily, or Celery override)
        │
        ▼
Pre-aggregated slices + analytics watermark ("Data as of …")
```

**Why this shape:**
- Structural validation stays cheap and immediate (surveyor feedback).
- **Fact materialization is a first-class, transactional step triggered by approve** — not deferred solely to a nightly batch. This makes "approved → eligible for analytics" deterministic and near-real-time once the next continuous-aggregate refresh runs, directly addressing the "less computation from DB" requirement without sacrificing timeliness.
- **A review decision is never lost or rolled back because materialization fails** (e.g. a transient DB error). The approve decision is the source of truth; the fact row is derived and independently retriable. This is why `fact_status` (Database Design §2.5) is a separate field from `records.status` — conflating them would make a materialization hiccup look like a reversed review decision, which it is not.
- The expensive GROUP BY work stays inside Timescale continuous aggregates (incremental refresh, not a full recompute each time).
- The scheduled/Beat job only refreshes aggregates, retries `fact_status='failed'` records, and updates the watermark — it does **not** re-derive facts from raw records on a schedule; materialization itself happens once, at approve time.

Full contracts, service interfaces, and test cases live in `17-ANALYTICS-PROCESSING-SEQUENCE.md` and `09-ANALYTICS-SPEC.md` §2/§7.

---

## 6. Analytics Read Path

- Dashboard widgets read from **pre-aggregated continuous aggregates** first; fall back to a scoped live query over `record_facts` (never raw `records`/`record_answers`) only when the requested filter combination isn't covered by an existing aggregate.
- **Never** include non-approved-or-not-yet-materialized records — enforced structurally, since only `approved` + `fact_status='materialized'` rows ever exist in `record_facts` in the first place (System Design §5), not by a runtime filter that could be forgotten.
- Every dashboard data response includes **`data_as_of`** (from the analytics watermark) — the UI surfaces this so a Client Admin always knows how fresh the numbers are (UX Spec §4b, Analytics Spec §8).
- Filter changes re-issue `GET /dashboards/{id}/data` with the full active filter set; the Analytics module applies AND-across-filter-types / OR-within-a-multiselect semantics (BR-050b, Analytics Spec §6).
- Full widget envelopes, the three always-present system widgets, and the dashboard generation algorithm are defined in `09-ANALYTICS-SPEC.md`.

---

## 7. Background Job Types (workers)

| Job | Trigger | Frequency | Responsibility |
|---|---|---|---|
| Sync processor | Record pushed via `/sync/records` | Real-time (queue-consumed within seconds) | Structural validation → `pending_review` |
| Media finalize (checksum, R2 confirm) | Evidence upload-url flow completes | Real-time | Integrity stamps |
| Fact materialization | Client Admin approves a record | Per approval (in-process call, same/immediate transaction) | Insert one `record_facts` row, idempotently |
| Continuous-aggregate refresh | Timescale policy, or Celery Beat override | Default daily; per-campaign override configurable | Refresh changed buckets, update the `data_as_of` watermark |
| Failed-fact retry | Celery Beat | e.g. hourly | Re-attempt materialization for `fact_status='failed'` records |
| PDF report export | Client Admin requests export | On-demand, async | Snapshot of current dashboard state |
| Data export (CSV/JSON) | Super Admin or Client Admin requests | On-demand, async | Flattened records + evidence reference links |
| Seat-limit request notification | Upgrade request submitted | Real-time (in-app notify to Super Admin) | — |

All jobs are queue-based (Redis-backed, e.g. via Celery or an equivalent async task framework) — never executed inline in an HTTP request handler for anything non-trivial, per FR-PRC-03.

---

## 8. Module Extraction Path (future, not MVP)

If/when a module needs independent scaling (most likely candidates: Processing/Aggregation under high submission volume, or Evidence under high media throughput), the service-interface boundary in §2 means extraction is: (1) move the module's code to a new deployable, (2) replace in-process function calls with HTTP/gRPC calls at the same interface boundary, (3) module keeps owning its own tables (no schema change required if boundaries were respected). This is why the "may only access via service interface" rule in §0 is load-bearing, not stylistic.

## 13. API Versioning & Mobile Compatibility Policy

The Surveyor App is installed on field devices that cannot be assumed to update promptly (poor connectivity, app-store review lag, surveyors mid-campaign not wanting to update). The backend must therefore support **at least two concurrent mobile app versions** without breaking either:

1. **Breaking changes are never shipped silently.** A breaking change to any `/sync/*` endpoint or the rule-schema shape requires a new path prefix (`/api/v2/sync/...`), not an in-place change to `/api/v1/sync/...` — the old version keeps working for devices that haven't updated.
2. **`GET /sync/campaigns` response includes a `min_supported_app_version` field.** If the app detects its own version is below this, it shows a non-blocking "please update" banner (never a hard block that prevents offline work already in progress) — the surveyor can still finish and submit a record already in Drafts even on an outdated app version, consistent with the offline-first, never-block-data-entry principle (BR-039).
3. **Deprecation window:** once a `/v2` endpoint exists, `/v1` is kept functional for a minimum of 90 days (configurable, but 90 days is the default assumption for planning purposes) before removal, giving field deployments realistic time to update.
4. **The rule schema (`04-BUSINESS-RULES.md` §3.1) is versioned independently** (`schema_version` field on the published template snapshot) — an older app version pulling a template built against a newer schema version should fail closed with a clear "update required" state for that specific template, rather than attempting to interpret unknown operators/fields incorrectly.

This policy is a Day 1 architectural constraint, not a later addition — endpoint and schema design in `07-API-SPEC.md` and `04-BUSINESS-RULES.md` should already anticipate a `v2` existing someday without requiring a rewrite of `v1`'s data model.

---
*Next document: `06-DATABASE-DESIGN.md` (ER Diagram & Schema DDL)*
