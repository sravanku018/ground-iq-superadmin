import type { Ctx } from "./ctx.ts";
import {
  logAudit,
} from "../lib/audit.ts";
import {
  sql,
} from "../lib/db.ts";
import {
  json,
  readBody,
} from "../lib/http.ts";

export async function handleCompanies(c: Ctx): Promise<Response | null> {
  const { req, path, method, me } = c;
  // ── Companies registry (Super Admin creates companies, adds Client Admins) ──
  if (path === "/api/companies" && method === "GET") {
    if (!me) return json({ error: "Login required" }, 401);
    if (me.role !== "super_admin") return json({ error: "Super Admin only" }, 403);
    const rows = await sql`
        SELECT c.id, c.name, c.created_at, c.created_by,
               COALESCE(u.display_name, u.username) AS created_by_name
        FROM companies c
        LEFT JOIN app_users u ON u.id = c.created_by
        ORDER BY c.name
      `.catch(() => []);
    const memberRows = await sql`
        SELECT u.company_id AS cid, u.id, u.username,
               COALESCE(u.display_name, u.username) AS name
        FROM app_users u
        WHERE u.company_id IS NOT NULL
        ORDER BY u.username
      `.catch(() => []);
    const memberMap = new Map<number, { id: number; username: string; name: string }[]>();
    for (const m of memberRows as { cid: number; id: number; username: string; name: string }[]) {
      const arr = memberMap.get(Number(m.cid)) || [];
      arr.push({ id: Number(m.id), username: String(m.username), name: String(m.name) });
      memberMap.set(Number(m.cid), arr);
    }
    const projectRows = await sql`
        SELECT LOWER(company_name) AS key, COUNT(*)::int AS n
        FROM survey_form
        WHERE company_name IS NOT NULL AND company_name <> ''
        GROUP BY LOWER(company_name)
      `.catch(() => []);
    const projectMap = new Map<string, number>();
    for (const p of projectRows as { key: string; n: number }[]) {
      projectMap.set(String(p.key), Number(p.n));
    }
    const items = (rows as Record<string, unknown>[]).map((c) => ({
      id: c.id,
      name: c.name,
      created_at: c.created_at,
      created_by_name: c.created_by_name || null,
      admins: memberMap.get(Number(c.id)) || [],
      admin_count: (memberMap.get(Number(c.id)) || []).length,
      project_count: projectMap.get(String(c.name).toLowerCase()) || 0,
    }));
    return json({ items, count: items.length });
  }

  if (path === "/api/companies" && method === "POST") {
    if (!me) return json({ error: "Login required" }, 401);
    if (me.role !== "super_admin") return json({ error: "Super Admin only" }, 403);
    const body = await readBody(req);
    const name = String(body.name || "").trim().slice(0, 160);
    if (!name) return json({ error: "Company name required" }, 400);
    const dup = await sql`SELECT id FROM companies WHERE LOWER(name) = LOWER(${name}) LIMIT 1`.catch(() => []);
    if (dup.length) return json({ error: `Company "${name}" already exists` }, 409);
    let rows;
    try {
      rows = await sql`
          INSERT INTO companies (name, created_by) VALUES (${name}, ${me.id})
          RETURNING id, name, created_at
        `;
    } catch (err) {
      const msg = (err as Error).message || "";
      if (msg.includes("unique") || msg.includes("duplicate")) {
        return json({ error: `Company "${name}" already exists` }, 409);
      }
      return json({ error: msg || "Could not create company" }, 500);
    }
    const c = rows[0] as { id: number; name: string; created_at: string } | undefined;
    if (!c) return json({ error: "Could not create company" }, 500);
    await sql`
        UPDATE app_users
        SET company_id = ${c.id}, company_name = ${c.name}
        WHERE LOWER(company_name) = LOWER(${c.name}) AND (company_id IS NULL OR company_id <> ${c.id})
      `.catch(() => null);
    logAudit(me, "company_create", "company", c.id, { name });
    return json({ company: c }, 201);
  }

  if (path.match(/^\/api\/companies\/\d+$/) && method === "PUT") {
    if (!me) return json({ error: "Login required" }, 401);
    if (me.role !== "super_admin") return json({ error: "Super Admin only" }, 403);
    const id = Number(path.split("/")[3]);
    const body = await readBody(req);
    const name = String(body.name || "").trim().slice(0, 160);
    if (!name) return json({ error: "Company name required" }, 400);
    const ex = await sql`SELECT id, name FROM companies WHERE id = ${id}`.catch(() => []);
    if (!ex.length) return json({ error: "Company not found" }, 404);
    const oldName = String((ex[0] as { name: string }).name);
    const dup = await sql`SELECT id FROM companies WHERE LOWER(name) = LOWER(${name}) AND id <> ${id} LIMIT 1`.catch(() => []);
    if (dup.length) return json({ error: `Company "${name}" already exists` }, 409);
    await sql`UPDATE companies SET name = ${name} WHERE id = ${id}`;
    // Keep member profiles in sync so the admin list/profile show the new name.
    await sql`UPDATE app_users SET company_name = ${name} WHERE company_id = ${id}`.catch(() => null);
    logAudit(me, "company_rename", "company", id, { from: oldName, to: name });
    return json({ ok: true, name });
  }

  if (path.match(/^\/api\/companies\/\d+$/) && method === "DELETE") {
    if (!me) return json({ error: "Login required" }, 401);
    if (me.role !== "super_admin") return json({ error: "Super Admin only" }, 403);
    const id = Number(path.split("/")[3]);
    const ex = await sql`SELECT id, name FROM companies WHERE id = ${id}`.catch(() => []);
    if (!ex.length) return json({ error: "Company not found" }, 404);
    const name = String((ex[0] as { name: string }).name);
    // Unlink member Client Admins; keep their profile name only if it differs.
    await sql`
        UPDATE app_users SET company_id = NULL,
          company_name = CASE WHEN company_name = ${name} THEN NULL ELSE company_name END
        WHERE company_id = ${id}
      `.catch(() => null);
    await sql`DELETE FROM companies WHERE id = ${id}`;
    logAudit(me, "company_delete", "company", id, { name });
    return json({ ok: true, deleted: true });
  }

  // Replace which Client Admins belong to a company (they become "part of it").
  if (path.match(/^\/api\/companies\/\d+\/admins$/) && method === "PUT") {
    if (!me) return json({ error: "Login required" }, 401);
    if (me.role !== "super_admin") return json({ error: "Super Admin only" }, 403);
    const id = Number(path.split("/")[3]);
    const body = await readBody(req);
    const company = await sql`SELECT id, name FROM companies WHERE id = ${id}`.catch(() => []);
    if (!company.length) return json({ error: "Company not found" }, 404);
    const companyName = String((company[0] as { name: string }).name);
    const requestedIds = [...new Set((Array.isArray(body.admin_ids) ? body.admin_ids : [])
      .map(Number)
      .filter((v: number) => Number.isFinite(v)))];
    if (requestedIds.length) {
      const valid = await sql`SELECT id FROM app_users WHERE role = 'admin' AND id = ANY(${requestedIds})`.catch(() => []);
      const validIds = new Set((valid as { id: number }[]).map((r) => Number(r.id)));
      if (validIds.size !== requestedIds.length) {
        return json({ error: "Only Client Admin accounts can be added to a company" }, 422);
      }
    }
    // Unlink everyone, then link the requested set (company_name stays in sync).
    await sql`
        UPDATE app_users SET company_id = NULL,
          company_name = CASE WHEN company_name = ${companyName} THEN NULL ELSE company_name END
        WHERE company_id = ${id}
      `.catch(() => null);
    if (requestedIds.length) {
      await sql`
          UPDATE app_users SET company_id = ${id}, company_name = ${companyName}
          WHERE id = ANY(${requestedIds})
        `.catch(() => null);
    }
    logAudit(me, "company_admins_update", "company", id, { admin_ids: requestedIds });
    return json({ ok: true, connected: requestedIds.length });
  }

  // ── Company Client Dashboard API ───────────────────────
  if (path.match(/^\/api\/companies\/([^/]+)\/dashboard$/) && method === "GET") {
    if (!me) return json({ error: "Login required" }, 401);
    if (me.role !== "super_admin") return json({ error: "Super Admin only" }, 403);

    const rawParam = decodeURIComponent(path.split("/")[3]);
    let company: { id: number; name: string; created_at: string } | undefined;

    if (/^\d+$/.test(rawParam)) {
      const rows = await sql`SELECT id, name, created_at FROM companies WHERE id = ${Number(rawParam)}`.catch(() => []);
      if (rows.length) company = rows[0] as { id: number; name: string; created_at: string };
    }
    if (!company) {
      const rows = await sql`SELECT id, name, created_at FROM companies WHERE LOWER(name) = LOWER(${rawParam}) LIMIT 1`.catch(() => []);
      if (rows.length) company = rows[0] as { id: number; name: string; created_at: string };
    }
    if (!company) {
      company = { id: 0, name: rawParam, created_at: new Date().toISOString() };
    }

    const companyId = Number(company.id);
    const companyName = String(company.name);

    // 1. Client Admins
    const admins = await sql`
        SELECT id, username, COALESCE(display_name, username) AS name, company_name, created_at, verified, active
        FROM app_users
        WHERE role = 'admin' AND (company_id = ${companyId} OR LOWER(company_name) = LOWER(${companyName}))
        ORDER BY username
      `.catch(() => []);

    const adminIds = (admins as { id: number }[]).map((a) => Number(a.id));

    // 2. Surveys / Projects under this company
    const surveyRows = await sql`
        SELECT DISTINCT s.id, s.form_key, s.title, s.questions, s.updated_at, s.created_by, s.company_name
        FROM survey_form s
        LEFT JOIN survey_admin_access a ON a.survey_id = s.id
        WHERE LOWER(s.company_name) = LOWER(${companyName})
           OR (cardinality(${adminIds}) > 0 AND (s.created_by = ANY(${adminIds}) OR a.admin_id = ANY(${adminIds})))
        ORDER BY s.title
      `.catch(() => []);

    const surveyIds = (surveyRows as { id: number }[]).map((s) => Number(s.id));

    // 3. Surveyors mapped to these projects / created by company's client admins
    const surveyors = await sql`
        SELECT DISTINCT u.id, u.username, COALESCE(u.display_name, u.username) AS name,
               u.phone, u.active, u.created_at, u.verified, u.target_quota,
               (SELECT COUNT(*)::int FROM submissions sub WHERE (sub.payload->>'submitted_by' = u.username OR sub.payload->>'surveyor_id' = u.id::text)) AS submission_count
        FROM app_users u
        LEFT JOIN survey_assignments sa ON sa.user_id = u.id
        WHERE (u.role IN ('surveyor', 'field'))
          AND (
            (cardinality(${adminIds}) > 0 AND u.created_by = ANY(${adminIds}))
            OR (cardinality(${surveyIds}) > 0 AND sa.survey_id = ANY(${surveyIds}))
          )
        ORDER BY u.username
      `.catch(() => []);

    // 4. Submissions & Geo Location Data
    const submissions = surveyIds.length
      ? await sql`
            SELECT id, survey_id, created_at, fact_status,
                   payload->>'submitted_by' AS submitted_by,
                   payload->'geo' AS geo,
                   payload->'answers'->>'district' AS district,
                   payload->'answers'->>'constituency' AS constituency,
                   payload->'answers' AS answers,
                   payload->>'latitude' AS latitude,
                   payload->>'longitude' AS longitude
            FROM submissions
            WHERE survey_id = ANY(${surveyIds})
            ORDER BY created_at DESC
            LIMIT 500
          `.catch(() => [])
      : [];

    let totalQuestions = 0;
    const projectsFormatted = (surveyRows as Record<string, unknown>[]).map((s) => {
      let qList: unknown[] = [];
      try {
        qList = typeof s.questions === "string" ? JSON.parse(s.questions) : (Array.isArray(s.questions) ? s.questions : []);
      } catch { qList = []; }
      totalQuestions += qList.length;
      return {
        id: Number(s.id),
        form_key: String(s.form_key || ""),
        title: String(s.title || ""),
        question_count: qList.length,
        questions: qList,
        updated_at: s.updated_at,
        created_by: s.created_by,
        company_name: s.company_name,
      };
    });

    const locations: Record<string, unknown>[] = [];
    const surveyTitleMap = new Map<number, string>();
    for (const p of projectsFormatted) {
      surveyTitleMap.set(p.id, p.title);
    }

    let confirmedCount = 0;
    let pendingCount = 0;

    for (const sub of submissions as Record<string, unknown>[]) {
      if (sub.fact_status === "materialized" || sub.fact_status === "confirmed") {
        confirmedCount++;
      } else {
        pendingCount++;
      }

      let lat: number | null = null;
      let lng: number | null = null;

      if (sub.latitude && sub.longitude) {
        lat = Number(sub.latitude);
        lng = Number(sub.longitude);
      } else if (sub.geo && typeof sub.geo === "object") {
        const g = sub.geo as Record<string, unknown>;
        lat = Number(g.lat || g.latitude);
        lng = Number(g.lng || g.longitude);
      } else if (sub.answers && typeof sub.answers === "object") {
        const a = sub.answers as Record<string, unknown>;
        if (a.latitude && a.longitude) {
          lat = Number(a.latitude);
          lng = Number(a.longitude);
        }
      }

      if (lat && lng && !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
        locations.push({
          id: Number(sub.id),
          survey_id: Number(sub.survey_id),
          survey_title: surveyTitleMap.get(Number(sub.survey_id)) || "Survey",
          lat,
          lng,
          submitted_by: sub.submitted_by || "Surveyor",
          district: sub.district || null,
          constituency: sub.constituency || null,
          created_at: sub.created_at,
        });
      }
    }

    return json({
      company: {
        id: companyId,
        name: companyName,
        created_at: company.created_at,
      },
      summary: {
        total_admins: (admins as unknown[]).length,
        total_projects: projectsFormatted.length,
        total_questions: totalQuestions,
        total_surveyors: (surveyors as unknown[]).length,
        total_submissions: (submissions as unknown[]).length,
        total_locations: locations.length,
        confirmed_qa: confirmedCount,
        pending_qa: pendingCount,
      },
      admins,
      projects: projectsFormatted,
      surveyors,
      locations,
      qa_stats: {
        confirmed: confirmedCount,
        pending: pendingCount,
        total: (submissions as unknown[]).length,
      },
    });
  }
  return null;
}
