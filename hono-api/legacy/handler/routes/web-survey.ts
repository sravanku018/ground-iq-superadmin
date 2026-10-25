import type { Ctx } from "./ctx.ts";
import {
  surveyDisplayLang,
} from "../lib/analytics/answers.ts";
import {
  logAudit,
} from "../lib/audit.ts";
import {
  insertSubmissionRow,
  sql,
} from "../lib/db.ts";
import {
  stripPii,
} from "../lib/defaults.ts";
import {
  json,
  readBody,
} from "../lib/http.ts";
import {
  checkRateLimit,
} from "../lib/rate-limit.ts";
import {
  hasPower,
} from "../lib/survey-assignments.ts";
import {
  adminFormKeyScope,
  allocationSnapshot,
  countTenantRecords,
} from "../lib/tenant.ts";
import {
  isPortalAdmin,
  sqlCountN,
} from "../lib/users.ts";
import {
  parseQuestionsArray,
} from "../lib/util.ts";
import {
  clampWebLinkMaxUses,
  ensureCanonicalWebLink,
  mapWebLinkRow,
  publicWebFillUrl,
  webLinkExpired,
  webLinkSpent,
} from "../lib/web-links.ts";

export async function handleWebSurvey(c: Ctx): Promise<Response | null> {
  const { req, url, path, method, me } = c;
  if (path === "/api/web-survey/link" && method === "POST") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    if (!hasPower(me, "can_web_survey")) {
      return json({ error: "Super Admin has not granted Web survey permission" }, 403);
    }
    const body = await readBody(req);
    const formKey = String(body.form_key || body.form_id || "").trim();
    if (!formKey || formKey === "default" || formKey === "legacy") {
      return json({ error: "Pick a real survey" }, 400);
    }
    if (me.role === "admin") {
      const writeScope = await adminFormKeyScope(sql, me);
      if (writeScope && !writeScope.includes(formKey)) {
        return json({ error: "You can only create links for your own surveys" }, 403);
      }
    }
    const exists = await sql`
        SELECT form_key, title, ended_at FROM survey_form WHERE form_key = ${formKey} LIMIT 1
      `.catch(() => []);
    if (!exists.length) return json({ error: "Survey not found" }, 404);
    if ((exists[0] as { ended_at?: unknown }).ended_at) {
      return json({
        error: "This survey has ended. The web link is expired and a new one cannot be created.",
        ended: true,
        form_key: formKey,
      }, 410);
    }
    const surveyTitle = String((exists[0] as { title?: string }).title || formKey);
    const maxUses = clampWebLinkMaxUses(body.max_uses ?? body.maxUses ?? body.limit);
    let link = await ensureCanonicalWebLink(formKey, Number(me.id), maxUses);
    if (!link) return json({ error: "Could not create web link" }, 500);
    if (link.expired) {
      const snap0 = me.role === "admin" ? await allocationSnapshot(sql, Number(me.id)) : null;
      const deactivated = Boolean(link.used_at) && link.use_count < link.max_uses;
      return json({
        error: deactivated
          ? "This web link was deactivated by Super Admin. A new link cannot be created."
          : "Web target reached — sharing is disabled for this survey",
        expired: true,
        deactivated,
        token: link.token,
        form_key: formKey,
        title: surveyTitle,
        max_uses: link.max_uses,
        use_count: link.use_count,
        ...(snap0 || {}),
      }, 410);
    }
    const nextMax = Math.max(link.use_count, maxUses);
    if (me.role === "admin") {
      const snap = await allocationSnapshot(sql, Number(me.id));
      const nextReserved = snap.web_reserved - link.max_uses + nextMax;
      if (snap.max_records > 0 && snap.field_used + nextReserved > snap.max_records) {
        const room = Math.max(0, snap.max_records - snap.field_used - (snap.web_reserved - link.max_uses));
        return json({
          error: `Not enough allocation. ${room} remaining for this web quota (${snap.max_records} − ${snap.field_used} field − other web reserved).`,
          code: "max_records",
          ...snap,
          room,
        }, 422);
      }
    }
    if (nextMax !== link.max_uses) {
      await sql`
          UPDATE web_survey_links SET max_uses = ${nextMax}
          WHERE token = ${link.token}
        `.catch(() => null);
      link = { ...link, max_uses: nextMax };
    }
    const snap = me.role === "admin" ? await allocationSnapshot(sql, Number(me.id)) : null;
    return json({
      ok: true,
      token: link.token,
      form_key: formKey,
      title: surveyTitle,
      url: publicWebFillUrl(formKey, link.token),
      max_uses: link.max_uses,
      use_count: link.use_count,
      starts_at: link.created_at || null,
      created_at: link.created_at || null,
      ended_at: link.used_at || null,
      used_at: link.used_at || null,
      reused: true,
      ...(snap || {}),
    });
  }

  if (path === "/api/web-survey/link" && method === "DELETE") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    const formKey = String(url.searchParams.get("form_key") || "").trim();
    if (!formKey) return json({ error: "form_key required" }, 400);
    if (me.role === "admin") {
      const writeScope = await adminFormKeyScope(sql, me);
      if (writeScope && !writeScope.includes(formKey)) {
        return json({ error: "You can only delete links for your own surveys" }, 403);
      }
    }
    await sql`DELETE FROM web_survey_links WHERE form_key = ${formKey}`.catch(() => null);
    return json({ ok: true, message: "Web link deleted" });
  }

  if (path === "/api/web-survey/link" && method === "PATCH") {
    if (!me) return json({ error: "Login required" }, 401);
    if (me.role !== "super_admin") {
      return json({ error: "Super Admin only — Client Admin cannot deactivate web links" }, 403);
    }
    if (!hasPower(me, "can_web_survey")) {
      return json({ error: "Super Admin has not granted Web survey permission" }, 403);
    }
    const body = await readBody(req);
    const formKey = String(body.form_key || url.searchParams.get("form_key") || "").trim();
    if (!formKey || formKey === "default" || formKey === "legacy") {
      return json({ error: "form_key required" }, 400);
    }
    if (me.role === "admin") {
      const writeScope = await adminFormKeyScope(sql, me);
      if (writeScope && !writeScope.includes(formKey)) {
        return json({ error: "You can only deactivate links for your own surveys" }, 403);
      }
    }
    const active = body.active;
    if (active === false || body.deactivate === true) {
      const closed = await sql`
          UPDATE web_survey_links
          SET used_at = NOW()
          WHERE form_key = ${formKey}
            AND used_at IS NULL
            AND use_count < max_uses
          RETURNING token, form_key, max_uses, use_count, used_at, created_at
        `.catch(() => []);
      if (!closed.length) {
        return json({ error: "No active web link for this survey" }, 404);
      }
      const row = mapWebLinkRow(closed[0] as Record<string, unknown>);
      logAudit(me, "web_link_deactivate", "web_survey_link", formKey, {
        token: row.token,
        use_count: row.use_count,
        max_uses: row.max_uses,
      });
      const titleRows = await sql`
          SELECT title FROM survey_form WHERE form_key = ${formKey} LIMIT 1
        `.catch(() => []);
      const surveyTitle = String((titleRows[0] as { title?: string } | undefined)?.title || formKey);
      return json({
        ok: true,
        deactivated: true,
        form_key: formKey,
        title: surveyTitle,
        token: row.token,
        used_at: row.used_at,
        ended_at: row.used_at,
      });
    }
    return json({ error: "Set active=false to deactivate" }, 400);
  }

  if (path === "/api/web-survey/links" && method === "GET") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    if (!hasPower(me, "can_web_survey")) {
      return json({ error: "Super Admin has not granted Web survey permission" }, 403);
    }
    const formKey = String(url.searchParams.get("form_key") || "").trim();
    if (!formKey) {
      const scopeKeys = await adminFormKeyScope(sql, me);
      const liveRows = scopeKeys
        ? await sql`
              SELECT DISTINCT ON (l.form_key)
                l.token, l.form_key, l.max_uses, l.use_count, l.used_at, l.created_at,
                f.title, f.company_name,
                COALESCE(u.display_name, u.username) AS owner_name
              FROM web_survey_links l
              JOIN survey_form f ON f.form_key = l.form_key
              LEFT JOIN app_users u ON u.id = f.created_by
              WHERE l.form_key = ANY(${scopeKeys})
                AND f.form_key NOT IN ('default', 'legacy')
                AND l.used_at IS NULL
                AND l.use_count < l.max_uses
              ORDER BY l.form_key, l.created_at ASC
            `.catch(() => [])
        : await sql`
              SELECT DISTINCT ON (l.form_key)
                l.token, l.form_key, l.max_uses, l.use_count, l.used_at, l.created_at,
                f.title, f.company_name,
                COALESCE(u.display_name, u.username) AS owner_name
              FROM web_survey_links l
              JOIN survey_form f ON f.form_key = l.form_key
              LEFT JOIN app_users u ON u.id = f.created_by
              WHERE f.form_key NOT IN ('default', 'legacy')
                AND l.used_at IS NULL
                AND l.use_count < l.max_uses
              ORDER BY l.form_key, l.created_at ASC
            `.catch(() => []);
      const items = (liveRows as Record<string, unknown>[]).map((r) => {
        const row = mapWebLinkRow(r);
        const title = String(r.title || row.form_key);
        return {
          ...row,
          title,
          company_name: r.company_name ? String(r.company_name) : null,
          owner_name: r.owner_name ? String(r.owner_name) : null,
          remaining: Math.max(0, row.max_uses - row.use_count),
          url: publicWebFillUrl(row.form_key, row.token),
          live: true,
          starts_at: row.created_at,
          ended_at: null,
        };
      });
      return json({ items, count: items.length });
    }
    if (formKey === "default" || formKey === "legacy") {
      return json({ error: "Pick a real survey" }, 400);
    }
    if (me.role === "admin") {
      const writeScope = await adminFormKeyScope(sql, me);
      if (writeScope && !writeScope.includes(formKey)) {
        return json({ error: "You can only view links for your own surveys" }, 403);
      }
    }
    const rows = await sql`
        SELECT token, form_key, max_uses, use_count, used_at, created_at
        FROM web_survey_links
        WHERE form_key = ${formKey}
        ORDER BY created_at DESC
        LIMIT 40
      `.catch(() => []);
    const items = (rows as Record<string, unknown>[]).map((r) => {
      const max = clampWebLinkMaxUses(r.max_uses);
      const used = Math.max(0, Number(r.use_count) || 0);
      const expired = Boolean(r.used_at) || used >= max;
      const deactivated = Boolean(r.used_at) && used < max;
      return {
        token: r.token,
        form_key: r.form_key,
        max_uses: max,
        use_count: used,
        remaining: Math.max(0, max - used),
        expired,
        deactivated,
        starts_at: r.created_at || null,
        created_at: r.created_at || null,
        ended_at: r.used_at || null,
        used_at: r.used_at || null,
      };
    });
    const titleRows = await sql`
        SELECT title, ended_at FROM survey_form WHERE form_key = ${formKey} LIMIT 1
      `.catch(() => []);
    const surveyTitle = String((titleRows[0] as { title?: string } | undefined)?.title || formKey);
    const surveyEnded = Boolean((titleRows[0] as { ended_at?: unknown } | undefined)?.ended_at);
    const liveRow = items.find((x) => !x.expired) || null;
    const latest = items[0] || null;
    const share = liveRow || latest;
    const [subRow] = await sql`
        SELECT COUNT(*)::int AS n FROM submissions
        WHERE payload->>'form_key' = ${formKey}
          AND (
            payload->>'source' = 'web-survey'
            OR payload->>'source' = 'web'
          )
          AND COALESCE(payload->>'status', 'pending') <> 'rejected'
          AND COALESCE(payload->>'draft', 'false') NOT IN ('true', 't', '1')
      `.catch(() => [{ n: 0 }]);
    const submitted = sqlCountN(subRow);
    const cap = share ? clampWebLinkMaxUses(share.max_uses) : 100;
    const rawUsed = share ? Number(share.use_count) || 0 : 0;
    const effectiveUsed = Math.max(submitted, rawUsed);
    const expired = share ? Boolean(share.expired) || effectiveUsed >= cap : false;
    const snap = me.role === "admin" ? await allocationSnapshot(sql, Number(me.id)) : null;
    const deactivated = Boolean(share?.deactivated) || (Boolean(share?.used_at) && effectiveUsed < cap);
    return json({
      items,
      live: liveRow && !surveyEnded ? {
        ...liveRow,
        url: publicWebFillUrl(formKey, String(liveRow.token || "")),
        use_count: effectiveUsed,
        expired: false,
        deactivated: false,
        starts_at: liveRow.created_at || null,
        created_at: liveRow.created_at || null,
        ended_at: liveRow.used_at || null,
        used_at: liveRow.used_at || null,
      } : null,
      latest: share ? {
        ...share,
        url: publicWebFillUrl(formKey, String(share.token || "")),
        use_count: Math.max(effectiveUsed, Number(share.use_count) || 0),
        expired: expired || surveyEnded || deactivated,
        deactivated: deactivated || surveyEnded,
        starts_at: share.created_at || null,
        created_at: share.created_at || null,
        ended_at: share.used_at || null,
        used_at: share.used_at || null,
      } : null,
      title: surveyTitle,
      submitted: effectiveUsed,
      cap,
      link_used: effectiveUsed,
      used: effectiveUsed,
      expired: expired || surveyEnded,
      deactivated: deactivated || surveyEnded,
      survey_ended: surveyEnded,
      sharing_disabled: expired || deactivated || surveyEnded,
      ...(snap || {}),
    });
  }

  if (path === "/api/web-survey/stats" && method === "GET") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    const scopeKeys = await adminFormKeyScope(sql, me);
    const forms = scopeKeys
      ? await sql`
            SELECT id, form_key, title FROM survey_form
            WHERE form_key = ANY(${scopeKeys})
              AND form_key NOT IN ('default', 'legacy')
            ORDER BY title
          `.catch(() => [])
      : await sql`
            SELECT id, form_key, title FROM survey_form
            WHERE form_key NOT IN ('default', 'legacy')
            ORDER BY title
          `.catch(() => []);
    const keys = (forms as { form_key: string }[]).map((f) => String(f.form_key));
    const keySet = new Set(keys);
    // Group all web fills in SQL, then keep this admin's surveys in JS.
    // Avoid ANY(${keys}) — the neon driver has dropped that list on some deploys.
    const counts = await sql`
        SELECT payload->>'form_key' AS form_key, COUNT(*)::int AS n
        FROM submissions
        WHERE (
          payload->>'source' = 'web-survey'
          OR payload->>'source' = 'web'
        )
          AND COALESCE(payload->>'status', 'pending') <> 'rejected'
          AND COALESCE(payload->>'draft', 'false') NOT IN ('true', 't', '1')
        GROUP BY 1
      `.catch(() => []);
    const countMap = new Map<string, number>();
    for (const r of counts as { form_key?: string; n?: number }[]) {
      const k = String(r.form_key || "");
      if (keySet.size && !keySet.has(k)) continue;
      countMap.set(k, Number(r.n) || 0);
    }
    const liveRows = keys.length
      ? await sql`
            SELECT DISTINCT ON (form_key) form_key, token, max_uses, use_count, used_at, created_at
            FROM web_survey_links
            WHERE form_key = ANY(${keys})
            ORDER BY form_key,
              CASE WHEN used_at IS NULL AND use_count < max_uses THEN 0 ELSE 1 END,
              created_at ASC
          `.catch(() => [])
      : [];
    const liveMap = new Map<string, {
      max_uses: number;
      use_count: number;
      expired: boolean;
      created_at: unknown;
      used_at: unknown;
    }>();
    for (const r of liveRows as Record<string, unknown>[]) {
      const max = clampWebLinkMaxUses(r.max_uses);
      const used = Math.max(0, Number(r.use_count) || 0);
      liveMap.set(String(r.form_key || ""), {
        max_uses: max,
        use_count: used,
        expired: Boolean(r.used_at) || used >= max,
        created_at: r.created_at || null,
        used_at: r.used_at || null,
      });
    }
    const items = (forms as { id: number; form_key: string; title: string }[]).map((f) => {
      const key = String(f.form_key);
      const live = liveMap.get(key);
      const submitted = countMap.get(key) || 0;
      const hasLink = Boolean(live);
      const cap = live ? live.max_uses : null;
      const linkUsed = live ? live.use_count : 0;
      const effectiveUsed = Math.max(submitted, linkUsed);
      const expired = live ? Boolean(live.expired) || (cap != null && effectiveUsed >= cap) : false;
      return {
        id: f.id,
        form_key: key,
        title: f.title || key,
        has_link: hasLink,
        submitted,
        used: effectiveUsed,
        link_used: hasLink ? effectiveUsed : 0,
        cap,
        remaining: cap != null ? Math.max(0, cap - effectiveUsed) : null,
        expired,
        created_at: live?.created_at || null,
        ended_at: live?.used_at || null,
      };
    });
    return json({ items });
  }

  if (path === "/api/web-survey" && method === "GET") {
    const formKey = String(url.searchParams.get("form_key") || "").trim();
    const token = String(url.searchParams.get("k") || url.searchParams.get("token") || "").trim();
    if (!formKey || formKey === "default" || formKey === "legacy") {
      return json({ error: "Unknown survey" }, 404);
    }
    if (!token) return webLinkExpired();
    const linkRows = await sql`
        SELECT token, form_key, used_at, max_uses, use_count FROM web_survey_links
        WHERE token = ${token}
        LIMIT 1
      `.catch(() => []);
    if (!linkRows.length) return webLinkExpired();
    const link = linkRows[0] as {
      token: string;
      form_key: string;
      used_at: string | null;
      max_uses?: number;
      use_count?: number;
    };
    if (String(link.form_key) !== formKey) return webLinkExpired();
    const rows = await sql`
        SELECT form_key, title, display_lang, questions, ended_at
        FROM survey_form
        WHERE form_key = ${formKey}
        LIMIT 1
      `.catch(() => []);
    if (!rows.length) return json({ error: "Survey not found" }, 404);
    const f = rows[0] as {
      form_key: string;
      title: string;
      display_lang?: string;
      questions: unknown;
      ended_at?: unknown;
    };
    if (f.ended_at) {
      return webLinkExpired({ title: f.title, form_key: f.form_key, ended: true });
    }
    if (webLinkSpent(link)) {
      return webLinkExpired({ title: f.title, form_key: f.form_key });
    }
    const questions = parseQuestionsArray(f.questions);
    return json({
      form_key: f.form_key,
      title: f.title,
      display_lang: surveyDisplayLang(f.display_lang),
      questions,
      max_uses: clampWebLinkMaxUses(link.max_uses),
      use_count: Math.max(0, Number(link.use_count) || 0),
    });
  }

  if (path === "/api/web-survey/public" && method === "POST") {
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "unknown";
    if (!checkRateLimit(`web:${ip}`)) {
      return json({ error: "Too many submissions. Try again in a minute." }, 429);
    }
    const body = await readBody(req);
    const answers = (body.answers || {}) as Record<string, unknown>;
    const agent = String(body.submitted_by || body.name || "Web").trim().slice(0, 120) || "Web";
    const formKey = String(body.form_key || body.form_id || "").trim();
    const token = String(body.token || body.k || "").trim();
    if (!formKey || formKey === "default" || formKey === "legacy") {
      return json({ error: "Unknown survey" }, 400);
    }
    if (!token) return webLinkExpired();
    const claimed = await sql`
        UPDATE web_survey_links
        SET
          use_count = use_count + 1,
          used_at = CASE WHEN use_count + 1 >= max_uses THEN NOW() ELSE used_at END
        WHERE token = ${token}
          AND form_key = ${formKey}
          AND use_count < max_uses
        RETURNING token, form_key, use_count, max_uses, used_at
      `.catch(() => []);
    if (!claimed.length) return webLinkExpired();
    const slot = claimed[0] as {
      use_count: number;
      max_uses: number;
      used_at: string | null;
    };
    const useCount = Math.max(0, Number(slot.use_count) || 0);
    const maxUses = clampWebLinkMaxUses(slot.max_uses);
    const remaining = Math.max(0, maxUses - useCount);
    const expired = remaining === 0 || Boolean(slot.used_at);
    const exists = await sql`
        SELECT form_key, title, created_by, ended_at FROM survey_form WHERE form_key = ${formKey} LIMIT 1
      `.catch(() => []);
    if (!exists.length) return json({ error: "Survey not found" }, 404);
    if ((exists[0] as { ended_at?: unknown }).ended_at) {
      return webLinkExpired({
        title: String((exists[0] as { title?: string }).title || formKey),
        form_key: formKey,
        ended: true,
      });
    }
    const ownerId = Number((exists[0] as { created_by?: number }).created_by);
    const surveyTitle = String((exists[0] as { title?: string }).title || formKey);
    if (Number.isFinite(ownerId)) {
      const [capRow] = await sql`
          SELECT COALESCE(max_records, 0) AS max_records FROM app_users WHERE id = ${ownerId} LIMIT 1
        `.catch(() => [{ max_records: 0 }]);
      const maxRec = Number((capRow as { max_records?: number })?.max_records) || 0;
      if (maxRec > 0) {
        const used = await countTenantRecords(sql, ownerId);
        if (used >= maxRec) {
          return json({
            error: `Record limit reached — maximum ${maxRec} records for this account.`,
            code: "max_records",
            used,
            max_records: maxRec,
          }, 422);
        }
      }
    }
    const payload = {
      form_key: formKey,
      form_id: formKey,
      source: "web-survey",
      submitted_by: agent,
      user_id: null,
      user_role: "web",
      status: "pending",
      geo: null,
      location_details: null,
      locks: { geo: false, web: true },
      has_photo: false,
      has_audio: false,
      answers: stripPii({ ...answers, data_collector: agent }),
      content_type: "qa",
      web_link_token: token,
    };
    const rows = await insertSubmissionRow(payload);
    const row = rows[0] as { id: number; created_at: string };
    await sql`
        UPDATE web_survey_links SET submission_id = ${row.id} WHERE token = ${token}
      `.catch(() => []);
    logAudit(
      {
        id: Number.isFinite(ownerId) ? ownerId : 0,
        username: agent.slice(0, 80) || "Web",
        role: "web",
      },
      "web_submission_create",
      "submission",
      row.id,
      { form_key: formKey, source: "web-survey", title: surveyTitle },
    );
    return json({
      ok: true,
      id: row.id,
      status: "pending",
      created_at: row.created_at,
      max_uses: maxUses,
      use_count: useCount,
      remaining,
      expired,
    }, 201);
  }

  if (path === "/api/web-survey" && method === "POST") {
    return json({
      error: "Submitting web surveys from inside the Admin portal is disabled. Web surveys must be submitted by respondents via public survey links.",
    }, 403);
  }
  return null;
}
