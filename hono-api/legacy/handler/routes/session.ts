import type { Ctx } from "./ctx.ts";
import {
  sql,
} from "../lib/db.ts";
import {
  json,
} from "../lib/http.ts";
import {
  peakQuestionsForAdmin,
} from "../lib/survey-assignments.ts";
import {
  allocationSnapshot,
  countTenantRecords,
} from "../lib/tenant.ts";
import {
  invalidateSessionCache,
  sqlCountN,
} from "../lib/users.ts";

export async function handleSession(c: Ctx): Promise<Response | null> {
  const { path, method, token, me } = c;
  if (path === "/api/auth/me" && method === "GET") {
    if (!me) return json({ error: "Login required" }, 401);
    // Profile photos live on /me only — never on login or every session lookup.
    // If this SELECT fails, omit the keys so the app does not replace a
    // displayed photo with null.
    const mediaRows = await sql`
        SELECT photo, aadhaar_front, aadhaar_back FROM app_users WHERE id = ${me.id} LIMIT 1
      `.catch(() => null);
    const media = Array.isArray(mediaRows) && mediaRows[0]
      ? (mediaRows[0] as Record<string, unknown>)
      : null;
    const withMedia = {
      ...me,
      ...(media
        ? {
            photo: media.photo || null,
            aadhaar_front: media.aadhaar_front || null,
            aadhaar_back: media.aadhaar_back || null,
          }
        : {}),
    };
    // Client Admin: attach live usage vs Super-Admin-set caps so Overview "My allocation" works
    // without relying only on GET /api/users (which can be filtered / slow).
    if (me.role === "admin" && sql) {
      const meCompany = String((me as { company_name?: unknown }).company_name || "").trim();
      const [sCnt] = await sql`SELECT COUNT(*)::int AS n FROM survey_form WHERE created_by = ${me.id}`.catch(() => [{ n: 0 }]);
      const [srCnt] = await sql`SELECT COUNT(*)::int AS n FROM app_users WHERE role = 'surveyor' AND created_by = ${me.id}`.catch(() => [{ n: 0 }]);
      // Peak Q across owned + shared + company projects (not only created_by)
      const questionPeak = await peakQuestionsForAdmin(sql, Number(me.id), meCompany);
      const recUsed = await countTenantRecords(sql, Number(me.id));
      const snap = await allocationSnapshot(sql, Number(me.id));
      const webReserved = snap.web_reserved;
      const teamRows = await sql`
          SELECT f.id AS sid, f.title,
                 jsonb_array_length(COALESCE(
                   CASE WHEN jsonb_typeof(f.questions) = 'array' THEN f.questions ELSE '[]'::jsonb END,
                   '[]'::jsonb
                 ))::int AS qn,
                 COALESCE(array_agg(jsonb_build_object('id', u.id, 'username', u.username, 'name', COALESCE(u.display_name, u.username)))
                   FILTER (WHERE u.id IS NOT NULL), '[]'::jsonb) AS surveyors
          FROM survey_form f
          LEFT JOIN survey_assignments a ON a.survey_id = f.id
          LEFT JOIN app_users u ON u.id = a.user_id AND u.created_by = ${me.id} AND u.role = 'surveyor'
          WHERE f.created_by = ${me.id}
             OR f.id IN (SELECT survey_id FROM survey_admin_access WHERE admin_id = ${me.id})
          GROUP BY f.id, f.title, f.questions ORDER BY f.title
        `.catch(() => []);
      const survey_team = (teamRows as { sid: number; title: string; qn?: number; surveyors: unknown }[]).map((t) => ({
        id: Number(t.sid),
        title: String(t.title),
        question_count: Number(t.qn) || 0,
        surveyors: Array.isArray(t.surveyors)
          ? (t.surveyors as { id: number; username: string; name: string }[])
          : [],
      }));
      // If SQL qn was 0 for all (double-encoded questions), prefer JS peak per row via peakQuestionsForAdmin
      const granted = await sql`
          SELECT f.id, f.title
          FROM survey_admin_access saa JOIN survey_form f ON f.id = saa.survey_id
          WHERE saa.admin_id = ${me.id} ORDER BY f.title
        `.catch(() => []);
      return json({
        user: {
          ...withMedia,
          survey_count: sqlCountN(sCnt),
          surveyor_count: sqlCountN(srCnt),
          question_count: questionPeak,
          record_count: recUsed,
          surveyor_record_count: recUsed,
          web_reserved: snap.web_reserved,
          field_used: snap.field_used,
          field_remaining: snap.field_remaining,
          max_records: snap.max_records || Number((me as { max_records?: unknown }).max_records) || 0,
          survey_team,
          granted_surveys: (granted as { id: number; title: string }[]).map((p) => ({
            id: Number(p.id),
            title: String(p.title),
          })),
        },
      });
    }
    return json({ user: withMedia });
  }

  if (path === "/api/auth/logout" && method === "POST") {
    if (token) {
        invalidateSessionCache(token);
        await sql`DELETE FROM app_sessions WHERE token = ${token}`;
      }
    return json({ ok: true });
  }
  return null;
}
