import type { Ctx } from "./ctx.ts";
import {
  sql,
} from "../lib/db.ts";
import {
  autoConfirmIfComplete,
} from "../lib/facts.ts";
import {
  json,
  readBody,
} from "../lib/http.ts";
import {
  countConfirmedForUser,
  countDoneByFormKeyForUser,
  countDoneForUser,
  progressStatus,
} from "../lib/progress.ts";
import {
  isoStamp,
} from "../lib/time.ts";
import {
  listAssignedSurveys,
} from "../lib/survey-assignments.ts";
import {
  isPortalAdmin,
} from "../lib/users.ts";

export async function handleProgress(c: Ctx): Promise<Response | null> {
  const { req, path, method, me } = c;
  // ── Progress: surveyor self + admin board ───────────────
  if (path === "/api/progress/me" && method === "GET") {
    if (!me) return json({ error: "Login required" }, 401);
    const rows = await sql`
        SELECT id, username, display_name, role, active, COALESCE(target_quota, 0) AS target_quota
        FROM app_users WHERE id = ${me.id} LIMIT 1
      `.catch(async () => {
      // column missing fallback
      const r = await sql`
          SELECT id, username, display_name, role, active FROM app_users WHERE id = ${me.id} LIMIT 1
        `;
      return r.map((x: Record<string, unknown>) => ({ ...x, target_quota: 0 }));
    });
    const u = rows[0] as {
      id: number;
      username: string;
      display_name: string;
      target_quota: number;
    };
    if (!u) return json({ error: "User not found" }, 404);
    const assigned = me.role === "surveyor" || me.role === "field"
      ? await listAssignedSurveys(sql, Number(u.id))
      : [];
    const byKey = await countDoneByFormKeyForUser({
      id: u.id,
      username: u.username,
      display_name: u.display_name,
    });
    const userFallback = Number(u.target_quota) || 0;
    const assignmentQuotaSum = assigned.reduce((n, s) => n + (Number(s.target_quota) || 0), 0);
    const perSurveyTargets = assigned.map((s) => {
      const qn = Array.isArray(s.questions) ? s.questions.length : 0;
      let t = Number(s.target_quota) || 0;
      // One assigned survey can inherit the user-level quota. Two or more
      // must keep their own assignment quotas — never collapse to 1.
      if (t <= 0 && assigned.length === 1 && userFallback > 1) t = userFallback;
      const key = String(s.form_key || "");
      const d = Number(byKey.get(key) || 0);
      const completeOne = t > 0 && d >= t;
      const remainingOne = t > 0 ? Math.max(0, t - d) : null;
      const pctOne = t > 0 ? Math.min(100, Math.round((d / t) * 100)) : null;
      return {
        id: s.id,
        form_key: s.form_key,
        title: s.title,
        target: t,
        done: d,
        remaining: remainingOne,
        pct: pctOne,
        questions_count: qn,
        complete: completeOne,
        label: t > 0 ? `${d} / ${t}` : `${d} records`,
      };
    });
    const questionsCount = perSurveyTargets.reduce((n, s) => n + s.questions_count, 0);
    const assignedDone = perSurveyTargets.reduce((n, s) => n + s.done, 0);
    let done = assigned.length ? assignedDone : 0;
    if (!assigned.length) {
      for (const v of byKey.values()) done += v;
    }
    // Total target = sum of per-survey quotas. Never COUNT(assignments).
    // A leftover user-level 1 with two surveys is not a real quota.
    const target = assignmentQuotaSum > 0
      ? perSurveyTargets.reduce((n, s) => n + s.target, 0)
      : (assigned.length <= 1 && userFallback > 1 ? userFallback : 0);
    const remaining = target > 0 ? Math.max(0, target - done) : null;
    const pct = target > 0 ? Math.min(100, Math.round((done / target) * 100)) : null;
    const status = progressStatus(done, target);
    const withTargets = perSurveyTargets.filter((s) => s.target > 0);
    const complete = withTargets.length > 0 && withTargets.every((s) => s.complete);
    const confirmed = await countConfirmedForUser({
      id: u.id,
      username: u.username,
      display_name: u.display_name,
    });
    return json({
      user_id: u.id,
      username: u.username,
      name: u.display_name || u.username,
      target,
      done,
      confirmed,
      remaining,
      pct,
      status,
      surveys_count: assigned.length,
      questions_count: questionsCount,
      surveys: perSurveyTargets,
      next_record: done + 1,
      complete,
      label:
        target > 0
          ? `${done} / ${target} records · ${status}`
          : `${done} records (no target set)`,
    });
  }

  // ── Surveyor event feed: what happened since the last check ──────────────
  // Drives the surveyor's system notifications: record confirmations (with
  // the record numbers and survey titles the surveyor recognises), new survey
  // assignments, and finished conversation transcriptions.
  if (path === "/api/my/events" && method === "GET") {
    if (!me) return json({ error: "Login required" }, 401);
    const url = new URL(req.url);
    const afterParam = String(url.searchParams.get("after") || "").trim();
    // Missing/invalid cursor → last 12h catch-up window, so a fresh install
    // summarizes the day without dragging a year of rows.
    const after = /^\d{4}-\d{2}-\d{2}T/.test(afterParam)
      ? new Date(afterParam)
      : new Date(Date.now() - 12 * 60 * 60 * 1000);
    const afterIso = after.toISOString();
    const uid = String(me.id);
    const uname = me.username;
    const dname = (me as { display_name?: string }).display_name || uname;

    const confirms = await sql`
        SELECT s.payload->>'confirmed_at' AS at,
               s.payload->>'record_index' AS record_no,
               s.payload->>'confirmed_by' AS confirmed_by,
               f.title AS survey_title,
               f.form_key AS form_key
        FROM submissions s
        LEFT JOIN survey_form f ON f.form_key = s.payload->>'form_key'
        WHERE (s.payload->>'user_id' = ${uid}
            OR s.payload->>'submitted_by' = ${uname}
            OR s.payload->>'submitted_by' = ${dname})
          AND s.payload->>'status' = 'confirmed'
          AND s.payload->>'confirmed_at' IS NOT NULL
          AND s.payload->>'confirmed_at' > ${afterIso}
        ORDER BY s.payload->>'confirmed_at' ASC
        LIMIT 100
      `.catch(() => []);
    const assignments = await sql`
        SELECT a.created_at AS at, f.title AS survey_title
        FROM survey_assignments a
        JOIN survey_form f ON f.id = a.survey_id
        WHERE a.user_id = ${Number(me.id)} AND a.created_at > ${afterIso}
        ORDER BY a.created_at ASC
        LIMIT 20
      `.catch(() => []);
    const transcribed = await sql`
        SELECT id, title, updated_at AS at
        FROM conversations
        WHERE user_id = ${Number(me.id)}
          AND transcript_status = 'completed'
          AND updated_at > ${afterIso}
        ORDER BY updated_at ASC
        LIMIT 20
      `.catch(() => []);

    const items = [
      ...(confirms as Record<string, unknown>[]).map((r) => ({
        type: "record_confirmed",
        at: isoStamp(r.at),
        record_no: Number(r.record_no) || null,
        survey: String(r.survey_title || r.form_key || "survey"),
        by: r.confirmed_by ? String(r.confirmed_by) : "",
      })),
      ...(assignments as Record<string, unknown>[]).map((r) => ({
        type: "survey_assigned",
        at: isoStamp(r.at),
        survey: String(r.survey_title || "New survey"),
      })),
      ...(transcribed as Record<string, unknown>[]).map((r) => ({
        type: "conversation_ready",
        at: isoStamp(r.at),
        survey: String(r.title || "Conversation"),
      })),
    ].sort((a, b) => String(a.at).localeCompare(String(b.at)));

    return json({ items, count: items.length, now: new Date().toISOString() });
  }

  if (path === "/api/progress" && method === "GET") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);

    // Catch-up: auto-confirm complete pending packages so Client Admin sees done work
    // without opening Review. Bounded batch keeps this cheap.
    try {
      const pendingRows = me.role === "super_admin"
        ? await sql`
              SELECT id FROM submissions
              WHERE COALESCE(payload->>'status', 'pending') = 'pending'
                AND COALESCE(payload->>'draft', 'false') NOT IN ('true', 't', '1')
                AND (
                  payload->>'has_photo' = 'true'
                  OR payload->>'has_audio' = 'true'
                  OR EXISTS (SELECT 1 FROM survey_media m WHERE m.submission_id = submissions.id)
                )
              ORDER BY id DESC LIMIT 40
            `.catch(() => [])
        : await sql`
              SELECT s.id FROM submissions s
              WHERE COALESCE(s.payload->>'status', 'pending') = 'pending'
                AND COALESCE(s.payload->>'draft', 'false') NOT IN ('true', 't', '1')
                AND (
                  s.payload->>'user_id' IN (
                    SELECT id::text FROM app_users WHERE created_by = ${me.id} AND role IN ('surveyor', 'field')
                  )
                  OR s.payload->>'submitted_by' IN (
                    SELECT username FROM app_users WHERE created_by = ${me.id} AND role IN ('surveyor', 'field')
                  )
                  OR s.payload->>'form_key' = ANY(
                    SELECT form_key FROM survey_form WHERE created_by = ${me.id}
                    UNION
                    SELECT f.form_key FROM survey_admin_access saa
                    JOIN survey_form f ON f.id = saa.survey_id WHERE saa.admin_id = ${me.id}
                  )
                )
              ORDER BY s.id DESC LIMIT 40
            `.catch(() => []);
      for (const pr of pendingRows as { id: number }[]) {
        await autoConfirmIfComplete(sql, Number(pr.id)).catch(() => null);
      }
    } catch {
      /* non-fatal */
    }

    // Client Admin: only their surveyors. Super Admin: all.
    const rows = me.role === "super_admin"
      ? await sql`
            SELECT id, username, display_name, role, active, COALESCE(target_quota, 0) AS target_quota, created_at
            FROM app_users
            WHERE role IN ('surveyor', 'field')
            ORDER BY id
          `.catch(async () => {
          const r = await sql`
              SELECT id, username, display_name, role, active, created_at
              FROM app_users WHERE role IN ('surveyor', 'field') ORDER BY id
            `;
          return r.map((x: Record<string, unknown>) => ({ ...x, target_quota: 0 }));
        })
      : await sql`
            SELECT id, username, display_name, role, active, COALESCE(target_quota, 0) AS target_quota, created_at
            FROM app_users
            WHERE role IN ('surveyor', 'field') AND created_by = ${me.id}
            ORDER BY id
          `.catch(async () => {
          const r = await sql`
              SELECT id, username, display_name, role, active, created_at
              FROM app_users
              WHERE role IN ('surveyor', 'field') AND created_by = ${me.id}
              ORDER BY id
            `;
          return r.map((x: Record<string, unknown>) => ({ ...x, target_quota: 0 }));
        });
    const surveyors = [];
    for (const r of rows as {
      id: number;
      username: string;
      display_name: string;
      active: boolean;
      target_quota: number;
      created_at: string;
    }[]) {
      const done = await countDoneForUser(r);
      const target = Number(r.target_quota) || 0;
      const status = progressStatus(done, target);
      surveyors.push({
        id: r.id,
        username: r.username,
        name: r.display_name || r.username,
        active: r.active,
        target,
        done,
        remaining: target > 0 ? Math.max(0, target - done) : null,
        pct: target > 0 ? Math.min(100, Math.round((done / target) * 100)) : null,
        status,
        label:
          target > 0
            ? `${done}/${target}`
            : `${done}/—`,
        created_at: r.created_at,
      });
    }
    const totals = {
      surveyors: surveyors.length,
      targets: surveyors.reduce((s, x) => s + (x.target || 0), 0),
      done: surveyors.reduce((s, x) => s + x.done, 0),
      completed_users: surveyors.filter((x) => x.status === "completed").length,
      in_progress: surveyors.filter((x) => x.status === "in_progress").length,
    };
    return json({ surveyors, totals });
  }

  // Admin sets quota for one or all surveyors
  if (path === "/api/progress/quota" && method === "POST") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    const body = await readBody(req);
    const target = Math.max(0, Math.min(Number(body.target) || 0, 100000));
    if (body.user_id) {
      if (me.role !== "super_admin") {
        const own = await sql`
            SELECT id FROM app_users
            WHERE id = ${Number(body.user_id)} AND created_by = ${me.id} AND role IN ('surveyor', 'field')
            LIMIT 1
          `.catch(() => []);
        if (!own.length) return json({ error: "Not your surveyor" }, 403);
      }
      await sql`
          UPDATE app_users SET target_quota = ${target} WHERE id = ${Number(body.user_id)}
        `;
      return json({ ok: true, user_id: Number(body.user_id), target });
    }
    if (body.all_surveyors) {
      if (me.role === "super_admin") {
        await sql`
            UPDATE app_users SET target_quota = ${target} WHERE role = 'surveyor'
          `;
      } else {
        await sql`
            UPDATE app_users SET target_quota = ${target}
            WHERE role = 'surveyor' AND created_by = ${me.id}
          `;
      }
      return json({ ok: true, all_surveyors: true, target });
    }
    return json({ error: "Provide user_id or all_surveyors:true" }, 400);
  }
  return null;
}
