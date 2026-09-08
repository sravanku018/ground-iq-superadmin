# Smart Survey X — Database Design

**Version:** 1.0 (Locked)
**Depends on:** `01-PRD.md` through `05-SYSTEM-DESIGN.md`
**Feeds into:** `07-API-SPEC.md`
**Engine:** PostgreSQL 16+ with `postgis`, `timescaledb`, `pgcrypto` extensions

---

## 0. Conventions

- Primary keys: `id UUID DEFAULT gen_random_uuid()` on every table (internal key). Human-facing composite IDs (Record ID, Campaign Code) are separate indexed columns, never the PK.
- Every tenant-scoped table has a non-nullable `tenant_id UUID REFERENCES tenants(id)`.
- All tables have `created_at TIMESTAMPTZ DEFAULT now()`; mutable tables also have `updated_at TIMESTAMPTZ DEFAULT now()` maintained by trigger.
- Soft-delete via `status`/`is_active` columns is preferred over hard delete for anything with audit/history value (users, campaigns, templates). Records/evidence are **never** deleted (immutability requirement).
- Money/billing tables intentionally do not exist per PRD §14 (out of scope).

---

## 1. Entity-Relationship Diagram (conceptual)

```
tenants ──< users (role: super_admin | client_admin_main | client_admin_sub | dashboard_viewer | surveyor)
   │            │
   │            └──< surveyor_profiles (1:1 with users where role=surveyor)
   │
   ├──< seat_limit_requests
   │
   ├──< questions (is_global bool; tenant_id NULL for global)
   │        │
   │        └──< question_versions
   │
   ├──< survey_templates ──< survey_template_versions ──< survey_template_version_questions >── question_versions
   │                               │
   │                               └──< campaigns ──< assignments >── users (surveyor)
   │                                        │              │
   │                                        │              └──< assignment_history (audit of add/remove/reassign)
   │                                        │
   │                                        └──< records
   │                                                 │
   │                                                 ├──< record_answers
   │                                                 ├──1:1─ record_evidence (photo/gps root-level)
   │                                                 ├──1:1─ record_audio_evidence
   │                                                 ├──< record_stamps (or columns on records, see §3.9)
   │                                                 ├──1:1─ record_reviews
   │                                                 └── self-FK: original_record_id (resubmission chain)
   │
   ├──< dashboards (1:1 with survey_template, or campaign — see §3.11) ──< dashboard_widgets
   ├──< analytics_aggregates (TimescaleDB continuous aggregate, derived from records/answers)
   ├──< geo_boundaries (PostGIS geometry, GeoJSON source)
   ├──< report_export_jobs
   ├──< data_export_jobs
   ├──< notifications
   └──< audit_log
```

---

## 2. Schema DDL

### 2.1 Extensions & Setup

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS timescaledb;
```

### 2.2 Tenant & User Management

```sql
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
    default_locale TEXT DEFAULT 'en',
    default_timezone TEXT DEFAULT 'UTC',
    sub_admin_limit INT NOT NULL DEFAULT 2,
    dashboard_viewer_limit INT NOT NULL DEFAULT 2,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),  -- NULL for super_admin (platform-level)
    role TEXT NOT NULL CHECK (role IN
        ('super_admin','client_admin_main','client_admin_sub','dashboard_viewer','surveyor')),
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    phone TEXT,
    password_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','deactivated')),
    created_by UUID REFERENCES users(id),  -- actor-level audit (FR-USR/BR-061 traceability)
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    -- role/tenant consistency: super_admin has NULL tenant_id, all others require it
    CONSTRAINT chk_tenant_role CHECK (
        (role = 'super_admin' AND tenant_id IS NULL) OR
        (role != 'super_admin' AND tenant_id IS NOT NULL)
    )
);
CREATE INDEX idx_users_tenant ON users(tenant_id);

-- BR-007 (max 3 super_admin accounts) is enforced by the app-layer transactional COUNT() + INSERT
-- guard (Business Rules §5) — no DB constraint can express "at most N rows of type X" directly.
-- This partial index exists purely to make that COUNT() query fast, not as the enforcement itself.
CREATE INDEX idx_users_super_admin_lookup ON users(role) WHERE role = 'super_admin' AND status = 'active';
-- Same pattern applies to the sub_admin/dashboard_viewer seat-limit counts, scoped per tenant:
CREATE INDEX idx_users_role_tenant_active ON users(tenant_id, role) WHERE status = 'active';

CREATE TABLE surveyor_profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    surveyor_code TEXT NOT NULL UNIQUE,  -- platform-issued unique Surveyor ID, immutable
    photo_url TEXT NOT NULL,             -- R2 reference
    govt_id_type TEXT NOT NULL,          -- e.g. 'aadhaar','passport','voter_id' (closed set, tenant-configurable list)
    govt_id_reference TEXT NOT NULL,     -- R2 reference or masked value, never raw sensitive doc in plaintext column
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
    -- NOTE: no API exposes UPDATE on this table to role='surveyor' (FR-USR-06) — enforced at service layer.
);

CREATE TABLE seat_limit_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    requested_by UUID NOT NULL REFERENCES users(id),
    role_type TEXT NOT NULL CHECK (role_type IN ('sub_admin','dashboard_viewer')),
    requested_limit INT NOT NULL,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_seat_requests_tenant ON seat_limit_requests(tenant_id, status);
```

### 2.3 Question Bank & Survey Builder

```sql
CREATE TABLE questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),  -- NULL = global (Super Admin authored)
    is_global BOOLEAN NOT NULL DEFAULT false,
    cloned_from_question_id UUID REFERENCES questions(id),  -- FR-QB-03 traceability
    created_by UUID NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE question_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID NOT NULL REFERENCES questions(id),
    version_number INT NOT NULL,
    text TEXT NOT NULL,
    input_type TEXT NOT NULL CHECK (input_type IN
        ('text_short','text_long','number','single_select','multi_select',
         'date','date_time','scale','yes_no','gps','photo','audio')),
    options JSONB,                 -- for single_select/multi_select: [{value, label}, ...]
    metadata JSONB NOT NULL,       -- full PRD §7 block: validation, visibility, analytics_filter,
                                    -- group_by, chart_type, gps/photo/audio_required, display_order
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(question_id, version_number)
);
CREATE INDEX idx_qversions_metadata_gin ON question_versions USING GIN (metadata);

CREATE TABLE survey_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    description TEXT,
    election_type TEXT CHECK (election_type IN ('mla','mp','municipal','district','state','generic')),
    created_by UUID NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE survey_template_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_template_id UUID NOT NULL REFERENCES survey_templates(id),
    version_number INT NOT NULL,
    is_published BOOLEAN NOT NULL DEFAULT false,
    published_at TIMESTAMPTZ,
    published_by UUID REFERENCES users(id),
    snapshot JSONB NOT NULL,   -- full immutable snapshot: questions + metadata + order, at publish time
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(survey_template_id, version_number)
);

CREATE TABLE survey_template_version_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_template_version_id UUID NOT NULL REFERENCES survey_template_versions(id),
    question_version_id UUID NOT NULL REFERENCES question_versions(id),
    display_order INT NOT NULL,
    UNIQUE(survey_template_version_id, question_version_id)
);
```

### 2.4 Campaign & Assignment

```sql
CREATE TABLE campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    campaign_code TEXT NOT NULL UNIQUE,  -- e.g. "CMP-2031" — root of the composite Record ID
    survey_template_version_id UUID NOT NULL REFERENCES survey_template_versions(id),
    name TEXT NOT NULL,
    start_date DATE,
    end_date DATE,
    geography_scope JSONB,    -- list of constituency/district/booth identifiers
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','closed')),
    aggregation_refresh_interval INT,  -- minutes; NULL = system default (daily Timescale policy) — closes ADR OPEN-006
    last_analytics_refresh_at TIMESTAMPTZ,  -- watermark exposed to the API as `data_as_of` (Analytics Spec §5)
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_campaigns_tenant ON campaigns(tenant_id, status);

CREATE TABLE assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    campaign_id UUID NOT NULL REFERENCES campaigns(id),
    surveyor_id UUID NOT NULL REFERENCES users(id),
    territory_scope JSONB,   -- optional sub-territory within campaign's geography_scope
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed')),
    assigned_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_assignments_surveyor ON assignments(surveyor_id, status);
CREATE INDEX idx_assignments_campaign ON assignments(campaign_id, status);
-- Prevents duplicate active assignment rows for the same surveyor+campaign
-- (e.g. a double-submitted "assign" click creating two rows) — a removed assignment
-- doesn't block a fresh one, so a surveyor can be legitimately re-added later.
CREATE UNIQUE INDEX idx_assignments_unique_active ON assignments(campaign_id, surveyor_id)
    WHERE status = 'active';

CREATE TABLE assignment_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Reassign is modeled as: (1) mark the old assignment 'removed', (2) INSERT a new assignment row
    -- for the new campaign — never an in-place UPDATE of assignments.campaign_id. This is required so
    -- historical assignment state remains reconstructable (Business Rules §4: a surveyor's assignment
    -- history must stay queryable even after they're moved elsewhere), and so the idx_assignments_unique_active
    -- constraint above is never violated mid-reassignment.
    old_assignment_id UUID REFERENCES assignments(id),
    new_assignment_id UUID REFERENCES assignments(id),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    surveyor_id UUID NOT NULL REFERENCES users(id),
    action TEXT NOT NULL CHECK (action IN ('added','removed','reassigned')),
    old_campaign_id UUID REFERENCES campaigns(id),
    new_campaign_id UUID REFERENCES campaigns(id),
    actor_id UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_assignment_history_surveyor ON assignment_history(surveyor_id, created_at DESC);
CREATE INDEX idx_assignment_history_tenant ON assignment_history(tenant_id, created_at DESC);
```

### 2.5 Records (Submissions) — Core Table

```sql
CREATE TABLE records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    record_code TEXT UNIQUE,               -- composite Record ID: "{campaign_code}-{sequence}[-R{n}]"
                                             -- NULL until server assigns it on first successful sync (FR-EVD-07);
                                             -- client uses local_draft_id as the pre-sync identifier
    campaign_id UUID NOT NULL REFERENCES campaigns(id),
    survey_template_version_id UUID NOT NULL REFERENCES survey_template_versions(id),
    surveyor_id UUID NOT NULL REFERENCES users(id),
    local_draft_id TEXT NOT NULL,          -- client-generated id, used for idempotent upsert on sync
    status TEXT NOT NULL DEFAULT 'submitted_locally' CHECK (status IN
        ('submitted_locally','syncing','synced','validation_failed',
         'pending_review','approved','rejected')),
    -- Fact materialization status — deliberately separate from `status` above (System Design §5).
    -- `status` is the human review decision (immutable once approved/rejected); `fact_status` is
    -- whether the derived analytics row exists yet. approved + fact_status='failed' means the review
    -- decision stands unchanged; the record is simply excluded from dashboards until retry succeeds.
    fact_status TEXT NOT NULL DEFAULT 'not_applicable' CHECK (fact_status IN
        ('not_applicable','pending','materialized','failed')),
    fact_error TEXT,                        -- last materialization error message (Client Admin visible)
    fact_materialized_at TIMESTAMPTZ,       -- set when fact_status becomes 'materialized'
    -- resubmission chain (Business Rules §1.4)
    original_record_id UUID REFERENCES records(id),
    attempt_number INT NOT NULL DEFAULT 1,
    -- data stamps (BR-038 / FR-EVD-08)
    captured_at TIMESTAMPTZ NOT NULL,
    submitted_at TIMESTAMPTZ,               -- NULL while still in local draft/paused state; set on final submit
    synced_at TIMESTAMPTZ,
    reviewed_at TIMESTAMPTZ,
    -- location (root-level GPS, locked at record start)
    -- NULLABLE: a slow/failed GPS lock (UX Spec §4a.2) must not make the record itself uncreatable.
    -- gps_status distinguishes "captured" from "unavailable" so downstream code never treats
    -- a NULL point as a data-quality accident vs. a deliberate, template-permitted fallback.
    gps_point GEOGRAPHY(POINT, 4326),
    gps_status TEXT NOT NULL DEFAULT 'pending' CHECK (gps_status IN ('captured','unavailable','pending')),
    gps_locked_at TIMESTAMPTZ,              -- set the moment gps_point is written; immutable thereafter
    geo_constituency_id UUID REFERENCES geo_boundaries(id),
    geo_booth_id UUID REFERENCES geo_boundaries(id),
    -- sync bookkeeping
    sync_attempt_count INT NOT NULL DEFAULT 0,
    last_sync_error TEXT,                   -- last sync/structural validation error; fact errors live in fact_error
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(campaign_id, local_draft_id),
    -- enforce the immutability boundary at the DB level, not just app convention (Business Rules §1.3 rule 7):
    -- once a record leaves 'submitted_locally'/'syncing', captured_at/gps_point must already be set
    CONSTRAINT chk_gps_before_review CHECK (
        status IN ('submitted_locally','syncing') OR gps_status != 'pending'
    )
);
CREATE INDEX idx_records_tenant_status ON records(tenant_id, status);
CREATE INDEX idx_records_fact_status ON records(tenant_id, fact_status) WHERE fact_status IN ('pending','failed');
CREATE INDEX idx_records_campaign ON records(campaign_id, status);
CREATE INDEX idx_records_surveyor ON records(surveyor_id, status);
CREATE INDEX idx_records_gps ON records USING GIST (gps_point) WHERE gps_point IS NOT NULL;
CREATE INDEX idx_records_original ON records(original_record_id) WHERE original_record_id IS NOT NULL;
-- record_code is assigned late (post-sync); this partial unique index still guarantees uniqueness
-- once assigned, without blocking inserts of pre-sync rows that don't have it yet.
CREATE UNIQUE INDEX idx_records_code ON records(record_code) WHERE record_code IS NOT NULL;

CREATE TABLE record_pause_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),  -- denormalized for direct RLS (avoids a join-based policy)
    record_id UUID NOT NULL REFERENCES records(id),
    event_type TEXT NOT NULL CHECK (event_type IN ('paused','resumed')),
    event_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_pause_events_record ON record_pause_events(record_id);

CREATE TABLE record_answers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),  -- denormalized for direct RLS
    record_id UUID NOT NULL REFERENCES records(id),
    question_version_id UUID NOT NULL REFERENCES question_versions(id),
    answer_value JSONB NOT NULL,   -- shape depends on input_type; validated against question metadata
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(record_id, question_version_id)
);
CREATE INDEX idx_answers_record ON record_answers(record_id);
CREATE INDEX idx_answers_question_gin ON record_answers USING GIN (answer_value);
```

### 2.6 Evidence (separate audio/image stores per FR-EVD-02)

```sql
CREATE TABLE record_photo_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),  -- denormalized for direct RLS
    record_id UUID NOT NULL REFERENCES records(id),
    question_version_id UUID REFERENCES question_versions(id),  -- NULL = root-level record photo
    r2_key TEXT NOT NULL,          -- e.g. images/{tenant_id}/{record_id}/{uuid}.jpg
    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    checksum_sha256 TEXT NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL,
    locked_at TIMESTAMPTZ NOT NULL,   -- immediate lock per BR-034
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_photo_evidence_record ON record_photo_evidence(record_id);
CREATE INDEX idx_photo_evidence_checksum ON record_photo_evidence(checksum_sha256);  -- integrity re-verification lookups (Security §4)

CREATE TABLE record_audio_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),  -- denormalized for direct RLS
    record_id UUID NOT NULL UNIQUE REFERENCES records(id),  -- root-level, one primary audio track per record
                                                               -- (a resubmission is a NEW records row, so this
                                                               -- constraint does not block resubmission — each
                                                               -- attempt gets its own record_id and thus its own audio row)
    question_version_id UUID REFERENCES question_versions(id),  -- NULL unless a specific question also requires audio
    r2_key TEXT NOT NULL,           -- e.g. audio/{tenant_id}/{record_id}/{uuid}.m4a
    mime_type TEXT NOT NULL,
    duration_seconds INT,
    size_bytes BIGINT NOT NULL,
    checksum_sha256 TEXT NOT NULL,
    recording_started_at TIMESTAMPTZ NOT NULL,
    locked_at TIMESTAMPTZ NOT NULL,   -- locked at submission (BR-032/033)
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_audio_evidence_checksum ON record_audio_evidence(checksum_sha256);
```

### 2.7 Review

```sql
CREATE TABLE record_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    record_id UUID NOT NULL UNIQUE REFERENCES records(id),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    reviewer_id UUID NOT NULL REFERENCES users(id),
    decision TEXT NOT NULL CHECK (decision IN ('approved','rejected')),
    reason TEXT,   -- required (app-layer enforced) when decision='rejected'
    reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_reviews_tenant ON record_reviews(tenant_id, decision);
```

### 2.8 GIS / Boundaries

```sql
CREATE TABLE geo_boundaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    geo_type TEXT NOT NULL CHECK (geo_type IN ('constituency','district','booth','state','municipal_ward')),
    name TEXT NOT NULL,
    parent_id UUID REFERENCES geo_boundaries(id),  -- e.g. booth -> constituency -> state
    boundary GEOGRAPHY(MULTIPOLYGON, 4326),        -- NULL if boundary data not yet configured (FR-GIS-02 degrade)
    source TEXT,   -- provenance note; PRD §13 TBD pluggable provider
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_geo_boundary_gist ON geo_boundaries USING GIST (boundary);
CREATE INDEX idx_geo_type ON geo_boundaries(geo_type);
```

### 2.9 Analytics (TimescaleDB continuous aggregates)

```sql
-- Hypertable of approved-only record facts, feeding all continuous aggregates.
-- Populated (INSERT) transactionally at the moment a record is approved, by the Processing
-- module's materialize_fact() (17-ANALYTICS-PROCESSING-SEQUENCE.md). Idempotent via
-- ON CONFLICT DO NOTHING. filterable_answers contains ONLY answers for questions flagged
-- analytics_filter / group_by / chart_type — not the full answer set (keeps this table narrow).
CREATE TABLE record_facts (
    record_id UUID NOT NULL,
    tenant_id UUID NOT NULL,
    campaign_id UUID NOT NULL,
    survey_template_id UUID NOT NULL,
    surveyor_id UUID NOT NULL,
    geo_constituency_id UUID,
    geo_booth_id UUID,
    approved_at TIMESTAMPTZ NOT NULL,
    -- denormalized flat answer facts for metadata-flagged analytics_filter/group_by questions only
    -- (not all answers — keeps this table narrow; full answers remain in record_answers)
    filterable_answers JSONB NOT NULL,
    PRIMARY KEY (record_id, approved_at)
);
SELECT create_hypertable('record_facts', 'approved_at');

-- Example continuous aggregate: daily submission counts per campaign per geography
-- (one of several generated per survey template's analytics config — see 09-ANALYTICS-SPEC.md)
CREATE MATERIALIZED VIEW campaign_daily_counts
WITH (timescaledb.continuous) AS
SELECT
    campaign_id,
    tenant_id,
    geo_constituency_id,
    time_bucket('1 day', approved_at) AS day,
    COUNT(*) AS approved_count
FROM record_facts
GROUP BY campaign_id, tenant_id, geo_constituency_id, day;

SELECT add_continuous_aggregate_policy('campaign_daily_counts',
    start_offset => INTERVAL '3 years',
    end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 day');  -- default cadence per BR-046; overridable per tenant/campaign
```

### 2.10 Dashboards, Reports, Export, Notifications, Audit

```sql
CREATE TABLE dashboards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    survey_template_id UUID NOT NULL REFERENCES survey_templates(id),
    name TEXT NOT NULL,          -- auto-named after survey (BR-050a), editable
    layout JSONB,                -- widget positions, persisted per FR-DSH-01
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE dashboard_widgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dashboard_id UUID NOT NULL REFERENCES dashboards(id),
    widget_type TEXT NOT NULL CHECK (widget_type IN ('kpi','bar','pie','trend','map','surveyor_performance')),
    question_version_id UUID REFERENCES question_versions(id),  -- source question, if applicable
    config JSONB NOT NULL,       -- chart-specific config derived from question metadata
    display_order INT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE report_export_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    dashboard_id UUID NOT NULL REFERENCES dashboards(id),
    requested_by UUID NOT NULL REFERENCES users(id),
    filters JSONB,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','ready','failed')),
    r2_key TEXT,
    generated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE data_export_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),   -- the tenant being exported
    requested_by UUID NOT NULL REFERENCES users(id),
    format TEXT NOT NULL CHECK (format IN ('csv','json')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','ready','failed')),
    r2_key TEXT,
    generated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    tenant_id UUID REFERENCES tenants(id),
    message TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID NOT NULL REFERENCES users(id),   -- specific account, per BR-061 actor-level requirement
    actor_role TEXT NOT NULL,
    tenant_id UUID REFERENCES tenants(id),          -- NULL for platform-level Super Admin actions
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    -- append-only: no UPDATE/DELETE grants on this table for any application role (FR-AUD-03)
);
CREATE INDEX idx_audit_tenant ON audit_log(tenant_id, created_at DESC);
CREATE INDEX idx_audit_actor ON audit_log(actor_id, created_at DESC);
```

---

## 3. Row-Level Security (tenant isolation backstop, per System Design §3)

```sql
-- Standard pattern: tables where tenant_id is NOT NULL (the vast majority — campaigns, records, etc.)
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_campaigns ON campaigns
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- Nullable-tenant_id pattern: users, notifications, audit_log — where tenant_id IS NULL
-- represents a genuinely platform-level row (a Super Admin account, a platform-wide notification,
-- a Super-Admin-actor audit entry). The naive policy above would silently hide these from everyone
-- (NULL = anything is never true in SQL), which is correct for client_admin/dashboard_viewer/surveyor
-- sessions (they should never see platform-level rows) but must be handled explicitly, not by accident:
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_audit_log ON audit_log
    USING (
        tenant_id = current_setting('app.current_tenant_id')::UUID
        OR (tenant_id IS NULL AND current_setting('app.current_role')::TEXT = 'super_admin')
    );
-- (repeat this nullable-aware pattern for `users` and `notifications`, the other two
-- tables with a legitimately-NULL tenant_id, per §2.2/§2.10)

-- Super Admin bypass role (used only for genuinely platform-wide queries, e.g. the cross-tenant
-- data export in FR-EXP-01 and the tenant-monitoring list in FR-TEN-05 — NOT the default request
-- path even for Super Admin sessions, which should still set app.current_tenant_id when acting
-- "as" a tenant context, e.g. viewing one tenant's audit log, and only use this bypass role for
-- the genuinely cross-tenant queries):
CREATE ROLE super_admin_role BYPASSRLS;
```

Apply the standard (`NOT NULL tenant_id`) pattern to: `surveyor_profiles`, `seat_limit_requests`, `questions`, `question_versions` (where `tenant_id IS NOT NULL` — global questions are only visible via the explicit "global OR own-tenant" query the Question Bank service already constructs, not via a blanket RLS bypass), `survey_templates`, `survey_template_versions`, `campaigns`, `assignments`, `assignment_history`, `records`, `record_answers`, `record_pause_events`, `record_photo_evidence`, `record_audio_evidence`, `record_reviews`, `dashboards`, `dashboard_widgets`, `report_export_jobs`, `data_export_jobs`.

Apply the nullable-aware pattern (shown above for `audit_log`) to: `users`, `notifications`.

---

## 4. Key Design Notes for Code Agents

1. **`record_facts` is intentionally denormalized and narrow.** It exists only to feed TimescaleDB continuous aggregates fast; it is not the source of truth (that's `records` + `record_answers`) and should never be joined back for detailed record display — use `records`/`record_answers`/evidence tables for that (e.g. the Review screen).
2. **`geo_constituency_id`/`geo_booth_id` on `records`** are resolved once at sync time via a PostGIS `ST_Within` query against `geo_boundaries`, then stored denormalized on the record — this avoids a spatial join on every dashboard filter query. Both are nullable and may remain NULL if `gps_status != 'captured'` (see note 6) or if boundary data isn't configured for that region (FR-GIS-02).
3. **`metadata JSONB` on `question_versions`** is the literal implementation of the PRD §7 metadata-driven engine and the Business Rules §3.1 rule schema — this is the single field a code agent should treat as the canonical validation/visibility/analytics source, not scattered boolean columns.
4. **Composite Record ID generation** (`record_code`): server-side sequence per `campaign_id`, formatted per Business Rules §1.4 (`{campaign_code}-{sequence}` or `-R2` suffix for resubmissions) — implement as a Postgres sequence or advisory-lock-guarded counter per campaign, not a naive `COUNT(*)+1` (race-condition prone under concurrent syncs). `record_code` is nullable and assigned only on first successful sync (System Design §4.2 step 3/4) — before that, `local_draft_id` is the client-side identifier used for idempotent upsert.
5. **Seat limit enforcement** (Business Rules §5): the `COUNT(active sub_admins) < tenant.sub_admin_limit` check and the subsequent `INSERT INTO users` must happen in the **same transaction** with an appropriate isolation level (or `SELECT ... FOR UPDATE` on the tenant row) to prevent a race under concurrent creation requests. No unique index can express "at most N rows of this type" — the transactional guard is the actual enforcement; `idx_users_role_tenant_active` only makes that guard's COUNT() query fast.
6. **GPS lock failure is a first-class state, not an error.** `records.gps_status` (`pending`/`captured`/`unavailable`) exists because UX Spec §4a.2 requires a graceful, template-configurable fallback when GPS acquisition is slow or fails in the field — `gps_point` is nullable to support this. `chk_gps_before_review` enforces that a record cannot progress past `submitted_locally`/`syncing` while `gps_status` is still `pending` (i.e., the surveyor must reach a resolved state — captured or explicitly unavailable — before submission finalizes), without forcing every record to have a non-null point at creation time.
7. **Assignment reassignment is insert-plus-mark-removed, never an in-place `campaign_id` mutation** (see `assignments`/`assignment_history` in §2.4). This preserves a reconstructable history and avoids racing the `idx_assignments_unique_active` partial unique index. A code agent implementing `POST /assignments/{id}/reassign` (API Spec §6) must perform both writes (mark old row `removed`, insert new row) in one transaction, then write the `assignment_history` entry referencing both `old_assignment_id` and `new_assignment_id`.
8. **`tenant_id` is denormalized onto every child table of `records`** (`record_answers`, `record_pause_events`, `record_photo_evidence`, `record_audio_evidence`), not just inherited via join through `records`. This is deliberate: it lets each table's RLS policy filter directly on its own `tenant_id` column rather than requiring a subquery/join against `records` inside the policy itself, which is both faster and easier to verify correct in isolation (Testing Strategy §2.1's isolation suite should test each table independently, not just `records`).

---
*Next document: `07-API-SPEC.md` (REST API Specification)*
