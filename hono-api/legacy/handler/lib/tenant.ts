import {
  sql,
} from "./db.ts";
import {
  sqlCountN,
} from "./users.ts";
import {
  clampWebLinkMaxUses,
} from "./web-links.ts";

/**
 * BR-004 record-layer scope: the form_keys a Client Admin may read/write.
 * - Surveys they created (created_by)
 * - Explicit shares (survey_admin_access)
 * Super Admin / surveyors: unrestricted (null).
 * Never match company_name / company_id here — that is company-wide
 * auto-share with no grant event. Company share happens only as an
 * explicit Super Admin write of survey_admin_access rows at POST time.
 */
export async function adminFormKeyScope(
  sqlFn: NonNullable<typeof sql>,
  me: { role: unknown; id: unknown } | null,
): Promise<string[] | null> {
  if (!me || me.role !== "admin") return null;
  const adminId = Number(me.id);
  const rows = await sqlFn`
    SELECT form_key FROM survey_form
    WHERE created_by = ${adminId}
       OR id IN (SELECT survey_id FROM survey_admin_access WHERE admin_id = ${adminId})
       OR (company_name IS NOT NULL AND company_name <> '' AND LOWER(TRIM(company_name)) = LOWER(TRIM((SELECT company_name FROM app_users WHERE id = ${adminId}))))
       OR (company_id IS NOT NULL AND company_id = (SELECT company_id FROM app_users WHERE id = ${adminId}))
  `.catch(() => []);
  return [...new Set((rows as { form_key: string }[]).map((r) => String(r.form_key)))];
}

/** Tenant record total for Super Admin max_records: field + web, not rejected/draft. */
export async function countTenantRecords(
  sqlFn: NonNullable<typeof sql>,
  adminId: number,
): Promise<number> {
  const keys = await adminFormKeyScope(sqlFn, { role: "admin", id: adminId });
  if (!keys || !keys.length) return 0;
  const [row] = await sqlFn`
    SELECT COUNT(*)::int AS n
    FROM submissions
    WHERE payload->>'form_key' = ANY(${keys})
      AND COALESCE(payload->>'status', 'pending') <> 'rejected'
      AND COALESCE(payload->>'draft', 'false') NOT IN ('true', 't', '1')
      AND COALESCE(payload->'answers'->>'_draft', 'false') NOT IN ('true', 't', '1')
      AND COALESCE(payload->>'content_type', '') <> 'draft'
  `.catch(() => [{ n: 0 }]);
  return sqlCountN(row);
}

export async function countFieldRecords(
  sqlFn: NonNullable<typeof sql>,
  adminId: number,
): Promise<number> {
  const keys = await adminFormKeyScope(sqlFn, { role: "admin", id: adminId });
  if (!keys || !keys.length) return 0;
  const [row] = await sqlFn`
    SELECT COUNT(*)::int AS n
    FROM submissions
    WHERE payload->>'form_key' = ANY(${keys})
      AND COALESCE(payload->>'source', '') NOT IN ('web-survey', 'web')
      AND COALESCE(payload->>'status', 'pending') <> 'rejected'
      AND COALESCE(payload->>'draft', 'false') NOT IN ('true', 't', '1')
      AND COALESCE(payload->'answers'->>'_draft', 'false') NOT IN ('true', 't', '1')
      AND COALESCE(payload->>'content_type', '') <> 'draft'
  `.catch(() => [{ n: 0 }]);
  return sqlCountN(row);
}

export async function allocationSnapshot(
  sqlFn: NonNullable<typeof sql>,
  adminId: number,
): Promise<{
  max_records: number;
  field_used: number;
  web_reserved: number;
  field_remaining: number;
}> {
  const [capRow] = await sqlFn`
    SELECT COALESCE(max_records, 0) AS max_records FROM app_users WHERE id = ${adminId} LIMIT 1
  `.catch(() => [{ max_records: 0 }]);
  const maxRecords = Number((capRow as { max_records?: number })?.max_records) || 0;
  const fieldUsed = await countFieldRecords(sqlFn, adminId);
  const webReserved = await sumCanonicalWebCaps(sqlFn, adminId);
  const fieldRemaining = maxRecords > 0
    ? Math.max(0, maxRecords - fieldUsed - webReserved)
    : 0;
  return {
    max_records: maxRecords,
    field_used: fieldUsed,
    web_reserved: webReserved,
    field_remaining: fieldRemaining,
  };
}

/** Sum of each survey's canonical web-link max_uses (reserved from the 5,000 cap). */
export async function sumCanonicalWebCaps(
  sqlFn: NonNullable<typeof sql>,
  adminId: number,
): Promise<number> {
  const keys = await adminFormKeyScope(sqlFn, { role: "admin", id: adminId });
  if (!keys || !keys.length) return 0;
  const rows = await sqlFn`
    SELECT DISTINCT ON (form_key) max_uses
    FROM web_survey_links
    WHERE form_key = ANY(${keys})
    ORDER BY form_key, created_at ASC
  `.catch(() => []);
  let n = 0;
  for (const r of rows as { max_uses?: unknown }[]) {
    n += clampWebLinkMaxUses(r.max_uses);
  }
  return n;
}

