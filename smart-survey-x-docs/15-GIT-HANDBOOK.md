# Smart Survey X — Git Handbook

**Version:** 1.0 (Locked)
**Depends on:** `14-CODING-STANDARDS.md` §7 (commit/PR conventions), `16-TASK-BREAKDOWN.md` (task sizing maps to branch/PR sizing)
**Applies to:** all three codebases in the monorepo (`backend/`, `web-portal/`, `surveyor-app/`)

---

## 0. Purpose

This document is the operational companion to `14-CODING-STANDARDS.md` §7 — that document states the commit-message and PR-description *format*; this one covers the full day-to-day workflow: branching, review, merge strategy, release tagging, and how to handle the two highest-risk areas in this codebase (schema migrations and the dual-platform Validation Rule Engine) safely in Git.

---

## 1. Repository Structure

Single monorepo (per `14-CODING-STANDARDS.md` §1.1) — `backend/`, `web-portal/`, `surveyor-app/`, `shared/`, `docs/` all live in one repo, one history, one PR queue. **Rationale:** the Validation Rule Engine parity requirement (Coding Standards §5) and the shared design-tokens file require backend/web/mobile changes to land together atomically when they're coupled — a multi-repo setup would make that coordination much harder to enforce.

```
main            ← always deployable; production deploys from here (12-DEPLOYMENT.md §5)
├── develop      ← optional integration branch (see §2.3 — only if the team needs it)
└── feature/*, fix/*, chore/* branches, per §2
```

---

## 2. Branching Model

### 2.1 Branch naming (restated from Coding Standards §2, with full detail here)

`<type>/<short-kebab-case-description>`

| Type | Use for | Example |
|---|---|---|
| `feature/` | New functionality, maps to a Task Breakdown item | `feature/review-resubmission-flow` (Task 4.3) |
| `fix/` | Bug fix | `fix/seat-limit-race-condition` |
| `chore/` | Tooling, deps, CI, non-functional cleanup | `chore/upgrade-fastapi` |
| `docs/` | Documentation-only changes (including edits to this doc set) | `docs/update-adr-log-gis-source` |
| `refactor/` | No behavior change, structural improvement only | `refactor/extract-validation-service` |
| `hotfix/` | Urgent production fix, branched from `main` directly | `hotfix/evidence-checksum-null` |

**Reference the Task Breakdown item where one exists** — branch name or PR description should make it traceable back to e.g. "Task 3.9" so a reviewer can open `16-TASK-BREAKDOWN.md` and check the definition of done directly.

### 2.2 Branch lifecycle

1. Branch from `main` (or `develop`, if the team is using one — §2.3).
2. Keep branches **short-lived** — a branch should correspond to one Task Breakdown item or one clearly-scoped fix, not an entire Phase. If a task is too large for one PR, split it (e.g. Task 3.8's "form rendering engine" can be its own sequence of smaller PRs: text/number inputs first, then select types, then skip-logic wiring).
3. Rebase on top of `main` before opening a PR (or before merge, if the team prefers merge commits into an already-open PR — pick one convention and apply it consistently; see §4).
4. Delete the branch after merge. No long-lived personal branches.

### 2.3 Do you need a `develop` branch?

**Default: no.** For a project this size, `main` + short-lived feature branches + a working CI gate (Coding Standards §4, Testing Strategy §4) is sufficient — trunk-based development keeps integration pain low. Introduce a `develop` integration branch only if the team grows large enough that batching several Phase-level features together before a production release becomes genuinely necessary. This is a team-scaling decision, not a Day 1 requirement — if adopted later, log it in `13-ADR-LOG.md`.

---

## 3. Commit Messages

Format (from Coding Standards §7, detailed here):

```
<type>(<module>): <short description, imperative mood, no trailing period>

[optional body: why, not just what]

[optional footer: BR-xxx / FR-MODULE-NN / Task N.N reference]
```

**Types:** `feat`, `fix`, `refactor`, `test`, `docs`, `chore` (matches Coding Standards §7 exactly — don't invent new types).

**Module scope** — use the FRS/System-Design module name where the change lives (`auth`, `review`, `assignment`, `analytics`, `sync`, etc.), or the platform name for cross-cutting changes (`web`, `mobile`, `backend`, `infra`).

### Good examples

```
feat(review): add resubmission linkage to reject flow

Implements Business Rules §1.4 — a rejected first-attempt record
now offers a Resubmit action that creates a new linked record
rather than reopening the original.

Refs: BR-044, FR-REV-04, Task 4.3
```

```
fix(assignment): close race condition on seat limit check

COUNT() and INSERT were in separate transactions, allowing two
concurrent requests to both pass the check. Now wrapped in a single
transaction with SELECT ... FOR UPDATE on the tenant row.

Refs: 04-BUSINESS-RULES.md §5, Task 1.5
```

### Bad examples (and why)

- `fixed stuff` — no type, no module, no information for a future git-blame reader.
- `feat: updates` — has a type but no module scope, no description of *what* updated.
- `feat(review): implement entire review module` — too large; should have been several commits/PRs matching the Task Breakdown's granularity (4.1 schema, 4.2 backend endpoints, 4.4 UI, as separate units).

---

## 4. Pull Requests

### 4.1 PR description template

Every PR description should answer, in order:

1. **What Task Breakdown item(s) does this implement?** (e.g. "Task 3.7 — New Record flow, capture lock")
2. **What source documents were followed?** (link the specific `.md` file(s) and section)
3. **What's the definition of done, and how is it verified?** (which tests, which manual check)
4. **Cross-platform note** (mandatory if touching the Validation Rule Engine, per Coding Standards §7 and §7 below): "Backend and Dart implementations both updated" or "N/A — no rule-engine change."

### 4.2 Review requirements

| PR touches | Minimum review requirement |
|---|---|
| Any tenant-scoped query or new endpoint | Reviewer explicitly confirms tenant-scoping dependency is used (System Design §3) — not just that the code "looks right" |
| Validation Rule Engine (either platform) | Reviewer confirms the parity golden-file test (Testing Strategy §2.8) was run and passes; if only one platform changed, the PR description must state why the other doesn't need updating |
| A state-machine transition (`04-BUSINESS-RULES.md`) | Reviewer confirms both a positive and negative test exist (Coding Standards §6) |
| Database migration | Reviewer confirms migration is additive/backward-compatible where the table involves immutable data (evidence, approved records) — see §5 below |
| Design/UI | Reviewer confirms no hardcoded token values were introduced (Coding Standards §3.2, §6.6 in Task Breakdown) |

### 4.3 Merge strategy

**Squash merge to `main`** — one commit per PR on `main`'s history, keeping the mainline log readable at the Task Breakdown's granularity. The squashed commit message should follow the §3 format (most git hosts let you edit the squash commit message to match the PR title/description) — don't let the squash produce a generic "Merge PR #42" message.

### 4.4 CI gates before merge (restated from Testing Strategy §4)

- Lint + format check (all platforms)
- Unit tests
- **Blocking, non-negotiable:** tenant-isolation suite, evidence-immutability suite
- Validation Rule Engine parity suite, when either implementation changed

A PR cannot merge with any of these red. No "merge anyway, fix in follow-up" exceptions for the blocking suites specifically — Testing Strategy §4 already establishes why (data-breach/trust-failure severity).

---

## 5. Database Migrations — Special Git Handling

Because `06-DATABASE-DESIGN.md` establishes hard immutability guarantees (evidence, approved reviews, audit log), migration PRs get extra discipline:

1. **One migration per PR**, never bundled with unrelated feature code — makes it possible to `git revert` a bad migration's PR cleanly without touching feature logic, and vice versa.
2. **Additive by default.** Adding a nullable column, a new table, a new index — safe, normal. Altering or dropping a column on `records`, `record_answers`, `record_photo_evidence`, `record_audio_evidence`, or `audit_log` needs explicit justification in the PR description referencing why it doesn't violate the immutability model (Deployment Guide §8).
3. **Migration file naming**: Alembic's autogenerated revision ID prefix is fine, but the descriptive slug should match the change, e.g. `xxxx_add_aggregation_refresh_interval_to_campaigns.py` — searchable, matches the Task Breakdown item (here, Task 5.9).
4. **Never edit a migration file that has already been merged to `main` and potentially applied to any shared environment (staging/production).** If a migration was wrong, write a new migration that corrects it — treat merged migrations the same way approved records are treated (Business Rules §1.3 rule 6): forward-only correction, not retroactive editing.
5. Migration PRs should include, in the description, the exact `alembic upgrade`/`downgrade` commands the reviewer can run locally to verify both directions work.

---

## 6. Handling the Validation Rule Engine in Git (highest-risk area)

Per Coding Standards §5, this engine exists twice (Python + Dart). Git-specific discipline on top of that:

- A PR that changes the rule **schema** (`04-BUSINESS-RULES.md` §3.1/3.2) is a **documentation change first** — update the Business Rules doc in the same PR (or a preceding one it depends on) before/alongside the code, since that document is the schema's source of truth, not either implementation.
- Prefer **one PR per platform** for a rule-engine behavior change (e.g. `feat(validation): add is_not_answered operator [backend]` and a paired `feat(validation): add is_not_answered operator [mobile]`), linked to each other in both descriptions, merged close together — rather than one enormous cross-platform PR that's hard to review carefully on either side. The parity test (§4.2 table) is what guarantees they actually agree once both land.
- Tag both commits/PRs with the same reference footer (e.g. `Refs: 04-BUSINESS-RULES.md §3.2, Task 2.3/2.8`) so `git log --grep` can find the pair later.

---

## 7. Tags & Releases

- Tag production deploys on `main`: `vMAJOR.MINOR.PATCH` (semantic versioning) — e.g. `v0.1.0` for first internal staging-ready build, `v1.0.0` for MVP launch (Task Breakdown Phase 7 completion).
- Each tag's release notes should reference which Task Breakdown phase(s) it completes, so `13-ADR-LOG.md`'s "Decided" items and any newly-resolved "Open Questions" can be cross-checked against what actually shipped.
- Hotfix tags (`v1.0.1`, etc.) get a one-line note on what broke and which `fix/` PR resolved it.

---

## 8. What Not to Do

- Don't force-push to `main` or any shared branch, ever.
- Don't commit directly to `main` — even a "trivial" one-line fix goes through a `fix/` branch and PR, so CI gates (§4.4) actually run.
- Don't bundle a design-token change (`shared/design-tokens.json`) with an unrelated feature PR — token changes affect both frontends and deserve isolated review (Coding Standards §3.2/§8 discipline extended to Git).
- Don't leave a branch open and stale for more than a few days without either merging or explicitly marking it draft/blocked with a reason — stale branches rot against a fast-moving `main`, especially schema-touching ones.
- Don't edit `docs/*.md` files informally in a feature PR "while I'm in there." Documentation changes that alter a locked decision go through their own `docs/` PR, reviewed with the same seriousness as the original spec — this doc set is the contract the whole team (and every code agent) builds against.

---
*Related: `14-CODING-STANDARDS.md`, `16-TASK-BREAKDOWN.md`, `11-TESTING-STRATEGY.md` §4, `12-DEPLOYMENT.md` §5*
