# Smart Survey X — Business Rules & Validation Engine Specification

**Version:** 1.0 (Locked)
**Depends on:** `01-PRD.md`, `02-BRS.md`, `03-FRS.md`
**Feeds into:** `05-SYSTEM-DESIGN.md`, `06-DATABASE-DESIGN.md`, `07-API-SPEC.md`

---

## 0. Purpose

This document is the **single source of truth for state machines and rule-evaluation logic** that must be implemented identically across the Flutter app (offline, client-side) and the FastAPI backend (server-side, authoritative). Where this document and any other document disagree on a lifecycle transition, this document wins. Code agents implementing either platform must implement the state machines below exactly — do not infer additional states or transitions.

---

## 1. Record (Submission) Lifecycle — State Machine

A **Record** is one completed (or in-progress) survey response, identified by its composite Record ID (FR-EVD-07).

### 1.1 States

| State | Meaning | Where it lives |
|---|---|---|
| `draft` | Record started, evidence (photo/GPS) locked, audio recording, form partially filled. Not yet submitted. | Device only (never synced) |
| `submitted_locally` | Surveyor tapped Submit; audio locked; all evidence finalized on-device. Queued for sync. | Device, queued |
| `syncing` | Upload in progress (answers + media). | Device + server (transient) |
| `synced` | Structural validation passed server-side; record persisted server-side. | Server |
| `sync_failed` | Upload attempt failed (network/server error); will auto-retry with backoff. | Device (server never saw a complete record) |
| `validation_failed` | Structural validation failed server-side (should be rare, since client validates too — indicates a client/server rule mismatch or a genuinely corrupt payload). | Server |
| `pending_review` | Passed structural validation; awaiting Client Admin review. | Server |
| `approved` | Client Admin approved after audio cross-check. Terminal review outcome; eligible for fact materialization (see §1.5). | Server |
| `rejected` | Client Admin rejected with a reason. Surveyor may correct and resubmit once (see §1.4) via a **new linked record**; the rejected record itself remains immutable and stays in the trail. | Server |

**Note:** there is no `processing_failed` value on `records.status`. Whether a record's *analytics fact row* has been materialized is tracked on a **separate field**, `fact_status` (`not_applicable`/`pending`/`materialized`/`failed`), specifically so a materialization hiccup can never look like — or accidentally revert — a review decision. See §1.5.

### 1.2 Transition Diagram

```
[draft] --(surveyor submits)--> [submitted_locally] --(sync attempt)--> [syncing]
                                                                            │
                                                    ┌───────────────────────┼───────────────────────┐
                                                    ▼                       ▼                       ▼
                                              [sync_failed]           [synced]              [validation_failed]
                                              (auto-retry loop)             │                       │
                                                    │                       ▼                       │
                                                    └──────────────►  [pending_review]  ◄────────────┘
                                                                            │                (after payload fix /
                                                              ┌─────────────┴──────────────┐   manual correction —
                                                              ▼                             ▼   MVP: flagged to Client
                                                        [approved]                     [rejected]  Admin, not silently retried)
                                                              │                             │
                                                              │                             ▼ (surveyor corrects, ONE retry only)
                                                              │                    [draft] of a NEW record:
                                                              │                     original_record_id = rejected record's ID,
                                                              │                     attempt_number = 2
                                                              │                             │
                                                              │                             └──> re-enters this same flow
                                                              │                                  (submitted_locally → ... →
                                                              │                                   approved | rejected [FINAL])
                                                              ▼
                                              records.status = 'approved' (final, immutable)
                                                              │
                                                              ▼  (Processing.materialize_fact(), same/next transaction)
                                              fact_status: pending ──┬── materialized ──> picked up by next
                                                                     │                    continuous aggregate refresh
                                                                     └── failed ──(Celery Beat retry)──> back to pending
```

**Reading note:** `fact_status` is tracked on the same `records` row but is a genuinely separate field from `status` — approving a record always sets `status='approved'` immediately and permanently; `fact_status` then independently cycles through its own pending/materialized/failed states as many times as a retry requires, without ever touching or implying a change to the review decision. See §1.5.

### 1.3 Transition Rules

1. `draft → submitted_locally`: **client-side only.** Requires all `required=true` questions answered and all mandatory evidence present (per template metadata), evaluated by the shared Validation Rule Engine (§3). Locks audio.
2. `submitted_locally → syncing → synced`: automatic, backend background worker. On `synced`, server assigns the final composite Record ID if not already present (FR-EVD-07) and computes evidence checksums (FR-EVD-05).
3. `synced → pending_review`: automatic, immediate — no separate admin action required to "queue" a record for review.
4. `pending_review → approved | rejected`: **Client Admin (Main/Sub) only**, manual action (FR-REV-03). Reject requires a reason (BR-043).
5. `approved → [aggregation]`: automatic, picked up by the batched aggregation job (FR-PRC-02), not a manual transition.
6. **No role may transition a record backward** (e.g. `approved → pending_review`) in MVP. If a reviewed decision is later found wrong, that is an out-of-band data-correction/ops action, not a supported product flow — flag in `13-ADR-LOG.md` if this becomes a real need.
7. **Immutability boundary:** answers and evidence are frozen at `submitted_locally` (client) and never mutated server-side at any subsequent state. Only the record's *lifecycle metadata* (status, review reason, stamps) changes after that point. This still holds for a resubmission — see §1.4 — which creates a **new** record rather than mutating the rejected one.
8. `rejected → [surveyor-initiated resubmission]`: see §1.4. This is the one permitted "backward-feeling" flow, and it is implemented as forward-only (a new record), not as reopening the rejected one.

### 1.4 Lightweight Resubmission Flow (rejected records)

To avoid a rejected record being a dead end in the field (re-interviewing a respondent isn't always possible), a surveyor gets **exactly one resubmission attempt** per rejected record:

1. A `rejected` record appears in the surveyor's Activity Log (FR-USR-07) with status "Rejected" and the Client Admin's reason, **plus a "Resubmit" action** — this is the one mutation the Activity Log screen permits (everything else there stays view-only per BR-036).
2. Tapping Resubmit starts a **new record** through the normal New Record Flow (PRD §8: fresh photo+GPS capture, fresh audio recording, fresh form fill) — the original rejected record's evidence and answers are never reopened, edited, or reused. This preserves the immutability guarantee (rule 7) and keeps the audit trail honest (the rejected attempt is never silently replaced).
3. The new record stores `original_record_id` (pointing to the rejected record) and `attempt_number = 2`. The composite Record ID (FR-EVD-07) for the resubmission is `{campaign_code}-{original_sequence}-R2` so the two attempts are visibly linked in reporting.
4. The new record goes through the identical lifecycle (`draft → submitted_locally → ... → pending_review → approved | rejected`).
5. **The second decision is final** — if `attempt_number = 2` is also rejected, no further Resubmit action is offered; the surveyor's Activity Log shows both attempts, the second marked "Rejected (Final)". This caps the loop and keeps the flow "lightweight" rather than open-ended.
6. Client Admin's Review screen, when reviewing an `attempt_number = 2` record, surfaces the original rejection reason alongside the new submission for context (FR-REV-02 extended, see FRS update).
7. Only `approved` records (whichever attempt) ever reach analytics; a `rejected` record — original or final resubmission — never contributes to aggregation, regardless of attempt number.

### 1.5 Fact Materialization — a Parallel, Independently-Retriable Lifecycle

Approval and fact materialization are deliberately two different lifecycles on the same `records` row, not one combined status, per `17-ANALYTICS-PROCESSING-SEQUENCE.md`:

- `records.status` is the **review decision** — set once by a human, immutable thereafter (§1.3 rule 6).
- `records.fact_status` (`not_applicable → pending → materialized | failed`) is the **analytics eligibility** of that already-approved record — a system-derived, independently retriable concern.
- On `approve`, the Review module sets `status='approved'` and `fact_status='pending'` in the same transaction, then calls `Processing.materialize_fact(record_id)` (same transaction preferred, or an immediate follow-on transaction).
- **If materialization fails, the approval still stands.** `status` remains `'approved'`; only `fact_status` moves to `'failed'`, with `fact_error` recording why. A Celery Beat job retries `fact_status='failed'` records on a schedule; a Client Admin can also trigger `POST /records/{id}/retry-fact` manually.
- A record is eligible for any dashboard/analytics query **only when `status='approved' AND fact_status='materialized'`** — both conditions, checked structurally (only such rows are ever inserted into `record_facts` in the first place — see Database Design §2.9), not as a runtime filter a query author could forget.
- This separation exists specifically so a transient infrastructure failure (a DB hiccup during materialization) can never be mistaken for, or accidentally cause, a reversed review decision — the two are owned by different modules (Review vs. Processing) and change independently.

---

## 2. Survey Template Lifecycle — State Machine

| State | Meaning |
|---|---|
| `draft` | Being authored by Client Admin; fully editable. |
| `published` | Immutable version snapshot created (FR-SB-04); dashboard + analytics config generated; live for campaign creation. |
| `archived` | No longer usable for new campaigns; existing campaigns referencing this version are unaffected. |

Transitions: `draft → published` (Publish action, FR-SB-04, single transaction) · `published → archived` (Client Admin action, does not affect already-created campaigns) · editing a `published` version does not mutate it — it creates a new `draft` version (FR-SB-05).

---

## 3. Shared Validation Rule Engine

**This is the mechanism that makes "metadata-driven" real** (FR-VAL-01). Both Flutter and FastAPI consume the **same rule definition format**, generated once when a template is published, and stored as part of the immutable template version snapshot. Neither platform hardcodes validation logic per question — both interpret this schema.

### 3.1 Rule Definition Schema (per question, conceptual — full JSON Schema in `07-API-SPEC.md`)

```json
{
  "question_id": "q_042",
  "input_type": "number",
  "required": true,
  "validation": {
    "min": 18,
    "max": 120
  },
  "visibility": {
    "show_if": [
      { "question_id": "q_041", "operator": "equals", "value": "yes" }
    ],
    "logic": "ALL"
  },
  "evidence": {
    "gps_required": false,
    "photo_required": { "min": 0, "max": 0 },
    "audio_required": false
  }
}
```

### 3.2 Supported Validation Operators (closed set — do not extend ad hoc)

| Input type | Available rules |
|---|---|
| `text_short` / `text_long` | `required`, `min_length`, `max_length`, `regex` |
| `number` | `required`, `min`, `max`, `integer_only` |
| `single_select` / `multi_select` | `required`, `min_selections`, `max_selections`, options must be from the defined option list |
| `date` / `date_time` | `required`, `min_date`, `max_date` |
| `scale` | `required`, `min`, `max` (defines the scale range) |
| `yes_no` | `required` |
| `gps` / `photo` / `audio` | governed by the `evidence` block, not `validation` (see §3.1) |

### 3.3 Skip-Logic (Conditional Visibility) Evaluation Algorithm

Both platforms implement this identical algorithm (FR-VAL-03):

1. For each question, evaluate its `visibility.show_if` array against the **current answer set** (including answers not yet submitted, i.e. live as the surveyor types).
2. Each condition is `{question_id, operator, value}`. Supported operators: `equals`, `not_equals`, `in`, `not_in`, `greater_than`, `less_than`, `is_answered`, `is_not_answered`.
3. `visibility.logic` is `ALL` (AND) or `ANY` (OR) across the conditions array. Absence of a `visibility` block means always-visible.
4. A question evaluated as **hidden**:
   - Client-side: is not rendered, and its value (if previously entered, then hidden by a later answer change) is excluded from the submission payload.
   - Server-side: is not required to be present, and its `required` flag is ignored for that submission — a hidden question is never a validation failure (FR-VAL-03 exact requirement).
5. **No circular references**: Survey Builder validates at save time (FR-SB-03) that no question's visibility rule creates a cycle (A depends on B depends on A). This is a build-time guarantee, not something either runtime needs to defend against, but both should fail safely (treat as always-visible + log) if a malformed rule somehow reaches them.

### 3.4 Structural Validation vs. Review Cross-Check — Explicit Boundary

To avoid an agent conflating these two very different checks (per PRD §8b):

- **Structural validation** (this section, §3): mechanical — required fields present, types/formats/ranges correct, evidence present per metadata. Runs at sync time, automated, no human judgment. A record can be structurally perfect and still be factually wrong.
- **Review cross-check** (BR-043): human judgment — does the typed answer match what the audio recording says. This is never automated in MVP; it is the Client Admin's core value-add action and is not something the Validation Rule Engine attempts to verify.

---

## 4. Assignment & Territory Rule

- A surveyor may hold **multiple concurrent assignments** across different campaigns/forms; the Assignment Manager (FR-ASG-04) operates per assignment record, not per surveyor globally.
- Removing an assignment does not cascade-delete any records already tied to it; historical records remain queryable/reportable against the campaign they were submitted under even after the surveyor is reassigned elsewhere (BR-022, FR-ASG-03).

## 5. Seat Limit Enforcement Rule

- Evaluated at account-creation time only (not continuously): `COUNT(active accounts of role X for tenant) < tenant.limit_for_role_X` must hold immediately before insert, inside the same transaction as the insert, to prevent a race condition from exceeding the limit under concurrent requests.
- Deactivating an account frees a seat immediately (a freed Sub Admin seat can be reused for a new Sub Admin without an upgrade request).

## 6. Tenant Isolation Rule (restated precisely for implementation)

- Every tenant-scoped query must filter by `tenant_id` derived **from the authenticated request's token**, never from a client-supplied parameter, at the service layer.
- This is enforced in two independent layers (defense in depth, per FR-TEN-03): (a) application service layer always injects `tenant_id` from the token into the query; (b) Postgres row-level security policy as a backstop, keyed on a session variable set per-request. Full DDL in `06-DATABASE-DESIGN.md`.

## 7. GPS Lock Failure Handling (formalizes UX Spec §4a.2, enforced by Database Design `chk_gps_before_review`)

A record's `gps_status` (Database Design §2.5) moves through exactly: `pending → captured` (normal path) or `pending → unavailable` (fallback path, only reachable after the UX Spec §4a.2 escalation — manual retry offered, then explicit user action to proceed without GPS).

- A record **cannot** be submitted (transition to `submitted_locally`, §1.3 rule 1) while `gps_status = 'pending'` — the surveyor must reach a resolved state first.
- Whether `unavailable` is a permitted resolution at all is a **per-template setting** (an admin-configured tolerance on the template's root-level evidence requirements, distinct from any single question's `gps_required` flag, which governs question-level GPS per PRD §7) — most templates should require `captured`, with `unavailable` as an explicit opt-in for organizations that need to keep working through GPS dead zones rather than lose the interview entirely.
- A record with `gps_status = 'unavailable'` has `geo_constituency_id`/`geo_booth_id` permanently NULL (no spatial resolution possible) and is therefore excluded from any map/choropleth widget and from geography-based dashboard filters, but still counts toward non-geography aggregates (e.g. total submissions, per-question breakdowns) — it is not excluded from analytics generally, only from the geography dimension of it.
- This state is set once and is then immutable, exactly like a `captured` GPS point (§1.3 rule 7) — an `unavailable` record cannot later have a GPS point attached retroactively, since that would reintroduce exactly the tamper-evidence risk the immutability rule exists to prevent.

---
*Next document: `05-SYSTEM-DESIGN.md` (Architecture & Sync Protocol)*
