import {
  sql,
} from "./db.ts";
import {
  sqlCountN,
} from "./users.ts";

// Count finished records for one surveyor (by user_id or username/name).
// Excludes drafts and rejected rows so targets reflect real completed work.
export async function countDoneByFormKeyForUser(u: {
  id: number;
  username: string;
  name?: string;
  display_name?: string;
}): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!sql) return map;
  const uid = String(u.id);
  const uname = u.username;
  const dname = u.name || u.display_name || uname;
  const rows = await sql`
        SELECT COALESCE(NULLIF(payload->>'form_key', ''), payload->>'formKey', '') AS form_key,
               COUNT(*)::int AS n
        FROM submissions
        WHERE (
             payload->>'user_id' = ${uid}
          OR payload->>'submitted_by' = ${uname}
          OR payload->>'submitted_by' = ${dname}
          OR payload->'answers'->>'data_collector' = ${uname}
          OR payload->'answers'->>'data_collector' = ${dname}
        )
          AND COALESCE(payload->>'source', '') NOT IN ('web-survey', 'web')
          AND COALESCE(payload->>'status', 'pending') <> 'rejected'
          AND COALESCE(payload->>'draft', 'false') NOT IN ('true', 't', '1')
          AND COALESCE(payload->'answers'->>'_draft', 'false') NOT IN ('true', 't', '1')
          AND COALESCE(payload->'answers'->>'draft', 'false') NOT IN ('true', 't', '1')
          AND COALESCE(payload->>'content_type', '') <> 'draft'
        GROUP BY 1
      `.catch(() => []);
  for (const r of rows as { form_key?: string; n?: number }[]) {
    map.set(String(r.form_key || ""), sqlCountN(r));
  }
  return map;
}

export async function countDoneForUser(u: {
  id: number;
  username: string;
  name?: string;
  display_name?: string;
}) {
  const byKey = await countDoneByFormKeyForUser(u);
  let n = 0;
  for (const v of byKey.values()) n += v;
  return n;
}

/**
 * Records a Client Admin has actually confirmed. `done` (above) counts pending
 * too, so it never moves when an admin confirms — the surveyor notification
 * must watch this number instead.
 */
export async function countConfirmedForUser(u: {
  id: number;
  username: string;
  name?: string;
  display_name?: string;
}): Promise<number> {
  if (!sql) return 0;
  const uid = String(u.id);
  const uname = u.username;
  const dname = u.name || u.display_name || uname;
  const rows = await sql`
        SELECT COUNT(*)::int AS n
        FROM submissions
        WHERE (
             payload->>'user_id' = ${uid}
          OR payload->>'submitted_by' = ${uname}
          OR payload->>'submitted_by' = ${dname}
          OR payload->'answers'->>'data_collector' = ${uname}
          OR payload->'answers'->>'data_collector' = ${dname}
        )
          AND COALESCE(payload->>'source', '') NOT IN ('web-survey', 'web')
          AND payload->>'status' = 'confirmed'
          AND COALESCE(payload->>'draft', 'false') NOT IN ('true', 't', '1')
          AND COALESCE(payload->'answers'->>'_draft', 'false') NOT IN ('true', 't', '1')
          AND COALESCE(payload->'answers'->>'draft', 'false') NOT IN ('true', 't', '1')
          AND COALESCE(payload->>'content_type', '') <> 'draft'
      `.catch(() => []);
  return rows.length ? Number((rows[0] as { n?: number }).n) || 0 : 0;
}

export function progressStatus(done: number, target: number) {
  if (!target || target <= 0) {
    return done > 0 ? "in_progress" : "no_target";
  }
  if (done >= target) return "completed";
  if (done > 0) return "in_progress";
  return "not_started";
}

