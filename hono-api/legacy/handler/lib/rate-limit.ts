// ── Rate Limiting (In-Memory) ────────────────────────────
export const loginAttempts = new Map<string, { count: number; reset: number }>();

/**
 * Hard ceiling on tracked keys. Without it, a client that varies
 * X-Forwarded-For (or any other key) grows this Map until the process dies.
 */
const MAX_KEYS = 5_000;

function sweepExpired(now: number) {
  for (const [key, entry] of loginAttempts) {
    if (now > entry.reset) loginAttempts.delete(key);
  }
}

/**
 * The client IP as seen by the trusted proxy.
 *
 * Caddy appends the real peer to any incoming X-Forwarded-For, so the LAST
 * entry is the one we can trust; the earlier ones are attacker-controlled.
 * Using the whole header (the old behaviour) let a caller bypass the limit by
 * sending a new fake prefix on every request.
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    "unknown"
  ).trim();
}

export function checkRateLimit(key: string, capOverride?: number): boolean {
  const now = Date.now();
  const cap = capOverride ?? (String(key).startsWith("web:") ? 30 : 5);
  if (loginAttempts.size > MAX_KEYS) sweepExpired(now);
  if (loginAttempts.size > MAX_KEYS) {
    // Still full of live keys: evict the oldest until there is room.
    while (loginAttempts.size >= MAX_KEYS) {
      const oldest = loginAttempts.keys().next().value;
      if (oldest === undefined) break;
      loginAttempts.delete(oldest);
    }
  }
  const a = loginAttempts.get(key);
  if (!a || now > a.reset) {
    loginAttempts.set(key, { count: 1, reset: now + 60000 });
    return true;
  }
  a.count++;
  return a.count <= cap;
}
