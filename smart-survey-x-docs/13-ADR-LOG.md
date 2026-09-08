# Smart Survey X — Architecture Decision Record (ADR) Log

**Version:** 1.0 (living document — update as new decisions are made)

---

## Purpose

This log captures significant architectural/product decisions made during planning, the alternatives considered, and — critically — **open questions that remain genuinely unresolved**. Code agents should consult this before inventing a solution to an ambiguous requirement; if a gap is found during implementation that isn't covered by any document, it should be added here as a new open item rather than silently resolved inline.

---

## Decided (locked, with rationale)

### ADR-001: Shared-database multi-tenancy over schema-per-tenant or DB-per-tenant
**Decision:** Single Postgres database, `tenant_id` on every tenant-scoped table, enforced via app-layer filtering + Row-Level Security.
**Alternatives considered:** Schema-per-tenant (more isolation, more migration complexity at scale); DB-per-tenant (maximum isolation, highest cost/ops overhead).
**Rationale:** Lowest cost/complexity for MVP scale; two-layer enforcement (System Design §3) mitigates the main risk (cross-tenant leakage).
**Revisit if:** A tenant requires contractual/regulatory data isolation stronger than RLS can provide.

### ADR-002: Client-wins sync conflict strategy
**Decision:** Surveyor's local device is the source of truth for a draft until submit; no server-side overwrite of unsubmitted local drafts.
**Alternatives considered:** Last-write-wins; server-side merge with conflict-review UI.
**Rationale:** Surveyors work solo on their own assignments — collision risk is low; building a merge-review UI was judged not worth the complexity for MVP.
**Revisit if:** Multi-surveyor collaboration on the same record ever becomes a requirement.

### ADR-003: Modular monolith over microservices at launch
**Decision:** One FastAPI deployable, 18 internally-bounded modules (System Design §2), service-interface boundaries preserved for future extraction.
**Rationale:** Avoids premature operational overhead; extraction path is explicitly designed for (System Design §8), not an afterthought.

### ADR-004: TimescaleDB continuous aggregates over a separate analytics warehouse
**Decision:** Use TimescaleDB (free Postgres extension) for the batched aggregation pipeline rather than standing up ClickHouse/BigQuery/etc.
**Rationale:** Directly serves the "minimize DB compute" requirement while staying inside one database engine; avoids a second system to operate, back up, and keep in sync.
**Revisit if:** Aggregate table sizes or query complexity genuinely outgrow single-instance Postgres+Timescale at real tenant/submission volumes.

### ADR-005: Review/approval gate before analytics visibility
**Decision:** A record is invisible to all analytics/dashboards until a Client Admin approves it via audio cross-check.
**Rationale:** Explicit product requirement — audio is the source of truth for verifying field accuracy; prevents unverified data from influencing decisions.

### ADR-006: Lightweight resubmission (one retry) for rejected records
**Decision:** A rejected record (first attempt) offers exactly one resubmission as a **new linked record** (never an edit of the rejected one); a second rejection is final.
**Rationale:** Avoids a dead end for surveyors when re-interviewing isn't feasible, while preserving evidence immutability and keeping the loop bounded.

### ADR-007: Role hierarchy — Super Admin (≤3) / Client Admin Main / Sub Admin / Dashboard Viewer / Surveyor
**Decision:** Fixed 5-role model (Survey Supervisor reserved, Phase 2); Dashboard Viewer creation restricted to Client Admin (Main) only; Sub Admin otherwise matches Main's operational permissions.
**Rationale:** Explicit product requirement, seat-limited with a Super-Admin-approved upgrade request flow (no billing engine built).

### ADR-008: Admin/Reviewer/Viewer surfaces are web-only; only Surveyor gets a native app
**Decision:** Super Admin, Client Admin (Main/Sub), Dashboard Viewer use a responsive Next.js web portal exclusively. Flutter is Surveyor-only.
**Rationale:** Admin/review/analytics work is desk-first; a native app adds build/distribution cost with no offline-capability benefit for these roles.

### ADR-009: Closed-set input types and validation operators (no custom types in MVP)
**Decision:** 12 fixed input types (Business Rules §3.2 / PRD §8e); Survey Builder does not allow defining a new type.
**Rationale:** Keeps the metadata-driven validation engine and the client/server rule-parity guarantee (Testing Strategy §2.8) tractable — an open-ended type system would make that parity much harder to guarantee.

### ADR-010: Validation Rule Engine — generic schema interpreters, not per-question dual implementations
**Decision:** Both Python and Dart implementations are generic interpreters of one declarative JSON rule schema, not independently hand-written business logic that happens to cover the same cases.
**Alternatives considered:** Two hand-written implementations kept in sync purely via tests (original approach — rejected as insufficient once reviewed: testing catches drift after it happens, it doesn't prevent it).
**Rationale:** A ~150–250 line generic interpreter in each language, changed rarely (only when the operator/type set itself changes), is a structurally smaller and more stable risk surface than two growing, independently-evolving rule engines. See `14-CODING-STANDARDS.md` §5.

### ADR-011: Read replica for analytics from launch, not as a later scaling response
**Decision:** Analytics/Dashboard/Reports/Data-Export read paths route to a Postgres read replica from Day 1; transactional paths (sync, review, auth) stay on the primary exclusively.
**Rationale:** The transactional path (surveyor sync) must never degrade due to analytics load — retrofitting this separation after traffic patterns are load-bearing on a single instance is materially harder than building the routing convention in from the start. See `05-SYSTEM-DESIGN.md` §1c.
**Cost note:** most managed Postgres providers supporting the required extensions offer read replicas even on lower tiers — confirm at provider selection time (`12-DEPLOYMENT.md` §2).

### ADR-012: API versioning and mobile-compatibility policy defined pre-emptively
**Decision:** `/api/v1` reserved as immediately-superseded-by-`/v2`-when-needed pattern; `min_supported_app_version` field on sync responses; 90-day default deprecation window; schema-versioned template snapshots.
**Rationale:** Field devices cannot be assumed to update promptly. Without this policy defined before launch, the first breaking backend change becomes a crisis rather than a routine, planned rollout. See `05-SYSTEM-DESIGN.md` §13.

### ADR-013: Database schema corrected after tracing real flows end-to-end
**Decision:** A flow-level audit of the initial schema (tracing New Record → Sync → Review, Assignment reassignment, Seat limits, GPS lock failure) found and fixed seven issues:
1. `records.gps_point` was `NOT NULL`, making GPS-lock-failure handling (UX Spec §4a.2) impossible to represent — changed to nullable with a new `gps_status` enum (`pending`/`captured`/`unavailable`) and a `chk_gps_before_review` constraint enforcing resolution before submission.
2. `record_pause_events`, `record_answers`, and both evidence tables lacked `tenant_id`, making the documented RLS policy pattern require an unstated join — added denormalized `tenant_id` to all four for direct, verifiable RLS.
3. `assignments` had no constraint preventing duplicate active rows for the same surveyor+campaign — added a partial unique index.
4. "Reassignment" was ambiguous between in-place mutation and insert-new-row; in-place mutation would have destroyed reconstructable assignment history — formalized as insert-plus-mark-removed, with `assignment_history` updated to reference both the old and new assignment rows explicitly.
5. `idx_super_admin_limit` was a dead/misleading index that didn't actually cap anything — removed and replaced with an index that genuinely supports the real enforcement mechanism (transactional COUNT-then-INSERT).
6. `record_code` was `NOT NULL UNIQUE` despite being assigned late (post-sync, per FR-EVD-07) — changed to nullable with a partial unique index, `local_draft_id` confirmed as the correct pre-sync identifier.
7. The RLS section's handling of legitimately-NULL `tenant_id` rows (`users`, `notifications`, `audit_log`) was hand-waved as "allowed through" without a concrete policy — replaced with an explicit nullable-aware policy pattern.
**Rationale:** These weren't style issues — #1, #3, #4, and #6 would have caused either data loss, silent duplication, or an unrepresentable required product state (GPS fallback) in production. See `06-DATABASE-DESIGN.md` §2.4/§2.5/§2.6/§3/§4 and `04-BUSINESS-RULES.md` §7 for the corrected specs.

### ADR-014: Fact materialization is transactional on approve, not deferred solely to a batch job
**Decision:** When a Client Admin approves a record, the Processing module inserts one row into `record_facts` in the same (or an immediately following) transaction, via `materialize_fact()`. The scheduled/Beat job only refreshes continuous aggregates, retries `fact_status='failed'` records, and updates the freshness watermark — it does not re-derive facts from raw records on a schedule.
**Alternatives considered:** A pure nightly batch that scans newly-approved records to build facts (the original design); an event-sourced outbox pattern.
**Rationale:** Makes "approved → eligible for analytics" deterministic and near-real-time (bounded by the next aggregate refresh, not by a full day), while keeping the actually expensive GROUP BY work inside Timescale's incremental engine. Idempotent via `ON CONFLICT DO NOTHING`, so safe to retry.
**See:** `09-ANALYTICS-SPEC.md` §2, `05-SYSTEM-DESIGN.md` §5, `17-ANALYTICS-PROCESSING-SEQUENCE.md`.

### ADR-015: Analytics metadata validated with a closed rule set at template publish
**Decision:** `analytics_filter`, `group_by`, `chart_type`, `aggregation_fn`, and `filter_ui` are part of the question metadata schema and are validated against a closed rule set inside the publish transaction (e.g. free-text cannot be a filter; `sum`/`avg` only on numeric input types; at most one `chart_type=map` question per template). Invalid combinations reject the publish, with a structured per-question error.
**Rationale:** Prevents a template from publishing into a "dashboard that shows nothing useful" state, and keeps fact materialization and continuous-aggregate definitions predictable rather than needing to handle arbitrary metadata combinations at read time.
**See:** `09-ANALYTICS-SPEC.md` §1, `04-BUSINESS-RULES.md` §3.1.

### ADR-016: Three system widgets always present; every dashboard response carries a freshness watermark
**Decision:** Every published template's dashboard receives three system widgets unconditionally (submissions KPI, Surveyor Performance, map), regardless of question metadata. Every `GET /dashboards/{id}/data` response includes `data_as_of`; the UI must surface it, with a non-blocking warning chip if aggregation lag exceeds 2× the expected refresh interval.
**Rationale:** Guarantees a dashboard is never empty-by-construction even for a template with sparse analytics flags, and makes the inherent lag of a batched/near-real-time aggregation pipeline visible and trustworthy rather than silently stale — directly closes a gap in the original design, which built the batching pipeline but never told the Client Admin how fresh what they're looking at is.
**See:** `09-ANALYTICS-SPEC.md` §3, §8, `08-UXUI-SPEC.md` §4b, FR-DSH-02/03.

---

## Open Questions (genuinely unresolved — do not silently assume an answer)

### OPEN-001: GeoJSON boundary data source
**Status:** TBD (PRD §13, referenced throughout GIS module).
**Impact:** Map choropleth widgets degrade to pin/list view (FR-GIS-02) until resolved — this is a graceful degradation, not a blocker, but real election-analytics value depends on resolving this.
**Next step:** Evaluate free/open government shapefile sources per region vs. a paid boundary-data vendor; PRD §13 already scaffolds a pluggable provider interface so this can be wired in without a redesign.

### OPEN-002: Notification provider (SMS/push/email)
**Status:** TBD. MVP ships in-app notifications only (FR-NOT-01), interface-based/pluggable.
**Next step:** Confirm which channel(s) are actually needed before Phase 2 — likely SMS for surveyor campaign-assignment alerts in low-connectivity regions, but not yet confirmed.

### OPEN-003: Survey Supervisor role scope (Phase 2)
**Status:** Named in PRD as Phase 2 but no functional spec written yet.
**Next step:** When prioritized, needs its own pass through BRS/FRS — likely sits between Surveyor and Client Admin in the review workflow (PRD §8a currently has Client Admin doing this role's job as an interim measure).

### OPEN-004: Correcting a wrong review decision (approved/rejected) after the fact
**Status:** Explicitly out of scope as a product flow (Business Rules §1.3 rule 6) — treated as an out-of-band ops action.
**Next step:** If this becomes a real operational pain point post-launch, needs a deliberate design (likely a new "correction" audit-logged action, not simply unlocking the existing state machine).

### OPEN-005: Filter presets / saved dashboard views
**Status:** Not in MVP scope (Analytics Spec §4 note). Flagged, not designed.
**Next step:** Natural Phase 2 candidate if Client Admins request it after using ad-hoc filtering for a while.

### OPEN-006: Aggregation refresh cadence configuration UI
**Status:** Partially closed. Database column (`campaigns.aggregation_refresh_interval`) and mechanism specified (Analytics Spec §7/§8); the **display** side is now specified (`08-UXUI-SPEC.md` §4b — `data_as_of` header, lag warning chip). What's still missing: an actual admin-facing **input control** to set the override interval in the first place (likely a Campaign Settings panel field) — nothing in the UX spec currently lets a Client Admin change this value, only see its effect.
**Next step:** Add a simple numeric/interval input to the Campaign settings screen in the Admin Portal, wired to `PATCH` the campaign's `aggregation_refresh_interval`. Small, well-scoped gap.

---

## How to Add to This Log

When implementation surfaces a genuine gap (a decision this doc set doesn't cover), add it under **Open Questions** with: status, impact (does it block anything or degrade gracefully), and a proposed next step — then flag it to the product owner rather than resolving it silently in code. When a decision is made, move it to **Decided** with rationale, and update any documents that referenced it as TBD.
