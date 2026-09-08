# Smart Survey X — Documentation Set

Metadata-driven, multi-tenant survey and election intelligence platform. This folder is the complete build specification — read in order, do not skip ahead.

## Reading / Build Order

| # | Document | What it defines |
|---|---|---|
| 1 | `01-PRD.md` | Vision, roles, locked decisions, metadata engine, success metrics |
| 2 | `02-BRS.md` | Numbered business requirements (`BR-xxx`) with acceptance criteria |
| 3 | `03-FRS.md` | Module-by-module functional requirements (`FR-MODULE-NN`), traced to BRs |
| 4 | `04-BUSINESS-RULES.md` | State machines (record lifecycle, template lifecycle), shared validation rule engine spec |
| 5 | `05-SYSTEM-DESIGN.md` | Architecture, module boundaries, tech stack per module, sync protocol, processing pipeline |
| 6 | `06-DATABASE-DESIGN.md` | Full ER diagram + PostgreSQL DDL for all 27 tables |
| 7 | `07-API-SPEC.md` | REST endpoint contract |
| 8 | `08-UXUI-SPEC.md` | Design tokens, component states, screen-by-screen UX intent |
| 9 | `09-ANALYTICS-SPEC.md` | Dashboard auto-generation algorithm, widget data contracts, election-type widget sets |
| 10 | `10-SECURITY.md` | AuthN/AuthZ, tenant isolation, data protection, evidence integrity |
| 11 | `11-TESTING-STRATEGY.md` | Critical test scenarios traced to BR acceptance criteria |
| 12 | `12-DEPLOYMENT.md` | Environments, infra, Super Admin bootstrap, CI/CD |
| 13 | `13-ADR-LOG.md` | Decisions with rationale + genuinely open questions — **check this before inventing a solution to an ambiguity** |
| 14 | `14-CODING-STANDARDS.md` | Folder structure, naming, architecture conventions, linting, testing rules |
| 15 | `15-GIT-HANDBOOK.md` | Branching model, commit/PR conventions, migration handling, release tagging |
| 16 | `16-TASK-BREAKDOWN.md` | Full build sequenced into 8 phases of agent-sized tasks with definitions of done |
| 17 | `17-ANALYTICS-PROCESSING-SEQUENCE.md` | Exact Review→Approve→Fact-Materialization service interfaces, transaction boundaries, failure/retry semantics, test contracts |
| 18 | `18-PHASE5-ANALYTICS-TASKS.md` | Granular Phase 5 task groups (A–F) for fact materialization, aggregation, dashboard generation, and read path, with a parallelization graph — supersedes the Phase 5 summary in `16-TASK-BREAKDOWN.md` |

## For Code Agents

1. Do not invent entities, fields, endpoints, or UI states not defined in these documents.
2. If a gap is found, add it to `13-ADR-LOG.md` under Open Questions rather than silently resolving it.
3. **Start execution at `16-TASK-BREAKDOWN.md`** — it sequences the entire build into 8 dependency-ordered phases with agent-sized tasks, each citing exactly which source documents to read and what "done" means. Read `01`–`14` first for context, then work the task list.
4. The Business Rules document (`04`) is the single source of truth for any lifecycle/state-machine question — if another document seems to imply a different transition, `04` wins.
5. Design tokens in `08-UXUI-SPEC.md` §1 are mandatory — no ad-hoc colors, fonts, or one-off button styles. `14-CODING-STANDARDS.md` §3.2/§3.3 enforces this at the folder/architecture level.
6. `14-CODING-STANDARDS.md` governs folder structure, naming, and the module service-interface boundary — read before writing the first line of code, not after.

## Locked Product Decisions (quick reference — full rationale in `13-ADR-LOG.md`)

- Shared PostgreSQL database, `tenant_id`-scoped, Row-Level Security backstop
- Client-wins offline sync for surveyor drafts
- Modular monolith (FastAPI), 18 modules, service-interface boundaries for future extraction
- TimescaleDB continuous aggregates for analytics (not a separate warehouse)
- Records invisible to analytics until Client Admin approves (audio cross-check against typed answers)
- One resubmission attempt allowed for rejected records, then final
- 5 roles: Super Admin (≤3 accounts), Client Admin Main, Sub Admin, Dashboard Viewer, Surveyor
- Only Surveyor gets a native app (Flutter); all admin/reviewer/viewer roles are web-only (Next.js)
- Closed set of 12 question input types, no custom types in MVP

## Status

18 documents complete and internally consistent as of this version. The analytics/dashboard pipeline (fact materialization, `data_as_of` freshness, system widgets, publish-time metadata validation) was substantially refined in a later pass — `09-ANALYTICS-SPEC.md`, `17-ANALYTICS-PROCESSING-SEQUENCE.md`, and `18-PHASE5-ANALYTICS-TASKS.md` are the current source of truth for that area; see `13-ADR-LOG.md` ADR-013 through ADR-016 for what changed and why, including a database flow-audit that fixed seven real schema issues. Two genuinely open items remain (see `13-ADR-LOG.md` OPEN-001, OPEN-002, OPEN-006) but all degrade gracefully and do not block MVP build.
