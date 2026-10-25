import type { Ctx } from "./ctx.ts";
import {
  buildAnalytics,
} from "../lib/analytics/build.ts";
import {
  sql,
} from "../lib/db.ts";
import {
  json,
} from "../lib/http.ts";
import {
  adminFormKeyScope,
} from "../lib/tenant.ts";
import {
  isPortalAdmin,
} from "../lib/users.ts";

// ── Analytics result cache (30s per admin + filter set) ──
// Heavy dashboard/report queries load all rows and compute in JS.
// Repeated requests with the same filters within 30s return the cached
// result instead of re-running the full computation.
const ANALYTICS_CACHE_TTL_MS = 30_000;
const analyticsCache = new Map<string, { body: unknown; expires: number }>();

function cacheKey(meId: unknown, search: string): string {
  return `${meId}:${search}`;
}

function sweepAnalyticsCache(): void {
  const now = Date.now();
  if (analyticsCache.size < 5) return; // only sweep when there are entries
  for (const [k, v] of analyticsCache) {
    if (v.expires < now) analyticsCache.delete(k);
  }
}

export function invalidateAnalyticsCache(): void {
  analyticsCache.clear();
}

export async function handleAnalytics(c: Ctx): Promise<Response | null> {
  const { url, m, me } = c;
  // Dashboard + filters — full super-set / sub-set analytics (and consolidated kpi / geo groups)
  if (m === "GET" && url.pathname === "/api/analytics") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);

    // Check cache first — same admin + same filters = same result
    const key = cacheKey(me.id, url.search);
    const cached = analyticsCache.get(key);
    if (cached && cached.expires > Date.now()) {
      return json(cached.body);
    }
    sweepAnalyticsCache();

    const groupBy = (url.searchParams.get("group_by") || "").trim().toLowerCase();
    const envScope = await adminFormKeyScope(sql, me);

    // KPI group (formerly /api/stats)
    if (groupBy === "kpi") {
      const [[dists], [mands], [acs], [srs], [factGeo]] = await Promise.all([
        sql`SELECT COUNT(*)::int AS n FROM districts`.catch(() => [{ n: 0 }]),
        sql`SELECT COUNT(*)::int AS n FROM mandals`.catch(() => [{ n: 0 }]),
        sql`SELECT COUNT(*)::int AS n FROM assembly_constituencies`.catch(() => [{ n: 0 }]),
        sql`SELECT COUNT(*)::int AS n FROM survey_responses`.catch(() => [{ n: 0 }]),
        sql`
          SELECT COUNT(DISTINCT district)::int AS dist_count,
                 COUNT(DISTINCT constituency)::int AS ac_count
          FROM record_facts
        `.catch(() => [{ dist_count: 0, ac_count: 0 }]),
      ]);

      const [statusRow] = envScope
        ? await sql`
              SELECT
                COUNT(*) FILTER (
                  WHERE NOT (
                    COALESCE(payload->>'draft', 'false') IN ('true', 't', '1')
                    OR COALESCE(payload->'answers'->>'_draft', 'false') IN ('true', 't', '1')
                    OR COALESCE(payload->'answers'->>'draft', 'false') IN ('true', 't', '1')
                    OR LOWER(COALESCE(payload->>'content_type', '')) = 'draft'
                  )
                  AND COALESCE(payload->>'status', 'pending') = 'confirmed'
                  AND COALESCE(payload->>'source', '') NOT IN ('web-survey', 'web')
                )::int AS confirmed,
                COUNT(*) FILTER (
                  WHERE NOT (
                    COALESCE(payload->>'draft', 'false') IN ('true', 't', '1')
                    OR COALESCE(payload->'answers'->>'_draft', 'false') IN ('true', 't', '1')
                    OR COALESCE(payload->'answers'->>'draft', 'false') IN ('true', 't', '1')
                    OR LOWER(COALESCE(payload->>'content_type', '')) = 'draft'
                  )
                  AND COALESCE(payload->>'status', 'pending') = 'rejected'
                  AND COALESCE(payload->>'source', '') NOT IN ('web-survey', 'web')
                )::int AS rejected,
                COUNT(*) FILTER (
                  WHERE (
                    (
                      COALESCE(payload->>'draft', 'false') IN ('true', 't', '1')
                      OR COALESCE(payload->'answers'->>'_draft', 'false') IN ('true', 't', '1')
                      OR COALESCE(payload->'answers'->>'draft', 'false') IN ('true', 't', '1')
                      OR LOWER(COALESCE(payload->>'content_type', '')) = 'draft'
                    )
                    OR COALESCE(payload->>'status', 'pending') NOT IN ('confirmed', 'rejected')
                  )
                  AND COALESCE(payload->>'source', '') NOT IN ('web-survey', 'web')
                )::int AS pending,
                COUNT(*) FILTER (
                  WHERE NOT (
                    COALESCE(payload->>'draft', 'false') IN ('true', 't', '1')
                    OR COALESCE(payload->'answers'->>'_draft', 'false') IN ('true', 't', '1')
                    OR COALESCE(payload->'answers'->>'draft', 'false') IN ('true', 't', '1')
                    OR LOWER(COALESCE(payload->>'content_type', '')) = 'draft'
                  )
                  AND COALESCE(payload->>'status', 'pending') = 'confirmed'
                  AND COALESCE(payload->>'source', '') IN ('web-survey', 'web')
                )::int AS web_confirmed,
                COUNT(*) FILTER (
                  WHERE NOT (
                    COALESCE(payload->>'draft', 'false') IN ('true', 't', '1')
                    OR COALESCE(payload->'answers'->>'_draft', 'false') IN ('true', 't', '1')
                    OR COALESCE(payload->'answers'->>'draft', 'false') IN ('true', 't', '1')
                    OR LOWER(COALESCE(payload->>'content_type', '')) = 'draft'
                  )
                  AND COALESCE(payload->>'status', 'pending') = 'rejected'
                  AND COALESCE(payload->>'source', '') IN ('web-survey', 'web')
                )::int AS web_rejected,
                COUNT(*) FILTER (
                  WHERE (
                    (
                      COALESCE(payload->>'draft', 'false') IN ('true', 't', '1')
                      OR COALESCE(payload->'answers'->>'_draft', 'false') IN ('true', 't', '1')
                      OR COALESCE(payload->'answers'->>'draft', 'false') IN ('true', 't', '1')
                      OR LOWER(COALESCE(payload->>'content_type', '')) = 'draft'
                    )
                    OR COALESCE(payload->>'status', 'pending') NOT IN ('confirmed', 'rejected')
                  )
                  AND COALESCE(payload->>'source', '') IN ('web-survey', 'web')
                )::int AS web_pending
              FROM submissions WHERE payload->>'form_key' = ANY(${envScope})
            `.catch(() => [{ confirmed: 0, rejected: 0, pending: 0, web_confirmed: 0, web_rejected: 0, web_pending: 0 }])
        : await sql`
              SELECT
                COUNT(*) FILTER (
                  WHERE NOT (
                    COALESCE(payload->>'draft', 'false') IN ('true', 't', '1')
                    OR COALESCE(payload->'answers'->>'_draft', 'false') IN ('true', 't', '1')
                    OR COALESCE(payload->'answers'->>'draft', 'false') IN ('true', 't', '1')
                    OR LOWER(COALESCE(payload->>'content_type', '')) = 'draft'
                  )
                  AND COALESCE(payload->>'status', 'pending') = 'confirmed'
                  AND COALESCE(payload->>'source', '') NOT IN ('web-survey', 'web')
                )::int AS confirmed,
                COUNT(*) FILTER (
                  WHERE NOT (
                    COALESCE(payload->>'draft', 'false') IN ('true', 't', '1')
                    OR COALESCE(payload->'answers'->>'_draft', 'false') IN ('true', 't', '1')
                    OR COALESCE(payload->'answers'->>'draft', 'false') IN ('true', 't', '1')
                    OR LOWER(COALESCE(payload->>'content_type', '')) = 'draft'
                  )
                  AND COALESCE(payload->>'status', 'pending') = 'rejected'
                  AND COALESCE(payload->>'source', '') NOT IN ('web-survey', 'web')
                )::int AS rejected,
                COUNT(*) FILTER (
                  WHERE (
                    (
                      COALESCE(payload->>'draft', 'false') IN ('true', 't', '1')
                      OR COALESCE(payload->'answers'->>'_draft', 'false') IN ('true', 't', '1')
                      OR COALESCE(payload->'answers'->>'draft', 'false') IN ('true', 't', '1')
                      OR LOWER(COALESCE(payload->>'content_type', '')) = 'draft'
                    )
                    OR COALESCE(payload->>'status', 'pending') NOT IN ('confirmed', 'rejected')
                  )
                  AND COALESCE(payload->>'source', '') NOT IN ('web-survey', 'web')
                )::int AS pending,
                COUNT(*) FILTER (
                  WHERE NOT (
                    COALESCE(payload->>'draft', 'false') IN ('true', 't', '1')
                    OR COALESCE(payload->'answers'->>'_draft', 'false') IN ('true', 't', '1')
                    OR COALESCE(payload->'answers'->>'draft', 'false') IN ('true', 't', '1')
                    OR LOWER(COALESCE(payload->>'content_type', '')) = 'draft'
                  )
                  AND COALESCE(payload->>'status', 'pending') = 'confirmed'
                  AND COALESCE(payload->>'source', '') IN ('web-survey', 'web')
                )::int AS web_confirmed,
                COUNT(*) FILTER (
                  WHERE NOT (
                    COALESCE(payload->>'draft', 'false') IN ('true', 't', '1')
                    OR COALESCE(payload->'answers'->>'_draft', 'false') IN ('true', 't', '1')
                    OR COALESCE(payload->'answers'->>'draft', 'false') IN ('true', 't', '1')
                    OR LOWER(COALESCE(payload->>'content_type', '')) = 'draft'
                  )
                  AND COALESCE(payload->>'status', 'pending') = 'rejected'
                  AND COALESCE(payload->>'source', '') IN ('web-survey', 'web')
                )::int AS web_rejected,
                COUNT(*) FILTER (
                  WHERE (
                    (
                      COALESCE(payload->>'draft', 'false') IN ('true', 't', '1')
                      OR COALESCE(payload->'answers'->>'_draft', 'false') IN ('true', 't', '1')
                      OR COALESCE(payload->'answers'->>'draft', 'false') IN ('true', 't', '1')
                      OR LOWER(COALESCE(payload->>'content_type', '')) = 'draft'
                    )
                    OR COALESCE(payload->>'status', 'pending') NOT IN ('confirmed', 'rejected')
                  )
                  AND COALESCE(payload->>'source', '') IN ('web-survey', 'web')
                )::int AS web_pending
              FROM submissions
            `.catch(() => [{ confirmed: 0, rejected: 0, pending: 0, web_confirmed: 0, web_rejected: 0, web_pending: 0 }]);

      const confirmed = Number((statusRow as Record<string, unknown>)?.confirmed || 0);
      const rejected = Number((statusRow as Record<string, unknown>)?.rejected || 0);
      const pending = Number((statusRow as Record<string, unknown>)?.pending || 0);
      const webConfirmed = Number((statusRow as Record<string, unknown>)?.web_confirmed || 0);
      const webRejected = Number((statusRow as Record<string, unknown>)?.web_rejected || 0);
      const webPending = Number((statusRow as Record<string, unknown>)?.web_pending || 0);

      const [distFromData] = envScope
        ? await sql`
              SELECT COUNT(DISTINCT NULLIF(TRIM(payload->'answers'->>'district'), ''))::int AS n
              FROM submissions
              WHERE payload->>'form_key' = ANY(${envScope})
                AND COALESCE(payload->>'status', 'pending') = 'confirmed'
                AND NOT (
                  COALESCE(payload->>'draft', 'false') IN ('true', 't', '1')
                  OR COALESCE(payload->'answers'->>'_draft', 'false') IN ('true', 't', '1')
                  OR COALESCE(payload->'answers'->>'draft', 'false') IN ('true', 't', '1')
                  OR LOWER(COALESCE(payload->>'content_type', '')) = 'draft'
                )
            `.catch(() => [{ n: 0 }])
        : await sql`
              SELECT COUNT(DISTINCT NULLIF(TRIM(payload->'answers'->>'district'), ''))::int AS n
              FROM submissions
              WHERE COALESCE(payload->>'status', 'pending') = 'confirmed'
                AND NOT (
                  COALESCE(payload->>'draft', 'false') IN ('true', 't', '1')
                  OR COALESCE(payload->'answers'->>'_draft', 'false') IN ('true', 't', '1')
                  OR COALESCE(payload->'answers'->>'draft', 'false') IN ('true', 't', '1')
                  OR LOWER(COALESCE(payload->>'content_type', '')) = 'draft'
                )
            `.catch(() => [{ n: 0 }]);

      const [acFromData] = envScope
        ? await sql`
              SELECT COUNT(DISTINCT NULLIF(TRIM(COALESCE(
                payload->'answers'->>'constituency',
                payload->'answers'->>'assembly_constituency'
              )), ''))::int AS n
              FROM submissions
              WHERE payload->>'form_key' = ANY(${envScope})
                AND COALESCE(payload->>'status', 'pending') = 'confirmed'
                AND NOT (
                  COALESCE(payload->>'draft', 'false') IN ('true', 't', '1')
                  OR COALESCE(payload->'answers'->>'_draft', 'false') IN ('true', 't', '1')
                  OR COALESCE(payload->'answers'->>'draft', 'false') IN ('true', 't', '1')
                  OR LOWER(COALESCE(payload->>'content_type', '')) = 'draft'
                )
            `.catch(() => [{ n: 0 }])
        : await sql`
              SELECT COUNT(DISTINCT NULLIF(TRIM(COALESCE(
                payload->'answers'->>'constituency',
                payload->'answers'->>'assembly_constituency'
              )), ''))::int AS n
              FROM submissions
              WHERE COALESCE(payload->>'status', 'pending') = 'confirmed'
                AND NOT (
                  COALESCE(payload->>'draft', 'false') IN ('true', 't', '1')
                  OR COALESCE(payload->'answers'->>'_draft', 'false') IN ('true', 't', '1')
                  OR COALESCE(payload->'answers'->>'draft', 'false') IN ('true', 't', '1')
                  OR LOWER(COALESCE(payload->>'content_type', '')) = 'draft'
                )
            `.catch(() => [{ n: 0 }]);

      const dataDistricts = Number((distFromData as Record<string, unknown>)?.n || 0);
      const dataAcs = Number((acFromData as Record<string, unknown>)?.n || 0);
      const surveyDistrictsLive = dataDistricts || Number((factGeo as Record<string, unknown>)?.dist_count || 0);
      const surveyAcsLive = dataAcs || Number((factGeo as Record<string, unknown>)?.ac_count || 0);

      return json({
        field_pending: pending,
        field_confirmed: confirmed,
        field_rejected: rejected,
        field_submissions: confirmed + pending + rejected,
        pending: pending + webPending,
        confirmed: confirmed + webConfirmed,
        rejected: rejected + webRejected,
        submissions: confirmed + pending + rejected + webConfirmed + webPending + webRejected,
        survey_responses: srs?.n ?? 0,
        web_pending: webPending,
        web_confirmed: webConfirmed,
        web_rejected: webRejected,
        web_submissions: webConfirmed + webPending + webRejected,
        districts: surveyDistrictsLive,
        constituencies: surveyAcsLive,
        master_districts: dists?.n ?? 0,
        mandals: mands?.n ?? 0,
        assembly_constituencies: acs?.n ?? 0,
        coverage: {
          districtsWithFacts: factGeo?.dist_count ?? 0,
          constituenciesWithFacts: factGeo?.ac_count ?? 0,
        },
      });
    }

    // Geo summary group (formerly /api/admin/geo-summary)
    if (groupBy === "geo") {
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      try {
        const [[d], [m], [a], [p], [r], [s], districts, acs, mps] = await Promise.all([
          sql`SELECT COUNT(*)::int AS n FROM districts`,
          sql`SELECT COUNT(*)::int AS n FROM mandals`,
          sql`SELECT COUNT(*)::int AS n FROM assembly_constituencies`,
          sql`SELECT COUNT(*)::int AS n FROM mp_constituencies`,
          sql`SELECT COUNT(*)::int AS n FROM revenue_divisions`,
          envScope
            ? sql`SELECT COUNT(*)::int AS n FROM submissions WHERE payload->>'form_key' = ANY(${envScope})`
            : sql`SELECT COUNT(*)::int AS n FROM submissions`,
          sql`SELECT * FROM districts ORDER BY name LIMIT 100`,
          sql`
            SELECT name, covering_districts, mp_constituency, reservation
            FROM assembly_constituencies ORDER BY name LIMIT 150
          `,
          sql`SELECT * FROM mp_constituencies ORDER BY name LIMIT 50`,
        ]);
        return json({
          counts: {
            districts: d?.n ?? 0,
            mandals: m?.n ?? 0,
            assembly_constituencies: a?.n ?? 0,
            mp_constituencies: p?.n ?? 0,
            revenue_divisions: r?.n ?? 0,
            submissions: s?.n ?? 0,
          },
          districts,
          assembly_constituencies: acs,
          mp_constituencies: mps,
        });
      } catch (e) {
        return json({ error: (e as Error).message }, 500);
      }
    }

    const result = await buildAnalytics(sql, url, envScope);
    // Envelope: data_as_of watermark + fact health (09-ANALYTICS-SPEC §5/§8, ADR-014/016)
    const [w] = envScope
      ? await sql`
            SELECT MAX(confirmed_at) AS as_of FROM record_facts WHERE survey_key = ANY(${envScope})
          `.catch(() => [{ as_of: null }])
      : await sql`
            SELECT MAX(confirmed_at) AS as_of FROM record_facts
          `.catch(() => [{ as_of: null }]);
    let dataAsOf: string | null = (w as { as_of?: unknown } | undefined)?.as_of
      ? String((w as { as_of?: unknown }).as_of)
      : null;
    if (!dataAsOf) {
      const [f] = envScope
        ? await sql`
              SELECT MAX((payload->>'confirmed_at')::timestamptz) AS as_of
              FROM submissions
              WHERE payload->>'status' = 'confirmed' AND payload->>'form_key' = ANY(${envScope})
            `.catch(() => [{ as_of: null }])
        : await sql`
              SELECT MAX((payload->>'confirmed_at')::timestamptz) AS as_of
              FROM submissions WHERE payload->>'status' = 'confirmed'
            `.catch(() => [{ as_of: null }]);
      dataAsOf = (f as { as_of?: unknown } | undefined)?.as_of
        ? String((f as { as_of?: unknown }).as_of)
        : null;
    }
    const [fc] = envScope
      ? await sql`SELECT COUNT(*)::int AS n FROM record_facts WHERE survey_key = ANY(${envScope})`.catch(() => [{ n: 0 }])
      : await sql`SELECT COUNT(*)::int AS n FROM record_facts`.catch(() => [{ n: 0 }]);
    const [failedN] = envScope
      ? await sql`
            SELECT COUNT(*)::int AS n FROM submissions
            WHERE fact_status = 'failed' AND payload->>'form_key' = ANY(${envScope})
          `.catch(() => [{ n: 0 }])
      : await sql`
            SELECT COUNT(*)::int AS n FROM submissions WHERE fact_status = 'failed'
          `.catch(() => [{ n: 0 }]);
    const failed = Number((failedN as { n?: number } | undefined)?.n ?? 0);
    const confirmedTotal = Number(result?.statusCounts?.confirmed ?? 0);
    const body = {
      ...result,
      data_as_of: dataAsOf,
      empty: confirmedTotal === 0,
      degraded: failed > 0,
      degraded_reason: failed > 0
        ? `${failed} confirmed record${failed === 1 ? "" : "s"} with failed fact materialization — retry in Review`
        : null,
      facts: {
        materialized: Number((fc as { n?: number } | undefined)?.n ?? 0),
        failed,
      },
    };
    // Cache the expensive full-analytics result for repeat requests
    analyticsCache.set(key, { body, expires: Date.now() + ANALYTICS_CACHE_TTL_MS });
    return json(body);
  }
  return null;
}
