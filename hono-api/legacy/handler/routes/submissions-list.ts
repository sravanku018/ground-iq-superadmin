import type { Ctx } from "./ctx.ts";
import {
  ageBucket,
  answerOf,
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
  qaFromAnswers,
} from "../lib/time.ts";
import {
  isPortalAdmin,
} from "../lib/users.ts";
import {
  parseQuestionsArray,
} from "../lib/util.ts";
import {
  isDraftSubmission,
  loadMediaKindsMap,
  payloadStatus,
  recordIndexOf,
  surveyorNameOf,
  verifyWithMedia,
  workStatusOf,
} from "../lib/verify.ts";

export async function handleSubmissionsList(c: Ctx): Promise<Response | null> {
  const { url, m, me } = c;
  if (m === "GET" && url.pathname === "/api/submissions") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role) && me.role !== "surveyor") {
      return json({ error: "Access denied" }, 403);
    }

    const mine = url.searchParams.get("mine") === "1";
    if (mine || !isPortalAdmin(me.role)) {
      const uId = String(me.id);
      const name1 = String(me.name || "");
      const name2 = String(me.username || "");
      const rows = await sql`
          SELECT id, payload, created_at FROM (
            SELECT id, created_at,
              CASE
                WHEN jsonb_typeof(payload) = 'string' THEN (payload #>> '{}')::jsonb
                ELSE payload
              END AS payload
            FROM submissions
          ) s
          WHERE s.payload->>'user_id' = ${uId}
             OR (length(${name1}) > 0 AND s.payload->>'submitted_by' = ${name1})
             OR (length(${name2}) > 0 AND s.payload->>'submitted_by' = ${name2})
             OR (length(${name1}) > 0 AND s.payload->'answers'->>'data_collector' = ${name1})
             OR (length(${name2}) > 0 AND s.payload->'answers'->>'data_collector' = ${name2})
          ORDER BY created_at DESC LIMIT 500
        `.catch((err) => {
        console.error("submissions mine error:", err);
        return [];
      });
      const mediaRows = await sql`
          SELECT submission_id, kind, url, storage, meta FROM survey_media
        `.catch(() => []);
      const mediaMap = new Map<number, { url: string | null; kind: string }[]>();
      for (const m of mediaRows as {
        submission_id: number;
        kind: string;
        url: string | null;
        storage: string | null;
        meta: unknown;
      }[]) {
        const meta =
          typeof m.meta === "string"
            ? parsePayload(m.meta)
            : (m.meta as Record<string, unknown>) || {};
        const url = m.url || (meta.url as string) || null;
        const arr = mediaMap.get(Number(m.submission_id)) || [];
        arr.push({ url, kind: m.kind });
        mediaMap.set(Number(m.submission_id), arr);
      }
      const items = (rows as Record<string, unknown>[])
        .map((r) => {
          const payload = parsePayload(r.payload);
          const answers = (payload?.answers || {}) as Record<string, unknown>;
          const media = mediaMap.get(Number(r.id)) || [];
          return {
            id: r.id,
            created_at: r.created_at,
            status: payloadStatus(payload),
            submitted_by: String(
              payload?.submitted_by || answers?.data_collector || "",
            ),
            record_index: recordIndexOf(payload),
            form_key: String(payload?.form_key || "default"),
            answers,
            photo_url: media.find((m) => m.kind === "photo")?.url || null,
            audio_url: media.find((m) => m.kind === "audio")?.url || null,
            media,
          };
        })
        .filter(Boolean);
      return json({ items, count: items.length });
    }

    const limit = Math.min(Number(url.searchParams.get("limit") || 200), 1000);
    const statusQ = (url.searchParams.get("status") || "").trim().toLowerCase();
    let dateFrom = (url.searchParams.get("date_from") || "").trim();
    let dateTo = (url.searchParams.get("date_to") || "").trim();
    const periodQ = (url.searchParams.get("period") || "total").trim().toLowerCase();
    const dayParam = (url.searchParams.get("day") || "").trim();
    const monthParam = (url.searchParams.get("month") || "").trim();
    if (periodQ === "today") {
      const t = istToday();
      dateFrom = t;
      dateTo = t;
    } else if (periodQ === "day" && dayParam) {
      dateFrom = dayParam;
      dateTo = dayParam;
    } else if (periodQ === "month" && monthParam) {
      const [y, m] = monthParam.split("-").map(Number);
      if (y && m) {
        const last = new Date(y, m, 0).getDate();
        dateFrom = `${monthParam}-01`;
        dateTo = `${monthParam}-${String(last).padStart(2, "0")}`;
      }
    }
    const userQ = (url.searchParams.get("user") || "").trim().toLowerCase();
    const districtQ = (url.searchParams.get("district") || "").trim().toLowerCase();
    const completenessQ = (url.searchParams.get("completeness") || "").trim().toLowerCase();
    // Dynamic question filters (q_<questionId> → value) — from Client Admin question naming
    const qFilters: [string, string][] = [];
    for (const [k, v] of url.searchParams) {
      if (k.startsWith("q_") && v.trim()) qFilters.push([k.slice(2), v.trim()]);
    }
    // Filters apply AFTER the LIMIT in JS below — so when any filter is set, fetch
    // a wide slice (oldest rows like legacy data would otherwise be unreachable).
    const hasSliceFilter =
      (statusQ && statusQ !== "all") ||
      Boolean(dateFrom) ||
      Boolean(dateTo) ||
      Boolean(userQ) ||
      Boolean(districtQ) ||
      Boolean(completenessQ && completenessQ !== "all") ||
      qFilters.length > 0 ||
      Boolean((url.searchParams.get("survey") || url.searchParams.get("form_key") || "").trim()) ||
      Boolean((url.searchParams.get("source") || "").trim());
    const fetchRows = hasSliceFilter ? 5000 : limit;
    const scopeKeys = await adminFormKeyScope(sql, me);
    const rows = scopeKeys
      ? await sql`
            SELECT id, payload, fact_status, fact_error, created_at FROM submissions
            WHERE payload->>'form_key' = ANY(${scopeKeys})
            ORDER BY created_at DESC LIMIT ${fetchRows}
          `
      : await sql`
            SELECT id, payload, fact_status, fact_error, created_at FROM submissions
            ORDER BY created_at DESC LIMIT ${fetchRows}
          `;
    // media kinds for strict voice/photo checks
    const mediaMap = await loadMediaKindsMap(sql);
    const qrows = scopeKeys
      ? await sql`SELECT form_key, questions FROM survey_form WHERE form_key = ANY(${scopeKeys})`.catch(() => [])
      : await sql`SELECT form_key, questions FROM survey_form`.catch(() => []);
    const qByKey = new Map<string, unknown[]>();
    for (const qr of qrows as { form_key?: string; questions?: unknown }[]) {
      qByKey.set(String(qr.form_key || ""), parseQuestionsArray(qr.questions));
    }

    let items = (rows as Record<string, unknown>[]).map((r) => {
      const payload = parsePayload(r.payload);
      const answers = (payload?.answers || payload) as Record<string, unknown>;
      const status = payloadStatus(payload);
      const verify = verifyWithMedia(payload, mediaMap, Number(r.id));
      const submittedBy = surveyorNameOf(payload);
      const draft = isDraftSubmission(payload);
      const work = workStatusOf(payload);
      return {
        id: r.id,
        source: (payload?.source as string) || "app",
        form_id: (payload?.form_id as string) || "",
        form_key: String(payload?.form_key || "default"),
        created_at: r.created_at,
        date: dayKey(isoStamp(r.created_at)),
        status,
        fact_status: r.fact_status ?? null,
        fact_error: r.fact_error ?? null,
        work,
        draft,
        completeness: verify.completeness,
        verification: verify,
        legacy: !!verify.legacy,
        submitted_by: submittedBy === "unknown" ? "" : submittedBy,
        user_id: payload?.user_id ?? null,
        confirmed_at: payload?.confirmed_at || null,
        confirmed_by: payload?.confirmed_by || null,
        answers,
        qa: qaFromAnswers(answers || {}, qByKey.get(String(payload?.form_key || "")) || []),
        voice_transcript: String(
          payload?.voice_transcript || answers?._voice_transcript_en || "",
        ),
        has_geo: verify.geo_ok,
        has_voice: verify.voice_ok,
        has_photo: verify.photo_ok,
        // Free storage links (not Neon blobs)
        photo_url: payload?.photo_url || null,
        audio_url: payload?.audio_url || null,
        media_storage: payload?.media_storage || null,
        proof_validated: payload?.proof_validated || null,
        record_index: recordIndexOf(payload),
      };
    });

    if (statusQ && statusQ !== "all") {
      if (statusQ === "pending") {
        // Same as Overview "Pending review": not confirmed work, including
        // rows still tagged _draft after Send from the field app.
        items = items.filter((x) => x.work === "pending" || x.status === "pending");
      } else if (statusQ === "confirmed") {
        items = items.filter((x) => x.work === "completed");
      } else {
        items = items.filter((x) => x.status === statusQ);
      }
    }
    const sourceQ = (url.searchParams.get("source") || "").trim().toLowerCase();
    const isWebSrc = (x: { source?: string }) =>
      x.source === "web-survey" || x.source === "web";
    if (sourceQ === "web") {
      items = items.filter((x) => isWebSrc(x));
    } else if (sourceQ === "field" || sourceQ === "app") {
      items = items.filter((x) => !isWebSrc(x));
    }
    if (qFilters.length) {
      // question id → type, so age-type filters bucket-match ranges
      const qTypeMap = new Map<string, string>();
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
            if (id) qTypeMap.set(id, String(q.type || "text"));
          }
        }
      }
      items = items.filter((x) => {
        for (const [qid, want] of qFilters) {
          const av = (x as { answers?: Record<string, unknown> }).answers;
          const val = answerOf(av, qid);
          const hit = qTypeMap.get(qid) === "age"
            ? ageBucket(val) === want
            : Array.isArray(val)
              ? val.map(String).includes(want)
              : String(val ?? "") === want;
          if (!hit) return false;
        }
        return true;
      });
    }
    if (dateFrom) items = items.filter((x) => x.date >= dateFrom);
    if (dateTo) items = items.filter((x) => x.date <= dateTo);
    if (userQ) {
      items = items.filter((x) =>
        String(x.submitted_by || "").toLowerCase().includes(userQ)
      );
    }
    const surveyQ = (url.searchParams.get("survey") || url.searchParams.get("form_key") || "").trim();
    if (surveyQ) {
      items = items.filter((x) => String(x.form_key || "") === surveyQ);
    }
    if (districtQ) {
      items = items.filter((x) => {
        const a = (x as { answers?: Record<string, unknown> }).answers || {};
        return String(a.district || "").toLowerCase().includes(districtQ);
      });
    }
    if (completenessQ === "complete" || completenessQ === "incomplete") {
      items = items.filter((x) => x.completeness === completenessQ);
    }

    const summary = {
      total: items.length,
      complete: items.filter((x) => x.completeness === "complete").length,
      incomplete: items.filter((x) => x.completeness === "incomplete").length,
      // Work: drafts count as pending, not completed
      completed: items.filter((x) => x.work === "completed").length,
      pending: items.filter((x) => x.work === "pending").length,
      confirmed: items.filter((x) => x.work === "completed").length,
      rejected: items.filter((x) => x.work === "rejected").length,
      draft: items.filter((x) => x.draft).length,
      status_confirmed: items.filter((x) => x.status === "confirmed").length,
      status_pending: items.filter((x) => x.status === "pending").length,
      geo_fail: items.filter((x) => !x.has_geo).length,
      voice_fail: items.filter((x) => !x.has_voice).length,
      by_user: {} as Record<
        string,
        {
          total: number;
          complete: number;
          incomplete: number;
          completed: number;
          confirmed: number;
          pending: number;
          draft: number;
        }
      >,
      by_date: {} as Record<
        string,
        {
          total: number;
          complete: number;
          incomplete: number;
          completed: number;
          confirmed: number;
          pending: number;
          draft: number;
        }
      >,
    };
    for (const it of items) {
      const u = it.submitted_by || "unknown";
      if (!summary.by_user[u]) {
        summary.by_user[u] = {
          total: 0,
          complete: 0,
          incomplete: 0,
          completed: 0,
          confirmed: 0,
          pending: 0,
          draft: 0,
        };
      }
      summary.by_user[u].total += 1;
      if (it.completeness === "complete") summary.by_user[u].complete += 1;
      else summary.by_user[u].incomplete += 1;
      if (it.work === "completed") {
        summary.by_user[u].completed += 1;
        summary.by_user[u].confirmed += 1;
      } else if (it.work === "pending") {
        summary.by_user[u].pending += 1;
      }
      if (it.draft) summary.by_user[u].draft += 1;
      const d = it.date || "unknown";
      if (!summary.by_date[d]) {
        summary.by_date[d] = {
          total: 0,
          complete: 0,
          incomplete: 0,
          completed: 0,
          confirmed: 0,
          pending: 0,
          draft: 0,
        };
      }
      summary.by_date[d].total += 1;
      if (it.completeness === "complete") summary.by_date[d].complete += 1;
      else summary.by_date[d].incomplete += 1;
      if (it.work === "completed") {
        summary.by_date[d].completed += 1;
        summary.by_date[d].confirmed += 1;
      } else if (it.work === "pending") {
        summary.by_date[d].pending += 1;
      }
      if (it.draft) summary.by_date[d].draft += 1;
    }

    return json({
      items,
      total: items.length,
      summary,
      filters: {
        status: statusQ || "all",
        date_from: dateFrom || null,
        date_to: dateTo || null,
        user: userQ || null,
        completeness: completenessQ || "all",
      },
      strict: {
        geo_tagging: "required",
        voice_detection: "required",
        photo: "required",
        rule: "complete = geo_ok AND voice_ok AND photo_ok AND qa_ok",
        legacy: "Legacy rows (no GPS/camera) are exempt from geo/voice/photo checks",
      },
    });
  }
  return null;
}
