# Smart Survey X — Testing Strategy

**Version:** 1.0 (Locked)
**Depends on:** all prior documents (every `BR-xxx` acceptance criterion is a test case source)

---

## 1. Test Levels

| Level | Scope | Tooling recommendation (free-first, per System Design §1a philosophy) |
|---|---|---|
| Unit | Individual service functions, especially the Validation Rule Engine (Business Rules §3) and skip-logic evaluator | `pytest` (backend), `flutter test` (mobile) |
| Integration | Module-to-module via service interfaces (System Design §2), DB constraints, RLS policies | `pytest` with a real Postgres test instance (Testcontainers or equivalent) — not mocked DB, since RLS/constraints are the point |
| Contract | API Spec conformance | Generate from FastAPI's OpenAPI output; validate request/response shapes match `07-API-SPEC.md` |
| End-to-end | Full user journeys across Flutter app + backend + web portal | `flutter integration_test` for mobile flows; Playwright (free) for web portal flows |
| Security/isolation | Tenant isolation, role boundaries, evidence immutability | Dedicated adversarial test suite, run on every PR (see §4) |

---

## 2. Critical Path Test Scenarios (traced to BR-xxx acceptance criteria)

These are **not optional** — each corresponds directly to an acceptance criterion already written in `02-BRS.md`, restated here as an executable scenario. A code agent should implement these before considering a module "done," not as an afterthought.

### 2.1 Tenant Isolation (BR-001, BR-062, BR-063)
- Create two tenants A and B with distinct data. Authenticate as Tenant A's Client Admin. Attempt to `GET /campaigns/{tenant_B_campaign_id}` → expect 403/404, never the actual data.
- Attempt `POST /data-export` with a `tenant_id` belonging to Tenant B while authenticated as Tenant A's Client Admin → expect 403 (FR-EXP-02 boundary).
- Verify RLS independently: connect directly as the app's DB role with `app.current_tenant_id` set to Tenant A, query Tenant B's `campaigns` row by known ID → expect zero rows returned, even bypassing the application layer.

### 2.2 Offline Resilience (BR-030, BR-031, BR-039)
- Put device in airplane mode. Complete full survey flow (photo/GPS lock → audio → form fill → pause → resume → submit). Verify zero errors and correct local persistence at every step.
- Mid-form-fill, force-kill the app process. Relaunch. Verify all previously entered answers are restored exactly (BR-031).
- Restore connectivity. Verify automatic background sync occurs without user action, and per-record sync status updates visibly (`queued` → `syncing` → `synced`).

### 2.3 Evidence Immutability (BR-032, BR-033)
- Submit a record. Attempt (as Client Admin, as Super Admin, as the originating Surveyor) any request to modify `record_photo_evidence`/`record_audio_evidence` rows or their R2 objects post-lock → expect 403/no such endpoint exists, for every role.
- Verify checksum stored at lock time matches the actual file content at any later retrieval (detects any out-of-band tampering).

### 2.4 Capture Order Enforcement (BR-034)
- Attempt to answer a form question via the app before photo+GPS capture completes → verify this is not reachable in the UI flow (not just discouraged).
- Verify audio recording indicator is active continuously from record start through submit, including across a pause/resume cycle.
- **GPS fallback (Business Rules §7):** on a template configured to permit `unavailable` GPS, simulate a GPS timeout through the full UX Spec §4a.2 escalation (0–5s / 5–20s / 20s+ states) and confirm the record can proceed with `gps_status='unavailable'`; on a template that does *not* permit the fallback, confirm the record genuinely cannot be created without a resolved GPS lock. Confirm an `unavailable` record is excluded from map/geography-filtered widgets but still counted in non-geography aggregates.

### 2.5 Surveyor Profile Lock & Activity Log Boundary (BR-035, BR-036)
- Authenticate as a surveyor. Attempt `PATCH` on own profile fields (photo, name, phone, govt ID, surveyor code) via any endpoint → expect 403/no such write path exists.
- Authenticate as a surveyor. Call `GET /records/{id}` for one's own previously submitted record → expect 403 (this endpoint is Client Admin only, per API Spec §8) — the surveyor's own visibility into a submitted record is limited to `/surveyor/activity-log` metadata only.

### 2.6 Review Gate & Resubmission (BR-042, BR-043, BR-044)
- Submit a record. Verify it does **not** appear in any `/dashboards/{id}/data` response while `status=pending_review`.
- Approve the record. Verify: (a) `status=approved`; (b) `fact_status=materialized` and a `record_facts` row exists (or `fact_status=failed` if materialization was forced to fail); (c) after continuous-aggregate refresh (or forced), the record appears in `/dashboards/{id}/data` only when `fact_status=materialized`; (d) response includes `data_as_of`.
- Reject a first-attempt record with a reason. Verify: (a) Activity Log shows "Rejected" + reason + Resubmit action; (b) resubmitting creates a **new** record with `original_record_id` set and `attempt_number=2`, and the original record's answers/evidence are unchanged; (c) rejecting the `attempt_number=2` record removes the Resubmit action ("Rejected (Final)").

### 2.7 Seat Limits & Role Hierarchy (BR-004, BR-005, BR-006, BR-007)
- As Client Admin (Main) with 2 existing Sub Admins (default limit), attempt to create a 3rd → expect a clear "seat limit reached" error, not a generic 500.
- As a Sub Admin, attempt to create another Sub Admin → expect 403. Attempt to create a Dashboard Viewer → expect 403 (FR-USR-08 restricts this to Main only).
- Submit a seat-limit upgrade request as Client Admin (Main); approve as Super Admin; verify the limit is immediately raised and a 3rd Sub Admin can now be created.
- Verify up to 3 Super Admin accounts can exist and each has identical permissions (no test should reveal a 4th-account creation path via the public API).

### 2.7a Assignment Integrity (BR-022, Database Design §2.4 note 7)
- Attempt to double-submit an "assign surveyor to campaign" action (simulating a network retry or double-click) → verify only one active assignment row results (`idx_assignments_unique_active` holds), not two.
- Reassign a surveyor from Campaign A to Campaign B; verify: (a) the old assignment is marked `removed`, not deleted; (b) a new assignment row exists for Campaign B; (c) `assignment_history` correctly links both via `old_assignment_id`/`new_assignment_id`; (d) records the surveyor already submitted under Campaign A remain queryable/reportable against Campaign A unchanged.

### 2.8 Validation Rule Engine Parity (FR-VAL-01, FR-VAL-03)
- **Critical parity test**: for a representative template with skip logic and every input type, run the same answer set through the Flutter client-side validator and the FastAPI server-side validator (e.g. via a shared fixture/golden-file of `{answers, expected_visible_questions, expected_errors}`). Assert identical outcomes. This test should be re-run whenever either implementation changes, to catch drift between the two independently-coded rule engines (Business Rules §3 exists specifically to make this test possible).

### 2.9 Compute Strategy (BR-045, BR-046)
- Sync a record with a missing required field → expect immediate (`synced_at` within seconds) rejection with question-level error, not a delayed batch-job discovery.
- Load-test: verify per-submission sync latency does not measurably degrade as the aggregation batch job's data volume grows (i.e., confirm the two are actually decoupled, not just decoupled in the code's intent).
- Verify the aggregation batch job is idempotent: run it twice in succession with no new approved records between runs → verify aggregate values are unchanged (no double-counting), per FR-PRC-05.

### 2.10 Fact Materialization & Dashboard Freshness (BR-046, FR-PRC-02/04/05, FR-DSH-03)
- Approve a record → assert exactly one `record_facts` row exists; `filterable_answers` contains only questions flagged `analytics_filter`/`group_by`/`chart_type` — not the full answer set.
- Call `materialize_fact` twice for the same record → still exactly one row (idempotency, ON CONFLICT DO NOTHING).
- Force a materialization failure on approve → `status='approved'` stands unchanged, `fact_status='failed'`, record **absent** from dashboard data; running the retry endpoint or Celery retry job succeeds → `fact_status='materialized'` and the record appears after the next aggregate refresh.
- Dashboard with zero approved-and-materialized records returns widgets with `empty: true` and calm, specific copy — not an error state.
- Every `/dashboards/{id}/data` response includes a non-null `data_as_of` value.
- GPS-unavailable record (Business Rules §7): its fact row has NULL geo ids, counts toward the total submissions KPI, and is excluded from choropleth/map widgets.
- Tenant isolation, applied specifically to facts: Tenant A's dashboard queries never include Tenant B's `record_facts` rows, even under the same campaign-naming coincidence.

---

## 3. Test Data & Environments

- A seeded "demo tenant" with representative data (multiple election-type campaigns, a range of question input types, some approved/rejected/pending records) should exist in the staging environment for manual QA and demo purposes — separate from automated test fixtures.
- Automated tests use ephemeral, isolated tenants/data per test run (never share state with the demo tenant or between test runs) to avoid flaky cross-test interference, especially for the tenant-isolation suite (§2.1) where false negatives are unacceptable.

## 4. CI Gate

- The tenant-isolation suite (§2.1), evidence-immutability suite (§2.3), and fact-materialization idempotency suite (§2.10) are **required, blocking checks** on every PR — not just run periodically. These are the categories where a regression is a genuine data-breach, financial-double-count, or trust failure, not just a bug.
- Full end-to-end suite runs on merge to main / pre-deployment, not necessarily on every commit (balance CI time vs. coverage).

---
*Next document: `12-DEPLOYMENT.md`*
