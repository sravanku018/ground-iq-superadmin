import {
  surveyDisplayLang,
} from "./analytics/answers.ts";
import {
  sql,
} from "./db.ts";
import {
  sqlBool,
} from "./users.ts";
import {
  parseQuestionsArray,
  retryOnce,
} from "./util.ts";

/** Surveys assigned to a surveyor, with questions parsed for the field app. */
export async function listAssignedSurveys(
  sqlFn: NonNullable<typeof sql>,
  userId: number,
): Promise<{
  id: unknown;
  form_key: unknown;
  title: unknown;
  display_lang: "en" | "te";
  questions: unknown[];
  updated_at: unknown;
  voice_required: boolean;
  voice_time_limit: number;
  target_quota: number;
}[]> {
  const mapRows = (rows: Record<string, unknown>[]) =>
    rows.map((r) => ({
      id: r.id,
      form_key: r.form_key,
      title: r.title,
      display_lang: surveyDisplayLang(r.display_lang),
      questions: parseQuestionsArray(r.questions),
      updated_at: r.updated_at,
      voice_required: r.voice_required === true,
      voice_time_limit: Number(r.voice_time_limit) || 0,
      target_quota: Math.max(0, Number(r.target_quota) || 0),
    }));
  const withQuota = await retryOnce(() =>
    sqlFn`
      SELECT f.id, f.form_key, f.title, f.display_lang, f.questions, f.updated_at,
             COALESCE(f.voice_required, FALSE) AS voice_required,
             COALESCE(f.voice_time_limit, 0) AS voice_time_limit,
             COALESCE(sa.target_quota, 0) AS target_quota
      FROM survey_assignments sa
      JOIN survey_form f ON f.id = sa.survey_id
      WHERE sa.user_id = ${userId}
      ORDER BY f.title
    `
  ).catch(() => null);
  if (Array.isArray(withQuota)) return mapRows(withQuota as Record<string, unknown>[]);
  const rows = await retryOnce(() =>
    sqlFn`
      SELECT f.id, f.form_key, f.title, f.display_lang, f.questions, f.updated_at,
             COALESCE(f.voice_required, FALSE) AS voice_required,
             COALESCE(f.voice_time_limit, 0) AS voice_time_limit
      FROM survey_assignments sa
      JOIN survey_form f ON f.id = sa.survey_id
      WHERE sa.user_id = ${userId}
      ORDER BY f.title
    `
  ).catch(() => []);
  return mapRows(
    (rows as Record<string, unknown>[]).map((r) => ({ ...r, target_quota: 0 })),
  );
}

/**
 * Total questions across all surveys a Client Admin owns or accesses.
 * Used for total question quota usage vs max_questions_per_survey.
 */
export async function totalQuestionsForAdmin(
  sqlFn: NonNullable<typeof sql>,
  adminId: number,
  companyName?: string | null,
  excludeSurveyId?: number,
): Promise<number> {
  void companyName;
  const rows = excludeSurveyId
    ? await sqlFn`
        SELECT questions FROM survey_form
        WHERE form_key NOT IN ('default', 'legacy')
          AND id <> ${excludeSurveyId}
          AND (
            created_by = ${adminId}
            OR id IN (SELECT survey_id FROM survey_admin_access WHERE admin_id = ${adminId})
          )
      `.catch(() => [])
    : await sqlFn`
        SELECT questions FROM survey_form
        WHERE form_key NOT IN ('default', 'legacy')
          AND (
            created_by = ${adminId}
            OR id IN (SELECT survey_id FROM survey_admin_access WHERE admin_id = ${adminId})
          )
      `.catch(() => []);
  let total = 0;
  for (const r of rows as { questions?: unknown }[]) {
    total += parseQuestionsArray(r.questions).length;
  }
  return total;
}

export async function peakQuestionsForAdmin(
  sqlFn: NonNullable<typeof sql>,
  adminId: number,
  companyName?: string | null,
): Promise<number> {
  return totalQuestionsForAdmin(sqlFn, adminId, companyName);
}

/** Grant-based power check — Super Admin always has every power; Client Admins need the grant. */
export function hasPower(
  me: { role: unknown } & Record<string, unknown> | null,
  key: string,
): boolean {
  if (!me) return false;
  if (me.role === "super_admin") return true;
  if (key === "can_web_survey" && me.role === "admin") return true;
  return sqlBool(me[key]);
}

/** Per-survey quotas from PUT /api/users/:id/surveys (`quotas` map or `survey_quotas` array). */
export function parseSurveyQuotas(body: Record<string, unknown>): Map<number, number> {
  const out = new Map<number, number>();
  const clamp = (v: unknown) => Math.max(0, Math.min(Math.round(Number(v) || 0), 100000));
  const raw = body.quotas ?? body.survey_quotas;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const id = Number(k);
      if (Number.isFinite(id)) out.set(id, clamp(v));
    }
  }
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const id = Number(rec.id ?? rec.survey_id);
      if (Number.isFinite(id)) out.set(id, clamp(rec.target_quota ?? rec.quota));
    }
  }
  return out;
}

/**
 * Surveyor ↔ survey mapping. ON CONFLICT needs UNIQUE(survey_id, user_id);
 * if an older table is missing that constraint, fall back to a plain INSERT.
 * Optional `quota` is this surveyor's target for THIS survey (not survey count).
 */
export async function upsertSurveyAssignment(
  surveyId: number,
  userId: number,
  quota?: number | null,
): Promise<boolean> {
  if (!sql || !Number.isFinite(surveyId) || !Number.isFinite(userId)) return false;
  const hasQuota = quota != null && Number.isFinite(Number(quota));
  const q = hasQuota ? Math.max(0, Math.min(Math.round(Number(quota)), 100000)) : 0;
  try {
    if (hasQuota) {
      await sql`
        INSERT INTO survey_assignments (survey_id, user_id, target_quota)
        VALUES (${surveyId}, ${userId}, ${q})
        ON CONFLICT (survey_id, user_id) DO UPDATE SET target_quota = EXCLUDED.target_quota
      `;
    } else {
      await sql`
        INSERT INTO survey_assignments (survey_id, user_id)
        VALUES (${surveyId}, ${userId})
        ON CONFLICT (survey_id, user_id) DO NOTHING
      `;
    }
    return true;
  } catch {
    try {
      await sql`
        INSERT INTO survey_assignments (survey_id, user_id)
        VALUES (${surveyId}, ${userId})
      `;
      if (hasQuota) {
        await sql`
          UPDATE survey_assignments SET target_quota = ${q}
          WHERE survey_id = ${surveyId} AND user_id = ${userId}
        `.catch(() => null);
      }
      return true;
    } catch {
      return false;
    }
  }
}

