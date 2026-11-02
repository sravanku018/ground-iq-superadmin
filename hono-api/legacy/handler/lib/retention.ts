/**
 * Retention sweep — keeps local operational tables from growing forever.
 *
 * Runs from the in-process job worker (no extra cron): once at boot, then at
 * most once every 6 hours. Errors are swallowed per statement so one missing
 * table never blocks the others.
 */
import { sql } from "./db.ts";
import { deleteR2Object } from "./r2-media.ts";

const SWEEP_INTERVAL_MS = 6 * 60 * 60_000;
let lastSweep = 0;

/**
 * Presigned PUT proves nothing until /complete runs. Anything still pending
 * after 24h is an abandoned upload: delete the R2 object, then the row.
 * A confirmed survey_media row always wins — never delete its bytes.
 */
async function sweepOrphanMedia(): Promise<void> {
  const stale = await sql`
      SELECT key FROM pending_media
      WHERE created_at < NOW() - INTERVAL '24 hours'
      ORDER BY created_at
      LIMIT 200
    `.catch(() => null);
  if (stale === null) return;
  for (const row of stale as { key?: string }[]) {
    const key = String(row.key || "");
    if (!key) continue;
    const confirmed = await sql`
        SELECT 1 FROM survey_media WHERE meta->>'key' = ${key} LIMIT 1
      `.catch(() => null);
    if (confirmed === null) continue; // DB uncertain: never delete bytes
    if (!confirmed.length) {
      const deleted = await deleteR2Object(key);
      if (!deleted) continue; // R2 failure: retry on the next sweep
    }
    await sql`DELETE FROM pending_media WHERE key = ${key}`.catch(() => null);
  }
}

export async function runRetentionSweep(force = false): Promise<void> {
  const now = Date.now();
  if (!force && lastSweep && now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;

  // Error reports: 30 days is enough to spot a regression, and keeps the
  // table small enough to scan from the Super Admin console.
  await sql`
      DELETE FROM client_errors
      WHERE created_at < NOW() - INTERVAL '30 days'
    `.catch(() => null);

  // Sessions are already invalid after expires_at; keep a week for audit.
  await sql`
      DELETE FROM app_sessions
      WHERE expires_at < NOW() - INTERVAL '7 days'
    `.catch(() => null);

  // Finished jobs are history, not work.
  await sql`
      DELETE FROM jobs
      WHERE status IN ('done', 'failed')
        AND updated_at < NOW() - INTERVAL '30 days'
    `.catch(() => null);

  // Traffic rollups are only needed for the current migration window.
  await sql`
      DELETE FROM app_traffic
      WHERE day < CURRENT_DATE - INTERVAL '90 days'
    `.catch(() => null);

  await sweepOrphanMedia();
}
