/**
 * Retention sweep — keeps local operational tables from growing forever.
 *
 * Runs from the in-process job worker (no extra cron): once at boot, then at
 * most once every 6 hours. Errors are swallowed per statement so one missing
 * table never blocks the others.
 */
import { sql } from "./db.ts";

const SWEEP_INTERVAL_MS = 6 * 60 * 60_000;
let lastSweep = 0;

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
}
