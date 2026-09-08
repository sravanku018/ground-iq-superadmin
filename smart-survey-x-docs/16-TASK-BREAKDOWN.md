# Smart Survey X — Task Breakdown

**Version:** 1.0 (Locked)
**Depends on:** all prior documents — this is the execution sequencing of the full spec
**Numbering note:** filed as `16-` per request; `15-GIT-HANDBOOK.md` / a Developer Guide remain open slots from the original documentation plan (see `01-PRD.md` §0) if needed later.

---

## 0. How to Use This Document

Each task below is sized to be a single focused unit of work for a code agent (roughly: one PR). Tasks are grouped into **phases**, and phases are ordered — later phases depend on earlier ones being functionally complete, not just started. Every task lists its **source documents** (what to read before starting) and its **definition of done**, which should map to something checkable (a passing test from `11-TESTING-STRATEGY.md`, an endpoint matching `07-API-SPEC.md`, etc.), not a vague description.

Do not start a Phase 2 task before its Phase 1 dependencies are done and tested. Within a phase, tasks without a listed dependency on each other can run in parallel (multiple agents/sessions).

---

## Phase 0 — Foundations

| Task | Source docs | Definition of done |
|---|---|---|
| **0.1** Repo scaffolding | `14-CODING-STANDARDS.md` §1 | Monorepo folder structure exists exactly as specified; `docker-compose.yml` brings up Postgres+PostGIS+TimescaleDB, Redis, empty FastAPI app, empty Next.js app |
| **0.2** Database extensions + base migration tooling | `06-DATABASE-DESIGN.md` §0/§2.1, `12-DEPLOYMENT.md` §3 | `postgis`, `timescaledb`, `pgcrypto` enabled; Alembic initialized; first migration applies cleanly on a fresh DB |
| **0.2a** Read replica routing scaffold | `05-SYSTEM-DESIGN.md` §1c | Second SQLAlchemy engine bound to a replica connection string (local: can point at the same instance until a real replica exists, but the code path/convention must exist); Analytics/Dashboard/Reports/Data-Export module scaffolds use it by default |
| **0.3** Design tokens file | `08-UXUI-SPEC.md` §1 | `shared/design-tokens.json` created with full color/type/spacing/radius token set; consumable by both a Tailwind config and a Flutter `ThemeExtension` stub |
| **0.4** CI pipeline skeleton | `14-CODING-STANDARDS.md` §4, `11-TESTING-STRATEGY.md` §4, `12-DEPLOYMENT.md` §5 | PR pipeline runs lint + format-check + empty test suite on all three platforms; blocking on failure |
| **0.5** Super Admin bootstrap script | `10-SECURITY.md` §6, `12-DEPLOYMENT.md` §4 | `scripts/seed_super_admin.py` creates one Super Admin account against a fresh DB; credential input never logged |

---

## Phase 1 — Core Identity & Tenancy

*Unlocks everything else — no other module can be meaningfully tested without tenants/users/auth.*

| Task | Source docs | Definition of done |
|---|---|---|
| **1.1** `tenants` + `users` + `surveyor_profiles` schema | `06-DATABASE-DESIGN.md` §2.2 | Tables migrated with all constraints (`chk_tenant_role`, seat limit columns) |
| **1.2** Row-Level Security setup | `06-DATABASE-DESIGN.md` §3, `05-SYSTEM-DESIGN.md` §3 | RLS enabled + policy applied on `users`; `super_admin_role` created with `BYPASSRLS`; isolation test (Testing Strategy §2.1) passes |
| **1.3** Authentication module | `03-FRS.md` Auth module, `07-API-SPEC.md` §1, `10-SECURITY.md` §1 | `/auth/login`, `/auth/refresh`, `/auth/logout`, password reset endpoints working; rate limiting on login active |
| **1.4** Tenant Management module | `03-FRS.md` Tenant module, `07-API-SPEC.md` §2 | `POST /tenants` creates tenant + Main admin atomically; suspend/activate works; Testing Strategy §2.1 tenant-isolation suite passes end-to-end |
| **1.5** User Management module (roles + seat limits) | `03-FRS.md` User module, `04-BUSINESS-RULES.md` §5, `07-API-SPEC.md` §3 | Sub Admin creation (Main only, seat-limited), Dashboard Viewer creation (Main only, seat-limited), Surveyor creation with profile fields all working; Testing Strategy §2.7 suite passes (including the race-condition seat-limit test) |
| **1.6** Seat limit upgrade request flow | `03-FRS.md` FR-USR-10, `07-API-SPEC.md` §2 | Request → Super Admin approve/deny → limit updates, end to end |
| **1.7** Audit logging foundation | `03-FRS.md` Audit module, `06-DATABASE-DESIGN.md` §2.10 | `audit_log` table + a shared `log_action()` helper wired into every mutating endpoint added so far (auth events, tenant/user creation) |

**Phase 1 exit criteria:** a Super Admin can create a tenant; that tenant's Main admin can log in, create a Sub Admin and a Dashboard Viewer within seat limits, and every action is audit-logged with the correct actor. Full Testing Strategy §2.1 and §2.7 suites green.

---

## Phase 2 — Question Bank, Survey Builder & the Validation Engine

*This phase delivers the platform's core differentiator — get this right before building anything downstream of it.*

| Task | Source docs | Definition of done |
|---|---|---|
| **2.1** `questions` + `question_versions` schema | `06-DATABASE-DESIGN.md` §2.3 | Migrated, including the `metadata JSONB` GIN index |
| **2.2** Question Bank module (backend) | `03-FRS.md` Question Bank module, `07-API-SPEC.md` §4 | Global + tenant question CRUD, cloning (FR-QB-03), versioning working |
| **2.3** Validation Rule Engine — Python interpreter | `04-BUSINESS-RULES.md` §3, `14-CODING-STANDARDS.md` §5 | Generic interpreter (schema + answers → result), not per-question logic; correctly evaluates structural validation and skip-logic for all 12 input types and all 4 visibility operators; unit tests cover every operator; JSON Schema file committed to `shared/validation-schema/` |
| **2.4** `survey_templates` + `survey_template_versions` schema | `06-DATABASE-DESIGN.md` §2.3 | Migrated |
| **2.5** Survey Builder module (backend) | `03-FRS.md` Survey Builder module, `07-API-SPEC.md` §5 | Template CRUD, question attach/reorder/metadata config, circular-reference check on visibility rules (FR-SB-03) |
| **2.6** Publish transaction | `03-FRS.md` FR-SB-04, `04-BUSINESS-RULES.md` §2, `09-ANALYTICS-SPEC.md` §1 | `POST /survey-templates/{id}/publish` atomically creates version snapshot + dashboard + widgets, or fully rolls back on any failure; election-type default widgets (Analytics Spec §3) attached correctly per `election_type` |
| **2.7** Survey Builder UI (web) | `08-UXUI-SPEC.md` §4.3, `07-API-SPEC.md` §5 | Drag-reorder question list, metadata inspector panel, live form preview (mirrors mobile rendering), publish flow with clear error states |
| **2.8** Validation Rule Engine — Dart interpreter | `04-BUSINESS-RULES.md` §3, `14-CODING-STANDARDS.md` §5 | Independent generic interpreter of the same `shared/validation-schema/` JSON Schema (not a line-by-line port of the Python code); parity golden-file test suite (Testing Strategy §2.8) passes against the Python implementation |

**Phase 2 exit criteria:** a Client Admin can build a template from scratch or cloned questions, configure full metadata per question, publish it, and get an auto-generated dashboard with zero manual widget wiring. Validation parity test green.

---

## Phase 3 — Campaign, Assignment & the Surveyor App Core Loop

| Task | Source docs | Definition of done |
|---|---|---|
| **3.1** `campaigns` + `assignments` + `assignment_history` schema | `06-DATABASE-DESIGN.md` §2.4 | Migrated |
| **3.2** Campaign module (backend) | `03-FRS.md` Campaign module, `07-API-SPEC.md` §6 | CRUD + status transitions (pause/close) |
| **3.3** Assignment module (backend), incl. add/remove/reassign | `03-FRS.md` Assignment module, `04-BUSINESS-RULES.md` §4, `07-API-SPEC.md` §6 | Assignment Manager matrix endpoint; add/remove/reassign all working and audit-logged (FR-ASG-05) |
| **3.4** Flutter: local storage layer | `05-SYSTEM-DESIGN.md` §4.1, `14-CODING-STANDARDS.md` §3.3 | Drift/SQLite schema mirroring campaigns/templates/drafts; offline read works with app in airplane mode |
| **3.5** Flutter: sync protocol — pull | `05-SYSTEM-DESIGN.md` §4.2 step 1, `07-API-SPEC.md` §7 | `GET /sync/campaigns` delta-sync implemented; new assignments appear on-device after pull |
| **3.6** Flutter: Profile screen (read-only) | `01-PRD.md` §8, `08-UXUI-SPEC.md` §3.2 | Profile fields render, zero edit affordances, matches BR-035 exactly |
| **3.7** Flutter: New Record flow — capture lock | `01-PRD.md` §8, `04-BUSINESS-RULES.md`, `08-UXUI-SPEC.md` §3.3 step 1–2 | Photo+GPS capture blocks form access until locked; audio auto-starts and persists sticky indicator across screens |
| **3.8** Flutter: form rendering engine | `04-BUSINESS-RULES.md` §3, Task 2.8 | Renders correct native control per input type; skip-logic hides/shows questions live as answers change, using the ported Validation Rule Engine |
| **3.9** Flutter: pause/resume + Drafts | `01-PRD.md` §8, `04-BUSINESS-RULES.md` §1 | Pause persists full state incl. audio; resume restores exactly; app-kill-mid-form test (Testing Strategy §2.2) passes |
| **3.10** Flutter: submit + local-first lock | `04-BUSINESS-RULES.md` §1.1/1.3 | Submit succeeds fully offline; record moves to `submitted_locally`; audio/evidence locked; no network dependency in this step |
| **3.11** Evidence schema + upload flow (backend) | `06-DATABASE-DESIGN.md` §2.6, `07-API-SPEC.md` §7 | Pre-signed R2 upload URL flow; separate audio/image key prefixes; checksum finalize job |
| **3.12** Flutter: sync protocol — push | `05-SYSTEM-DESIGN.md` §4.2 steps 2–4, §4.3 | Background upload of records + media, idempotent via `local_draft_id`; visible per-record sync status; retry/backoff on failure |
| **3.13** Records schema + structural validation (backend) | `06-DATABASE-DESIGN.md` §2.5, `03-FRS.md` Validation module | `POST /sync/records` validates structurally using Task 2.3's engine; question-level errors returned per `07-API-SPEC.md` §0 error shape |
| **3.14** Composite Record ID generation | `06-DATABASE-DESIGN.md` §4 note 4 | Race-condition-safe sequence per campaign; format matches Business Rules §1.4 |
| **3.15** Flutter: Activity Log | `03-FRS.md` FR-USR-07, `08-UXUI-SPEC.md` §3.5 | Lists own records with status; tapping shows metadata only, never answers/evidence (negative test from Testing Strategy §2.5 passes) |

**Phase 3 exit criteria:** full offline-first surveyor flow works end to end — assign, download, capture, fill, pause/resume, submit, sync — with zero network calls required during data entry. Testing Strategy §2.2, §2.3, §2.4 suites green.

---

## Phase 4 — Review, Resubmission & Data Stamps

| Task | Source docs | Definition of done |
|---|---|---|
| **4.1** `record_reviews` + data stamp columns | `06-DATABASE-DESIGN.md` §2.5/§2.7 | Migrated; stamps populated automatically at each lifecycle transition (never client-writable) |
| **4.2** Review module (backend) | `03-FRS.md` Review module, `04-BUSINESS-RULES.md` §1.3 rule 4 | Approve/reject endpoints; reject requires reason; review-gate confirmed — Testing Strategy §2.6 first half passes |
| **4.3** Resubmission flow (backend) | `04-BUSINESS-RULES.md` §1.4, `07-API-SPEC.md` §7 | `POST /records/{id}/resubmit` creates correctly linked new record; second rejection is final; Testing Strategy §2.6 second half passes |
| **4.4** Review Detail UI (web) | `08-UXUI-SPEC.md` §4.2, `07-API-SPEC.md` §8 | Split view: answers + photo + GPS pin + inline audio player + stamp timeline; sticky Approve/Reject action bar |
| **4.5** Flutter: Resubmit action in Activity Log | `04-BUSINESS-RULES.md` §1.4, `03-FRS.md` FR-USR-07 | Resubmit button appears only on first-attempt rejected records; starts a genuinely fresh New Record flow, not a reopen |
| **4.6** Review-outcome pull-back sync | `05-SYSTEM-DESIGN.md` §4.3, `07-API-SPEC.md` §7 | `GET /sync/review-status` correctly updates Activity Log statuses on the surveyor's device |

**Phase 4 exit criteria:** a Client Admin can cross-check audio against typed answers and approve/reject; a rejected surveyor can resubmit exactly once; nothing reaches analytics before approval.

---

## Phase 5 — Analytics, Dashboards & GIS

**For fact-materialization, dashboard-generation, and dashboard-read-path work specifically, `18-PHASE5-ANALYTICS-TASKS.md` supersedes the task list below with a more granular breakdown (task groups A–F, with a parallelization graph) — use that document for this phase's actual execution; the table below remains as a lighter-weight summary/checklist view.**

| Task | Source docs | Definition of done |
|---|---|---|
| **5.1** `record_facts` hypertable + continuous aggregates | `06-DATABASE-DESIGN.md` §2.9, `09-ANALYTICS-SPEC.md` §5 | Hypertable created; at least one continuous aggregate (daily counts) working with the refresh policy |
| **5.2** Processing module: `materialize_fact()` called transactionally from Review approve | `05-SYSTEM-DESIGN.md` §5, `17-ANALYTICS-PROCESSING-SEQUENCE.md`, `03-FRS.md` FR-PRC-02/06 | On approval, record's filterable answers land in `record_facts` idempotently (`ON CONFLICT DO NOTHING`); on failure, `status='approved'` stands and `fact_status='failed'` is set without rolling back the approval; idempotent re-run test (Testing Strategy §2.10) passes |
| **5.3** `geo_boundaries` schema + PostGIS point-in-polygon resolution | `06-DATABASE-DESIGN.md` §2.8/§4 note 2 | At sync time, `geo_constituency_id`/`geo_booth_id` resolved and stored on the record (if boundary data available; NULL otherwise, per graceful degradation) |
| **5.4** Dashboard/Widget schema + auto-generation | `06-DATABASE-DESIGN.md` §2.10, `09-ANALYTICS-SPEC.md` §1 | Ties into Task 2.6's publish transaction; widget set matches metadata + election-type defaults exactly |
| **5.5** Dashboard data endpoint | `07-API-SPEC.md` §9, `09-ANALYTICS-SPEC.md` §2/§4 | `GET /dashboards/{id}/data` reads pre-aggregated tables, supports full filter combination, never exposes non-approved records |
| **5.6** Dashboard UI (web) | `08-UXUI-SPEC.md` §4.1 | KPI row, filter bar, chart grid, map panel; live re-render on filter change without full reload |
| **5.7** Map widget — choropleth + pin degradation | `03-FRS.md` GIS module, `09-ANALYTICS-SPEC.md` §2 | Choropleth renders when boundary data exists; falls back to pins/list otherwise, never errors |
| **5.8** Surveyor Performance widget | `03-FRS.md` FR-DSH-02, `09-ANALYTICS-SPEC.md` §1 step 5 | Per-surveyor submission count, avg completion time, evidence completeness — present on every dashboard by default |
| **5.9** Aggregation refresh cadence override | `09-ANALYTICS-SPEC.md` §5, `13-ADR-LOG.md` OPEN-006 | `campaigns.aggregation_refresh_interval` column + Celery Beat trigger; simple admin UI control to set it (closing the ADR-log gap) |

**Phase 5 exit criteria:** publishing any template produces a working, auto-filtered dashboard within minutes of the first approval; GIS degrades gracefully without boundary data; load test confirms sync latency is unaffected by aggregate volume (Testing Strategy §2.9).

---

## Phase 6 — Reports, Data Export, Notifications, Polish

| Task | Source docs | Definition of done |
|---|---|---|
| **6.1** PDF report export | `03-FRS.md` Reports module, `09-ANALYTICS-SPEC.md` §6, `07-API-SPEC.md` §10 | Async job, WeasyPrint-based, matches on-screen filtered state |
| **6.2** Data export (CSV/JSON) | `03-FRS.md` Data Export module, `10-SECURITY.md` §3, `07-API-SPEC.md` §10 | Super Admin (any tenant) vs. Client Admin (own tenant only, no selector) both working; excludes credentials/other tenants' data per FR-EXP-03 |
| **6.3** In-app notifications | `03-FRS.md` Notifications module, `07-API-SPEC.md` §11 | Provider-agnostic interface; in-app delivery for new assignment (FR-NOT-02) |
| **6.4** Team & Activity Log UI (web) | `08-UXUI-SPEC.md` §4.5, `07-API-SPEC.md` §11 | Client Admin sees their Sub Admins/Viewers with seat indicators; per-actor audit log, filterable |
| **6.5** Assignment Manager UI (web) | `08-UXUI-SPEC.md` §4.4 | Matrix view with inline add/remove/reassign |
| **6.6** Full design-token audit pass | `08-UXUI-SPEC.md` §6, `14-CODING-STANDARDS.md` §3.2 | Sweep both frontends for any hardcoded color/spacing value not from the token file; fix all findings |
| **6.7** Accessibility pass | `08-UXUI-SPEC.md` §5 | Contrast ratios verified computationally; keyboard focus rings present; touch targets ≥48px confirmed on mobile |
| **6.8** Loading/error/empty/degraded states pass | `08-UXUI-SPEC.md` §4a, §4b | Every screen from §3/§4 has all four states implemented (not just happy path) — GPS slow-lock escalation, multi-record sync panel, empty states, inline validation errors, offline banner — verified against the §4a checklist screen-by-screen |

**Phase 6 exit criteria:** MVP feature-complete per `01-PRD.md` §3.1.

---

## Phase 7 — Hardening & Launch Readiness

| Task | Source docs | Definition of done |
|---|---|---|
| **7.1** Full tenant-isolation adversarial pass | `11-TESTING-STRATEGY.md` §2.1, §4 | Every tenant-scoped endpoint explicitly tested against cross-tenant access attempts |
| **7.2** Full evidence-immutability adversarial pass | `11-TESTING-STRATEGY.md` §2.3 | Every role tested against every evidence-mutation attempt |
| **7.3** Load test: sync + aggregation decoupling | `11-TESTING-STRATEGY.md` §2.9 | Confirms sync latency doesn't degrade as aggregate data volume grows |
| **7.4** Staging deploy + demo tenant seed | `12-DEPLOYMENT.md` §1, `11-TESTING-STRATEGY.md` §3 | Staging environment live with representative seeded data across all 5 election types |
| **7.5** Production deploy | `12-DEPLOYMENT.md` §2–8 | Production environment live, Super Admin bootstrapped, monitoring in place |
| **7.6** ADR log review | `13-ADR-LOG.md` | Confirm OPEN-001 through OPEN-006 status before launch; resolve or explicitly accept as post-launch follow-ups |

---

## Dependency Graph (phase level)

```
Phase 0 (Foundations)
      │
Phase 1 (Identity & Tenancy)
      │
Phase 2 (Question Bank / Survey Builder / Validation Engine) ───┐
      │                                                          │
Phase 3 (Campaign / Assignment / Surveyor Core Loop) ◄───────────┘
      │
Phase 4 (Review / Resubmission)
      │
Phase 5 (Analytics / Dashboards / GIS)
      │
Phase 6 (Reports / Export / Polish)
      │
Phase 7 (Hardening / Launch)
```

Phases 2 and 3 have a soft dependency both ways (the Validation Engine from Phase 2 is consumed by the Surveyor App built in Phase 3) — Phase 2's backend tasks (2.1–2.6) can run alongside Phase 3's early Flutter scaffolding (3.4, 3.6), but Task 3.8 (form rendering) cannot start until Task 2.8 (Dart validation port) is done.

---
*Related: every document in this set. This is the sequencing layer, not a new source of requirements — if a task description here ever seems to contradict an earlier document, the earlier document wins (per `04-BUSINESS-RULES.md` §0 precedence rule).*
