# Smart Survey X — Coding Standards

**Version:** 1.0 (Locked)
**Applies to:** FastAPI backend, Next.js Admin Portal, Flutter Surveyor App
**Depends on:** `05-SYSTEM-DESIGN.md`, `06-DATABASE-DESIGN.md`, `08-UXUI-SPEC.md`

---

## 0. Purpose

This document exists so that code written by different agents/sessions/developers looks like it came from one team. Where this document is silent, follow the dominant convention already present in the codebase rather than introducing a new one.

---

## 1. Repository / Folder Structure

### 1.1 Monorepo layout

```
smart-survey-x/
├── backend/                 # FastAPI modular monolith
│   ├── app/
│   │   ├── modules/         # one folder per FRS module — see §1.2
│   │   ├── core/            # config, DB session, security/JWT, RLS session-var setup
│   │   ├── shared/          # shared Pydantic schemas, enums, the Validation Rule Engine
│   │   └── main.py
│   ├── alembic/              # migrations, per 12-DEPLOYMENT.md §3
│   ├── workers/              # Celery tasks (sync processor, aggregation trigger, exports)
│   ├── tests/                 # mirrors app/modules structure
│   └── scripts/               # seed_super_admin.py etc., per 10-SECURITY.md §6
├── web-portal/               # Next.js Admin/Reviewer/Viewer portal
│   ├── src/
│   │   ├── app/               # route segments (Next.js App Router)
│   │   ├── components/        # shared UI components, built from 08-UXUI-SPEC.md tokens
│   │   ├── features/          # one folder per feature area, mirrors backend modules where sensible
│   │   ├── lib/                # API client, auth helpers
│   │   └── styles/             # design tokens as CSS variables / Tailwind theme
│   └── tests/
├── surveyor-app/              # Flutter
│   ├── lib/
│   │   ├── features/           # one folder per feature (auth, sync, record_capture, activity_log, ...)
│   │   ├── core/                # theme (AppTheme from 08-UXUI-SPEC.md tokens), local DB, sync engine
│   │   └── shared/               # the Dart port of the Validation Rule Engine (must stay in parity — see §5)
│   └── test/
├── shared/                    # cross-platform shared artifacts
│   └── design-tokens.json      # single source for color/type/spacing tokens, consumed by both web and Flutter
├── docs/                       # this documentation set
└── docker-compose.yml           # local dev environment, per 12-DEPLOYMENT.md
```

### 1.2 Backend module folder (repeats per FRS module)

Every one of the 18 modules from `03-FRS.md` / `05-SYSTEM-DESIGN.md` §2 gets an identical internal shape — this uniformity is what keeps the "service-interface only" boundary rule enforceable:

```
app/modules/<module_name>/
├── __init__.py
├── models.py        # SQLAlchemy models — ONLY this module's owned tables (06-DATABASE-DESIGN.md §2.x)
├── schemas.py        # Pydantic request/response schemas — must match 07-API-SPEC.md shapes
├── service.py         # business logic — the ONLY functions other modules are allowed to call
├── router.py           # FastAPI route handlers — thin, delegate to service.py
└── exceptions.py        # module-specific exception classes
```

**Rule:** `router.py` in one module must never import `models.py` from a different module. Cross-module needs go through the other module's `service.py` — this is the literal implementation of System Design §0's "service interface only" rule.

---

## 2. Naming Conventions

| Context | Convention | Example |
|---|---|---|
| Python files/modules | `snake_case` | `survey_builder/service.py` |
| Python classes | `PascalCase` | `class SurveyTemplateService` |
| Python functions/variables | `snake_case` | `def publish_template(...)` |
| Dart files | `snake_case` | `record_capture_screen.dart` |
| Dart classes | `PascalCase` | `class RecordCaptureScreen` |
| TypeScript/React files | `PascalCase` for components, `camelCase` for utilities | `ReviewDetailPanel.tsx`, `formatRecordCode.ts` |
| React components | `PascalCase` | `function DashboardFilterBar()` |
| DB tables | `snake_case`, plural | `survey_template_versions` |
| DB columns | `snake_case` | `tenant_id`, `captured_at` |
| API routes | `kebab-case`, plural nouns | `/survey-templates`, `/seat-limit-requests` |
| API JSON fields | `snake_case` (matches DB, avoids a translation layer) | `{"tenant_id": "...", "record_code": "..."}` |
| Enum/status values | `snake_case`, matches DB CHECK constraints exactly | `pending_review`, `client_admin_main` |
| Git branches | `type/short-description` | `feature/review-resubmission-flow`, `fix/seat-limit-race-condition` |

**Traceability naming rule:** where a piece of code implements a specific `BR-xxx` or `FR-MODULE-NN`, reference it in a comment at the point of implementation (not in the identifier name itself) — e.g. `# BR-034: photo+GPS must lock before form renders`. This keeps code searchable against the spec without bloating names.

---

## 3. Architecture Conventions

### 3.1 Backend (FastAPI)

- **Layered per module**: `router.py` (HTTP concerns only — parsing, status codes, auth dependency injection) → `service.py` (business logic, the Business Rules §1–6 state machines live here) → `models.py` (persistence). No business logic in routers, no HTTP concerns in services.
- **Tenant scoping is a dependency, not a manual check per function.** Every tenant-scoped router depends on a shared `get_tenant_scoped_session` (System Design §3) — do not re-implement tenant filtering ad hoc in individual service functions.
- **State machine transitions** (record lifecycle, template lifecycle — `04-BUSINESS-RULES.md`) are implemented as explicit functions per transition (e.g. `approve_record()`, `reject_record()`), never as a generic `update_status(new_status)` that lets a caller set any status — this is what prevents an illegal transition (e.g. `approved → pending_review`) from ever being reachable through the code.
- **Background jobs** (Celery tasks) live in `workers/`, not inside `app/modules/*/service.py` — a service function may *enqueue* a task, but the task's execution logic is a separate, independently-testable unit.

### 3.2 Web Portal (Next.js)

- **Feature folders over type folders** — group by what the code does (`features/review-queue/`), not by technical layer (`components/`, `hooks/`, `utils/` all mixed at top level) — keeps a feature's full surface area (component + data fetching + local state) discoverable in one place.
- **Server Components by default**, Client Components only where interactivity requires it (filters, forms, the audio player) — matches Next.js App Router conventions and keeps data-fetching close to the server.
- **No inline hex colors, font sizes, or spacing values** — every visual value comes from the design tokens (`shared/design-tokens.json` → Tailwind theme / CSS variables), per `08-UXUI-SPEC.md` §6. A PR introducing a raw hex value outside the token file should be rejected in review.
- **Role-gating in the UI is a UX courtesy, never the security boundary** — every component that conditionally renders based on role must assume the underlying API call is independently enforcing that role server-side (`10-SECURITY.md` §2). Never build a feature that relies solely on hiding a button.

### 3.3 Surveyor App (Flutter)

- **Feature-first folder structure** (`lib/features/record_capture/`), each feature owns its widgets, local state (Riverpod/Bloc — pick one and use it consistently across the whole app, not mixed per feature), and local data access.
- **The local database layer (Drift/SQLite) is the source of truth for anything not yet synced** — UI widgets read from local state, never directly assume server state is current, per the offline-first requirement (`04-BUSINESS-RULES.md` §1, `05-SYSTEM-DESIGN.md` §4).
- **The Validation Rule Engine port (`lib/shared/validation_engine/`) must be a direct, deliberate port of the same rule schema** consumed by the backend (`04-BUSINESS-RULES.md` §3) — not a reimplementation from scratch. See §5 below for how parity is maintained.
- **AppTheme (`lib/core/theme/`) consumes the same `shared/design-tokens.json`** as the web portal — no hardcoded `Color(0xFF...)` values scattered through widget code.

---

## 4. Linting & Formatting

| Platform | Formatter | Linter | Enforcement |
|---|---|---|---|
| Python (backend) | `black` (default settings) | `ruff` (covers flake8 + isort + more, faster, free) | Pre-commit hook + CI blocking check |
| TypeScript/React (web) | `prettier` (default settings) | `eslint` with `next/core-web-vitals` config | Pre-commit hook + CI blocking check |
| Dart (Flutter) | `dart format` (built-in) | `flutter_lints` (official, free) | Pre-commit hook + CI blocking check |
| SQL (migrations) | manual, consistent with `06-DATABASE-DESIGN.md` DDL style (uppercase keywords, snake_case identifiers) | — | Review-enforced |

**Rule:** formatting is never a discussion in code review — if the formatter would change it, run the formatter, don't hand-debate style. Linter warnings are fixed before merge, not suppressed with inline ignores unless a comment explains why the suppression is correct.

---

## 5. Cross-Platform Parity — Codegen, Not Dual Hand-Written Implementations

**This supersedes the "two implementations kept in sync via tests" approach.** Testing for parity catches drift after it happens; it doesn't prevent it. The correct architecture eliminates the possibility of drift structurally:

1. The rule schema (`04-BUSINESS-RULES.md` §3.1/3.2) is defined **once**, as a JSON Schema file in `shared/validation-schema/`, checked into the repo as the single source of truth — not merely described in prose in the Business Rules doc.
2. The **Python evaluator** (backend, authoritative) is hand-written against this schema — it's the reference implementation, and it's a rule *interpreter* (reads the schema + answers, returns a result), not per-question generated code.
3. The **Dart evaluator** is **also a hand-written interpreter of the same schema shape**, not a port of Python logic line-by-line — both are "generic JSON rule interpreters," so there's exactly one algorithm (§3.3 of Business Rules) implemented twice, not per-question business logic duplicated. This is a meaningfully smaller, more stable surface than it sounds: the interpreter is maybe 150–250 lines in each language and, once correct, rarely changes — new question types or operators are schema/data changes, not interpreter changes.
4. **The parity test suite (Testing Strategy §2.8) is the actual enforcement mechanism** — since both are interpreters of the same declarative schema (not independently-evolving business logic), a shared set of golden-file fixtures (`{schema, answers} → expected result`) genuinely exercises "does the interpreter behave correctly," and a passing suite is strong evidence of parity, not just a hopeful check.
5. **Do not add per-question-type special-case code in either interpreter.** If a new operator or input type is needed, it's added to the closed set (Business Rules §3.2) in both interpreters together, in the same PR pair (Git Handbook §6) — the discipline is still required, but the blast radius of getting it wrong is much smaller when the interpreters are generic rather than hand-written per question.

---

## 6. Testing Rules (supplementing `11-TESTING-STRATEGY.md`)

- **No PR merges without tests for the code it adds**, at minimum unit-level for new service functions and state-machine transitions. Test-writing is not a follow-up task.
- **Every new state-machine transition function** (`04-BUSINESS-RULES.md`) needs both a positive test (valid transition succeeds) and a negative test (invalid transition is rejected) — e.g. `test_approve_pending_review_record_succeeds` and `test_approve_already_approved_record_fails`.
- **Every new role-gated endpoint** needs a negative test proving the wrong role gets 403 — not just a happy-path test proving the right role succeeds. This is the concrete enforcement of `07-API-SPEC.md` §12 rule 2.
- Test file location mirrors source file location (`app/modules/review/service.py` → `tests/modules/review/test_service.py`) — no separate parallel test-organization scheme.
- Mocking the database is discouraged for anything touching Row-Level Security or tenant isolation — those tests must run against a real Postgres instance (Testing Strategy §1) since RLS is a database-engine feature that can't be meaningfully mocked.

---

## 7. Commit & PR Conventions

- Commit messages: `<type>(<module>): <short description>` — e.g. `feat(review): add resubmission linkage to reject flow`, `fix(assignment): race condition on seat limit check`. Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.
- PR description should reference the `BR-xxx`/`FR-MODULE-NN` it implements where applicable, so a reviewer can check it against the spec directly rather than inferring intent from the diff alone.
- A PR that touches the Validation Rule Engine on either platform must confirm (in the description) that the corresponding change was made on the other platform too, or explicitly state why not (e.g. "backend-only bugfix, no schema/behavior change").

---

## 8. What Not to Do

- Do not add a new npm/pip/pub package without checking whether an existing dependency already covers the need (dependency sprawl makes the "free-first, lean stack" decision in `05-SYSTEM-DESIGN.md` §1a meaningless over time).
- Do not introduce a second state-management library in Flutter or a second styling approach in Next.js "just for this one screen."
- Do not write raw SQL joins across module table boundaries in application code — if a query genuinely needs to span modules (most legitimately: analytics), it belongs in the Analytics module's service layer reading from `record_facts` (the deliberately shared read-model per `06-DATABASE-DESIGN.md` §4 note 1), not an ad hoc cross-module join elsewhere.

---
*Related: `05-SYSTEM-DESIGN.md`, `06-DATABASE-DESIGN.md`, `08-UXUI-SPEC.md`, `11-TESTING-STRATEGY.md`*
