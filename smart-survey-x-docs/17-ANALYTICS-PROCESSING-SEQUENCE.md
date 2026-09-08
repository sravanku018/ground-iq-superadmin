# Smart Survey X — Review → Approve → Fact Materialization Sequence

**Version:** 1.0  
**Depends on:** `03-FRS.md` (Review, Processing, Analytics), `04-BUSINESS-RULES.md` §1, `05-SYSTEM-DESIGN.md` §5, `09-ANALYTICS-SPEC.md` §2/§7  
**Purpose:** Exact service-interface sequence so code agents implement the approve path identically and testably.

---

## 0. Goal

Make the path from “Client Admin taps Approve” to “record is eligible for dashboard widgets” **deterministic, transactional where possible, and fully observable**.

```
Review.approve(record_id)
    │
    ├─1─ write record_reviews row (immutable)
    ├─2─ transition record.status → approved
    ├─3─ set reviewed_at stamp
    ├─4─ audit log
    │
    └─5─ Processing.materialize_fact(record_id)   ← service interface call
              │
              ├─ success → record_facts row exists; continuous aggregates will pick it up
              └─ failure → record.status stays approved, fact_status=failed flag set; retry later
```

Only after step 5 succeeds (or is later retried successfully) does the record appear in any dashboard query.

---

## 1. Service Interfaces (module boundaries)

### 1.1 Review module (owns the human decision)

```python
# Pseudocode — actual signature in backend service layer

class ReviewService:
    def approve(self, *, record_id: UUID, actor: AuthenticatedUser) -> ApproveResult:
        """
        Preconditions:
          - actor.role in {client_admin_main, client_admin_sub}
          - actor.tenant_id == record.tenant_id
          - record.status == 'pending_review'
        Side effects (single transaction preferred):
          1. INSERT record_reviews (decision='approved', reviewer_id, reviewed_at)
          2. UPDATE records SET status='approved', reviewed_at=now(), fact_status='pending'
          3. INSERT audit_log
          4. CALL ProcessingService.materialize_fact(record_id)  # via service interface
        Returns:
          ApproveResult(record_id, status='approved', fact_materialized: bool)
        """

    def reject(self, *, record_id: UUID, reason: str, actor: AuthenticatedUser) -> RejectResult:
        """
        Same isolation/preconditions. No fact materialization.
        Sets status='rejected', writes reason, audit log, signals Activity Log.
        """
```

### 1.2 Processing module (owns fact materialization + background jobs)

```python
class ProcessingService:
    def materialize_fact(self, *, record_id: UUID) -> MaterializeResult:
        """
        Idempotent. Safe to call more than once.
        Steps:
          1. Load record + answers + evidence + geo resolution
          2. Assert record.status == 'approved' (or fact_status == 'failed' for a retry call)
          3. Build filterable_answers JSONB from questions where
             analytics_filter OR group_by OR chart_type is set
          4. Resolve geo_constituency_id / geo_booth_id from locked GPS
             (NULL if gps_status='unavailable')
          5. INSERT INTO record_facts (…) ON CONFLICT (record_id, approved_at) DO NOTHING
          6. Clear the fact_status='failed' flag if previously set (set fact_status='materialized')
        Returns:
          MaterializeResult(inserted: bool, already_existed: bool)
        On unexpected error:
          Set records.fact_status = 'failed', records.fact_error = <message>
          Raise / return failure so Review can surface it; do NOT roll back the approve decision.
        """

    def retry_failed_facts(self, *, limit: int = 100) -> RetrySummary:
        """Celery Beat job. Selects records where fact_status='failed', calls materialize_fact on each."""
```

### 1.3 Analytics module (read-only for dashboards)

```python
class AnalyticsService:
    def get_dashboard_data(self, *, dashboard_id: UUID, filters: FilterSet, actor: AuthenticatedUser) -> DashboardData:
        """
        - tenant_id from actor JWT only
        - Reads continuous aggregates first, falls back to record_facts
        - Always returns data_as_of from watermark / max(approved_at)
        - Never reads raw records / record_answers for aggregates
        """
```

**Rule:** Review may call Processing. Processing may write `record_facts`. Analytics may only **read** `record_facts` and continuous aggregates. No module may reach across tables belonging to another module except through these interfaces.

---

## 2. Transaction Boundaries

| Step | Preferred boundary | On failure |
|------|--------------------|------------|
| 1–4 (review write + status + audit) | Single DB transaction | Entire approve aborts; record stays `pending_review` |
| 5 (materialize_fact) | Same transaction **or** immediate follow-on transaction | Approve **commits**; record is `approved` but flagged `fact_status=failed`; fact missing until retry |

**Rationale:** A review decision must never be lost because materialization failed (e.g. transient DB error). The decision is the source of truth; the fact row is derived and retriable.

---

## 3. Fact Payload Construction (exact)

```
filterable_answers = {
  <question_version_id or stable question key>: <normalized answer value>
  for each answer where the question's analytics metadata has
    analytics_filter=true OR group_by=true OR chart_type is not null
}
```

Normalization rules (must match on both client and server if ever mirrored):
- `yes_no` → `true` / `false`
- `single_select` → option key (not label)
- `multi_select` → sorted array of option keys
- `number` / `scale` → number
- `date` / `date_time` → ISO-8601 string

Geography:
- If `gps_status = 'captured'` → resolve point against `geo_boundaries` (PostGIS); store ids.
- If `gps_status = 'unavailable'` → both geo ids NULL; record still counts in non-geo aggregates.

---

## 4. Continuous Aggregate & Watermark Interaction

After a successful `materialize_fact`:
- No immediate forced refresh is required for MVP.
- Timescale continuous-aggregate policy (or Celery override) picks up the new row on next run.
- After refresh, update `campaigns.last_analytics_refresh_at` (or a dedicated watermark table).
- Dashboard API exposes this as `data_as_of`.

Optional future: `ProcessingService.request_refresh(campaign_id)` for Client Admin “Refresh now”.

---

## 5. Failure & Retry Semantics

| Condition | Record status | Fact row | Dashboard | Action |
|-----------|---------------|----------|-----------|--------|
| Approve + materialize succeed | `approved` | present | visible after next refresh | — |
| Approve succeeds, materialize fails | `approved` + `fact_status=failed` | absent | not visible | Celery retry / Client Admin “Retry processing” |
| Retry materialize succeeds | `approved` + `fact_status=materialized` | present | visible after refresh | — |
| Record rejected | `rejected` | never created | never visible | — |

---

## 6. Test Contracts (must exist)

1. **Happy path:** approve → fact row exists → after refresh, widget count increases by 1.  
2. **Idempotency:** call `materialize_fact` twice → still one row; aggregates unchanged.  
3. **Failure isolation:** force materialize to raise → approve still committed; status shows fact_status=failed; dashboard does not include the record.  
4. **Retry:** retry job clears the flag and inserts the fact.  
5. **Tenant isolation:** materialize and dashboard queries never cross tenants.  
6. **Geo unavailable:** fact row has NULL geo ids; appears in total KPI, absent from choropleth.

---

## 7. Implementation Order for Agents

1. `ProcessingService.materialize_fact` + unit tests (golden payload from sample approved record).  
2. Wire `ReviewService.approve` to call it via service interface.  
3. Celery task `retry_failed_facts`.  
4. Continuous-aggregate definitions + watermark write.  
5. `AnalyticsService.get_dashboard_data` returning `data_as_of`.  
6. UI: show fact_status=failed in Review queue; show “Data as of …” on dashboard.

---
*Related: `09-ANALYTICS-SPEC.md`, `05-SYSTEM-DESIGN.md` §5, `03-FRS.md` FR-REV-*, FR-PRC-*, FR-ANL-**
