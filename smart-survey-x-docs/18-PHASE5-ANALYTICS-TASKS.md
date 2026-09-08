# Phase 5 — Analytics / Processing / Dashboard Task List (Concrete)

**Version:** 1.0 (aligned with Analytics pipeline v1.1)  
**Source of truth:** `09-ANALYTICS-SPEC.md`, `17-ANALYTICS-PROCESSING-SEQUENCE.md`, `03-FRS.md` (FR-PRC-*, FR-ANL-*, FR-DSH-*), `05-SYSTEM-DESIGN.md` §5–§7  
**Exit criteria:** Approved records appear on dashboards with correct filters, system widgets, and visible `data_as_of`; fact materialization is idempotent and failure-isolated.

---

## Prerequisites (must be done before this phase)

- [ ] Template publish path exists and writes immutable template version snapshot  
- [ ] Question metadata includes `analytics` block; publish-time validator enforces closed rules (`09-ANALYTICS-SPEC.md` §1.2)  
- [ ] Review approve/reject path exists (status → `approved` / `rejected`, audit log)  
- [ ] `record_facts` table + hypertable created (`06-DATABASE-DESIGN.md`)  
- [ ] `campaigns.aggregation_refresh_interval` and `last_analytics_refresh_at` columns present  

---

## Task group A — Fact materialization (Processing module)

| ID | Task | Source | Definition of done |
|----|------|--------|-------------------|
| **A1** | Implement `ProcessingService.materialize_fact(record_id)` | `17-…` §1.2, `09-…` §2 | Given an approved record, inserts one `record_facts` row; builds `filterable_answers` only from analytics-flagged questions; resolves geo or leaves NULL; `ON CONFLICT DO NOTHING` |
| **A2** | Unit tests for materialize (happy, idempotent, geo unavailable, only flagged answers) | `17-…` §6 | Golden fixtures pass; second call does not double-insert |
| **A3** | Wire `ReviewService.approve` → `materialize_fact` via service interface | `17-…` §1.1, FR-PRC-02/06 | Approve transaction commits review + status; materialize called; on materialize failure, approve still committed and `fact_status='failed'` set |
| **A4** | Celery task `retry_failed_facts` | `09-…` §7, FR-PRC-04 | Hourly (or configurable) job re-attempts materialization for `fact_status='failed'` records; clears the flag on success |
| **A5** | Client Admin "Retry processing" action on failed records | FR-PRC-04 | Visible in Review queue for records where `fact_status='failed'`; calls `POST /records/{id}/retry-fact`; audit-logged |

---

## Task group B — Continuous aggregates & watermark

| ID | Task | Source | Definition of done |
|----|------|--------|-------------------|
| **B1** | Define continuous aggregates needed for system widgets + common dimensions (campaign, geo, day) | `09-…` §7–8, DB §2.9 | At least: daily counts per campaign/geo; surveyor performance base; policy default daily |
| **B2** | Watermark write after refresh | FR-PRC-05, `09-…` §8 | `campaigns.last_analytics_refresh_at` (or dedicated table) updated; exposed as `data_as_of` |
| **B3** | Celery Beat override for `aggregation_refresh_interval` | `09-…` §7 | When campaign interval is set, explicit refresh runs at that cadence |
| **B4** | Idempotency / no double-count test | FR-PRC-05, Testing Strategy §2.9 | Run refresh twice with no new facts → aggregate values unchanged |

---

## Task group C — Dashboard generation (on publish)

| ID | Task | Source | Definition of done |
|----|------|--------|-------------------|
| **C1** | Publish-time analytics metadata validator | `09-…` §1.2, ADR-015 | Invalid chart_type/aggregation_fn/filter combos reject publish with question-level errors |
| **C2** | Dashboard + system widgets creation on publish | `09-…` §3–4, FR-ANL-05, FR-DSH-02 | Every published template gets dashboard row + 3 system widgets (KPI, surveyor performance, map) |
| **C3** | Metadata-driven filters & widgets | `09-…` §4, FR-ANL-01 | `analytics_filter` → filter defs; `chart_type` → widgets with `aggregation_fn` |
| **C4** | Default layout persistence | FR-DSH-01, UX §4.1 | KPIs top, charts grid, map full-width; rearrange only changes positions |

---

## Task group D — Dashboard data API & read path

| ID | Task | Source | Definition of done |
|----|------|--------|-------------------|
| **D1** | `GET /dashboards/{id}/data` with filter query params | `09-…` §5–6, FR-ANL-03 | Returns widget envelope list; AND-across / OR-within filters; tenant from JWT only |
| **D2** | Read path: continuous aggregate first, else live `record_facts` | `09-…` §6, System Design §6 | Never queries raw `records`/`record_answers` for aggregates; never includes non-approved |
| **D3** | Widget envelope includes `data_as_of`, `empty`, `degraded` | `09-…` §5, FR-DSH-03/04 | Contract matches Analytics Spec exactly |
| **D4** | Tenant-isolation test on dashboard data | Testing Strategy §2.1 | Cross-tenant dashboard/fact access returns 403/empty, never data |

---

## Task group E — Frontend (Admin Portal dashboard UX)

| ID | Task | Source | Definition of done |
|----|------|--------|-------------------|
| **E1** | Dashboard shell: filter bar + “Data as of …” + lag warning chip | `08-UXUI` §4b, FR-DSH-03 | Freshness always visible; warning when lag > 2× interval |
| **E2** | Widget states: loading / empty / degraded / error | `08-UXUI` §4b, FR-DSH-04 | Skeletons; distinct empty copy; degraded chips; per-widget error + retry |
| **E3** | System widgets wired (KPI, surveyor performance table/bar, map) | `09-…` §3, FR-DSH-02 | All three render from API envelope |
| **E4** | Metadata widgets (bar/pie/trend/kpi) from generated config | `09-…` §5 | Correct payload shapes; empty when no data |
| **E5** | Map graceful degradation (choropleth → pins) | FR-GIS-02, `09-…` §5 | `degraded: true` + pin mode when no boundaries |

---

## Task group F — Integration & hardening

| ID | Task | Source | Definition of done |
|----|------|--------|-------------------|
| **F1** | End-to-end: publish → assign → submit → approve → appear on dashboard | PRD success metrics, Testing Strategy | Within refresh window (or forced refresh), approved record affects KPI and filters |
| **F2** | Approve failure isolation test | `17-…` §6 | Materialize forced to fail → record approved, not on dashboard, retryable |
| **F3** | Load check: sync latency vs aggregate volume | Testing Strategy §2.9 | Sync path does not degrade as `record_facts` grows |
| **F4** | PDF export includes `data_as_of` and active filters | `09-…` §10, FR-RPT-01 | Snapshot matches on-screen state |

---

## Suggested parallelization

```
A1–A2  ──►  A3  ──►  A4–A5
                │
B1–B2  ─────────┼──►  D1–D3  ──►  E1–E5  ──►  F1–F4
                │
C1–C4  ─────────┘
```

A (materialization) and C (dashboard generation) can start in parallel once prerequisites are met. D depends on A+B+C. E depends on D. F is the gate.

---

## Out of scope for this phase (still Phase 2 / open)

- Saved filter presets  
- Manual “add any widget” builder  
- Excel export of dashboard  
- Forced “Refresh now” button (optional stretch if time permits)  
- Survey Supervisor mid-level review role  

---
*Related: `16-TASK-BREAKDOWN.md` Phase 5, `09-ANALYTICS-SPEC.md`, `17-ANALYTICS-PROCESSING-SEQUENCE.md`*
