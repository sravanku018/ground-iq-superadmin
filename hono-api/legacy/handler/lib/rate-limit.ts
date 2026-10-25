// ── Rate Limiting (In-Memory) ────────────────────────────
export const loginAttempts = new Map<string, { count: number; reset: number }>();
export function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const cap = String(ip).startsWith("web:") ? 30 : 5;
  const a = loginAttempts.get(ip);
  if (!a || now > a.reset) {
    loginAttempts.set(ip, { count: 1, reset: now + 60000 });
    return true;
  }
  a.count++;
  return a.count <= cap;
}

