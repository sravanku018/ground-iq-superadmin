import {
  sql,
} from "./db.ts";
import {
  parsePayload,
} from "./payload.ts";
import {
  adminFormKeyScope,
} from "./tenant.ts";
import {
  sqlBool,
} from "./users.ts";

/**
 * Append a platform audit-log entry (FR-AUD-01/02) — fire-and-forget so the
 * request path never slows down. Actor is the specific account (id + username),
 * never just the role.
 */
export function mapInboxRow(r: Record<string, unknown>) {
  const action = String(r.action || "");
  let meta: Record<string, unknown> = {};
  if (r.meta && typeof r.meta === "object") meta = r.meta as Record<string, unknown>;
  else if (typeof r.meta === "string") {
    try {
      meta = JSON.parse(r.meta) as Record<string, unknown>;
    } catch {
      meta = {};
    }
  }
  const fields = Array.isArray(meta.fields) ? (meta.fields as unknown[]).map(String) : [];
  const actorId = r.actor_id != null ? Number(r.actor_id) : null;
  const entityId = r.entity_id != null && String(r.entity_id) !== "" ? Number(r.entity_id) : null;
  const verified = sqlBool((r as { surveyor_verified?: unknown }).surveyor_verified);
  if (action === "web_submission_create") {
    const surveyTitle = String(meta.title || meta.form_key || "Web survey");
    const who = String(r.actor_name || "Web respondent").trim() || "Web respondent";
    return {
      id: `evt-${r.id}`,
      seq: Number(r.id) || 0,
      kind: "web",
      page: "review",
      source: "web",
      formKey: String(meta.form_key || "") || null,
      userId: null,
      submissionId: entityId,
      verified: false,
      title: `${surveyTitle} — pending web response`,
      detail: who,
      at: r.created_at,
    };
  }
  if (action === "profile_media") {
    return {
      id: `evt-${r.id}`,
      seq: Number(r.id) || 0,
      kind: "docs",
      page: "users",
      userId: entityId || actorId,
      submissionId: null,
      verified,
      title: `@${r.actor_name || "surveyor"} uploaded verification docs`,
      detail: fields.length ? fields.join(" · ") : "photo / Aadhaar",
      at: r.created_at,
    };
  }
  return {
    id: `evt-${r.id}`,
    seq: Number(r.id) || 0,
    kind: "activity",
    page: "review",
    userId: actorId,
    submissionId: entityId,
    verified,
    title: `New activity #${r.entity_id || ""}`.trim(),
    detail: String(r.actor_name || "surveyor"),
    at: r.created_at,
  };
}

export async function backfillWebSubmissionAudits(sqlFn: NonNullable<typeof sql>) {
  try {
    await sqlFn`
      INSERT INTO audit_log (actor_id, actor_name, actor_role, action, entity_type, entity_id, meta, created_at)
      SELECT
        COALESCE(x.created_by, 0),
        x.actor_name,
        'web',
        'web_submission_create',
        'submission',
        x.sid,
        jsonb_build_object(
          'form_key', x.form_key,
          'source', 'web-survey',
          'title', x.title
        ),
        x.created_at
      FROM (
        SELECT
          s.id::text AS sid,
          s.created_at,
          COALESCE(f.created_by, 0) AS created_by,
          LEFT(COALESCE(NULLIF(s.payload->>'submitted_by', ''), 'Web'), 80) AS actor_name,
          COALESCE(s.payload->>'form_key', '') AS form_key,
          COALESCE(f.title, s.payload->>'form_key', 'Web survey') AS title
        FROM submissions s
        LEFT JOIN survey_form f ON f.form_key = s.payload->>'form_key'
        WHERE COALESCE(s.payload->>'source', '') IN ('web-survey', 'web')
          AND COALESCE(s.payload->>'status', 'pending') NOT IN ('rejected')
          AND COALESCE(s.payload->>'draft', 'false') NOT IN ('true', 't', '1')
          AND NOT EXISTS (
            SELECT 1 FROM audit_log a
            WHERE a.action = 'web_submission_create'
              AND a.entity_id = s.id::text
          )
        ORDER BY s.id DESC
        LIMIT 80
      ) x
    `;
  } catch (e) {
    console.error("web inbox backfill:", (e as Error)?.message || e);
  }
}

export function isWebSource(src: unknown): boolean {
  const s = String(src || "").toLowerCase();
  return s === "web-survey" || s === "web";
}

export async function listPendingWebNotices(
  sqlFn: NonNullable<typeof sql>,
  admin: { id: unknown; role: unknown },
) {
  const isSuper = admin.role === "super_admin";
  const scopeKeys = isSuper
    ? null
    : await adminFormKeyScope(sqlFn, { role: "admin", id: Number(admin.id) });
  const rows = scopeKeys
    ? await sqlFn`
        SELECT s.id, s.created_at, s.payload, f.title
        FROM submissions s
        LEFT JOIN survey_form f ON f.form_key = s.payload->>'form_key'
        WHERE COALESCE(s.payload->>'source', '') IN ('web-survey', 'web')
          AND COALESCE(s.payload->>'status', 'pending') NOT IN ('confirmed', 'rejected')
          AND COALESCE(s.payload->>'draft', 'false') NOT IN ('true', 't', '1')
          AND COALESCE(s.payload->>'form_key', '') = ANY(${scopeKeys.length ? scopeKeys : ["__none__"]})
        ORDER BY s.id DESC
        LIMIT 40
      `.catch(() => [])
    : await sqlFn`
        SELECT s.id, s.created_at, s.payload, f.title
        FROM submissions s
        LEFT JOIN survey_form f ON f.form_key = s.payload->>'form_key'
        WHERE COALESCE(s.payload->>'source', '') IN ('web-survey', 'web')
          AND COALESCE(s.payload->>'status', 'pending') NOT IN ('confirmed', 'rejected')
          AND COALESCE(s.payload->>'draft', 'false') NOT IN ('true', 't', '1')
        ORDER BY s.id DESC
        LIMIT 40
      `.catch(() => []);
  return (rows as Record<string, unknown>[]).map((r) => {
    const payload = parsePayload(r.payload);
    const answers = (payload?.answers || {}) as Record<string, unknown>;
    const who = String(payload?.submitted_by || answers.data_collector || "Web respondent").trim() || "Web respondent";
    const title = String(r.title || payload?.form_key || "Web survey");
    return {
      id: `web-sub-${r.id}`,
      seq: Number(r.id) || 0,
      kind: "web",
      page: "review",
      source: "web",
      formKey: String(payload?.form_key || "") || null,
      userId: null,
      submissionId: Number(r.id) || null,
      verified: false,
      title: `${title} — pending web response`,
      detail: who,
      at: r.created_at,
    };
  });
}

export async function listAdminInbox(
  sqlFn: NonNullable<typeof sql>,
  admin: { id: unknown; role: unknown },
  afterId = 0,
) {
  const after = Math.max(0, Number(afterId) || 0);
  const isSuper = admin.role === "super_admin";
  const adminId = Number(admin.id);
  await backfillWebSubmissionAudits(sqlFn);
  const scopeKeys = isSuper
    ? null
    : await adminFormKeyScope(sqlFn, { role: "admin", id: adminId });
  const webKeys = scopeKeys && scopeKeys.length ? scopeKeys : ["__none__"];

  return await sqlFn`
    SELECT a.id, a.actor_id, a.actor_name, a.action, a.entity_type, a.entity_id, a.meta, a.created_at,
           COALESCE(u.verified, FALSE) AS surveyor_verified
    FROM audit_log a
    LEFT JOIN app_users u ON u.id = CASE
      WHEN a.action = 'profile_media' AND a.entity_id ~ '^[0-9]+$' THEN a.entity_id::int
      ELSE a.actor_id
    END
    WHERE (
        a.action = 'submission_create'
        OR a.action = 'web_submission_create'
        OR (${!isSuper} AND a.action = 'profile_media')
      )
      AND a.id > ${after}
      AND (
        ${isSuper}
        OR (
          a.action = 'web_submission_create'
          AND COALESCE(a.meta->>'form_key', '') = ANY(${webKeys})
        )
        OR (
          a.action <> 'web_submission_create'
          AND CASE
            WHEN a.action = 'profile_media' AND a.entity_id ~ '^[0-9]+$' THEN a.entity_id::int
            ELSE a.actor_id
          END IN (
            SELECT id FROM app_users
            WHERE role = 'surveyor'
              AND (
                created_by = ${adminId}
                OR company_id = (SELECT company_id FROM app_users WHERE id = ${adminId} AND company_id IS NOT NULL)
              )
          )
        )
      )
    ORDER BY a.id DESC
    LIMIT 50
  `.catch((e) => {
    // Never swallow silently again: this returning [] is what made a broken
    // audit_log look like "no notifications" instead of an error.
    console.error("admin inbox query failed:", (e as Error)?.message || e);
    return [];
  });
}

