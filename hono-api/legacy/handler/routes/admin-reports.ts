import type { Ctx } from "./ctx.ts";
import {
  ageBucket,
  answerOf,
  normParty,
} from "../lib/analytics/answers.ts";
import {
  sql,
} from "../lib/db.ts";
import {
  json,
} from "../lib/http.ts";
import {
  parsePayload,
} from "../lib/payload.ts";
import {
  adminFormKeyScope,
} from "../lib/tenant.ts";
import {
  dayKey,
  isoStamp,
  istToday,
} from "../lib/time.ts";
import {
  isPortalAdmin,
} from "../lib/users.ts";
import {
  isDraftSubmission,
  loadMediaKindsMap,
  payloadStatus,
  surveyorNameOf,
  verifyWithMedia,
  workStatusOf,
} from "../lib/verify.ts";

export async function handleAdminReports(c: Ctx): Promise<Response | null> {
  const { url, path, method, me } = c;
  // ── Client Admin & Quota Breakdown (Super Admin view all / Client Admin self) ──
  if (path === "/api/admin/client-breakdown" && method === "GET") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);

    try {
      const isSuper = me.role === "super_admin";
      const rows = isSuper
        ? await sql`
              WITH sub_counts AS (
                SELECT 
                  payload->>'form_key' AS form_key,
                  COUNT(*) FILTER (WHERE COALESCE(payload->>'source','') NOT IN ('web-survey','web') AND COALESCE(payload->>'status','pending') <> 'rejected' AND COALESCE(payload->>'draft','false') NOT IN ('true','t','1'))::int AS field_used,
                  COUNT(*) FILTER (WHERE COALESCE(payload->>'source','') IN ('web-survey','web') AND COALESCE(payload->>'draft','false') NOT IN ('true','t','1'))::int AS web_used,
                  COUNT(*) FILTER (WHERE COALESCE(payload->>'status','pending') NOT IN ('confirmed', 'rejected') AND COALESCE(payload->>'draft','false') NOT IN ('true','t','1'))::int AS pending,
                  COUNT(*) FILTER (WHERE COALESCE(payload->>'status','pending') = 'confirmed' AND COALESCE(payload->>'draft','false') NOT IN ('true','t','1'))::int AS confirmed,
                  COUNT(*) FILTER (WHERE COALESCE(payload->>'status','pending') = 'rejected' AND COALESCE(payload->>'draft','false') NOT IN ('true','t','1'))::int AS rejected
                FROM submissions
                WHERE payload->>'form_key' IS NOT NULL
                GROUP BY 1
              ),
              web_caps AS (
                SELECT 
                  form_key, 
                  MAX(COALESCE(max_uses, 0))::int AS max_uses,
                  MAX(COALESCE(use_count, 0))::int AS use_count,
                  BOOL_OR(token IS NOT NULL AND used_at IS NULL AND (max_uses = 0 OR use_count < max_uses)) AS is_live,
                  MIN(created_at) AS starts_at,
                  MAX(used_at) AS ended_at
                FROM web_survey_links
                GROUP BY form_key
              ),
              admin_surveys AS (
                SELECT 
                  u.id AS admin_id,
                  f.id AS survey_id,
                  f.title,
                  f.form_key,
                  COALESCE(c.max_uses, 0)::int AS web_allocated,
                  COALESCE(s.field_used, 0)::int AS field_used,
                  GREATEST(COALESCE(s.web_used, 0), COALESCE(c.use_count, 0))::int AS web_used,
                  (COALESCE(s.pending, 0) + COALESCE(s.confirmed, 0) + COALESCE(s.rejected, 0))::int AS total_used,
                  COALESCE(s.pending, 0)::int AS pending,
                  COALESCE(s.confirmed, 0)::int AS confirmed,
                  COALESCE(s.rejected, 0)::int AS rejected,
                  COALESCE(c.is_live, false) AS is_live,
                  c.starts_at,
                  c.ended_at,
                  CASE 
                    WHEN COALESCE(c.max_uses, 0) > 0 THEN GREATEST(0, c.max_uses - GREATEST(COALESCE(s.web_used, 0), COALESCE(c.use_count, 0))) 
                    ELSE NULL 
                  END AS web_remaining
                FROM app_users u
                JOIN survey_form f ON (
                  f.created_by = u.id 
                  OR f.id IN (SELECT survey_id FROM survey_admin_access WHERE admin_id = u.id)
                  OR (f.company_name IS NOT NULL AND f.company_name <> '' AND LOWER(TRIM(f.company_name)) = LOWER(TRIM(u.company_name)))
                  OR (f.company_id IS NOT NULL AND f.company_id = u.company_id)
                ) AND f.form_key NOT IN ('default', 'legacy')
                LEFT JOIN sub_counts s ON s.form_key = f.form_key
                LEFT JOIN web_caps c ON c.form_key = f.form_key
                WHERE u.role = 'admin'
              )
              SELECT 
                u.id, 
                u.username, 
                COALESCE(u.display_name, u.username) AS name,
                u.company_name, 
                COALESCE(u.max_records, 0)::int AS allocated,
                COALESCE(SUM(asv.web_allocated), 0)::int AS web_allocated,
                COALESCE(SUM(asv.field_used), 0)::int AS field_used,
                COALESCE(SUM(asv.web_used), 0)::int AS web_used,
                (COALESCE(SUM(asv.field_used), 0) + COALESCE(SUM(asv.web_used), 0))::int AS total_used,
                COALESCE(SUM(asv.rejected), 0)::int AS rejected,
                CASE 
                  WHEN COALESCE(u.max_records, 0) > 0 
                  THEN GREATEST(0, u.max_records - COALESCE(SUM(asv.field_used), 0) - COALESCE(SUM(asv.web_allocated), 0))::int
                  ELSE NULL 
                END AS field_remaining,
                COUNT(asv.survey_id)::int AS survey_count,
                COALESCE(
                  jsonb_agg(
                    jsonb_build_object(
                      'id', asv.survey_id,
                      'title', asv.title,
                      'form_key', asv.form_key,
                      'web_allocated', asv.web_allocated,
                      'field_used', asv.field_used,
                      'web_used', asv.web_used,
                      'total_used', asv.total_used,
                      'pending', asv.pending,
                      'confirmed', asv.confirmed,
                      'rejected', asv.rejected,
                      'is_live', asv.is_live,
                      'starts_at', asv.starts_at,
                      'ended_at', asv.ended_at,
                      'web_remaining', asv.web_remaining
                    )
                  ) FILTER (WHERE asv.survey_id IS NOT NULL),
                  '[]'::jsonb
                ) AS surveys
              FROM app_users u
              LEFT JOIN admin_surveys asv ON asv.admin_id = u.id
              WHERE u.role = 'admin'
              GROUP BY u.id, u.username, u.display_name, u.company_name, u.max_records
              ORDER BY u.id
            `
        : await sql`
              WITH sub_counts AS (
                SELECT 
                  payload->>'form_key' AS form_key,
                  COUNT(*) FILTER (WHERE COALESCE(payload->>'source','') NOT IN ('web-survey','web') AND COALESCE(payload->>'status','pending') <> 'rejected' AND COALESCE(payload->>'draft','false') NOT IN ('true','t','1'))::int AS field_used,
                  COUNT(*) FILTER (WHERE COALESCE(payload->>'source','') IN ('web-survey','web') AND COALESCE(payload->>'draft','false') NOT IN ('true','t','1'))::int AS web_used,
                  COUNT(*) FILTER (WHERE COALESCE(payload->>'status','pending') NOT IN ('confirmed', 'rejected') AND COALESCE(payload->>'draft','false') NOT IN ('true','t','1'))::int AS pending,
                  COUNT(*) FILTER (WHERE COALESCE(payload->>'status','pending') = 'confirmed' AND COALESCE(payload->>'draft','false') NOT IN ('true','t','1'))::int AS confirmed,
                  COUNT(*) FILTER (WHERE COALESCE(payload->>'status','pending') = 'rejected' AND COALESCE(payload->>'draft','false') NOT IN ('true','t','1'))::int AS rejected
                FROM submissions
                WHERE payload->>'form_key' IS NOT NULL
                GROUP BY 1
              ),
              web_caps AS (
                SELECT 
                  form_key, 
                  MAX(COALESCE(max_uses, 0))::int AS max_uses,
                  MAX(COALESCE(use_count, 0))::int AS use_count,
                  BOOL_OR(token IS NOT NULL AND used_at IS NULL AND (max_uses = 0 OR use_count < max_uses)) AS is_live,
                  MIN(created_at) AS starts_at,
                  MAX(used_at) AS ended_at
                FROM web_survey_links
                GROUP BY form_key
              ),
              admin_surveys AS (
                SELECT 
                  u.id AS admin_id,
                  f.id AS survey_id,
                  f.title,
                  f.form_key,
                  COALESCE(c.max_uses, 0)::int AS web_allocated,
                  COALESCE(s.field_used, 0)::int AS field_used,
                  GREATEST(COALESCE(s.web_used, 0), COALESCE(c.use_count, 0))::int AS web_used,
                  (COALESCE(s.pending, 0) + COALESCE(s.confirmed, 0) + COALESCE(s.rejected, 0))::int AS total_used,
                  COALESCE(s.pending, 0)::int AS pending,
                  COALESCE(s.confirmed, 0)::int AS confirmed,
                  COALESCE(s.rejected, 0)::int AS rejected,
                  COALESCE(c.is_live, false) AS is_live,
                  c.starts_at,
                  c.ended_at,
                  CASE 
                    WHEN COALESCE(c.max_uses, 0) > 0 THEN GREATEST(0, c.max_uses - GREATEST(COALESCE(s.web_used, 0), COALESCE(c.use_count, 0))) 
                    ELSE NULL 
                  END AS web_remaining
                FROM app_users u
                JOIN survey_form f ON (
                  f.created_by = u.id 
                  OR f.id IN (SELECT survey_id FROM survey_admin_access WHERE admin_id = u.id)
                  OR (f.company_name IS NOT NULL AND f.company_name <> '' AND LOWER(TRIM(f.company_name)) = LOWER(TRIM(u.company_name)))
                  OR (f.company_id IS NOT NULL AND f.company_id = u.company_id)
                ) AND f.form_key NOT IN ('default', 'legacy')
                LEFT JOIN sub_counts s ON s.form_key = f.form_key
                LEFT JOIN web_caps c ON c.form_key = f.form_key
                WHERE u.id = ${me.id}
              )
              SELECT 
                u.id, 
                u.username, 
                COALESCE(u.display_name, u.username) AS name,
                u.company_name, 
                COALESCE(u.max_records, 0)::int AS allocated,
                COALESCE(SUM(asv.web_allocated), 0)::int AS web_allocated,
                COALESCE(SUM(asv.field_used), 0)::int AS field_used,
                COALESCE(SUM(asv.web_used), 0)::int AS web_used,
                (COALESCE(SUM(asv.field_used), 0) + COALESCE(SUM(asv.web_used), 0))::int AS total_used,
                COALESCE(SUM(asv.rejected), 0)::int AS rejected,
                CASE 
                  WHEN COALESCE(u.max_records, 0) > 0 
                  THEN GREATEST(0, u.max_records - COALESCE(SUM(asv.field_used), 0) - COALESCE(SUM(asv.web_allocated), 0))::int
                  ELSE NULL 
                END AS field_remaining,
                COUNT(asv.survey_id)::int AS survey_count,
                COALESCE(
                  jsonb_agg(
                    jsonb_build_object(
                      'id', asv.survey_id,
                      'title', asv.title,
                      'form_key', asv.form_key,
                      'web_allocated', asv.web_allocated,
                      'field_used', asv.field_used,
                      'web_used', asv.web_used,
                      'total_used', asv.total_used,
                      'pending', asv.pending,
                      'confirmed', asv.confirmed,
                      'rejected', asv.rejected,
                      'is_live', asv.is_live,
                      'starts_at', asv.starts_at,
                      'ended_at', asv.ended_at,
                      'web_remaining', asv.web_remaining
                    )
                  ) FILTER (WHERE asv.survey_id IS NOT NULL),
                  '[]'::jsonb
                ) AS surveys
              FROM app_users u
              LEFT JOIN admin_surveys asv ON asv.admin_id = u.id
              WHERE u.id = ${me.id}
              GROUP BY u.id, u.username, u.display_name, u.company_name, u.max_records
            `;

      return json({
        items: rows as Record<string, unknown>[],
        count: (rows as Record<string, unknown>[]).length,
      });
    } catch (err) {
      return json({ error: String((err as Error)?.message || err) }, 500);
    }
  }

  // Client Admin analyze board: by date + user
  // ── Raw answer rows for the question-analytics engine ───────────────────
  // The Excel Charts question mode needs per-record answers (cross-tabs,
  // significance). Compact shape: one object per record, answers keyed by
  // question id. Drafts skipped; scoped to the admin's surveys.
  if (path === "/api/admin/answer-rows" && method === "GET") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    const surveyQ = String(url.searchParams.get("survey") || "").trim();
    const userQ = String(url.searchParams.get("user") || "").trim().toLowerCase();
    const districtQ = String(url.searchParams.get("district") || "").trim().toLowerCase();
    const dateFromQ = String(url.searchParams.get("date_from") || "").trim();
    const dateToQ = String(url.searchParams.get("date_to") || "").trim();
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 2000, 1), 5000);
    const scopeKeys = await adminFormKeyScope(sql, me);

    const frows = scopeKeys
      ? await sql`
            SELECT form_key, questions FROM survey_form
            WHERE form_key = ANY(${scopeKeys})
              AND (${surveyQ} = '' OR form_key = ${surveyQ})
          `.catch(() => [])
      : await sql`
            SELECT form_key, questions FROM survey_form
            WHERE (${surveyQ} = '' OR form_key = ${surveyQ})
          `.catch(() => []);

    const qids: string[] = [];
    for (const f of frows as { questions?: unknown }[]) {
      let qs = f.questions;
      if (typeof qs === "string") { try { qs = JSON.parse(qs); } catch { qs = []; } }
      if (!Array.isArray(qs)) continue;
      for (const q of qs as Record<string, unknown>[]) {
        const id = String(q.id || q.label || "");
        if (id && !qids.includes(id)) qids.push(id);
      }
    }

    const rows = scopeKeys
      ? await sql`
            SELECT id, payload, created_at FROM submissions
            WHERE payload->>'form_key' = ANY(${scopeKeys})
              AND (${surveyQ} = '' OR payload->>'form_key' = ${surveyQ})
            ORDER BY created_at DESC LIMIT ${limit}
          `.catch(() => [])
      : await sql`
            SELECT id, payload, created_at FROM submissions
            WHERE (${surveyQ} = '' OR payload->>'form_key' = ${surveyQ})
            ORDER BY created_at DESC LIMIT ${limit}
          `.catch(() => []);

    const out: Record<string, unknown>[] = [];
    for (const r of rows as { id: number; payload: unknown; created_at: string }[]) {
      const payload = parsePayload(r.payload);
      if (isDraftSubmission(payload)) continue;
      const a = (payload.answers || {}) as Record<string, unknown>;
      const answers: Record<string, string> = {};
      for (const qid of qids) {
        const v = answerOf(a, qid);
        if (v == null || v === "") continue;
        answers[qid] = Array.isArray(v) ? v.map(String).join(", ") : String(v);
      }
      const date = dayKey(isoStamp(r.created_at));
      const user = surveyorNameOf(payload);
      const district = String(a.district || "Unknown");
      if (userQ && !String(user).toLowerCase().includes(userQ)) continue;
      if (districtQ && !district.toLowerCase().includes(districtQ)) continue;
      if (dateFromQ && date < dateFromQ) continue;
      if (dateToQ && date > dateToQ) continue;
      out.push({
        id: Number(r.id),
        date,
        month: date.slice(0, 7),
        user,
        district,
        status: payloadStatus(payload),
        answers,
      });
    }
    return json({ rows: out, question_ids: qids, total: out.length });
  }

  if (path === "/api/admin/analyze" && method === "GET") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    let dateFrom = (url.searchParams.get("date_from") || "").trim();
    let dateTo = (url.searchParams.get("date_to") || "").trim();
    const userQ = (url.searchParams.get("user") || "").trim().toLowerCase();
    const surveyQ = (url.searchParams.get("survey") || url.searchParams.get("form_key") || "").trim();
    const districtQ = (url.searchParams.get("district") || "").trim().toLowerCase();
    const constituencyQ = (url.searchParams.get("constituency") || url.searchParams.get("ac") || "").trim().toLowerCase();
    const period = (url.searchParams.get("period") || "total").trim().toLowerCase();
    const dayParam = (url.searchParams.get("day") || "").trim();
    const monthParam = (url.searchParams.get("month") || "").trim();
    const completenessQ = (url.searchParams.get("completeness") || "").trim().toLowerCase();
    const sourceQ = (url.searchParams.get("source") || "").trim().toLowerCase();
    // Dynamic question filters (q_<questionId> → value) — from Client Admin question naming
    const qFilters: [string, string][] = [];
    for (const [k, v] of url.searchParams) {
      if (k.startsWith("q_") && v.trim()) qFilters.push([k.slice(2), v.trim()]);
    }
    if (period === "today") {
      const t = istToday();
      dateFrom = t;
      dateTo = t;
    } else if (period === "day" && dayParam) {
      dateFrom = dayParam;
      dateTo = dayParam;
    } else if (period === "month" && monthParam) {
      const [y, m] = monthParam.split("-").map(Number);
      if (y && m) {
        const last = new Date(y, m, 0).getDate();
        dateFrom = `${monthParam}-01`;
        dateTo = `${monthParam}-${String(last).padStart(2, "0")}`;
      }
    }
    const scopeKeys = await adminFormKeyScope(sql, me);
    const rows = scopeKeys
      ? await sql`
            SELECT id, payload, created_at FROM submissions
            WHERE payload->>'form_key' = ANY(${scopeKeys})
            ORDER BY created_at DESC LIMIT 5000
          `
      : await sql`
            SELECT id, payload, created_at FROM submissions
            ORDER BY created_at DESC LIMIT 5000
          `;
    // question id → type, so age-type q_ filters bucket-match ranges
    const qTypeMap = new Map<string, string>();
    // question metadata for the question-answer charts (label + option order)
    const qMetaMap = new Map<string, { label: string; type: string; options: string[] }>();
    {
      const frows = scopeKeys
        ? await sql`SELECT questions FROM survey_form WHERE form_key = ANY(${scopeKeys})`.catch(() => [])
        : await sql`SELECT questions FROM survey_form`.catch(() => []);
      for (const f of frows as { questions?: unknown }[]) {
        let qs = f.questions;
        if (typeof qs === "string") { try { qs = JSON.parse(qs); } catch { qs = []; } }
        if (!Array.isArray(qs)) continue;
        for (const q of qs as Record<string, unknown>[]) {
          const id = String(q.id || q.label || "");
          if (!id) continue;
          const type = String(q.type || "text");
          qTypeMap.set(id, type);
          const optsRaw = Array.isArray(q.options) ? q.options : [];
          const options = optsRaw
            .map((o) => String(typeof o === "string" ? o : (o as Record<string, unknown>)?.label ?? (o as Record<string, unknown>)?.value ?? "").trim())
            .filter(Boolean);
          if (!qMetaMap.has(id)) {
            qMetaMap.set(id, { label: String(q.label || q.text || id), type, options });
          }
        }
      }
    }
    // per-question answer tallies for the filtered rows
    const qAnswers = new Map<string, Map<string, number>>();
    const qAnswered = new Map<string, number>();
    const mediaMap = await loadMediaKindsMap(sql);

    type RowA = {
      id: number;
      date: string;
      month: string;
      user: string;
      status: string;
      /** Work status for surveyor boards: completed | pending | rejected */
      work: "completed" | "pending" | "rejected";
      draft: boolean;
      completeness: string;
      geo_ok: boolean;
      voice_ok: boolean;
      photo_ok: boolean;
      district: string;
      party: string;
    };
    type Bucket = {
      total: number;
      /** Media OK (geo+voice+photo+Q/A) */
      complete: number;
      /** Media fail */
      incomplete: number;
      /** Confirmed + not draft = finished for surveyor */
      completed: number;
      /** Alias of completed (UI uses confirmed column for completed work) */
      confirmed: number;
      /** Status pending OR draft (still open) */
      pending: number;
      rejected: number;
      draft: number;
      geo_fail: number;
      voice_fail: number;
      photo_fail: number;
    };
    const emptyBucket = (): Bucket => ({
      total: 0,
      complete: 0,
      incomplete: 0,
      completed: 0,
      confirmed: 0,
      pending: 0,
      rejected: 0,
      draft: 0,
      geo_fail: 0,
      voice_fail: 0,
      photo_fail: 0,
    });
    const bump = (b: Bucket, row: RowA) => {
      b.total += 1;
      // Media completeness
      if (row.completeness === "complete") b.complete += 1;
      else b.incomplete += 1;
      // Work progress (what Client Admin expects: completed vs pending)
      if (row.work === "completed") {
        b.completed += 1;
        b.confirmed += 1; // confirmed column = completed work
      } else if (row.work === "rejected") {
        b.rejected += 1;
      } else {
        b.pending += 1;
      }
      if (row.draft) b.draft += 1;
      if (!row.geo_ok) b.geo_fail += 1;
      if (!row.voice_ok) b.voice_fail += 1;
      if (!row.photo_ok) b.photo_fail += 1;
    };

    let list: RowA[] = [];
    for (const r of rows as { id: number; payload: unknown; created_at: string }[]) {
      const payload = parsePayload(r.payload);
      const a = (payload.answers || {}) as Record<string, unknown>;
      const v = verifyWithMedia(payload, mediaMap, Number(r.id));
      const user = surveyorNameOf(payload);
      const draft = isDraftSubmission(payload);
      const work = workStatusOf(payload);
      const date = dayKey(isoStamp(r.created_at));
      const month = date.slice(0, 7);
      if (dateFrom && date < dateFrom) continue;
      if (dateTo && date > dateTo) continue;
      if (userQ && !user.toLowerCase().includes(userQ)) continue;
      if (surveyQ && String(payload.form_key || "default") !== surveyQ) continue;
      {
        const src = String(payload.source || "").toLowerCase();
        const isWeb = src === "web-survey" || src === "web";
        if (sourceQ === "web" && !isWeb) continue;
        if ((sourceQ === "field" || sourceQ === "app") && isWeb) continue;
      }
      if (districtQ && !String(a.district || "").toLowerCase().includes(districtQ)) continue;
      if (constituencyQ && !String(a.constituency || a.assembly || "").toLowerCase().includes(constituencyQ)) continue;
      let qSkip = false;
      for (const [qid, want] of qFilters) {
        const val = answerOf(a, qid);
        const hit = qTypeMap.get(qid) === "age"
          ? ageBucket(val) === want
          : Array.isArray(val)
            ? val.map(String).includes(want)
            : String(val ?? "") === want;
        if (!hit) {
          qSkip = true;
          break;
        }
      }
      if (qSkip) continue;
      // Media completeness filter (Complete / Incomplete chips)
      if (
        (completenessQ === "complete" || completenessQ === "incomplete") &&
        v.completeness !== completenessQ
      ) {
        continue;
      }
      list.push({
        id: Number(r.id),
        date,
        month,
        user,
        status: payloadStatus(payload),
        work,
        draft,
        completeness: v.completeness,
        geo_ok: v.geo_ok,
        voice_ok: v.voice_ok,
        photo_ok: v.photo_ok,
        district: String(a.district || "Unknown"),
        party: normParty(String(a.winning_party || "")),
      });
      // tally answers for every question in scope (only rows that passed filters)
      for (const qid of qMetaMap.keys()) {
        const val = answerOf(a, qid);
        if (val == null || val === "") continue;
        const qType = qTypeMap.get(qid);
        const vals = Array.isArray(val) ? val.map(String) : [String(val)];
        const tally = qAnswers.get(qid) || new Map<string, number>();
        let touched = false;
        for (const raw of vals) {
          if (raw === "") continue;
          const bucket = qType === "age" ? String(ageBucket(raw) ?? "unknown") : raw;
          tally.set(bucket, (tally.get(bucket) || 0) + 1);
          touched = true;
        }
        if (touched) {
          qAnswers.set(qid, tally);
          qAnswered.set(qid, (qAnswered.get(qid) || 0) + 1);
        }
      }
    }

    const byDate: Record<string, Bucket & { date: string }> = {};
    const byMonth: Record<string, Bucket & { month: string }> = {};
    const byUser: Record<string, Bucket & { user: string }> = {};
    const bySurveyorDay: Record<string, Bucket & { surveyor: string; day: string }> = {};
    const bySurveyorMonth: Record<string, Bucket & { surveyor: string; month: string }> = {};
    const byDistrict: Record<string, Bucket & { district: string }> = {};
    const byParty: Record<string, Bucket & { party: string }> = {};
    for (const row of list) {
      if (!byDate[row.date]) byDate[row.date] = { date: row.date, ...emptyBucket() };
      bump(byDate[row.date], row);

      const mk = row.month || row.date.slice(0, 7);
      if (!byMonth[mk]) byMonth[mk] = { month: mk, ...emptyBucket() };
      bump(byMonth[mk], row);

      if (!byUser[row.user]) byUser[row.user] = { user: row.user, ...emptyBucket() };
      bump(byUser[row.user], row);

      if (!byDistrict[row.district]) byDistrict[row.district] = { district: row.district, ...emptyBucket() };
      bump(byDistrict[row.district], row);
      if (!byParty[row.party]) byParty[row.party] = { party: row.party, ...emptyBucket() };
      bump(byParty[row.party], row);

      // Surveyor daily
      const sdk = `${row.user}::${row.date}`;
      if (!bySurveyorDay[sdk]) {
        bySurveyorDay[sdk] = { surveyor: row.user, day: row.date, ...emptyBucket() };
      }
      bump(bySurveyorDay[sdk], row);

      // Surveyor monthly
      const smk = `${row.user}::${mk}`;
      if (!bySurveyorMonth[smk]) {
        bySurveyorMonth[smk] = { surveyor: row.user, month: mk, ...emptyBucket() };
      }
      bump(bySurveyorMonth[smk], row);
    }

    return json({
      filters: {
        date_from: dateFrom || null,
        date_to: dateTo || null,
        user: userQ || null,
        period,
        day: dayParam || null,
        month: monthParam || null,
        completeness: completenessQ || "all",
      },
      totals: {
        records: list.length,
        // Media
        complete: list.filter((x) => x.completeness === "complete").length,
        incomplete: list.filter((x) => x.completeness === "incomplete").length,
        geo_fail: list.filter((x) => !x.geo_ok).length,
        voice_fail: list.filter((x) => !x.voice_ok).length,
        photo_fail: list.filter((x) => !x.photo_ok).length,
        // Work: completed vs pending (draft never counts completed)
        completed: list.filter((x) => x.work === "completed").length,
        confirmed: list.filter((x) => x.work === "completed").length,
        pending: list.filter((x) => x.work === "pending").length,
        rejected: list.filter((x) => x.work === "rejected").length,
        draft: list.filter((x) => x.draft).length,
        // Raw status (debug / advanced)
        status_confirmed: list.filter((x) => x.status === "confirmed").length,
        status_pending: list.filter((x) => x.status === "pending").length,
      },
      by_user: Object.values(byUser).sort(
        (a, b) =>
          Number((b as { total: number }).total) -
          Number((a as { total: number }).total),
      ),
      by_date: Object.values(byDate).sort((a, b) =>
        String((b as { date: string }).date).localeCompare(
          String((a as { date: string }).date),
        )
      ),
      by_month: Object.values(byMonth).sort((a, b) =>
        String((b as { month: string }).month).localeCompare(
          String((a as { month: string }).month),
        )
      ),
      by_day: Object.values(byDate).sort((a, b) =>
        String((b as { date: string }).date).localeCompare(
          String((a as { date: string }).date),
        )
      ),
      by_surveyor_day: Object.values(bySurveyorDay).sort((a, b) => {
        const da = a as { day: string; total: number; surveyor: string };
        const db = b as { day: string; total: number; surveyor: string };
        const d = db.day.localeCompare(da.day);
        if (d !== 0) return d;
        return db.total - da.total || da.surveyor.localeCompare(db.surveyor);
      }),
      by_surveyor_month: Object.values(bySurveyorMonth).sort((a, b) => {
        const ma = a as { month: string; total: number; surveyor: string };
        const mb = b as { month: string; total: number; surveyor: string };
        const m = mb.month.localeCompare(ma.month);
        if (m !== 0) return m;
        return mb.total - ma.total || ma.surveyor.localeCompare(mb.surveyor);
      }),
      by_district: Object.values(byDistrict).sort(
        (a, b) =>
          Number((b as { total: number }).total) -
          Number((a as { total: number }).total),
      ),
      by_party: Object.values(byParty).sort(
        (a, b) =>
          Number((b as { total: number }).total) -
          Number((a as { total: number }).total),
      ),
      by_question: [...qAnswers.entries()]
        .map(([qid, tally]) => {
          const meta = qMetaMap.get(qid) || { label: qid, type: "text", options: [] };
          const opts = [...tally.entries()]
            .map(([value, count]) => ({ value, count }))
            .sort((x, y) => y.count - x.count)
            .slice(0, 12);
          return {
            question_id: qid,
            label: meta.label,
            type: meta.type,
            answered: qAnswered.get(qid) || 0,
            options: opts,
          };
        })
        .sort((x, y) => y.answered - x.answered)
        .slice(0, 20),
      strict: {
        geo_tagging: "required",
        voice_detection: "required",
        photo: "required",
      },
      sample: list.slice(0, 100),
    });
  }
  return null;
}
