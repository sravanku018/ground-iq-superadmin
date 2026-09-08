# Smart Survey X — Analytics & Dashboard Specification

**Version:** 1.1 (Analytics pipeline deepened)
**Depends on:** `01-PRD.md` §7/§10/§11c, `03-FRS.md` Analytics/Dashboard/GIS/Processing modules, `04-BUSINESS-RULES.md` §3 (metadata schema), `05-SYSTEM-DESIGN.md` §5/§6, `06-DATABASE-DESIGN.md` §2.9
**Change summary (v1.1):** Input metadata refined and validated at publish; fact-materialization made a first-class, transactional step on approval; background processing contracts clarified; widget data contracts and freshness rules expanded; system widgets and election-type defaults made explicit.

---

## 0. Purpose & Pipeline Overview

This document is the single source of truth for **how question metadata becomes a working dashboard** and **how approved records become queryable analytics**.

The end-to-end path is deliberately simple and staged so each step is cheap, testable, and idempotent:

```
Question metadata (input)
        │
        ▼  (validated at template publish)
Dashboard + filter + widget definitions  ──►  stored once, immutable per template version
        │
Record answers (field)
        │
        ▼  Structural validation (real-time on sync)
pending_review
        │
        ▼  Client Admin approve
record_facts  (fact materialization — transactional with approval, idempotent)
        │
        ▼  Timescale continuous aggregates (background, scheduled)
Pre-aggregated slices
        │
        ▼  GET /dashboards/{id}/data  (filter-aware, freshness-aware)
Dashboard widgets + map
```

**Core rules (non-negotiable):**
1. Only **approved** records ever enter `record_facts` or any aggregate.
2. Dashboard generation is **metadata-driven and automatic** at publish — no manual widget wiring in MVP.
3. Dashboard reads prefer **pre-aggregated** data; live queries over `record_facts` are the fallback only.
4. Aggregation lag is visible to the Client Admin (“Data as of …”).

---

## 1. Input Metadata Refinement (what drives everything)

Analytics quality is determined at **template authoring time**. The metadata block on every question (see `04-BUSINESS-RULES.md` §3.1, extended below) is the only input the dashboard generator and fact materializer consume.

### 1.1 Analytics-relevant fields (per question)

| Field | Type | Required when | Meaning |
|---|---|---|---|
| `analytics_filter` | bool | always present | If true, this question becomes a dashboard filter |
| `group_by` | bool | always present | If true, results can be grouped/aggregated by this question’s answer |
| `chart_type` | enum \| null | optional | One of `kpi` \| `bar` \| `pie` \| `trend` \| `map` \| null. If set, a widget is auto-created |
| `aggregation_fn` | enum \| null | when `chart_type` in {kpi, bar, pie, trend} | `count` \| `count_distinct` \| `sum` \| `avg` \| `distribution`. Default = `count` for categorical, `avg` for numeric scales |
| `filter_ui` | enum \| null | when `analytics_filter = true` | Derived if omitted: select types → multi-select dropdown; date types → range; number/scale → min/max range; yes_no → toggle |

### 1.2 Closed validation rules at Publish (must pass or publish is rejected)

These rules run inside the same transaction as template version snapshot + dashboard generation (`FR-SB-04`):

1. `chart_type = map` is allowed only when meaningful; prefer the system map widget for geography.
2. `aggregation_fn = sum | avg` is allowed **only** when `input_type` is `number` or `scale`.
3. `aggregation_fn = distribution | count` is the only valid choice for `single_select` / `multi_select` / `yes_no`.
4. A question with `chart_type` set **must** have either `group_by = true` or be a pure KPI (`chart_type = kpi`).
5. `analytics_filter = true` on free-text (`text_short` / `text_long`) is **rejected** — free text is not a usable filter dimension in MVP.
6. At most **one** question may declare `chart_type = map` per template (system map already covers geography).
7. Every template must produce **at least** the three system widgets (see §3) even if no question has analytics flags.

Failed rules surface as structured validation errors on the publish endpoint (question_id + rule code), not a generic 400.

### 1.3 Why this refinement matters

- Prevents “dashboard that shows nothing useful” after publish.
- Makes fact materialization deterministic: only answers whose questions have `analytics_filter` or `group_by` or `chart_type` are copied into `record_facts.filterable_answers`.
- Keeps continuous-aggregate definitions small and predictable.

---

## 2. Fact Materialization (the critical bridge)

When a record transitions to **`approved`**, the Processing module **transactionally** inserts one row into `record_facts`. This is **not** left solely to a daily batch.

### 2.1 Contract

```
On approve(record_id):
  BEGIN
    INSERT INTO record_facts (…)
      VALUES (… derived from record + answers + geo …)
      ON CONFLICT (record_id, approved_at) DO NOTHING;   -- idempotent
    -- continuous aggregates pick the new row on next refresh
  COMMIT
```

- **Idempotent:** re-running the materializer never double-counts.
- **Narrow payload:** `filterable_answers` JSONB contains **only** answers for questions flagged `analytics_filter` or `group_by` or `chart_type`. Full answers stay in `record_answers`.
- **Geography:** `geo_constituency_id` / `geo_booth_id` are resolved at materialization time from the locked GPS point (or left NULL if `gps_status = unavailable`).
- **Failure:** if materialization fails, the record stays `approved` but is flagged `fact_status=failed` and is visible to Client Admin for manual retry. It does **not** appear in dashboards until the fact row exists.

### 2.2 What the scheduled “aggregation job” actually does

It does **not** re-scan raw records. It only:

1. Ensures any `fact_status=failed` records are retried (or reported).
2. Triggers `refresh_continuous_aggregate(...)` for the relevant views (or relies on Timescale’s own policy).
3. Updates an analytics watermark / last-refresh timestamp that the dashboard API exposes as “Data as of …”.

This keeps the expensive path (GROUP BY over large sets) inside Timescale’s incremental engine.

---

## 3. System Widgets (always present)

Every published template receives these three widgets regardless of question metadata:

| Widget key | Type | Data source | Notes |
|---|---|---|---|
| `sys_kpi_submissions` | kpi | continuous aggregate / record_facts | Total approved submissions (campaign-scoped) |
| `sys_surveyor_performance` | bar / table | record_facts | Submissions per surveyor, avg duration (`submitted_at - captured_at`), evidence completeness % |
| `sys_map` | map | record_facts + geo_boundaries | Choropleth by constituency/booth when boundary data exists; otherwise GPS pins only (graceful degradation) |

---

## 4. Metadata → Dashboard Generation Algorithm (refined)

Executed inside `POST /survey-templates/{id}/publish` in the **same transaction** as the immutable template version snapshot:

1. Validate analytics metadata (§1.2). Fail publish if invalid.
2. Create `dashboards` row linked to the new template version.
3. Always attach the three system widgets (§3).
4. For each question:
   - If `analytics_filter = true` → create a filter definition (UI type from `filter_ui` or derived).
   - If `chart_type` is set → create a widget bound to that question + `aggregation_fn` + optional `group_by` dimension.
5. Persist default layout: KPIs top row → charts in responsive grid → map full-width (UX Spec §4.1).
6. Persist the generated filter set and widget set; they are immutable for this template version. Rearrange (FR-DSH-01) only changes layout positions, not definitions.

No manual “add widget” screen exists in MVP.

---

## 5. Widget Data Contracts

Every widget request returns a consistent envelope so the frontend never has to special-case:

```json
{
  "widget_id": "uuid",
  "widget_key": "sys_kpi_submissions | q_042_bar | …",
  "type": "kpi | bar | pie | trend | map | table",
  "title": "…",
  "data_as_of": "2026-08-09T05:00:00Z",
  "filters_applied": { … },
  "payload": { … type-specific … },
  "empty": false,
  "degraded": false,
  "degraded_reason": null
}
```

### 5.1 Type-specific payload shapes

| Type | `payload` shape |
|---|---|
| `kpi` | `{ "value": number, "unit": string \| null, "delta": number \| null, "delta_period": "previous_day" \| null }` |
| `bar` / `pie` | `{ "categories": [ {"key": string, "label": string, "value": number} ] }` |
| `trend` | `{ "points": [ {"t": "ISO date", "value": number} ], "granularity": "day" \| "week" }` |
| `map` | `{ "mode": "choropleth" \| "pins", "features": […], "pins": [ {"lat", "lng", "record_id"} ] }` |
| `table` (surveyor performance) | `{ "rows": [ {"surveyor_id", "name", "submissions", "avg_duration_sec", "evidence_pct"} ] }` |

`empty: true` when the filtered set has zero approved facts.  
`degraded: true` when boundary data is missing (map falls back to pins) or a continuous aggregate is stale beyond a threshold.

---

## 6. Filter Semantics & Query Path

- **System filters** (always present): geography (constituency / booth), date range on `approved_at`, surveyor.
- **Metadata filters**: only questions with `analytics_filter = true`.
- Combination logic: **AND** across different filter dimensions; **OR** within a multi-select filter’s selected values.
- Review status is **not** a user-facing filter — dashboards only ever see approved facts.
- `GET /dashboards/{id}/data` accepts the full active filter set as query parameters. Frontend keeps filter state locally and re-fetches on every change.
- **Read path priority:**
  1. Continuous aggregate that matches the requested dimensions → use it.
  2. Else scoped live query over `record_facts` (never over raw `records` / `record_answers`) bounded by `tenant_id` + `campaign_id`.
  3. Never compute aggregates from unapproved or rejected records.

---

## 7. Background Processing Contracts (clarified)

| Job | Trigger | Responsibility | Idempotency | Failure handling |
|---|---|---|---|---|
| Fact materialization | On `approved` transition (same transaction preferred) | Insert one `record_facts` row | `ON CONFLICT DO NOTHING` | Mark `fact_status=failed`; Client Admin can retry |
| Continuous-aggregate refresh | Timescale policy (default daily) **or** Celery Beat override per campaign | Refresh only changed time buckets | Native to Timescale | Alert on repeated failure; lag becomes visible |
| Processing-failed retry | Celery Beat (e.g. hourly) | Re-attempt materialization for `fact_status=failed` records | Same as materialization | Escalate after N failures |
| Watermark update | After successful refresh | Write `last_analytics_refresh_at` (tenant/campaign level) | Overwrite | Dashboard shows last known good timestamp |

**Celery Beat** is only required for:
- Per-campaign override cadences (`campaigns.aggregation_refresh_interval`)
- Retry of `fact_status=failed`
- Optional forced refresh endpoint for Client Admin (future)

Default daily refresh can be left entirely to Timescale’s continuous-aggregate policy.

---

## 8. Aggregation Refresh Cadence & Freshness

- Default: Timescale continuous-aggregate policy, once per day.
- Override: nullable `campaigns.aggregation_refresh_interval` (minutes). When set, Celery Beat triggers an explicit refresh for that campaign’s aggregates.
- Dashboard API **always** returns `data_as_of` (from watermark or max `approved_at` present in the underlying aggregate).
- UX requirement: every dashboard header shows “Data as of {relative time}”. If lag > 2× expected interval, show a non-blocking warning chip.

---

## 9. Election-Type Default Widget Sets (BR-051)

When a campaign's template has one of the five locked `election_type` values (Database Design §2.3: `mla`, `mp`, `municipal`, `district`, `state` — `generic` gets no additions), the auto-generated set from §4 is augmented with the following defaults, **in addition to** the three system widgets (§3). This is the closed, complete list for MVP — a code agent must not infer additional election-type widgets not listed here (if a gap is found, log it in `13-ADR-LOG.md`):

| Election type | Additional default widgets |
|---|---|
| **MLA** (state assembly constituency) | KPI: total constituencies covered · Map: choropleth by constituency · Bar: top issues by constituency (if an issues-style multi_select question exists in the template) |
| **MP** (parliamentary constituency) | KPI: total parliamentary constituencies covered · Map: choropleth by parliamentary constituency (aggregating child assembly constituencies) · Trend: submission pace over campaign duration |
| **Municipal** | KPI: total wards covered · Map: choropleth by ward · Bar: ward-level comparison on a designated key-metric question |
| **District** | KPI: total districts/blocks covered · Map: choropleth by district · Pie: urban vs. rural split (if such a question exists) |
| **State** | KPI: statewide coverage % (booths surveyed / total booths, if a booth universe is configured) · Map: choropleth by district, drill-down to constituency · Trend: statewide submission pace |
| **Generic** (non-election) | No election-specific additions — only the metadata-derived set from §4 and the system widgets from §3 |

These defaults still depend on the template actually carrying matching questions/metadata flags (e.g. the MLA "top issues" bar needs a question flagged `group_by=true` with a plausible issues-style shape) — if the template's questions don't support a given default widget, the generator omits it rather than erroring; system widgets (§3) are the only ones guaranteed unconditionally.

---

## 10. Report (PDF) Content

Unchanged in intent (FR-RPT-01 / BR-052):
- Dashboard name, generation timestamp, generating user (name + role)
- Active filter summary line
- Each widget rendered as static image/table matching on-screen state
- `data_as_of` printed on the cover
- Does **not** include raw record-level answers or evidence links (that is Data Export)

---

## 11. Implementation Notes for Code Agents

1. Fact materialization belongs to the **Processing** module and is called from the Review module’s approve path via the service interface — never by a direct cross-module table write.
2. Continuous aggregates are defined **per template’s analytics config** at publish time (or a stable set of generic ones + JSONB filterable dimensions). Prefer a small number of well-indexed continuous aggregates over dozens of tiny ones.
3. The Analytics module is the **only** module allowed to query `record_facts` and continuous aggregates for dashboard/report purposes.
4. All dashboard data endpoints must enforce `tenant_id` from the JWT and must never accept a client-supplied tenant identifier.
5. When adding a new `chart_type` or `aggregation_fn`, update this document, the Business Rules metadata schema, the publish-time validator, and the dual validation-engine tests in the same change set.

---
*Related: `04-BUSINESS-RULES.md` §3, `05-SYSTEM-DESIGN.md` §5/§6, `06-DATABASE-DESIGN.md` §2.9, `03-FRS.md` Processing & Analytics modules, `13-ADR-LOG.md`*
