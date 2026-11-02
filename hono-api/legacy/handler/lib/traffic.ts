/**
 * Lightweight API traffic accounting — which hostname and app version are
 * calling us. Used to decide when the legacy sslip.io host can be retired.
 *
 * Counts are batched in memory and flushed by the job worker every tick, so a
 * request never waits on a database write. A failed flush merges the counts
 * back into the buffer for the next attempt.
 */
import { sql } from "./db.ts";

type Bucket = { host: string; version: string; n: number; last: number };

const buckets = new Map<string, Bucket>();

/** Normalize the public host (Caddy forwards the original Host). */
export function requestHost(req: Request): string {
  try {
    const raw = req.headers.get("x-forwarded-host") || req.headers.get("host") ||
      new URL(req.url).hostname;
    return String(raw).split(",")[0].trim().split(":")[0].slice(0, 120) || "unknown";
  } catch {
    return "unknown";
  }
}

/** New clients send X-App-Version; old APKs fall back to "unknown". */
export function requestAppVersion(req: Request): string {
  return (req.headers.get("x-app-version") || "unknown").trim().slice(0, 40) || "unknown";
}

export function recordTraffic(req: Request): void {
  try {
    const host = requestHost(req);
    const version = requestAppVersion(req);
    const key = `${host}|${version}`;
    const now = Date.now();
    const b = buckets.get(key) || { host, version, n: 0, last: now };
    b.n += 1;
    b.last = now;
    buckets.set(key, b);
  } catch {
    /* traffic accounting must never break a request */
  }
}

export async function flushTraffic(): Promise<void> {
  if (!buckets.size) return;
  const entries = [...buckets.values()];
  buckets.clear();
  const day = new Date().toISOString().slice(0, 10);
  for (const b of entries) {
    try {
      await sql`
          INSERT INTO app_traffic (day, host, app_version, requests, last_seen)
          VALUES (${day}::date, ${b.host}, ${b.version}, ${b.n}, to_timestamp(${b.last / 1000}))
          ON CONFLICT (day, host, app_version) DO UPDATE SET
            requests = app_traffic.requests + EXCLUDED.requests,
            last_seen = GREATEST(app_traffic.last_seen, EXCLUDED.last_seen)
        `;
    } catch {
      // Table may not exist yet (or DB is briefly down): keep the counts.
      const key = `${b.host}|${b.version}`;
      const existing = buckets.get(key);
      if (existing) {
        existing.n += b.n;
        existing.last = Math.max(existing.last, b.last);
      } else {
        buckets.set(key, b);
      }
    }
  }
}
