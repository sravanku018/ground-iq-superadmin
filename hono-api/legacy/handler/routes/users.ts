import type { Ctx } from "./ctx.ts";
import {
  logAudit,
  uniqueUserKeyId,
} from "../lib/audit.ts";
import {
  b64ToBytes,
  splitDataUrl,
} from "../lib/bytes.ts";
import {
  hashPasswordAsync,
} from "../lib/crypto.ts";
import {
  sql,
} from "../lib/db.ts";
import {
  json,
  readBody,
} from "../lib/http.ts";
import {
  countDoneForUser,
  progressStatus,
} from "../lib/progress.ts";
import {
  tryOptionalExternalUpload,
} from "../lib/r2-media.ts";
import {
  ensureCompanyExists,
} from "../lib/schema.ts";
import {
  hasPower,
  peakQuestionsForAdmin,
  upsertSurveyAssignment,
} from "../lib/survey-assignments.ts";
import {
  isPortalAdmin,
  sqlBool,
  sqlCountN,
} from "../lib/users.ts";

export async function handleUsers(c: Ctx): Promise<Response | null> {
  const { req, url, path, method, m, me } = c;
  // ── Users: list / generate (admin) ───────────────────────
  if (path === "/api/users" && method === "GET") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    const assignedRows = await sql`
        SELECT sa.user_id, f.id AS survey_id, f.title, f.form_key,
               COALESCE(sa.target_quota, 0) AS target_quota
        FROM survey_assignments sa JOIN survey_form f ON f.id = sa.survey_id
        ORDER BY f.title
      `.catch(async () =>
      await sql`
          SELECT sa.user_id, sa.survey_id, COALESCE(f.title, '') AS title, COALESCE(f.form_key, '') AS form_key,
                 0 AS target_quota
          FROM survey_assignments sa
          LEFT JOIN survey_form f ON f.id = sa.survey_id
        `.catch(() => [])
    );
    const assignedMap = new Map<number, { id: number; title: string; form_key: string; target_quota: number }[]>();
    for (const a of assignedRows as {
      user_id: number;
      survey_id: number;
      title: string;
      form_key: string;
      target_quota?: number;
    }[]) {
      const arr = assignedMap.get(Number(a.user_id)) || [];
      arr.push({
        id: Number(a.survey_id),
        title: a.title,
        form_key: a.form_key,
        target_quota: Math.max(0, Number(a.target_quota) || 0),
      });
      assignedMap.set(Number(a.user_id), arr);
    }
    // BR-004 tenant scoping: a Client Admin only sees themselves + surveyors they
    // created (created_by = me.id). Super Admin sees every account. This stops
    // survey names/surveyors from being mixed across client admins.
    // NOTE: two explicit queries — the Deno-deployed neon driver rejects nested
    // composed ${...} sql fragments with 'syntax error at or near $1'.
    const rows = me.role === "super_admin"
      ? await sql`
            SELECT id, username, display_name, company_name, role, active, created_at,
                   COALESCE(target_quota, 0) AS target_quota,
                   key_id, phone, photo, aadhaar_front, aadhaar_back,
                   COALESCE(verified, FALSE) AS verified,
                   COALESCE(can_manage_questions, FALSE) AS can_manage_questions,
                   COALESCE(can_edit_surveys, FALSE) AS can_edit_surveys,
                   COALESCE(can_review_data, FALSE) AS can_review_data,
                   COALESCE(can_verify_surveyors, FALSE) AS can_verify_surveyors,
                   COALESCE(can_assign_surveyors, FALSE) AS can_assign_surveyors,
                   COALESCE(can_crud_questionnaire, FALSE) AS can_crud_questionnaire,
                   COALESCE(can_validate_proof, FALSE) AS can_validate_proof,
               COALESCE(can_web_survey, FALSE) AS can_web_survey,
               COALESCE(can_record_voice, FALSE) AS can_record_voice,
               COALESCE(can_translate_telugu, FALSE) AS can_translate_telugu,
                   COALESCE(totp_enabled, FALSE) AS totp_enabled,
                   COALESCE(max_questions_per_survey, 0) AS max_questions_per_survey,
                   COALESCE(max_surveys, 0) AS max_surveys,
                   COALESCE(max_surveyors, 0) AS max_surveyors,
                   COALESCE(max_records, 0) AS max_records,
                   COALESCE(max_categories, 5) AS max_categories
            FROM app_users
            ORDER BY id
          `.catch(async () =>
          await sql`
              SELECT id, username, display_name, NULL::TEXT AS company_name, role, active, created_at,
                     FALSE AS can_manage_questions, FALSE AS can_edit_surveys,
                     FALSE AS can_review_data, FALSE AS can_verify_surveyors,
                     FALSE AS can_assign_surveyors,
                     FALSE AS can_crud_questionnaire, FALSE AS can_validate_proof, FALSE AS can_web_survey, FALSE AS can_record_voice, FALSE AS can_translate_telugu,
                     0 AS max_questions_per_survey, 0 AS max_surveys, 0 AS max_surveyors, 0 AS max_records, 5 AS max_categories
              FROM app_users ORDER BY id
            `
        )
      : await sql`
            SELECT id, username, display_name, company_name, role, active, created_at,
                   COALESCE(target_quota, 0) AS target_quota,
                   key_id, phone, photo, aadhaar_front, aadhaar_back,
                   COALESCE(verified, FALSE) AS verified,
                   COALESCE(can_manage_questions, FALSE) AS can_manage_questions,
                   COALESCE(can_edit_surveys, FALSE) AS can_edit_surveys,
                   COALESCE(can_review_data, FALSE) AS can_review_data,
                   COALESCE(can_verify_surveyors, FALSE) AS can_verify_surveyors,
                   COALESCE(can_assign_surveyors, FALSE) AS can_assign_surveyors,
                   COALESCE(can_crud_questionnaire, FALSE) AS can_crud_questionnaire,
                   COALESCE(can_validate_proof, FALSE) AS can_validate_proof,
               COALESCE(can_web_survey, FALSE) AS can_web_survey,
               COALESCE(can_record_voice, FALSE) AS can_record_voice,
               COALESCE(can_translate_telugu, FALSE) AS can_translate_telugu,
                   COALESCE(totp_enabled, FALSE) AS totp_enabled,
                   COALESCE(max_questions_per_survey, 0) AS max_questions_per_survey,
                   COALESCE(max_surveys, 0) AS max_surveys,
                   COALESCE(max_surveyors, 0) AS max_surveyors,
                   COALESCE(max_records, 0) AS max_records,
                   COALESCE(max_categories, 5) AS max_categories
            FROM app_users
            WHERE (id = ${me.id} OR created_by = ${me.id})
            ORDER BY id
          `.catch(async () =>
          await sql`
              SELECT id, username, display_name, NULL::TEXT AS company_name, role, active, created_at,
                     FALSE AS can_manage_questions, FALSE AS can_edit_surveys,
                     FALSE AS can_review_data, FALSE AS can_verify_surveyors,
                     FALSE AS can_assign_surveyors,
                     FALSE AS can_crud_questionnaire, FALSE AS can_validate_proof, FALSE AS can_web_survey, FALSE AS can_record_voice, FALSE AS can_translate_telugu,
                     0 AS max_questions_per_survey, 0 AS max_surveys, 0 AS max_surveyors, 0 AS max_records, 5 AS max_categories
              FROM app_users
              WHERE (id = ${me.id} OR created_by = ${me.id})
              ORDER BY id
            `
        );
    const users = [];
    for (const r of rows as Record<string, unknown>[]) {
      let done = 0;
      if (r.role === "surveyor" || r.role === "field") {
        done = await countDoneForUser({
          id: Number(r.id),
          username: String(r.username),
          display_name: String(r.display_name || r.username),
        });
      }
      const assignedForUser = assignedMap.get(Number(r.id)) || [];
      const assignedQuotaSum = assignedForUser.reduce(
        (n, s) => n + (Number(s.target_quota) || 0),
        0,
      );
      const userLevelQuota = Number(r.target_quota) || 0;
      const target = assignedQuotaSum > 0
        ? assignedQuotaSum
        : (assignedForUser.length <= 1 && userLevelQuota > 1 ? userLevelQuota : 0);
      const isCollector = r.role === "surveyor" || r.role === "field";
      // Usage vs allocated caps (Super Admin console → Client Admins tab)
      let survey_count = 0;
      let surveyor_count = 0;
      let surveyor_record_count = 0;
      let question_count = 0;
      let survey_team: { id: number; title: string; surveyors: { id: number; username: string; name: string }[] }[] = [];
      if (r.role === "admin") {
        const [sCnt] = await sql`SELECT COUNT(*)::int AS n FROM survey_form WHERE created_by = ${Number(r.id)}`.catch(() => [{ n: 0 }]);
        survey_count = sqlCountN(sCnt);
        const [srCnt] = await sql`SELECT COUNT(*)::int AS n FROM app_users WHERE role = 'surveyor' AND created_by = ${Number(r.id)}`.catch(() => [{ n: 0 }]);
        surveyor_count = sqlCountN(srCnt);
        const [recordCnt] = await sql`
            SELECT COUNT(*)::int AS n
            FROM submissions s JOIN app_users u ON (
              s.payload->>'submitted_by' = u.username
              OR s.payload->>'submitted_by' = COALESCE(u.display_name, u.username)
            )
            WHERE u.role = 'surveyor' AND u.created_by = ${Number(r.id)}
              AND COALESCE(s.payload->>'source', '') NOT IN ('web-survey', 'web')
              AND COALESCE(s.payload->>'status', 'pending') <> 'rejected'
              AND COALESCE(s.payload->>'draft', 'false') NOT IN ('true', 't', '1')
          `.catch(() => [{ n: 0 }]);
        surveyor_record_count = sqlCountN(recordCnt);
        // Peak questions across owned + shared + company projects
        question_count = await peakQuestionsForAdmin(
          sql,
          Number(r.id),
          r.company_name ? String(r.company_name) : null,
        );
        // Survey → surveyor mapping for this admin (only their own surveys + own surveyors)
        const teamRows = await sql`
            SELECT f.id AS sid, f.title,
                   COALESCE(array_agg(jsonb_build_object('id', u.id, 'username', u.username, 'name', COALESCE(u.display_name, u.username)))
                     FILTER (WHERE u.id IS NOT NULL), '[]'::jsonb) AS surveyors
            FROM survey_form f
            LEFT JOIN survey_assignments a ON a.survey_id = f.id
            LEFT JOIN app_users u ON u.id = a.user_id AND (u.created_by = ${Number(r.id)} OR u.role = 'admin' OR u.role = 'super_admin')
            WHERE f.created_by = ${Number(r.id)}
            GROUP BY f.id, f.title ORDER BY f.title
          `.catch(() => []);
        survey_team = (teamRows as { sid: number; title: string; surveyors: unknown }[]).map((t) => ({
          id: Number(t.sid),
          title: String(t.title),
          surveyors: Array.isArray(t.surveyors)
            ? (t.surveyors as { id: number; username: string; name: string }[])
            : [],
        }));
      }
      users.push({
        id: r.id,
        username: r.username,
        name: r.display_name || r.username,
        company_name: r.company_name || null,
        role: r.role,
        active: r.active,
        created_at: r.created_at,
        target_quota: target,
        survey_count,
        surveyor_count,
        surveyor_record_count,
        question_count,
        survey_team,
        // Projects explicitly assigned by Super Admin to this Client Admin.
        granted_surveys: r.role === "admin"
          ? (await sql`
                SELECT f.id, f.title
                FROM survey_admin_access saa JOIN survey_form f ON f.id = saa.survey_id
                WHERE saa.admin_id = ${Number(r.id)} ORDER BY f.title
              `.catch(() => []) as { id: number; title: string }[]).map((project) => ({
              id: Number(project.id), title: String(project.title),
            }))
          : [],
        done,
        key_id: r.key_id || null,
        phone: r.phone || null,
        photo: r.photo || null,
        aadhaar_front: r.aadhaar_front || null,
        aadhaar_back: r.aadhaar_back || null,
        verified: sqlBool(r.verified),
        can_manage_questions: sqlBool(r.can_manage_questions),
        can_edit_surveys: sqlBool(r.can_edit_surveys),
        can_review_data: sqlBool(r.can_review_data),
        can_verify_surveyors: sqlBool(r.can_verify_surveyors),
        can_assign_surveyors: sqlBool(r.can_assign_surveyors),
        can_crud_questionnaire: sqlBool(r.can_crud_questionnaire),
        can_validate_proof: sqlBool(r.can_validate_proof),
        can_web_survey: sqlBool(r.can_web_survey),
        can_record_voice: sqlBool(r.can_record_voice),
        can_translate_telugu: sqlBool(r.can_translate_telugu),
        totp_enabled: r.role === "super_admin" ? sqlBool(r.totp_enabled) : undefined,
        max_questions_per_survey: Number(r.max_questions_per_survey) || 0,
        max_surveys: Number(r.max_surveys) || 0,
        max_surveyors: Number(r.max_surveyors) || 0,
        max_records: Number(r.max_records) || 0,
        max_categories: Number(r.max_categories ?? 5),
        // Alias for Client Admin allocation UI
        record_count: surveyor_record_count,
        surveys: assignedForUser,
        status: isCollector ? progressStatus(done, target) : "admin",
        progress_label: isCollector
          ? target > 0
            ? `${done}/${target}`
            : `${done}/—`
          : "—",
      });
    }
    return json({ users });
  }

  if (path === "/api/users" && method === "POST") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    const body = await readBody(req);
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");
    const name = String(body.name || username).trim();
    const phone = String(body.phone || "").trim();
    const target_quota = Math.max(0, Math.min(Number(body.target_quota) || 0, 100000));
    // surveyor = field collector (can login field app); admin = portal only
    const role = body.role === "admin" ? "admin" : "surveyor";
    let companyName = role === "admin" ? String(body.company_name || "").trim().slice(0, 160) : "";
    if (role === "admin" && !companyName) {
      companyName = `${name || username} Organisation`;
    }
    if (!username || !password) {
      return json({ error: "username and password required" }, 400);
    }
    if (password.length < 4) {
      return json({ error: "Password min 4 characters" }, 400);
    }
    // BR-006: enforce the approved admin seat limit (Super Admin raises it via approval).
    // Super Admin is the approval authority and is not bound by the cap.
    if (role === "admin" && me.role !== "super_admin") {
      const [sl] = await sql`SELECT approved_limit FROM seat_limits WHERE seat_role = 'admin'`.catch(() => []);
      const limit = sl ? Number((sl as { approved_limit: unknown }).approved_limit) : 5;
      const [cnt] = await sql`SELECT COUNT(*)::int AS n FROM app_users WHERE role = 'admin' AND active = TRUE`.catch(() => [{ n: 0 }]);
      const current = sqlCountN(cnt);
      if (current >= limit) {
        return json({
          error: `Admin seat limit (${limit}) reached — file a seat upgrade request; Super Admin approves it (BR-006)`,
        }, 403);
      }
    }
    // Ensure role check allows surveyor
    await sql`ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check`.catch(() => null);
    await sql`
        ALTER TABLE app_users
        ADD CONSTRAINT app_users_role_check
        CHECK (role IN ('super_admin', 'admin', 'field', 'user', 'surveyor'))
      `.catch(() => null);
    await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS target_quota INTEGER NOT NULL DEFAULT 0`
      .catch(() => null);
    try {
      const password_hash = await hashPasswordAsync(password);
      const key_id = await uniqueUserKeyId();
      // Grant-based powers can be set at admin creation by the Super Admin (least privilege)
      const canSuper = role === "admin" && me.role === "super_admin";
      const canManageQuestions = canSuper && body.can_manage_questions === true;
      const canEditSurveys = canSuper && body.can_edit_surveys === true;
      const canReviewData = canSuper && body.can_review_data === true;
      const canVerifySurveyors = canSuper && body.can_verify_surveyors === true;
      const canAssignSurveyors = canSuper && body.can_assign_surveyors === true;
      const canCrudQuestionnaire = canSuper && body.can_crud_questionnaire === true;
      const canValidateProof = canSuper && body.can_validate_proof === true;
      const canWebSurvey = canSuper && body.can_web_survey === true;
      const canRecordVoice = canSuper && body.can_record_voice === true;
      const canTranslateTeluguGrant = canSuper && body.can_translate_telugu === true;
      // A brand-new Client Admin starts with a usable allowance — 50 questions and
      // 500 field records — instead of 0 (which means unlimited). An explicit value
      // in the request always wins, including 0 for unlimited.
      const DEFAULT_MAX_QUESTIONS = 50;
      const DEFAULT_MAX_RECORDS = 500;
      const clampUserLimit = (value: unknown, fallback: number, max: number) =>
        value === undefined || value === null || value === ""
          ? fallback
          : Math.max(0, Math.min(Number(value) || 0, max));
      const maxQuestionsPerSurvey = canSuper
        ? clampUserLimit(body.max_questions_per_survey, DEFAULT_MAX_QUESTIONS, 100000)
        : 0;      const maxSurveysCreate = canSuper
      ? Math.max(0, Math.min(Number(body.max_surveys) || 0, 100000))
      : 0;
    const maxSurveyorsCreate = canSuper
      ? Math.max(0, Math.min(Number(body.max_surveyors) || 0, 100000))
      : 0;
    const maxRecordsCreate = canSuper
      ? clampUserLimit(body.max_records, DEFAULT_MAX_RECORDS, 10_000_000)
      : 0;
    // 0 = unlimited; only Super Admin may grant it, and the default is the 5-category allowance.
    const maxCategoriesCreate = canSuper && body.max_categories !== undefined
      ? Math.max(0, Math.min(Number(body.max_categories) || 0, 1000))
      : 5;
    // Surveyor cap: a Client Admin may only create surveyors up to the Super-Admin-set
    // max_surveyors (0 = unlimited). Ownership is tracked via created_by.
    if (role === "surveyor" && me.role !== "super_admin") {
      const cap = Number((me as Record<string, unknown>).max_surveyors) || 0;
      if (cap > 0) {
        const [sc] = await sql`SELECT COUNT(*)::int AS n FROM app_users WHERE role = 'surveyor' AND created_by = ${me.id}`.catch(() => [{ n: 0 }]);
        const surveyorCount = sqlCountN(sc);
        if (surveyorCount >= cap) {
          return json({
            error: `Surveyor limit reached — max ${cap} surveyors (set by Super Admin). Delete a surveyor or ask Super Admin to raise the limit.`,
          }, 422);
        }
      }
    }
      let finalCompanyName = companyName || null;
      let companyId: number | null = null;
      if (role === "admin" && finalCompanyName && sql) {
        const comp = await ensureCompanyExists(sql, finalCompanyName, me.id);
        if (comp) {
          companyId = comp.id;
          finalCompanyName = comp.name;
        }
      }
      const inserted = await sql`
          INSERT INTO app_users (username, password_hash, display_name, company_name, company_id, role, target_quota, active, key_id, phone, can_manage_questions, can_edit_surveys, can_review_data, can_verify_surveyors, can_assign_surveyors, can_crud_questionnaire, can_validate_proof, can_web_survey, can_record_voice, can_translate_telugu, max_questions_per_survey, max_surveys, max_surveyors, max_records, max_categories, created_by)
          VALUES (${username}, ${password_hash}, ${name}, ${finalCompanyName}, ${companyId}, ${role}, ${target_quota}, TRUE, ${key_id}, ${phone || null}, ${canManageQuestions}, ${canEditSurveys}, ${canReviewData}, ${canVerifySurveyors}, ${canAssignSurveyors}, ${canCrudQuestionnaire}, ${canValidateProof}, ${canWebSurvey}, ${canRecordVoice}, ${canTranslateTeluguGrant}, ${maxQuestionsPerSurvey}, ${maxSurveysCreate}, ${maxSurveyorsCreate}, ${maxRecordsCreate}, ${maxCategoriesCreate}, ${me.id})
          RETURNING id, username, display_name, company_name, company_id, role, active, created_at, target_quota, key_id, phone, can_manage_questions, can_edit_surveys, can_review_data, can_verify_surveyors, can_assign_surveyors, can_crud_questionnaire, can_validate_proof, can_web_survey, can_record_voice, can_translate_telugu, max_questions_per_survey, max_surveys, max_surveyors, max_records, max_categories
        `;
      const u = inserted[0] as Record<string, unknown>;

      // Surveyors are explicitly assigned to surveys by Client Admin via Assign Surveyors tool

      logAudit(me, "user_create", "user", u.id, {
        username: u.username,
        role,
        target_quota,
        can_manage_questions: canManageQuestions,
        can_edit_surveys: canEditSurveys,
        can_review_data: canReviewData,
        can_verify_surveyors: canVerifySurveyors,
        can_assign_surveyors: canAssignSurveyors,
        can_crud_questionnaire: canCrudQuestionnaire,
        can_validate_proof: canValidateProof,
        can_web_survey: canWebSurvey,
        can_record_voice: canRecordVoice,
        can_translate_telugu: canTranslateTeluguGrant,
        max_questions_per_survey: maxQuestionsPerSurvey,
        max_surveys: maxSurveysCreate,
        max_surveyors: maxSurveyorsCreate,
        max_records: maxRecordsCreate,
        max_categories: maxCategoriesCreate,
      });
      return json({
        user: {
          id: u.id,
          username: u.username,
          name: u.display_name || u.username,
          company_name: u.company_name || null,
          role: u.role,
          active: u.active !== false,
          created_at: u.created_at,
          target_quota: u.target_quota ?? target_quota,
          key_id: u.key_id || key_id,
          phone: u.phone || null,
          can_manage_questions: u.can_manage_questions === true,
          can_edit_surveys: u.can_edit_surveys === true,
          can_review_data: u.can_review_data === true,
          can_verify_surveyors: u.can_verify_surveyors === true,
          can_assign_surveyors: u.can_assign_surveyors === true,
          can_crud_questionnaire: u.can_crud_questionnaire === true,
          can_validate_proof: u.can_validate_proof === true,
          can_web_survey: u.can_web_survey === true,
          can_record_voice: u.can_record_voice === true,
          can_translate_telugu: u.can_translate_telugu === true,
        },
        field_app_access: role === "surveyor",
        field_app_login: role === "surveyor"
          ? { username, note: "Use these credentials on field app (/) " }
          : null,
      }, 201);
    } catch (e) {
      const msg = (e as Error).message || "";
      if (msg.includes("unique") || msg.includes("duplicate")) {
        return json({ error: "Username already exists" }, 409);
      }
      return json({ error: msg || "Could not create user" }, 500);
    }
  }

  // Bulk generate surveyors: { count, prefix, password, target_quota }
  if (path === "/api/users/generate" && method === "POST") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    const body = await readBody(req);
    let count = Math.min(Math.max(Number(body.count) || 1, 1), 100);
    const prefix = String(body.prefix || "s").trim().toLowerCase().replace(/[^a-z0-9_]/g, "") || "s";
    // Surveyor cap: a Client Admin may only create surveyors up to the Super-Admin-set
    // max_surveyors (0 = unlimited). Clamp the requested batch to the remaining allowance.
    let bulkRemaining = -1; // -1 = no cap
    if (me.role !== "super_admin") {
      const cap = Number((me as Record<string, unknown>).max_surveyors) || 0;
      if (cap > 0) {
        const [sc] = await sql`SELECT COUNT(*)::int AS n FROM app_users WHERE role = 'surveyor' AND created_by = ${me.id}`.catch(() => [{ n: 0 }]);
        const surveyorCount = sqlCountN(sc);
        const remaining = Math.max(0, cap - surveyorCount);
        if (remaining <= 0) {
          return json({
            error: `Surveyor limit reached — max ${cap} surveyors (set by Super Admin). Delete a surveyor or ask Super Admin to raise the limit.`,
          }, 422);
        }
        count = Math.min(count, remaining);
        bulkRemaining = remaining;
      }
    }
    const password = String(body.password || "survey123");
    const target_quota = Math.max(0, Math.min(Number(body.target_quota) || 0, 100000));
    // Explicit usernames (one per line / comma separated) take priority over prefix+count
    const rawUsernames = Array.isArray(body.usernames)
      ? body.usernames
      : String(body.usernames_list || "").split(/[\n,;]+/);
    const usernames = rawUsernames
      .map((u: unknown) => String(u).trim().toLowerCase())
      .filter((u: string) => /^[a-z0-9_]{2,40}$/.test(u))
      .slice(0, 100);
    // Explicit usernames must also respect the cap — clamp the list to the allowance
    const names = usernames.length
      ? bulkRemaining >= 0
        ? usernames.slice(0, bulkRemaining)
        : usernames
      : Array.from({ length: count }, (_, i) => `${prefix}${String(i + 1).padStart(3, "0")}`);
    const created: {
      username: string;
      password: string;
      name: string;
      target_quota: number;
      key_id: string;
    }[] = [];
    await sql`ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check`.catch(() => null);
    await sql`
        ALTER TABLE app_users
        ADD CONSTRAINT app_users_role_check
        CHECK (role IN ('super_admin', 'admin', 'field', 'user', 'surveyor'))
      `.catch(() => null);
    await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS target_quota INTEGER NOT NULL DEFAULT 0`
      .catch(() => null);

    const password_hash = await hashPasswordAsync(password);
    const errors: string[] = [];
    for (const username of names) {
      const displayName = `Surveyor ${username}`;
      try {
        const key_id = await uniqueUserKeyId();
        const ins = await sql`
            INSERT INTO app_users (username, password_hash, display_name, role, target_quota, active, key_id, created_by)
            VALUES (${username}, ${password_hash}, ${displayName}, ${"surveyor"}, ${target_quota}, TRUE, ${key_id}, ${me.id})
            RETURNING id
          `;
        const newId = Number((ins[0] as { id?: number } | undefined)?.id);
        // Auto-attach bulk-created surveyors to every survey this admin owns
        if (Number.isFinite(newId) && me.role === "admin") {
          const mySurveys = await sql`
              SELECT id FROM survey_form
              WHERE created_by = ${me.id}
                AND form_key NOT IN ('default', 'legacy')
            `.catch(() => []);
          for (const s of mySurveys as { id: number }[]) {
            await upsertSurveyAssignment(Number(s.id), newId);
          }
        }
        created.push({
          username,
          password,
          name: displayName,
          target_quota,
          key_id,
          id: Number.isFinite(newId) ? newId : undefined,
        });
      } catch (e) {
        errors.push(`${username}: ${(e as Error).message || "exists"}`);
      }
    }
    logAudit(me, "users_bulk_create", "user", null, {
      count: created.length,
      prefix: names[0] || "",
      target_quota,
    });
    return json({
      ok: true,
      created: created.length,
      target_quota,
      users: created,
      field_app_access: true,
      field_app_url: "/",
      note: created.length
        ? `Each surveyor can login to field app with password "${password}". Target = ${target_quota}.`
        : "No users created — usernames may already exist. Try prefix t or s2.",
      errors: errors.length ? errors.slice(0, 5) : undefined,
    }, 201);
  }

  // Profile media upload endpoint (photo, aadhaar_front, aadhaar_back)
  if (m === "POST" && /^\/api\/users\/\d+\/media$/.test(url.pathname)) {
    if (!me) return json({ error: "Login required" }, 401);
    const urlParts = url.pathname.split("/");
    const targetId = Number(urlParts[3]);
    if (!targetId || !Number.isFinite(targetId)) return json({ error: "Invalid user id" }, 400);
    const body = await readBody(req);

    if (me.role !== "admin" && me.id !== targetId) {
      return json({ error: "Forbidden — can only edit own profile media" }, 403);
    }

    const existing = await sql`
        SELECT id, username, display_name, photo, aadhaar_front, aadhaar_back, verified
        FROM app_users WHERE id = ${targetId}
      `;
    if (!existing.length) return json({ error: "User not found" }, 404);

    // Lock uploads for verified surveyors — only admin can change
    const exUser = existing[0] as Record<string, unknown>;
    if (exUser.verified === true && me.role !== "admin") {
      return json({
        error: "Profile media is locked after Admin Verification. Only Admin can update photo or Aadhaar documents.",
      }, 403);
    }

    let photoVal = body.photo !== undefined ? (body.photo ? String(body.photo) : null) : null;
    let aadhaarFrontVal = body.aadhaar_front !== undefined ? (body.aadhaar_front ? String(body.aadhaar_front) : null) : null;
    let aadhaarBackVal = body.aadhaar_back !== undefined ? (body.aadhaar_back ? String(body.aadhaar_back) : null) : null;

    const field = String(body.field || body.kind || "").toLowerCase();
    const singleData = body.data !== undefined ? String(body.data) : body.url !== undefined ? String(body.url) : body.value !== undefined ? String(body.value) : null;

    if (singleData !== null) {
      if (field === "photo") photoVal = singleData || null;
      else if (field === "aadhaar_front" || field === "aadhaar-front" || field === "aadhaarfront") aadhaarFrontVal = singleData || null;
      else if (field === "aadhaar_back" || field === "aadhaar-back" || field === "aadhaarback") aadhaarBackVal = singleData || null;
    }

    const ex = existing[0] as Record<string, unknown>;
    let nextPhoto = photoVal !== null ? photoVal : ((ex.photo as string | null) || null);
    let nextAadhaarFront = aadhaarFrontVal !== null ? aadhaarFrontVal : ((ex.aadhaar_front as string | null) || null);
    let nextAadhaarBack = aadhaarBackVal !== null ? aadhaarBackVal : ((ex.aadhaar_back as string | null) || null);

    for (const [k, v] of [["photo", nextPhoto], ["aadhaar_front", nextAadhaarFront], ["aadhaar_back", nextAadhaarBack]] as const) {
      if (v && typeof v === "string" && v.length > 4_500_000) {
        return json({ error: `${k} image too large. Max 3MB base64 per image.` }, 413);
      }
    }

    // Store in Cloudflare R2 if configured
    const processR2 = async (field: "photo" | "aadhaar_front" | "aadhaar_back", val: string | null) => {
      if (!val || !val.startsWith("data:image/")) return val;
      const parsed = splitDataUrl(val);
      const mime = parsed.mime || "image/jpeg";
      const b64Data = parsed.b64;
      try {
        const bytes = b64ToBytes(b64Data);
        const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
        const objectKey = `profiles/${targetId}/${field}_${Date.now()}.${ext}`;
        const r2 = await tryOptionalExternalUpload(bytes, mime, field, objectKey, `${field}.${ext}`);
        if (r2?.url) return r2.url;
      } catch {
        /* fallback to dataUrl */
      }
      return val;
    };

    if (photoVal !== null && photoVal) nextPhoto = await processR2("photo", photoVal);
    if (aadhaarFrontVal !== null && aadhaarFrontVal) nextAadhaarFront = await processR2("aadhaar_front", aadhaarFrontVal);
    if (aadhaarBackVal !== null && aadhaarBackVal) nextAadhaarBack = await processR2("aadhaar_back", aadhaarBackVal);

    const updated = await sql`
        UPDATE app_users
        SET photo = ${nextPhoto},
            aadhaar_front = ${nextAadhaarFront},
            aadhaar_back = ${nextAadhaarBack}
        WHERE id = ${targetId}
        RETURNING id, username, display_name, key_id, phone, photo, aadhaar_front, aadhaar_back
      `;

    const u = updated[0] as Record<string, unknown>;
    const fields: string[] = [];
    if (photoVal) fields.push("photo");
    if (aadhaarFrontVal) fields.push("Aadhaar front");
    if (aadhaarBackVal) fields.push("Aadhaar back");
    if (me.role === "surveyor" && fields.length) {
      logAudit(me, "profile_media", "user", targetId, { fields });
    }
    return json({
      ok: true,
      user_id: u.id,
      username: u.username,
      photo: u.photo || null,
      aadhaar_front: u.aadhaar_front || null,
      aadhaar_back: u.aadhaar_back || null,
    });
  }

  // Edit user profile (Admin: all fields / Surveyor: own phone before verification)
  if (path.startsWith("/api/users/") && method === "PATCH") {
    if (!me) return json({ error: "Login required" }, 401);
    const id = Number(path.split("/").pop());
    if (!id) return json({ error: "Invalid id" }, 400);
    const body = await readBody(req);

    const existing = await sql`SELECT * FROM app_users WHERE id = ${id}`;
    if (!existing.length) return json({ error: "Not found" }, 404);
    const ex = existing[0] as Record<string, unknown>;

    const isSelf = me.id === id;
    const isAdmin = isPortalAdmin(me.role);

    if (!isAdmin && !isSelf) {
      return json({ error: "Forbidden — can only update own profile" }, 403);
    }

    // BR-004 tenant scoping: a Client Admin may only manage surveyors they
    // created (created_by = me.id). Super Admin manages every account.
    if (isAdmin && me.role !== "super_admin" && !isSelf &&
        Number(ex.created_by) !== me.id) {
      return json({ error: "Forbidden — that account belongs to another Client Admin" }, 403);
    }

    // Freeze phone, photo and Aadhaar edits for surveyors once verified by Admin
    if (ex.verified === true && !isAdmin) {
      const lockedFields = ['phone', 'photo', 'aadhaar_front', 'aadhaar_back'].filter(f => body[f] !== undefined)
      if (lockedFields.length > 0) {
        return json({
          error: `${lockedFields.join(', ')} ${lockedFields.length > 1 ? 'are' : 'is'} locked after Admin Verification. Only Admin can change them.`,
        }, 403);
      }
    }

    // Non-admins can ONLY update their own phone or photo
    if (!isAdmin) {
      if (body.username !== undefined || body.password !== undefined || body.active !== undefined || body.role !== undefined || body.verified !== undefined || body.target_quota !== undefined) {
        return json({ error: "Surveyors can only update their phone number or profile photo." }, 403);
      }
    }

    // revoke_sessions only — kick user offline without other changes
    if (body.revoke_sessions === true && body.password == null && body.username == null &&
        body.active == null && body.name == null && body.target_quota == null && body.role == null) {
      invalidateSessionCache();
        const del = invalidateSessionCache();
      await sql`DELETE FROM app_sessions WHERE user_id = ${id}`;
      await sql`DELETE FROM app_device_tokens WHERE user_id = ${id}`.catch(() => null);
      return json({
        ok: true,
        revoked: true,
        sessions_cleared: Array.isArray(del) ? del.length : true,
        user_id: id,
        username: ex.username,
      });
    }

    let password_hash = ex.password_hash;
    let passwordChanged = false;
    if (body.password != null && String(body.password).length > 0) {
      if (String(body.password).length < 4) {
        return json({ error: "Password min 4 characters" }, 400);
      }
      password_hash = await hashPasswordAsync(String(body.password));
      passwordChanged = true;
    }

    let nextUsername = ex.username;
    if (body.username != null && String(body.username).trim()) {
      nextUsername = String(body.username).trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
      if (!nextUsername || nextUsername.length < 2) {
        return json({ error: "Username min 2 characters (letters/numbers)" }, 400);
      }
      if (nextUsername !== ex.username) {
        const clash = await sql`
            SELECT id FROM app_users WHERE LOWER(username) = ${nextUsername} AND id <> ${id} LIMIT 1
          `;
        if (clash.length) return json({ error: "Username already taken" }, 409);
      }
    }

    const nextActive = typeof body.active === "boolean" ? body.active : ex.active;
    if (id === me.id && nextActive === false) {
      return json({ error: "Cannot disable your own admin account" }, 400);
    }
    if (id === me.id && nextUsername !== ex.username) {
      // allow rename self carefully
    }

    const nextName = body.name != null ? String(body.name).trim() : ex.display_name;
    let nextCompanyName =
      body.company_name !== undefined && me.role === "super_admin" && ex.role === "admin"
        ? String(body.company_name || "").trim().slice(0, 160) || null
        : (ex as Record<string, unknown>).company_name || null;
    if (ex.role === "admin" && !nextCompanyName) {
      nextCompanyName = `${nextName || ex.username} Organisation`;
    }
    // Company registry link: when Super Admin explicitly changes a Client Admin's
    // company_name, relink to a registered company with that name (or unlink).
    const companyNameChanged =
      body.company_name !== undefined && me.role === "super_admin" && ex.role === "admin";
    let nextCompanyId: number | null =
      (ex as Record<string, unknown>).company_id != null
        ? Number((ex as Record<string, unknown>).company_id)
        : null;
    if (companyNameChanged || (ex.role === "admin" && !nextCompanyId)) {
      nextCompanyId = null;
      if (nextCompanyName && sql) {
        const comp = await ensureCompanyExists(sql, nextCompanyName, me.id);
        if (comp) {
          nextCompanyId = comp.id;
          nextCompanyName = comp.name;
        }
      }
    }
    const nextPhone =
      body.phone != null ? String(body.phone).trim() : (ex as Record<string, unknown>).phone || null;
    const nextPhoto =
      body.photo != null ? String(body.photo).trim() : (ex as Record<string, unknown>).photo || null;
    const nextAadhaarFront =
      body.aadhaar_front != null ? String(body.aadhaar_front).trim() : (ex as Record<string, unknown>).aadhaar_front || null;
    const nextAadhaarBack =
      body.aadhaar_back != null ? String(body.aadhaar_back).trim() : (ex as Record<string, unknown>).aadhaar_back || null;
    const nextVerified =
      typeof body.verified === "boolean" ? body.verified : (ex as Record<string, unknown>).verified === true;
    const nextRole =
      body.role === "admin" || body.role === "surveyor" ? body.role : ex.role;
    const nextQuota =
      body.target_quota != null
        ? Math.max(0, Math.min(Number(body.target_quota) || 0, 100000))
        : Number(ex.target_quota) || 0;
    const nextMaxQuestionsPerSurvey =
      body.max_questions_per_survey !== undefined && me.role === "super_admin"
        ? Math.max(0, Math.min(Number(body.max_questions_per_survey) || 0, 100000))
        : Number((ex as Record<string, unknown>).max_questions_per_survey) || 0;
    const nextMaxSurveys =
      body.max_surveys !== undefined && me.role === "super_admin"
        ? Math.max(0, Math.min(Number(body.max_surveys) || 0, 100000))
        : Number((ex as Record<string, unknown>).max_surveys) || 0;
    const nextMaxSurveyors =
      body.max_surveyors !== undefined && me.role === "super_admin"
        ? Math.max(0, Math.min(Number(body.max_surveyors) || 0, 100000))
        : Number((ex as Record<string, unknown>).max_surveyors) || 0;
    const nextMaxRecords =
      body.max_records !== undefined && me.role === "super_admin"
        ? Math.max(0, Math.min(Number(body.max_records) || 0, 10_000_000))
        : Number((ex as Record<string, unknown>).max_records) || 0;
    const nextMaxCategories =
      body.max_categories !== undefined && me.role === "super_admin"
        ? Math.max(0, Math.min(Number(body.max_categories) || 0, 1000))
        : Number((ex as Record<string, unknown>).max_categories ?? 5);
    // Grant-based powers — only Super Admin grants/revokes them (least privilege)
    const POWER_KEYS = [
      "can_manage_questions",
      "can_edit_surveys",
      "can_review_data",
      "can_verify_surveyors",
      "can_assign_surveyors",
      "can_crud_questionnaire",
      "can_validate_proof",
      "can_web_survey",
      "can_record_voice",
      "can_translate_telugu",
    ] as const;
    const nextPowers: Record<string, boolean> = {};
    for (const k of POWER_KEYS) {
      const cur = sqlBool((ex as Record<string, unknown>)[k]);
      if (body[k] === undefined) {
        nextPowers[k] = cur;
      } else if (me.role === "super_admin") {
        // Accept true/false only from Super Admin body (boolean or "true"/"false")
        nextPowers[k] = sqlBool(body[k]);
      } else {
        nextPowers[k] = cur; // Client Admin cannot change own grants
      }
    }
    // Verification gate: surveyors need the granted verify power; client admin accounts
    // can only be verified by the Super Admin (client admins never verify each other)
    if (body.verified !== undefined) {
      const targetRole = String((ex as Record<string, unknown>).role || "");
      const isAdminTarget = targetRole === "admin" || targetRole === "super_admin";
      if (isAdminTarget ? me.role !== "super_admin" : !hasPower(me, "can_verify_surveyors")) {
        return json({
          error: isAdminTarget
            ? "Only Super Admin can verify client admin accounts"
            : "Super Admin has not granted your account surveyor-verification rights",
        }, 403);
      }
    }

    let rows;
    try {
      rows = await sql`
          UPDATE app_users
          SET username = ${nextUsername},
              password_hash = ${password_hash},
              display_name = ${nextName},
              company_name = ${nextCompanyName},
              company_id = ${nextCompanyId},
              role = ${nextRole},
              active = ${nextActive},
              target_quota = ${nextQuota},
              phone = ${nextPhone},
              photo = ${nextPhoto},
              aadhaar_front = ${nextAadhaarFront},
              aadhaar_back = ${nextAadhaarBack},
              verified = ${nextVerified},
              can_manage_questions = ${nextPowers.can_manage_questions},
              can_edit_surveys = ${nextPowers.can_edit_surveys},
              can_review_data = ${nextPowers.can_review_data},
              can_verify_surveyors = ${nextPowers.can_verify_surveyors},
              can_assign_surveyors = ${nextPowers.can_assign_surveyors},
              can_crud_questionnaire = ${nextPowers.can_crud_questionnaire},
              can_validate_proof = ${nextPowers.can_validate_proof},
              can_web_survey = ${nextPowers.can_web_survey},
              can_record_voice = ${nextPowers.can_record_voice},
              can_translate_telugu = ${nextPowers.can_translate_telugu},
              max_questions_per_survey = ${nextMaxQuestionsPerSurvey},
              max_surveys = ${nextMaxSurveys},
              max_surveyors = ${nextMaxSurveyors},
              max_records = ${nextMaxRecords},
              max_categories = ${nextMaxCategories}
          WHERE id = ${id}
          RETURNING id, username, display_name, company_name, role, active, created_at, target_quota, key_id, phone, photo, aadhaar_front, aadhaar_back, verified, can_manage_questions, can_edit_surveys, can_review_data, can_verify_surveyors, can_assign_surveyors, can_crud_questionnaire, can_validate_proof, can_web_survey, can_record_voice, can_translate_telugu, max_questions_per_survey, max_surveys, max_surveyors, max_records, max_categories
        `;
    } catch (e) {
      const msg = (e as Error).message || "";
      if (msg.includes("unique") || msg.includes("duplicate")) {
        return json({ error: "Username already taken" }, 409);
      }
      return json({ error: msg || "Update failed" }, 500);
    }

    // Revoke sessions only when credentials/status/identity change — NOT when
    // Super Admin only updates powers/limits (that was kicking Client Admins
    // on every feature save and made grants look "unsaved").
    const companyIdChanged =
      nextCompanyId !==
      ((ex as Record<string, unknown>).company_id != null
        ? Number((ex as Record<string, unknown>).company_id)
        : null);
    const shouldRevoke =
      body.revoke_sessions === true ||
      nextActive === false ||
      passwordChanged ||
      nextUsername !== ex.username ||
      nextRole !== ex.role ||
      (companyIdChanged && body.company_name !== undefined);
    let sessionsCleared = 0;
    if (shouldRevoke) {
      invalidateSessionCache();
        const del = invalidateSessionCache();
      await sql`DELETE FROM app_sessions WHERE user_id = ${id}`;
      await sql`DELETE FROM app_device_tokens WHERE user_id = ${id}`.catch(() => null);
      sessionsCleared = Array.isArray(del) ? del.length : 0;
    }

    // FR-AUD-01: log admin-driven account changes (not self phone/photo-only edits)
    const adminChanged =
      nextActive !== ex.active ||
      passwordChanged ||
      nextUsername !== ex.username ||
      body.role !== undefined ||
      body.target_quota !== undefined ||
      body.verified !== undefined ||
      body.max_questions_per_survey !== undefined ||
      body.max_surveys !== undefined ||
      body.max_surveyors !== undefined ||
      body.max_records !== undefined ||
      body.max_categories !== undefined ||
      POWER_KEYS.some((k) => body[k] !== undefined);
    if (adminChanged && isAdmin) {
      logAudit(me, "user_update", "user", id, {
        username: ex.username,
        active: nextActive,
        password_changed: passwordChanged,
        role_changed: body.role !== undefined,
        quota_changed: body.target_quota !== undefined,
        verified_changed: body.verified !== undefined,
        powers_changed: POWER_KEYS.filter((k) => body[k] !== undefined),
      });
    }

    const u = rows[0] as Record<string, unknown>;
    return json({
      ok: true,
      user: {
        id: u.id,
        username: u.username,
        name: u.display_name || u.username,
        company_name: u.company_name || null,
        role: u.role,
        active: u.active,
        created_at: u.created_at,
        target_quota: u.target_quota ?? nextQuota,
        key_id: u.key_id || null,
        phone: u.phone || nextPhone || null,
        photo: u.photo || nextPhoto || null,
        aadhaar_front: u.aadhaar_front || nextAadhaarFront || null,
        aadhaar_back: u.aadhaar_back || nextAadhaarBack || null,
        verified: sqlBool(u.verified),
        can_manage_questions: sqlBool(u.can_manage_questions),
        can_edit_surveys: sqlBool(u.can_edit_surveys),
        can_review_data: sqlBool(u.can_review_data),
        can_verify_surveyors: sqlBool(u.can_verify_surveyors),
        can_assign_surveyors: sqlBool(u.can_assign_surveyors),
        can_crud_questionnaire: sqlBool(u.can_crud_questionnaire),
        can_validate_proof: sqlBool(u.can_validate_proof),
        can_web_survey: sqlBool(u.can_web_survey),
        can_record_voice: sqlBool(u.can_record_voice),
        can_translate_telugu: sqlBool(u.can_translate_telugu),
        max_questions_per_survey: Number(u.max_questions_per_survey) || 0,
        max_surveys: Number(u.max_surveys) || 0,
        max_surveyors: Number(u.max_surveyors) || 0,
        max_records: Number(u.max_records) || nextMaxRecords || 0,
        max_categories: Number(u.max_categories ?? 5),
      },
      password_changed: passwordChanged,
      username_changed: nextUsername !== ex.username,
      disabled: nextActive === false,
      sessions_revoked: shouldRevoke,
      sessions_cleared: sessionsCleared,
      plain_password: passwordChanged ? String(body.password) : undefined,
    });
  }

  // DELETE user (optional hard remove) — prefer disable
  if (path.startsWith("/api/users/") && method === "DELETE") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    const id = Number(path.split("/").pop());
    if (!id) return json({ error: "Invalid id" }, 400);
    if (id === me.id) return json({ error: "Cannot delete your own account" }, 400);
    const existing = await sql`SELECT id, username, role, created_by FROM app_users WHERE id = ${id}`;
    if (!existing.length) return json({ error: "Not found" }, 404);
    // BR-004 tenant scoping: a Client Admin may only delete surveyors they created.
    if (me.role !== "super_admin" && Number((existing[0] as { created_by?: unknown }).created_by) !== me.id) {
      return json({ error: "Forbidden — that account belongs to another Client Admin" }, 403);
    }
    invalidateSessionCache();
      await sql`DELETE FROM app_sessions WHERE user_id = ${id}`;
    await sql`DELETE FROM app_device_tokens WHERE user_id = ${id}`.catch(() => null);
    await sql`DELETE FROM app_users WHERE id = ${id}`;
    logAudit(me, "user_delete", "user", id, {
      username: (existing[0] as { username: string }).username,
      role: (existing[0] as { role: string }).role,
    });
    return json({
      ok: true,
      deleted: true,
      id,
      username: (existing[0] as { username: string }).username,
    });
  }
  return null;
}
