# Smart Survey X — Deployment Guide

**Version:** 1.0 (Locked)
**Depends on:** `05-SYSTEM-DESIGN.md` §1a (tech stack), `10-SECURITY.md`

---

## 1. Environments

| Environment | Purpose | Notes |
|---|---|---|
| `local` | Developer machines | Docker Compose: Postgres+PostGIS+TimescaleDB, Redis, FastAPI, Next.js dev server |
| `staging` | Pre-production QA, demo tenant (per Testing Strategy §3) | Mirrors production topology at smaller scale |
| `production` | Live tenants | See §3 for scaling notes |

## 2. Infrastructure (free-first, per System Design §1a)

| Component | Recommended starting point | Notes |
|---|---|---|
| Backend hosting | Any container-friendly host with a free/low-cost tier to start (e.g. Fly.io, Railway) or a small VM | FastAPI runs behind Uvicorn/Gunicorn; containerize via Docker regardless of host chosen |
| Database | Managed Postgres with the required extensions (`postgis`, `timescaledb`, `pgcrypto`) available — verify extension support **before** committing to a managed provider, since not all managed Postgres offerings support TimescaleDB | Neon, Supabase, or Timescale Cloud's own free/starter tier are natural fits since Timescale support is native there |
| Redis | Free/small managed tier (e.g. Upstash free tier) | Job broker + cache, per System Design §1a |
| Media storage | Cloudflare R2 | Free egress tier as already justified |
| Web portal hosting | Vercel (free tier for Next.js) or equivalent | Static/SSR hosting for the Admin Portal |
| Mobile app distribution | Google Play / Apple App Store standard channels | Flutter build pipeline via `flutter build apk`/`flutter build ios` |

## 3. Database Setup Procedure

1. Provision Postgres instance with required extensions enabled.
2. Run schema migrations (recommend **Alembic** for FastAPI/SQLAlchemy — free, standard) applying `06-DATABASE-DESIGN.md` DDL in order: extensions → tenants/users → question bank → survey builder → campaign/assignment → records/evidence → review → GIS → analytics (hypertable + continuous aggregate) → dashboards/reports/export/notifications/audit → RLS policies (applied last, after all tables exist).
3. Seed the `super_admin_role` Postgres role (Database Design §3) and grant `BYPASSRLS`.
4. Load initial GeoJSON boundary data into `geo_boundaries` if a source is available at launch (PRD §13 — otherwise leave `boundary` NULL and rely on FR-GIS-02 degradation).

## 4. Super Admin Bootstrap (per Security §6)

Since no API endpoint can create the first Super Admin (nothing is authenticated to call it), this is a **deployment-time script**, run once per environment:

```
# Conceptual — actual script lives in the codebase, not reproduced here
python -m scripts.seed_super_admin --name "..." --email "..." --password-prompt
```

- Run this immediately after schema migration, before any other setup.
- Up to 2 additional Super Admin accounts (BR-007 cap of 3) can subsequently be created by an existing Super Admin through an internal-only endpoint (documented here, not exposed in the public web portal navigation by default — access via direct URL/internal tooling, consistent with Security §6).
- Rotate/secure the seed script's credentials input path (never log the password, never commit a default password to the repo).

## 5. CI/CD Pipeline (suggested shape)

```
PR opened → lint + unit tests + tenant-isolation & evidence-immutability suites (blocking, Testing Strategy §4)
          → merge to main → full integration + e2e suite → build containers/artifacts
          → deploy to staging → smoke test → manual promote to production
```

- Database migrations run as a distinct pipeline step **before** the new application version is deployed, with a rollback plan for the migration itself (not just the app code) — schema changes to `records`/`record_answers` in particular should be additive (new nullable columns) rather than destructive where possible, given the immutability requirements elsewhere in this doc set.

## 6. Background Worker Deployment

- Celery workers deployed as a separate process/container from the API (even if co-located on the same host at MVP scale, per System Design §1a's "free tier" note) — this keeps the extraction path (System Design §8) genuinely available later without a redesign.
- Celery Beat (scheduler) runs as a single instance (not multiple, to avoid duplicate scheduled jobs) — handles the daily aggregation refresh trigger and any per-tenant override cadences (Analytics Spec §5).

## 7. Configuration & Secrets

- All secrets (DB connection string, Redis URL, R2 credentials, JWT signing secret) via environment variables / the hosting platform's secret manager — never committed to the repository (Security §8).
- Feature flags / tenant-specific overrides (e.g. `aggregation_refresh_interval`) live in the database (per-tenant/per-campaign config), not in environment variables, since they're operational data, not deployment config.

## 8. Rollback & Data Safety

- Given the immutability guarantees throughout this doc set (evidence, approved reviews), a "rollback" of application code should never be paired with a rollback of already-processed data — if a bad deploy caused incorrect aggregation, the fix is a forward migration/reprocessing job, not a data rollback that could contradict the immutability model.
- Media in R2 has no delete path exposed to any application role (per Security §4) — infrastructure-level lifecycle policies (if any, e.g. cold storage tiering for old media) are an ops decision outside application code, and should preserve retrievability, not delete.

---
*Next document: `13-ADR-LOG.md`*
