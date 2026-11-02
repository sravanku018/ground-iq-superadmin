/**
 * Lightweight API traffic accounting — which hostname and app version are
 * calling us. Used to see when the legacy sslip.io host has gone quiet.
 *
 * Counts are batched in memory and flushed by the job worker every tick, so a
 * request never waits on a database write. A failed flush merges the counts
 * back into the buffer for the next attempt.
 *
 * Host and version are normalized before they become bucket keys: arbitrary
 * Host/X-App-Version values collapse to "other" instead of creating rows.
 */
import { sql } from "./db.ts";

type Bucket = { host: string; version: string; n: number; last: number };

const buckets = new Map<string, Bucket>();

/** Bound the in-memory key space even if normalization changes later. */
const MAX_BUCKETS = 100;

const SMARTSURVEY_HOST = /^([a-z0-9-]+\.)*smartsurveyx\.com$/;
const SSLP_HOST = /^([a-z0-9-]+\.)?162\.35\.96\.65\.sslip\.io$/;

/** Allowlisted hostname or "other". */
export function normalizeHost(raw: unknown): string {
  const h = String(raw || "")
    .split(",")[0]
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .split(":")[0]
    .slice(0, 120);
  if (!h) return "other";
  if (h === "localhost" || h === "127.0.0.1" || h === "::1") return h;
  if (SMARTSURVEY_HOST.test(h) || SSLP_HOST.test(h)) return h;
  return "other";
}

/** Semver-like version or "other" (old APKs do not send the header). */
export function normalizeAppVersion(raw: unknown): string {
  const v = String(raw || "").trim().toLowerCase().replace(/^v/, "");
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v) ? v : "other";
}

/** Normalize the public host (Caddy forwards the original Host). */
export function requestHost(req: Request): string {
  try {
    const raw = req.headers.get("x-forwarded-host") || req.headers.get("host") ||
      new URL(req.url).hostname;
    return normalizeHost(raw);
  } catch {
    return "other";
  }
}

export function requestAppVersion(req: Request): string {
  return normalizeAppVersion(req.headers.get("x-app-version"));
}

export function recordTraffic(req: Request): void {
  try {
    let host = requestHost(req);
    let version = requestAppVersion(req);
    let key = `${host}|${version}`;
    if (!buckets.has(key) && buckets.size >= MAX_BUCKETS) {
      host = "other";
      version = "other";
      key = "other|other";
    }
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
