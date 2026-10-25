import type { Ctx } from "./ctx.ts";
import {
  surveyDisplayLang,
} from "../lib/analytics/answers.ts";
import {
  logAudit,
} from "../lib/audit.ts";
import {
  listVisibleCategories,
} from "../lib/categories.ts";
import {
  sql,
} from "../lib/db.ts";
import {
  json,
  readBody,
} from "../lib/http.ts";
import {
  ensureCompanyExists,
} from "../lib/schema.ts";
import {
  hasPower,
  listAssignedSurveys,
  parseSurveyQuotas,
  totalQuestionsForAdmin,
  upsertSurveyAssignment,
} from "../lib/survey-assignments.ts";
import {
  canTranslateTelugu,
  googleTranslateToTelugu,
  stripTeluguUnlessAllowed,
} from "../lib/translate.ts";
import {
  isPortalAdmin,
  sqlCountN,
} from "../lib/users.ts";
import {
  parseQuestionsArray,
} from "../lib/util.ts";
import {
  clampWebLinkMaxUses,
  expireWebLinksForSurvey,
  findLiveWebLink,
  surveyIsFrozen,
} from "../lib/web-links.ts";

export async function handleSurveys(c: Ctx): Promise<Response | null> {
  const { req, url, path, method, me } = c;
  // ── Surveys (multi-survey: name + own questions + team + respondents) ────
  if (path === "/api/surveys" && method === "GET") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    // Super Admin: all projects.
    // Client Admin: own surveys + explicit shares only — no company
    // predicate (see SCHEMA.md: company is a display label, never a
    // live access check).
    let rows: Record<string, unknown>[] = [];
    try {
      rows = (me.role === "super_admin"
        ? (q
            ? await sql`SELECT id, form_key, title, display_lang, questions, CASE WHEN jsonb_typeof(questions) = 'array' THEN jsonb_array_length(questions) ELSE 0 END::int AS question_count, updated_at, created_by, company_name, COALESCE(voice_required, FALSE) AS voice_required, COALESCE(voice_time_limit, 0) AS voice_time_limit, ended_at FROM survey_form WHERE LOWER(title) LIKE ${'%' + q + '%'} ORDER BY title`
            : await sql`SELECT id, form_key, title, display_lang, questions, CASE WHEN jsonb_typeof(questions) = 'array' THEN jsonb_array_length(questions) ELSE 0 END::int AS question_count, updated_at, created_by, company_name, COALESCE(voice_required, FALSE) AS voice_required, COALESCE(voice_time_limit, 0) AS voice_time_limit, ended_at FROM survey_form ORDER BY title`)
        : (q
              ? await sql`
                    SELECT id, form_key, title, display_lang, questions, CASE WHEN jsonb_typeof(questions) = 'array' THEN jsonb_array_length(questions) ELSE 0 END::int AS question_count, updated_at, created_by, company_name, COALESCE(voice_required, FALSE) AS voice_required, COALESCE(voice_time_limit, 0) AS voice_time_limit, ended_at FROM survey_form
                    WHERE (
                      created_by = ${me.id}
                      OR id IN (SELECT survey_id FROM survey_admin_access WHERE admin_id = ${me.id})
                      OR (company_name IS NOT NULL AND company_name <> '' AND LOWER(TRIM(company_name)) = LOWER(TRIM((SELECT company_name FROM app_users WHERE id = ${me.id}))))
                      OR (company_id IS NOT NULL AND company_id = (SELECT company_id FROM app_users WHERE id = ${me.id}))
                    )
                      AND LOWER(title) LIKE ${'%' + q + '%'}
                    ORDER BY title
                  `
              : await sql`
                    SELECT id, form_key, title, display_lang, questions, CASE WHEN jsonb_typeof(questions) = 'array' THEN jsonb_array_length(questions) ELSE 0 END::int AS question_count, updated_at, created_by, company_name, COALESCE(voice_required, FALSE) AS voice_required, COALESCE(voice_time_limit, 0) AS voice_time_limit, ended_at FROM survey_form
                    WHERE created_by = ${me.id}
                      OR id IN (SELECT survey_id FROM survey_admin_access WHERE admin_id = ${me.id})
                      OR (company_name IS NOT NULL AND company_name <> '' AND LOWER(TRIM(company_name)) = LOWER(TRIM((SELECT company_name FROM app_users WHERE id = ${me.id}))))
                      OR (company_id IS NOT NULL AND company_id = (SELECT company_id FROM app_users WHERE id = ${me.id}))
                    ORDER BY title
                  `)) as Record<string, unknown>[];
    } catch {
      const fallback = me.role === "super_admin"
        ? await sql`SELECT id, form_key, title, questions, updated_at, created_by, company_name FROM survey_form ORDER BY title`.catch(() => [])
        : await sql`
              SELECT id, form_key, title, questions, updated_at, created_by, company_name FROM survey_form
              WHERE created_by = ${me.id}
                OR id IN (SELECT survey_id FROM survey_admin_access WHERE admin_id = ${me.id})
                OR (company_name IS NOT NULL AND company_name <> '' AND LOWER(TRIM(company_name)) = LOWER(TRIM((SELECT company_name FROM app_users WHERE id = ${me.id}))))
                OR (company_id IS NOT NULL AND company_id = (SELECT company_id FROM app_users WHERE id = ${me.id}))
              ORDER BY title
            `.catch(() => []);
      rows = (fallback as Record<string, unknown>[]).map((r) => ({
        ...r,
        question_count: parseQuestionsArray(r.questions).length,
      }));
    }

    // Project → Client Admin connections for the Super Admin project list.
    const adminAccess = await sql`
        SELECT saa.survey_id, u.id, u.username, COALESCE(u.display_name, u.username) AS name,
               u.company_name
        FROM survey_admin_access saa JOIN app_users u ON u.id = saa.admin_id
        ORDER BY u.username
      `.catch(() => []);
    const adminAccessMap = new Map<number, { id: number; username: string; name: string; company_name: string | null }[]>();
    for (const a of adminAccess as { survey_id: number; id: number; username: string; name: string; company_name: string | null }[]) {
      const arr = adminAccessMap.get(Number(a.survey_id)) || [];
      arr.push({ id: Number(a.id), username: a.username, name: a.name, company_name: a.company_name || null });
      adminAccessMap.set(Number(a.survey_id), arr);
    }
    const adminRows = await sql`
        SELECT id, COALESCE(display_name, username) AS name, company_name, role FROM app_users WHERE role = 'admin'
      `.catch(() => []);
    const adminById = new Map<number, { name: string; company_name: string | null; role: string }>();
    for (const a of adminRows as { id: number; name: string; company_name: string | null; role: string }[]) {
      adminById.set(Number(a.id), { name: String(a.name), company_name: a.company_name || null, role: String(a.role || 'admin') });
    }
    const asg = await sql`
        SELECT a.survey_id, COUNT(*)::int AS n,
               ARRAY_AGG(DISTINCT COALESCE(u.display_name, u.username)) AS names
        FROM survey_assignments a
        JOIN app_users u ON a.user_id = u.id
        GROUP BY a.survey_id
      `.catch(async () =>
      await sql`
          SELECT survey_id, COUNT(*)::int AS n, NULL AS names
          FROM survey_assignments GROUP BY survey_id
        `.catch(() => [])
    );
    const rsp = await sql`
        SELECT survey_id, COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE status = 'done')::int AS done
        FROM survey_respondents GROUP BY survey_id
      `.catch(() => []);

    // Counts by form_key — field vs web kept separate (web is not field quota).
    const subByFk = await sql`
        SELECT payload->>'form_key' AS fk,
               COUNT(*) FILTER (
                 WHERE COALESCE(payload->>'source', '') NOT IN ('web-survey', 'web')
                   AND COALESCE(payload->>'status', 'pending') <> 'rejected'
                   AND COALESCE(payload->>'draft', 'false') NOT IN ('true', 't', '1')
               )::int AS n,
               COUNT(*) FILTER (
                 WHERE COALESCE(payload->>'source', '') IN ('web-survey', 'web')
                   AND COALESCE(payload->>'draft', 'false') NOT IN ('true', 't', '1')
               )::int AS web_n,
               COUNT(*) FILTER (
                 WHERE COALESCE(payload->>'status', 'pending') NOT IN ('confirmed', 'rejected')
                   AND COALESCE(payload->>'draft', 'false') NOT IN ('true', 't', '1')
               )::int AS pending,
               COUNT(*) FILTER (
                 WHERE COALESCE(payload->>'status', 'pending') = 'confirmed'
                   AND COALESCE(payload->>'draft', 'false') NOT IN ('true', 't', '1')
               )::int AS confirmed,
               COUNT(*) FILTER (
                 WHERE COALESCE(payload->>'status', 'pending') = 'rejected'
               )::int AS rejected
        FROM submissions
        WHERE payload->>'form_key' IS NOT NULL
        GROUP BY 1
      `.catch(() => []);
    const asgMap = new Map((asg as any[]).map((r) => [Number(r.survey_id), r]));
    const rspMap = new Map((rsp as any[]).map((r) => [Number(r.survey_id), r]));
    const subByFkMap = new Map((subByFk as any[]).map((r) => [String(r.fk), Number(r.n)]));
    const webByFkMap = new Map((subByFk as any[]).map((r) => [String(r.fk), Number(r.web_n)]));
    const pendingByFk = new Map((subByFk as any[]).map((r) => [String(r.fk), Number(r.pending) || 0]));
    const confirmedByFk = new Map((subByFk as any[]).map((r) => [String(r.fk), Number(r.confirmed) || 0]));
    const rejectedByFk = new Map((subByFk as any[]).map((r) => [String(r.fk), Number(r.rejected) || 0]));

    const linkRows = await sql`
        SELECT DISTINCT ON (form_key) form_key, token, max_uses, use_count, used_at, created_at
        FROM web_survey_links
        ORDER BY form_key,
          CASE WHEN used_at IS NULL AND use_count < max_uses THEN 0 ELSE 1 END,
          created_at ASC
      `.catch(() => []);
    const linkMap = new Map<string, {
      token: string;
      max_uses: number;
      use_count: number;
      expired: boolean;
    }>();
    for (const r of linkRows as Record<string, unknown>[]) {
      const fk = String(r.form_key || "");
      const max = clampWebLinkMaxUses(r.max_uses);
      const webN = webByFkMap.get(fk) || 0;
      const used = Math.max(webN, Number(r.use_count) || 0);
      linkMap.set(fk, {
        token: String(r.token || ""),
        max_uses: max,
        use_count: used,
        expired: Boolean(r.used_at) || used >= max,
        deactivated: Boolean(r.used_at) && used < max,
        starts_at: r.created_at || null,
        created_at: r.created_at || null,
        ended_at: r.used_at || null,
        used_at: r.used_at || null,
      });
    }

    const items = (rows as Record<string, unknown>[])
      // Client Admin never sees platform seed forms (Field Survey / Legacy)
      .filter((r) => {
        if (me.role === "super_admin") return true;
        const fk = String(r.form_key || "");
        return fk !== "default" && fk !== "legacy";
      })
      .map((r) => {
      const qCount = Number(r.question_count || 0) || parseQuestionsArray((r as { questions?: unknown }).questions).length;
      const asgData = asgMap.get(Number(r.id)) as { n?: number; names?: string[] } | undefined;
      const names = Array.isArray(asgData?.names) ? asgData.names.filter(Boolean) : [];
      const connectedAdmins = adminAccessMap.get(Number(r.id)) || [];
      const ownerId = r.created_by != null ? Number(r.created_by) : null;
      const owner = ownerId != null ? adminById.get(ownerId) : undefined;
      // Only include owner if owner is a Client Admin (role === 'admin')
      const admins = (owner && owner.role === 'admin' && !connectedAdmins.some((a) => a.id === ownerId))
        ? [{ id: ownerId, username: '', name: owner.name, company_name: owner.company_name }, ...connectedAdmins]
        : connectedAdmins;
      const fk = String(r.form_key || "");
      const subCount = subByFkMap.get(fk) || 0;
      const webCount = webByFkMap.get(fk) || 0;
      const webLink = linkMap.get(fk) || null;
      return {
        id: r.id,
        form_key: r.form_key,
        title: r.title,
        display_lang: surveyDisplayLang((r as { display_lang?: unknown }).display_lang),
        questions: parseQuestionsArray((r as { questions?: unknown }).questions),
        voice_required: r.voice_required === true,
        voice_time_limit: Number(r.voice_time_limit) || 0,

        company_name: r.company_name || null,
        owner_company: owner?.company_name ?? null,
        owner_name: owner?.name ?? null,
        question_count: qCount,
        updated_at: r.updated_at,
        surveyors: asgData?.n || 0,
        surveyor_names: names.join(", ") || "",
        admin_count: admins.length,
        admin_names: admins.map((a) => `${a.company_name || 'No company'} · ${a.name}`).join(", "),
        respondents_total: (rspMap.get(Number(r.id)) as any)?.total || 0,
        respondents_done: (rspMap.get(Number(r.id)) as any)?.done || 0,
        submissions: (pendingByFk.get(fk) || 0) + (confirmedByFk.get(fk) || 0) + (rejectedByFk.get(fk) || 0),
        field_submissions: subCount,
        web_submissions: Math.max(webCount, Number(webLink?.use_count) || 0),
        pending: pendingByFk.get(fk) || 0,
        confirmed: confirmedByFk.get(fk) || 0,
        rejected: rejectedByFk.get(fk) || 0,
        web_link: webLink,
        ended_at: (r as { ended_at?: unknown }).ended_at || null,
        ended: Boolean((r as { ended_at?: unknown }).ended_at),
        frozen: Boolean((r as { ended_at?: unknown }).ended_at) ||
          Boolean(webLink?.token) ||
          subCount > 0 ||
          webCount > 0 ||
          (Number(asgData?.n) || 0) > 0,
      };
    });
    return json({ items, count: items.length });
  }

  if (path === "/api/surveys" && method === "POST") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    // Super Admin creates Projects; Client Admin creates Surveys (needs Create surveys power)
    if (me.role !== "super_admin" && !hasPower(me, "can_crud_questionnaire")) {
      return json({
        error: "Super Admin has not granted Create surveys on your profile",
      }, 403);
    }
    const body = await readBody(req);
    const title = String(body.title || "").trim();
    if (!title) {
      return json({
        error: me.role === "super_admin" ? "Project name required" : "Survey name required",
      }, 400);
    }
    const questions = stripTeluguUnlessAllowed(
      me,
      Array.isArray(body.questions) ? body.questions : [],
    );
    // Same validation as PUT /api/surveys/:id — reject empty/duplicate
    // question ids before they ever reach the database.
    {
      const seenIds = new Set<string>();
      for (const qq of questions as Record<string, unknown>[]) {
        const qid = String((qq as { id?: unknown })?.id || "").trim();
        if (!qid) {
          return json({ error: "Every question needs a non-empty id" }, 422);
        }
        if (seenIds.has(qid)) {
          return json({ error: `Duplicate question id "${qid}" — each question needs a unique id` }, 422);
        }
        seenIds.add(qid);
      }
    }
    // Super Admin registers the company this project is mapped under + the Client
    // Admins who are part of it (they get project access; the Super Admin stays owner).
    let companyName: string | null = null;
    let companyId: number | null = null;
    let connectedAdminIds: number[] = [];
    if (me.role === "super_admin") {
      companyName = String(body.company_name || "").trim().slice(0, 160) || null;
      if (companyName && sql) {
        const comp = await ensureCompanyExists(sql, companyName, me.id);
        if (comp) {
          companyName = comp.name;
          companyId = comp.id;
        }
      }
      connectedAdminIds = [...new Set(
        (Array.isArray(body.admin_ids) ? body.admin_ids : [])
          .map(Number)
          .filter((v: number) => Number.isFinite(v)),
      )];
      if (connectedAdminIds.length) {
        const valid = await sql`SELECT id FROM app_users WHERE role = 'admin' AND id = ANY(${connectedAdminIds})`.catch(() => []);
        const validIds = new Set((valid as { id: number }[]).map((r) => Number(r.id)));
        if (validIds.size !== connectedAdminIds.length) {
          return json({ error: "Only Client Admin accounts can be connected" }, 422);
        }
      }
    } else {
      companyName = (me as Record<string, unknown>).company_name
        ? String((me as Record<string, unknown>).company_name).trim().slice(0, 160)
        : null;
      if ((me as Record<string, unknown>).company_id != null) {
        companyId = Number((me as Record<string, unknown>).company_id);
      }
      if (companyName && sql) {
        const comp = await ensureCompanyExists(sql, companyName, me.id);
        if (comp) {
          companyName = comp.name;
          companyId = comp.id;
        }
      }
    }
    // Super-Admin-set total question quota across surveys for this Client Admin (0 = unlimited)
    const maxQsCreate = Number((me as Record<string, unknown>).max_questions_per_survey) || 0;
    if (maxQsCreate > 0 && me.role === "admin" && sql) {
      const existingQs = await totalQuestionsForAdmin(sql, Number(me.id));
      if (existingQs + questions.length > maxQsCreate) {
        return json({
          error: `Total question quota exceeded — maximum ${maxQsCreate} questions allowed across surveys (${existingQs} already used)`,
        }, 422);
      }
    }
    const dup = await sql`
        SELECT id, form_key FROM survey_form WHERE LOWER(title) = LOWER(${title}) LIMIT 1
      `.catch(() => []);
    if (dup.length) {
      const d = dup[0] as { id: number; form_key: string };
      return json({
        error: `Survey "${title}" already exists`,
        existing_id: d.id,
        form_key: d.form_key,
      }, 409);
    }
    // Super-Admin-set cap on how many surveys this Client Admin may create (0 = unlimited)
    const maxSvCreate = Number((me as Record<string, unknown>).max_surveys) || 0;
    if (maxSvCreate > 0) {
      const mine = await sql`SELECT COUNT(*)::int AS n FROM survey_form WHERE created_by = ${me.id}`.catch(() => [{ n: 0 }]);
      const createdCount = Number((mine[0] as { n?: number })?.n || 0);
      if (createdCount >= maxSvCreate) {
        return json({
          error: `Survey limit reached — maximum ${maxSvCreate} surveys (set by Super Admin). Delete or edit an existing survey first.`,
        }, 422);
      }
    }
    const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "survey";
    let formKey = base;
    let n = 1;
    for (;;) {
      const clash = await sql`SELECT id FROM survey_form WHERE form_key = ${formKey} LIMIT 1`;
      if (!clash.length) break;
      n += 1;
      formKey = `${base}-${n}`;
    }
    const rows = await sql`
        INSERT INTO survey_form (form_key, title, questions, updated_at, created_by, company_name, company_id, voice_required, voice_time_limit)
        VALUES (
          ${formKey}, ${title}, ${JSON.stringify(questions)}::jsonb, NOW(), ${me.id}, ${companyName}, ${companyId},
          ${hasPower(me, "can_record_voice") && body.voice_required === true},
          ${me.role === "super_admin" ? Math.max(0, Math.min(60, Number(body.voice_time_limit) || 0)) : 0}
        )
        RETURNING id, form_key, title, updated_at
      `;
    const surveyId = (rows[0] as { id?: unknown }).id;
    // Super Admin project: grant every Client Admin in that company + any extra admin_ids.
    // Company-mapped projects must show up for all Client Admins of that company.
    if (me.role === "super_admin") {
      const grantIds = new Set<number>(connectedAdminIds);
      if (companyName) {
        const companyAdmins = await sql`
            SELECT id FROM app_users
            WHERE role = 'admin' AND active = TRUE
              AND (
                LOWER(TRIM(COALESCE(company_name, ''))) = LOWER(${companyName})
                OR company_id = (SELECT id FROM companies WHERE LOWER(TRIM(name)) = LOWER(${companyName}) LIMIT 1)
              )
          `.catch(() => []);
        for (const a of companyAdmins as { id: number }[]) {
          grantIds.add(Number(a.id));
        }
      }
      for (const adminId of grantIds) {
        if (!Number.isFinite(adminId)) continue;
        await sql`
            INSERT INTO survey_admin_access (survey_id, admin_id)
            VALUES (${surveyId}, ${adminId})
            ON CONFLICT DO NOTHING
          `.catch(() => null);
      }
      connectedAdminIds = [...grantIds];
    }
    // Surveyors are explicitly mapped to surveys by Client Admin (no auto-assignment to surveyors)
    const autoAssigned = 0;
    logAudit(me, "survey_create", "survey", surveyId, {
      title,
      form_key: formKey,
      questions: questions.length,
      company_name: companyName,
      admin_ids: connectedAdminIds,
      auto_assigned_surveyors: autoAssigned,
    });
    return json({
      ok: true,
      survey: rows[0],
      auto_assigned_surveyors: autoAssigned,
      web_link: null,
    }, 201);
  }

  if (path.match(/^\/api\/surveys\/\d+$/) && method === "GET") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    const id = Number(path.split("/")[3]);
    // Client Admin: own survey or explicit share only — no company
    // predicate (see SCHEMA.md).
    let rows = me.role === "super_admin"
      ? await sql`SELECT id, form_key, title, display_lang, questions, updated_at, created_by, company_name, COALESCE(voice_required, FALSE) AS voice_required, COALESCE(voice_time_limit, 0) AS voice_time_limit, ended_at FROM survey_form WHERE id = ${id}`.catch(() => null)
      : await sql`
              SELECT id, form_key, title, display_lang, questions, updated_at, created_by, company_name, COALESCE(voice_required, FALSE) AS voice_required, COALESCE(voice_time_limit, 0) AS voice_time_limit, ended_at FROM survey_form
              WHERE id = ${id} AND (
                created_by = ${me.id}
                OR id IN (SELECT survey_id FROM survey_admin_access WHERE admin_id = ${me.id})
                OR (company_name IS NOT NULL AND company_name <> '' AND LOWER(TRIM(company_name)) = LOWER(TRIM((SELECT company_name FROM app_users WHERE id = ${me.id}))))
                OR (company_id IS NOT NULL AND company_id = (SELECT company_id FROM app_users WHERE id = ${me.id}))
              )
            `.catch(() => null);
    if (!rows) {
      rows = me.role === "super_admin"
        ? await sql`SELECT id, form_key, title, questions, updated_at, created_by, company_name FROM survey_form WHERE id = ${id}`
        : await sql`
                SELECT id, form_key, title, questions, updated_at, created_by, company_name FROM survey_form
                WHERE id = ${id} AND (
                  created_by = ${me.id}
                  OR id IN (SELECT survey_id FROM survey_admin_access WHERE admin_id = ${me.id})
                  OR (company_name IS NOT NULL AND company_name <> '' AND LOWER(TRIM(company_name)) = LOWER(TRIM((SELECT company_name FROM app_users WHERE id = ${me.id}))))
                  OR (company_id IS NOT NULL AND company_id = (SELECT company_id FROM app_users WHERE id = ${me.id}))
                )
              `;
    }
    if (!rows.length) return json({ error: "Not found or not your survey" }, 404);
    const r = rows[0] as { id: number; form_key: string; title: string; display_lang?: string; questions: unknown; updated_at: string; created_by: number | null; company_name: string | null; voice_required?: boolean; voice_time_limit?: number };
    const questions = parseQuestionsArray(r.questions);
    const team = me.role === "super_admin"
      ? await sql`
        SELECT u.id, u.username, u.display_name, u.active
        FROM survey_assignments sa JOIN app_users u ON u.id = sa.user_id
        WHERE sa.survey_id = ${id} ORDER BY u.username
      `.catch(() => [])
      : await sql`
        SELECT u.id, u.username, u.display_name, u.active
        FROM survey_assignments sa JOIN app_users u ON u.id = sa.user_id
        WHERE sa.survey_id = ${id} AND u.created_by = ${me.id} ORDER BY u.username
      `.catch(() => []);
    const respondents = await sql`
        SELECT id, name, phone, status, done_at, submission_id, created_at
        FROM survey_respondents WHERE survey_id = ${id} ORDER BY id DESC
      `.catch(() => []);
    const adminRows = await sql`
        SELECT u.id, u.username, u.display_name, u.company_name
        FROM app_users u
        WHERE u.id = ${r.created_by}
        UNION
        SELECT u.id, u.username, u.display_name, u.company_name
        FROM survey_admin_access saa JOIN app_users u ON u.id = saa.admin_id
        WHERE saa.survey_id = ${id}
        ORDER BY username
      `.catch(() => []);
    const admins = (adminRows as Record<string, unknown>[]).map((a) => ({
      id: a.id, username: a.username, name: a.display_name || a.username,
      company_name: a.company_name || null,
    }));
    const owner = admins.find((a) => Number(a.id) === Number(r.created_by));
    const webLink = await findLiveWebLink(r.form_key);
    const lock = await surveyIsFrozen(sql, r.form_key, r.id);
    return json({
      survey: {
        id: r.id,
        form_key: r.form_key,
        title: r.title,
        web_link: webLink,
        ended_at: (r as { ended_at?: unknown }).ended_at || null,
        ended: lock.ended,
        frozen: lock.frozen,
        display_lang: surveyDisplayLang(r.display_lang),
        voice_required: r.voice_required === true,
        voice_time_limit: Number(r.voice_time_limit) || 0,
        questions,
        updated_at: r.updated_at,
        surveyors: team,
        respondents,
        owner_id: r.created_by,
        owner: owner ? `${owner.name}${owner.company_name ? ` · ${owner.company_name}` : ""}` : null,
        company_name: r.company_name || null,
        admins,
        admin_count: admins.length,
      },
    });
  }

  if (path.match(/^\/api\/surveys\/\d+\/end$/) && method === "POST") {
    if (!me) return json({ error: "Login required" }, 401);
    if (me.role !== "super_admin") {
      return json({ error: "Super Admin only — Client Admin cannot end a survey" }, 403);
    }
    const id = Number(path.split("/")[3]);
    const rows = await sql`
        SELECT id, form_key, title, ended_at FROM survey_form WHERE id = ${id} LIMIT 1
      `.catch(() => []);
    if (!rows.length) return json({ error: "Survey not found" }, 404);
    const formKey = String((rows[0] as { form_key: string }).form_key || "");
    const title = String((rows[0] as { title?: string }).title || formKey);
    await sql`UPDATE survey_form SET ended_at = NOW(), updated_at = NOW() WHERE id = ${id}`.catch(() => null);
    await expireWebLinksForSurvey(formKey);
    logAudit(me, "survey_end", "survey", id, { form_key: formKey, title });
    return json({
      ok: true,
      ended: true,
      form_key: formKey,
      title,
      message: "Survey ended. The public web link has expired.",
    });
  }

  // Super Admin connects Client Admin accounts to a project. This endpoint
  // intentionally never touches survey_assignments (the surveyor team).
  if (path.match(/^\/api\/surveys\/\d+\/admins$/) && method === "PUT") {
    if (!me) return json({ error: "Login required" }, 401);
    if (me.role !== "super_admin") return json({ error: "Super Admin only" }, 403);
    const id = Number(path.split("/")[3]);
    const body = await readBody(req);
    const requestedIds = [...new Set((Array.isArray(body.admin_ids) ? body.admin_ids : [])
      .map(Number).filter((value: number) => Number.isFinite(value)))];
    const project = await sql`SELECT id, created_by FROM survey_form WHERE id = ${id}`.catch(() => []);
    if (!project.length) return json({ error: "Project not found" }, 404);
    const ownerId = Number((project[0] as { created_by?: unknown }).created_by) || null;
    const ids = requestedIds.filter((adminId) => adminId !== ownerId);
    if (ids.length) {
      const valid = await sql`SELECT id FROM app_users WHERE role = 'admin' AND id = ANY(${ids})`.catch(() => []);
      const validIds = new Set((valid as { id: number }[]).map((row) => Number(row.id)));
      if (validIds.size !== ids.length) return json({ error: "Only Client Admin accounts can be connected" }, 422);
    }
    await sql`DELETE FROM survey_admin_access WHERE survey_id = ${id}`;
    for (const adminId of ids) {
      await sql`INSERT INTO survey_admin_access (survey_id, admin_id) VALUES (${id}, ${adminId}) ON CONFLICT DO NOTHING`;
    }
    logAudit(me, "project_client_admins_update", "survey", id, { admin_ids: ids });
    return json({ ok: true, connected: ids.length });
  }

  if (path.match(/^\/api\/surveys\/\d+$/) && method === "PUT") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    if (!hasPower(me, "can_crud_questionnaire") && !hasPower(me, "can_edit_surveys")) {
      return json({
        error: "Super Admin has not granted your account questionnaire-editing rights",
      }, 403);
    }
    const id = Number(path.split("/")[3]);
    const body = await readBody(req);
    // Connected Client Admins may edit the project, while only the owner (or
    // Super Admin) can delete it.
    const rows = me.role === "super_admin"
      ? await sql`SELECT id, title, form_key FROM survey_form WHERE id = ${id}`
      : await sql`
            SELECT id, title, form_key FROM survey_form
            WHERE id = ${id} AND (
              created_by = ${me.id}
              OR id IN (SELECT survey_id FROM survey_admin_access WHERE admin_id = ${me.id})
              OR (company_name IS NOT NULL AND company_name <> '' AND LOWER(TRIM(company_name)) = LOWER(TRIM((SELECT company_name FROM app_users WHERE id = ${me.id}))))
              OR (company_id IS NOT NULL AND company_id = (SELECT company_id FROM app_users WHERE id = ${me.id}))
            )
          `;
    if (!rows.length) return json({ error: "Not found or not your survey" }, 404);
    {
      const formKey = String((rows[0] as { form_key?: string }).form_key || "");
      const lock = formKey ? await surveyIsFrozen(sql, formKey, id) : { frozen: false, ended: false };
      if (lock.frozen) {
        return json({
          error: lock.ended
            ? "This survey has ended and is frozen. It cannot be edited."
            : "This survey is ongoing (web or field) and is frozen. It cannot be edited.",
          frozen: true,
          ended: lock.ended,
          form_key: formKey,
        }, 409);
      }
    }
    // Super-Admin-set total question quota across surveys for this Client Admin (0 = unlimited)
    const maxQsPut = Number((me as Record<string, unknown>).max_questions_per_survey) || 0;
    if (maxQsPut > 0 && me.role === "admin" && Array.isArray(body.questions) && sql) {
      const otherQs = await totalQuestionsForAdmin(sql, Number(me.id), null, id);
      const newTotal = otherQs + body.questions.length;
      if (newTotal > maxQsPut) {
        return json({
          error: `Total question quota exceeded — maximum ${maxQsPut} questions allowed across surveys (${otherQs} used in other surveys, saving ${body.questions.length} would reach ${newTotal})`,
        }, 422);
      }
    }
    const title = String(body.title || "").trim();
    if (title) {
      const dup = await sql`
          SELECT id FROM survey_form
          WHERE LOWER(title) = LOWER(${title}) AND id <> ${id} LIMIT 1
        `.catch(() => []);
      if (dup.length) return json({ error: `Survey "${title}" already exists` }, 409);
    }
    if (title) {
      await sql`
          UPDATE survey_form SET title = ${title}, updated_at = NOW() WHERE id = ${id}
        `;
    }
    if (Array.isArray(body.questions)) {
      if (body.translate === true && canTranslateTelugu(me)) {
        // Auto-fill missing label_te and options_te via Google Translate
        const toTrans: string[] = [];
        for (const q of body.questions as Record<string, unknown>[]) {
          if (q.label && !q.label_te) toTrans.push(String(q.label));
          if (Array.isArray(q.options)) {
            for (const opt of q.options) {
              if (typeof opt === "string" && opt) toTrans.push(opt);
            }
          }
        }
        if (toTrans.length) {
          try {
            const transMap = new Map<string, string>();
            const translated = await googleTranslateToTelugu(toTrans);
            toTrans.forEach((t, i) => transMap.set(t, translated[i] || t));
            for (const q of body.questions as Record<string, unknown>[]) {
              if (q.label && !q.label_te) q.label_te = transMap.get(String(q.label)) || q.label;
              if (Array.isArray(q.options) && (!Array.isArray(q.options_te) || !q.options_te.length)) {
                q.options_te = q.options.map((opt: unknown) => (typeof opt === "string" ? transMap.get(opt) || opt : opt));
              }
            }
          } catch {
            /* ignore translation failures */
          }
        }
      }
      body.questions = stripTeluguUnlessAllowed(me, body.questions);
      // Reject malformed question ids before saving — an empty or
      // duplicate id collapses multiple questions onto one key in every
      // downstream per-question map (filters, chart counts), which can
      // break analytics for the whole survey, not just that question.
      const seenIds = new Set<string>();
      for (const q of body.questions as Record<string, unknown>[]) {
        const qid = String((q as { id?: unknown })?.id || "").trim();
        if (!qid) {
          return json({ error: "Every question needs a non-empty id" }, 422);
        }
        if (seenIds.has(qid)) {
          return json({ error: `Duplicate question id "${qid}" — each question needs a unique id` }, 422);
        }
        seenIds.add(qid);
      }
      // A question may only carry a category the caller's tenant owns, so a
      // rename or delete can never leave surveys tagged with a dead name.
      const wantedCats = new Set(
        (body.questions as Record<string, unknown>[])
          .map((q) => String(q.category ?? "").trim())
          .filter(Boolean),
      );
      if (wantedCats.size) {
        const allowed = new Set(
          (await listVisibleCategories(sql, me)).map((c) => String(c.name).toLowerCase()),
        );
        for (const name of wantedCats) {
          if (!allowed.has(name.toLowerCase())) {
            return json({
              error: `Unknown question category "${name}" — create it under Categories first`,
            }, 422);
          }
        }
      }
      await sql`
          UPDATE survey_form SET questions = ${JSON.stringify(body.questions)}::jsonb, updated_at = NOW()
          WHERE id = ${id}
        `;
    }
    if (body.display_lang !== undefined) {
      const displayLang = surveyDisplayLang(body.display_lang);
      if (displayLang === "te" && !canTranslateTelugu(me)) {
        return json({
          error: "Telugu translation is locked — Super Admin must grant Telugu Translation on your profile",
        }, 403);
      }
      await sql`
          UPDATE survey_form SET display_lang = ${displayLang}, updated_at = NOW() WHERE id = ${id}
        `;
    }
    if (body.voice_required !== undefined) {
      if (!hasPower(me, "can_record_voice")) {
        return json({
          error: "Super Admin has not granted Voice recording on your profile",
        }, 403);
      }
      await sql`
          UPDATE survey_form
          SET voice_required = ${body.voice_required === true},
              updated_at = NOW()
          WHERE id = ${id}
        `;
    }
    // Minute auto-stop is Super Admin only. Client Admin may send the field
    // from an older UI — ignore it so survey saves still succeed.
    if (body.voice_time_limit !== undefined && me.role === "super_admin") {
      const voiceLimit = Math.max(0, Math.min(60, Number(body.voice_time_limit) || 0));
      await sql`
          UPDATE survey_form
          SET voice_time_limit = ${voiceLimit},
              updated_at = NOW()
          WHERE id = ${id}
        `;
    }
    // The company a project is mapped under is registered by the Super Admin.
    let nextCompanyName: string | null | undefined;
    if (me.role === "super_admin" && body.company_name !== undefined) {
      nextCompanyName = String(body.company_name || "").trim().slice(0, 160) || null;
      let nextCompanyId: number | null = null;
      if (nextCompanyName && sql) {
        const comp = await ensureCompanyExists(sql, nextCompanyName, me.id);
        if (comp) {
          nextCompanyName = comp.name;
          nextCompanyId = comp.id;
        }
      }
      await sql`
          UPDATE survey_form
          SET company_name = ${nextCompanyName}, company_id = ${nextCompanyId}, updated_at = NOW()
          WHERE id = ${id}
        `;
    }
    logAudit(me, "survey_update", "survey", id, {
      title: title || undefined,
      company_name: nextCompanyName === undefined ? undefined : nextCompanyName,
    });
    return json({ ok: true });
  }

  if (path.match(/^\/api\/surveys\/\d+$/) && method === "DELETE") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    if (!hasPower(me, "can_crud_questionnaire") && !hasPower(me, "can_edit_surveys")) {
      return json({
        error: "Super Admin has not granted your account questionnaire-editing rights",
      }, 403);
    }
    const id = Number(path.split("/")[3]);
    // Only the owner (or Super Admin) may delete — shared access does NOT grant
    // delete rights, so one admin can't remove a survey others rely on.
    const rows = me.role === "super_admin"
      ? await sql`SELECT form_key FROM survey_form WHERE id = ${id}`
      : await sql`SELECT form_key FROM survey_form WHERE id = ${id} AND created_by = ${me.id}`;
    if (!rows.length) return json({ error: "Not found or not your survey" }, 404);
    {
      const formKey = String((rows[0] as { form_key?: string }).form_key || "");
      const lock = formKey ? await surveyIsFrozen(sql, formKey, id) : { frozen: false, ended: false };
      if (lock.frozen) {
        return json({
          error: lock.ended
            ? "This survey has ended and is frozen. It cannot be deleted."
            : "This survey is ongoing (web or field) and is frozen. It cannot be deleted.",
          frozen: true,
          ended: lock.ended,
          form_key: formKey,
        }, 409);
      }
    }
    await sql`DELETE FROM survey_assignments WHERE survey_id = ${id}`.catch(() => null);
    await sql`DELETE FROM survey_respondents WHERE survey_id = ${id}`.catch(() => null);
    await sql`DELETE FROM survey_form WHERE id = ${id}`;
    logAudit(me, "survey_delete", "survey", id, { form_key: (rows[0] as { form_key: string }).form_key });
    return json({ ok: true, deleted: true });
  }

  // Replace the surveyor team for a survey
  if (path.match(/^\/api\/surveys\/\d+\/surveyors$/) && method === "PUT") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    if (me.role === "super_admin") {
      return json({ error: "Super Admin connects Client Admins to projects; surveyors are managed only by the Client Admin." }, 403);
    }
    if (!hasPower(me, "can_assign_surveyors")) {
      return json({ error: "Super Admin has not granted your account surveyor-assignment rights" }, 403);
    }
    const id = Number(path.split("/")[3]);
    const body = await readBody(req);
    const ids = [...new Set((Array.isArray(body.user_ids) ? body.user_ids : [])
      .map(Number)
      .filter((v: number) => Number.isFinite(v)))];
    // A Client Admin maps only their own surveyors to owned or assigned projects.
    const rows = await sql`
        SELECT id FROM survey_form
        WHERE id = ${id} AND (created_by = ${me.id}
          OR id IN (SELECT survey_id FROM survey_admin_access WHERE admin_id = ${me.id}))
      `;
    if (!rows.length) return json({ error: "Not found or not your survey" }, 404);
    // Filter in JS — neon ANY(${ids}) has dropped every id on some deploys,
    // which then DELETE'd the team and inserted nobody.
    const mine = await sql`
        SELECT id FROM app_users
        WHERE created_by = ${me.id} AND role IN ('surveyor', 'field')
      `.catch(() => []);
    const mineSet = new Set((mine as { id: number }[]).map((r) => Number(r.id)));
    const allowed = ids.filter((v) => mineSet.has(v));
    if (ids.length > 0 && allowed.length === 0) {
      return json({
        error: "Only surveyors you created can be added to this survey",
      }, 422);
    }
    // Merge — never DELETE the whole team first. A failed insert used to
    // wipe assignments so the field app could not load this survey.
    const currentRows = await sql`
        SELECT user_id FROM survey_assignments
        WHERE survey_id = ${id} AND user_id IN (
          SELECT id FROM app_users WHERE created_by = ${me.id} AND role IN ('surveyor', 'field')
        )
      `.catch(() => []);
    const current = new Set((currentRows as { user_id: number }[]).map((r) => Number(r.user_id)));
    const next = new Set(allowed);
    for (const uid of current) {
      if (!next.has(uid)) {
        await sql`
            DELETE FROM survey_assignments WHERE survey_id = ${id} AND user_id = ${uid}
          `.catch(() => null);
      }
    }
    const saved: number[] = [...next].filter((uid) => current.has(uid));
    for (const uid of next) {
      if (current.has(uid)) continue;
      if (await upsertSurveyAssignment(id, uid)) saved.push(uid);
    }
    if (next.size > 0 && saved.length === 0) {
      return json({ error: "Could not save surveyor assignments" }, 500);
    }
    return json({ ok: true, assigned: saved.length, user_ids: saved });
  }

  // Assigned surveys for one surveyor (Client Admin profile / field my-surveys twin).
  if (path.match(/^\/api\/users\/\d+\/surveys$/) && method === "GET") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    const userId = Number(path.split("/")[3]);
    if (!Number.isFinite(userId)) return json({ error: "Invalid user id" }, 400);
    if (me.role !== "super_admin") {
      const owned = await sql`
          SELECT id FROM app_users WHERE id = ${userId} AND created_by = ${me.id} LIMIT 1
        `.catch(() => []);
      if (!owned.length) return json({ error: "You can only view surveyors you created" }, 403);
    }
    const items = await listAssignedSurveys(sql, userId);
    return json({
      items: items.map((s) => ({
        id: s.id,
        form_key: s.form_key,
        title: s.title,
        display_lang: s.display_lang,
        target_quota: Number(s.target_quota) || 0,
        questions_count: Array.isArray(s.questions) ? s.questions.length : 0,
      })),
      count: items.length,
    });
  }

  // Replace which surveys a surveyor is assigned to (user-centric).
  // Used by Client Admin Surveyors tab — NOT the inverted setSurveySurveyors(surveyId, users).
  if (path.match(/^\/api\/users\/\d+\/surveys$/) && method === "PUT") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    if (me.role === "super_admin") {
      return json({
        error: "Super Admin connects Client Admins to projects; surveyors are managed only by the Client Admin.",
      }, 403);
    }
    if (!hasPower(me, "can_assign_surveyors")) {
      return json({ error: "Super Admin has not granted your account surveyor-assignment rights" }, 403);
    }
    const userId = Number(path.split("/")[3]);
    if (!Number.isFinite(userId)) return json({ error: "Invalid user id" }, 400);
    const body = await readBody(req);
    const surveyIds = (Array.isArray(body.survey_ids) ? body.survey_ids : [])
      .map(Number)
      .filter((v: number) => Number.isFinite(v));
    const addIds = [...new Set((Array.isArray(body.add_survey_ids) ? body.add_survey_ids : [])
      .map(Number)
      .filter((v: number) => Number.isFinite(v)))];
    const removeIds = [...new Set((Array.isArray(body.remove_survey_ids) ? body.remove_survey_ids : [])
      .map(Number)
      .filter((v: number) => Number.isFinite(v)))];
    const incremental = addIds.length > 0 || removeIds.length > 0;
    const quotas = parseSurveyQuotas(body as Record<string, unknown>);

    // Must be a surveyor this Client Admin created
    const userRows = await sql`
        SELECT id, role, created_by FROM app_users WHERE id = ${userId} LIMIT 1
      `.catch(() => []);
    if (!userRows.length) return json({ error: "User not found" }, 404);
    const target = userRows[0] as { id: number; role: string; created_by: number | null };
    if (target.role !== "surveyor" && target.role !== "field") {
      return json({ error: "Only surveyors can be assigned surveys" }, 422);
    }
    if (Number(target.created_by) !== Number(me.id)) {
      return json({ error: "You can only assign surveys to surveyors you created" }, 403);
    }

    // Filter in JS — neon ANY(${ids}) has dropped every id on some deploys,
    // which then DELETE'd this surveyor's surveys and inserted nobody.
    const okSurveys = await sql`
        SELECT id FROM survey_form
        WHERE created_by = ${me.id}
           OR id IN (SELECT survey_id FROM survey_admin_access WHERE admin_id = ${me.id})
      `.catch(() => []);
    const okSet = new Set((okSurveys as { id: number }[]).map((r) => Number(r.id)));
    const allowedSurveyIds = [...new Set(surveyIds.filter((v) => okSet.has(v)))];
    if (!incremental && surveyIds.length > 0 && allowedSurveyIds.length === 0) {
      return json({
        error: "None of those surveys belong to your account",
      }, 422);
    }

    const currentRows = await sql`
        SELECT survey_id FROM survey_assignments
        WHERE user_id = ${userId}
          AND survey_id IN (
            SELECT id FROM survey_form
            WHERE created_by = ${me.id}
               OR id IN (SELECT survey_id FROM survey_admin_access WHERE admin_id = ${me.id})
          )
      `.catch(() => []);
    const current = new Set((currentRows as { survey_id: number }[]).map((r) => Number(r.survey_id)));
    // Incremental add/remove keeps already-assigned surveys (tapping survey 2
    // must not drop survey 1). Full replace still used by Edit / bulk assign.
    const next = new Set(incremental ? current : allowedSurveyIds);
    if (incremental) {
      for (const sid of addIds) if (okSet.has(sid)) next.add(sid);
      for (const sid of removeIds) next.delete(sid);
    }
    for (const sid of current) {
      if (!next.has(sid)) {
        await sql`
            DELETE FROM survey_assignments WHERE survey_id = ${sid} AND user_id = ${userId}
          `.catch(() => null);
      }
    }
    const saved: number[] = [];
    for (const sid of next) {
      const q = quotas.has(sid) ? quotas.get(sid) : undefined;
      if (current.has(sid)) {
        if (q != null) {
          await sql`
              UPDATE survey_assignments SET target_quota = ${q}
              WHERE survey_id = ${sid} AND user_id = ${userId}
            `.catch(() => null);
        }
        saved.push(sid);
        continue;
      }
      if (await upsertSurveyAssignment(sid, userId, q)) saved.push(sid);
    }
    if (next.size > 0 && saved.length === 0) {
      return json({ error: "Could not save survey assignments" }, 500);
    }
    // Keep user-level target_quota as the SUM of per-survey quotas (not survey count).
    if (quotas.size > 0) {
      let sum = 0;
      for (const sid of saved) sum += Number(quotas.get(sid) || 0);
      if (sum <= 0) {
        const qRows = await sql`
            SELECT COALESCE(SUM(target_quota), 0)::int AS n
            FROM survey_assignments WHERE user_id = ${userId}
          `.catch(() => [{ n: 0 }]);
        sum = sqlCountN(qRows[0]);
      }
      await sql`
          UPDATE app_users SET target_quota = ${sum} WHERE id = ${userId}
        `.catch(() => null);
    }
    return json({
      ok: true,
      assigned: saved.length,
      survey_ids: saved,
      quotas: Object.fromEntries(
        saved.map((sid) => [sid, quotas.get(sid) ?? null]),
      ),
    });
  }

  // Surveyor view: surveys assigned to me (with their questions) — field app
  if (path === "/api/my-surveys" && method === "GET") {
    if (!me) return json({ error: "Login required" }, 401);
    if (me.role !== "surveyor" && me.role !== "field" && me.role !== "admin") {
      return json({ error: "Forbidden" }, 403);
    }
    const items = await listAssignedSurveys(sql, Number(me.id));
    return json({ items, count: items.length });
  }
  return null;
}
