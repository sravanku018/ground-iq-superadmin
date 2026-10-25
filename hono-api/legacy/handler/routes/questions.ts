import type { Ctx } from "./ctx.ts";
import {
  logAudit,
} from "../lib/audit.ts";
import {
  type QuestionCategory,
  canTouchCategory,
  categoryTenantOf,
  categoryUseCounts,
  countCategoryUse,
  listOwnedCategories,
  listVisibleCategories,
  retagCategoryInTenant,
} from "../lib/categories.ts";
import {
  sql,
} from "../lib/db.ts";
import {
  DEFAULT_QUESTIONS,
} from "../lib/defaults.ts";
import {
  json,
  readBody,
} from "../lib/http.ts";
import {
  hasPower,
  listAssignedSurveys,
} from "../lib/survey-assignments.ts";
import {
  canTranslateTelugu,
  translateQuestionToTelugu,
} from "../lib/translate.ts";
import {
  isPortalAdmin,
} from "../lib/users.ts";

export async function handleQuestions(c: Ctx): Promise<Response | null> {
  const { req, path, method, me } = c;
  // FR-QB-02: Global Question Bank — Super Admin authors is_global templates;
  // Client Admins see global + their own, and can copy any into a survey.
  if (path === "/api/questions/translate" && method === "POST") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    if (!canTranslateTelugu(me)) {
      return json({
        error: "Telugu translation is locked — Super Admin must grant Telugu Translation on your profile",
      }, 403);
    }
    const body = await readBody(req);
    const text = String(body.text || "").trim();
    const options = Array.isArray(body.options)
      ? body.options.map((s: unknown) => String(s ?? "").trim()).filter(Boolean)
      : [];
    if (!text) return json({ error: "Question text required" }, 400);
    try {
      const out = await translateQuestionToTelugu(text, options);
      return json(out);
    } catch (e) {
      const status = Number((e as { status?: number }).status) || 502;
      return json({ error: (e as Error).message || "Translate failed" }, status);
    }
  }

  // ── Question categories: the admin's own vocabulary for tagging questions ──
  if (path === "/api/question-categories" && method === "GET") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    const categories = await listVisibleCategories(sql, me)
    const owned = await listOwnedCategories(sql, categoryTenantOf(me))
    // Usage counts only make sense inside one tenant's surveys.
    const counts = me.role === "super_admin"
      ? null
      : await categoryUseCounts(sql, categoryTenantOf(me));
    return json({
      categories: categories.map((c) => ({
        ...c,
        question_count: counts ? counts.get(String(c.name).toLowerCase()) || 0 : undefined,
      })),
      limit: me.role === "super_admin" ? 0 : Number(me.max_categories) || 0,
      used: owned.length,
    });
  }

  if (path === "/api/question-categories" && method === "POST") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    const body = await readBody(req);
    const name = String(body.name ?? "").replace(/\s+/g, " ").trim();
    if (!name) return json({ error: "Category name required" }, 400);
    if (name.length > 40) {
      return json({ error: "Category name must be 40 characters or fewer" }, 400);
    }
    const tenant = categoryTenantOf(me);
    const owned = await listOwnedCategories(sql, tenant);
    if (owned.some((c) => String(c.name).toLowerCase() === name.toLowerCase())) {
      return json({ error: `You already have a category called "${name}"` }, 409);
    }
    // max_categories = 0 is unlimited, same convention as max_surveys / max_records.
    const limit = me.role === "super_admin" ? 0 : Number(me.max_categories) || 0;
    if (limit > 0 && owned.length >= limit) {
      return json({
        error: `Category limit reached (${owned.length} of ${limit}). Ask Super Admin to raise it, or delete a category you are not using.`,
      }, 403);
    }
    const rows = await sql`
        INSERT INTO question_categories (name, company_id, created_by)
        VALUES (${name}, ${tenant.companyId}, ${me.id})
        ON CONFLICT DO NOTHING
        RETURNING id, name, company_id, created_by, created_at
      `.catch(() => []);
    const cat = (rows as QuestionCategory[])[0];
    if (!cat) return json({ error: `You already have a category called "${name}"` }, 409);
    logAudit(me, "question_category_create", "question_category", cat.id, {
      name,
      company_id: tenant.companyId,
    });
    return json({ category: cat }, 201);
  }

  if (path.startsWith("/api/question-categories/") && method === "PUT") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    const id = Number(path.split("/")[3]);
    const rows = await sql`
        SELECT id, name, company_id, created_by, created_at FROM question_categories WHERE id = ${id}
      `.catch(() => []);
    const cat = (rows as QuestionCategory[])[0];
    if (!cat) return json({ error: "Not found" }, 404);
    if (!canTouchCategory(me, cat)) return json({ error: "Not allowed" }, 403);
    const body = await readBody(req);
    const name = String(body.name ?? cat.name).replace(/\s+/g, " ").trim();
    if (!name) return json({ error: "Category name required" }, 400);
    if (name.length > 40) {
      return json({ error: "Category name must be 40 characters or fewer" }, 400);
    }
    const tenant = { companyId: cat.company_id, adminId: Number(cat.created_by) };
    const renamed = name.toLowerCase() !== String(cat.name).toLowerCase();
    if (renamed) {
      try {
        await sql`UPDATE question_categories SET name = ${name} WHERE id = ${id}`;
      } catch {
        return json({ error: `That tenant already has a category called "${name}"` }, 409);
      }
      const surveysTagged = await retagCategoryInTenant(sql, tenant, String(cat.name), name);
      logAudit(me, "question_category_rename", "question_category", id, {
        from: cat.name,
        to: name,
        surveys_tagged: surveysTagged,
      });
    } else {
      logAudit(me, "question_category_update", "question_category", id, { name });
    }
    return json({ ok: true, category: { ...cat, name } });
  }

  if (path.startsWith("/api/question-categories/") && method === "DELETE") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    const id = Number(path.split("/")[3]);
    const rows = await sql`
        SELECT id, name, company_id, created_by, created_at FROM question_categories WHERE id = ${id}
      `.catch(() => []);
    const cat = (rows as QuestionCategory[])[0];
    if (!cat) return json({ error: "Not found" }, 404);
    if (!canTouchCategory(me, cat)) return json({ error: "Not allowed" }, 403);
    const tenant = { companyId: cat.company_id, adminId: Number(cat.created_by) };
    const inUse = await countCategoryUse(sql, tenant, String(cat.name));
    if (inUse > 0) {
      return json(
        { error: `"${cat.name}" is still on ${inUse} question${inUse === 1 ? "" : "s"}. Retag them first.` },
        409,
      );
    }
    await sql`DELETE FROM question_categories WHERE id = ${id}`.catch(() => null);
    logAudit(me, "question_category_delete", "question_category", id, {
      name: cat.name,
      company_id: cat.company_id,
    });
    return json({ ok: true });
  }

  if (path === "/api/question-bank" && method === "GET") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    const rows = await sql`
        SELECT id, name, questions, is_global, created_by, created_at, updated_at
        FROM question_bank
        WHERE is_global = TRUE OR created_by = ${me.id}
        ORDER BY is_global DESC, id DESC
      `.catch(() => []);
    return json({ templates: rows });
  }

  if (path === "/api/question-bank" && method === "POST") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    // FR-QB-02: bank CRUD needs the Super-Admin-granted power (least privilege)
    if (!hasPower(me, "can_manage_questions")) {
      return json({
        error: "Super Admin has not granted your account Question Bank edit rights",
      }, 403);
    }
    const body = await readBody(req);
    const name = String(body.name || "").trim();
    const questions = Array.isArray(body.questions) ? body.questions : [];
    if (!name) return json({ error: "Template name required" }, 400);
    // Reject empty/duplicate question ids at the source — bank templates
    // get copied verbatim into real surveys, so a bad id here poisons
    // every survey created from it.
    {
      const seenIds = new Set<string>();
      for (const qq of questions as Record<string, unknown>[]) {
        const qid = String((qq as { id?: unknown })?.id || "").trim();
        if (!qid) return json({ error: "Every question needs a non-empty id" }, 422);
        if (seenIds.has(qid)) {
          return json({ error: `Duplicate question id "${qid}" — each question needs a unique id` }, 422);
        }
        seenIds.add(qid);
      }
    }
    // is_global forced true only for super_admin (FR-QB-02)
    const isGlobal = me.role === "super_admin" && body.is_global === true;
    const rows = await sql`
        INSERT INTO question_bank (name, questions, is_global, created_by)
        VALUES (${name}, ${JSON.stringify(questions)}::jsonb, ${isGlobal}, ${me.id})
        RETURNING id, name, questions, is_global, created_by, created_at, updated_at
      `.catch(() => []);
    const t = (rows as Record<string, unknown>[])[0];
    if (!t) return json({ error: "Could not create template" }, 500);
    logAudit(me, "question_bank_create", "question_bank", t.id, {
      name,
      is_global: isGlobal,
      questions: questions.length,
    });
    return json({ template: t }, 201);
  }

  if (path.startsWith("/api/question-bank/") && method === "PUT") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    // FR-QB-02: bank CRUD needs the Super-Admin-granted power (least privilege)
    if (!hasPower(me, "can_manage_questions")) {
      return json({
        error: "Super Admin has not granted your account Question Bank edit rights",
      }, 403);
    }
    const id = Number(path.split("/")[3]);
    const body = await readBody(req);
    const rows = await sql`SELECT * FROM question_bank WHERE id = ${id}`.catch(() => []);
    const t = rows[0] as Record<string, unknown> | undefined;
    if (!t) return json({ error: "Not found" }, 404);
    // FR-QB-02 / BR-003: global templates are Super Admin authored — no tenant can alter them
    if (t.is_global === true && me.role !== "super_admin") {
      return json({ error: "Global templates are Super Admin only" }, 403);
    }
    const isOwner = Number(t.created_by) === Number(me.id);
    if (!isOwner && me.role !== "super_admin") {
      return json({ error: "Only the author or Super Admin can edit this template" }, 403);
    }
    const name = String(body.name != null ? body.name : t.name || "Template").trim() || "Template";
    const questions = Array.isArray(body.questions)
      ? body.questions
      : (Array.isArray(t.questions) ? t.questions : []);
    {
      const seenIds = new Set<string>();
      for (const qq of questions as Record<string, unknown>[]) {
        const qid = String((qq as { id?: unknown })?.id || "").trim();
        if (!qid) return json({ error: "Every question needs a non-empty id" }, 422);
        if (seenIds.has(qid)) {
          return json({ error: `Duplicate question id "${qid}" — each question needs a unique id` }, 422);
        }
        seenIds.add(qid);
      }
    }
    const isGlobal = t.is_global === true || (me.role === "super_admin" && body.is_global === true);
    await sql`
        UPDATE question_bank
        SET name = ${name}, questions = ${JSON.stringify(questions)}::jsonb,
            is_global = ${isGlobal}, updated_at = NOW()
        WHERE id = ${id}
      `.catch(() => null);
    logAudit(me, "question_bank_update", "question_bank", id, { name, is_global: isGlobal });
    return json({ ok: true });
  }

  if (path.startsWith("/api/question-bank/") && method === "DELETE") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    // FR-QB-02: bank CRUD needs the Super-Admin-granted power (least privilege)
    if (!hasPower(me, "can_manage_questions")) {
      return json({
        error: "Super Admin has not granted your account Question Bank edit rights",
      }, 403);
    }
    const id = Number(path.split("/")[3]);
    const rows = await sql`SELECT id, name, created_by, is_global FROM question_bank WHERE id = ${id}`.catch(() => []);
    const t = rows[0] as Record<string, unknown> | undefined;
    if (!t) return json({ error: "Not found" }, 404);
    // FR-QB-02 / BR-003: global templates are Super Admin authored — no tenant can alter them
    if (t.is_global === true && me.role !== "super_admin") {
      return json({ error: "Global templates are Super Admin only" }, 403);
    }
    const isOwner = Number(t.created_by) === Number(me.id);
    if (!isOwner && me.role !== "super_admin") {
      return json({ error: "Only the author or Super Admin can delete this template" }, 403);
    }
    await sql`DELETE FROM question_bank WHERE id = ${id}`.catch(() => null);
    logAudit(me, "question_bank_delete", "question_bank", id, { name: t.name });
    return json({ ok: true, deleted: true });
  }

  // Copy a bank template into a real survey (survey_form) so surveyors can use it.
  if (path.match(/^\/api\/question-bank\/\d+\/copy$/) && method === "POST") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    // Copying a template creates a survey — needs questionnaire CRUD or survey-editing power
    if (!hasPower(me, "can_crud_questionnaire") && !hasPower(me, "can_edit_surveys")) {
      return json({
        error: "Super Admin has not granted your account questionnaire-editing rights",
      }, 403);
    }
    const body = await readBody(req);
    const id = Number(path.split("/")[3]);
    // Enforce client-scoped visibility: only global templates or the client's own
    const rows = await sql`SELECT id, name, questions FROM question_bank WHERE id = ${id} AND (is_global = TRUE OR created_by = ${me.id} OR ${me.role} = 'super_admin')`.catch(() => []);
    const t = rows[0] as Record<string, unknown> | undefined;
    if (!t) return json({ error: "Not found" }, 404);
    let questions = Array.isArray(t.questions) ? t.questions : [];
    // Select number of questions — subset by question_count (default all), capped by the
    // Super-Admin-set per-survey question cap for this Client Admin (0 = unlimited)
    const maxQs = Number((me as Record<string, unknown>).max_questions_per_survey) || 0;
    const cap = maxQs > 0 ? Math.min(maxQs, questions.length) : questions.length;
    if (body.question_count) {
      const limit = Math.max(1, Math.min(Number(body.question_count), cap));
      questions = questions.slice(0, limit);
    } else if (maxQs > 0 && questions.length > maxQs) {
      questions = questions.slice(0, maxQs);
    }
    // Super-Admin-set cap on how many surveys this Client Admin may create (0 = unlimited)
    const maxSvCopy = Number((me as Record<string, unknown>).max_surveys) || 0;
    if (maxSvCopy > 0) {
      const mine = await sql`SELECT COUNT(*)::int AS n FROM survey_form WHERE created_by = ${me.id}`.catch(() => [{ n: 0 }]);
      const createdCount = Number((mine[0] as { n?: number })?.n || 0);
      if (createdCount >= maxSvCopy) {
        return json({
          error: `Survey limit reached — maximum ${maxSvCopy} surveys (set by Super Admin). Delete or edit an existing survey first.`,
        }, 422);
      }
    }
    const title = `${String(t.name || "Template").trim()} Survey`;
    const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "survey";
    let formKey = base;
    let n = 1;
    for (;;) {
      const clash = await sql`SELECT id FROM survey_form WHERE form_key = ${formKey} LIMIT 1`;
      if (!(clash as unknown[]).length) break;
      n += 1;
      formKey = `${base}-${n}`;
    }
    const copyCompanyId = (me as Record<string, unknown>).company_id != null
      ? Number((me as Record<string, unknown>).company_id)
      : null;
    const copyCompanyName = (me as Record<string, unknown>).company_name
      ? String((me as Record<string, unknown>).company_name).trim().slice(0, 160) || null
      : null;
    const ins = await sql`
        INSERT INTO survey_form (form_key, title, questions, updated_at, created_by, company_name, company_id)
        VALUES (${formKey}, ${title}, ${JSON.stringify(questions)}::jsonb, NOW(), ${me.id}, ${copyCompanyName}, ${copyCompanyId})
        RETURNING id, form_key, title
      `.catch(() => []);
    const created = (ins as Record<string, unknown>[])[0];
    if (!created) return json({ error: "Could not create survey from template" }, 500);
    logAudit(me, "question_bank_copy", "survey", created.id, { template: id, title });
    return json({ ok: true, survey: created }, 201);
  }

  // ── Dynamic questions (field app loads automatically) ───
  if (path === "/api/questions" && method === "GET") {
    if (!me) return json({ error: "Login required" }, 401);
    // Surveyors must get the survey they were assigned (Surveys tab / questions
    // screen), not the platform Field Survey default.
    if (me.role === "surveyor" || me.role === "field") {
      const items = await listAssignedSurveys(sql, Number(me.id));
      const first = items[0];
      if (!first) {
        return json({
          form_key: "",
          title: "No survey assigned",
          questions: [],
          surveys: [],
          updated_at: null,
        });
      }
      const totalQuestions = items.reduce(
        (n, s) => n + (Array.isArray(s.questions) ? s.questions.length : 0),
        0,
      );
      return json({
        ...first,
        surveys: items,
        surveys_count: items.length,
        questions_count: totalQuestions,
        require_geo: true,
        require_photo: true,
        require_audio: first.voice_required === true,
      });
    }
    try {
      const rows = await sql`
          SELECT form_key, title, questions, updated_at
          FROM survey_form WHERE form_key = 'default' LIMIT 1
        `;
      if (!rows.length) {
        return json({
          form_key: "default",
          title: "Field Survey",
          questions: DEFAULT_QUESTIONS,
          updated_at: null,
        });
      }
      const f = rows[0] as {
        form_key: string;
        title: string;
        questions: unknown;
        updated_at: string;
      };
      let questions = f.questions;
      if (typeof questions === "string") {
        try {
          questions = JSON.parse(questions);
        } catch {
          questions = DEFAULT_QUESTIONS;
        }
      }
      if (!Array.isArray(questions) || !questions.length) {
        questions = DEFAULT_QUESTIONS;
      }
      return json({
        form_key: f.form_key,
        title: f.title,
        questions,
        updated_at: f.updated_at,
        require_geo: true,
        require_photo: true,
        require_audio: false,
        voice_required: false,
      });
    } catch (e) {
      return json({
        form_key: "default",
        title: "Field Survey",
        questions: DEFAULT_QUESTIONS,
        require_geo: true,
        require_photo: true,
        require_audio: false,
        voice_required: false,
        warning: (e as Error).message,
      });
    }
  }

  // Admin saves platform default form (form_key=default / Field Survey).
  // Super Admin console only — Client Admin must edit their own surveys via PUT /api/surveys/:id.
  if (path === "/api/admin/questions" && method === "PUT") {
    if (!me) return json({ error: "Login required" }, 401);
    if (me.role !== "super_admin") {
      return json({
        error: "Super Admin only — Client Admin cannot edit the platform Field Survey. Edit your own survey under Surveys / Questions.",
      }, 403);
    }
    const body = await readBody(req);
    const title = String(body.title || "Field Survey");
    const questions = Array.isArray(body.questions) ? body.questions : DEFAULT_QUESTIONS;
    await sql`
        INSERT INTO survey_form (form_key, title, questions, updated_at)
        VALUES ('default', ${title}, ${JSON.stringify(questions)}::jsonb, NOW())
        ON CONFLICT (form_key) DO UPDATE
        SET title = EXCLUDED.title,
            questions = EXCLUDED.questions,
            updated_at = NOW()
      `;
    return json({ ok: true, title, questions, count: questions.length });
  }
  return null;
}
