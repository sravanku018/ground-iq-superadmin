// ── CORS allowlist ────────────────────────────────────────────────────────
// Portals run on GitHub Pages (origin https://sravanku018.github.io) and Vercel.
// The Android WebView origin is https://localhost (androidScheme: "https").
// ALLOWED_ORIGINS env (comma-separated) is merged with the defaults, not a replace.
export const DEFAULT_ALLOWED_ORIGINS = [
  "https://ground-iq-web-lake.vercel.app",
  "https://ground-iq-superadmin.vercel.app",
  "https://sravanku018.github.io",
  "https://localhost",
  "http://localhost",
  "http://localhost:5173",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:4173",
  "capacitor://localhost",
  "ionic://localhost",
];
export const ALLOWED_ORIGINS = new Set([
  ...DEFAULT_ALLOWED_ORIGINS,
  ...(Deno.env.get("ALLOWED_ORIGINS")?.split(",").map((s) => s.trim()).filter(Boolean) ?? []),
]);

export function originIsAllowed(origin: string): boolean {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  const host = u.hostname;
  if (host === "localhost" || host === "127.0.0.1") return true;
  if (host === "sravanku018.github.io") return true;
  if (
    host.endsWith(".vercel.app") &&
    (host.startsWith("ground-iq-web") || host.startsWith("ground-iq-superadmin"))
  ) {
    return true;
  }
  return false;
}

/** The request's Origin iff it is allow-listed, else null. */
export function resolveAllowedOrigin(req?: Request): string | null {
  const origin = req?.headers.get("origin");
  if (!origin) return null; // non-browser client (curl / server-to-server): CORS N/A
  return originIsAllowed(origin) ? origin : null;
}
/** Single choke point: stamp the correct CORS origin on every outgoing response. */
export function withCors(req: Request, res: Response): Response {
  try {
    const allowed = resolveAllowedOrigin(req);
    if (allowed) res.headers.set("access-control-allow-origin", allowed);
    else res.headers.delete("access-control-allow-origin"); // block disallowed origins
    res.headers.append("vary", "Origin");
  } catch { /* streamed/guarded headers — leave as-is */ }
  return res;
}

export const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-headers":
    "authorization, content-type, x-auth-token, idempotency-key, accept, origin, range, content-disposition, cache-control, pragma, x-requested-with",
  "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
  "access-control-expose-headers":
    "content-disposition, content-type, content-length, location",
  "access-control-max-age": "86400",
};

export function corsHeaders(_req?: Request): Record<string, string> {
  return { ...CORS_HEADERS };
}

export function corsPreflight(req: Request): Response {
  const headers: Record<string, string> = { ...CORS_HEADERS, vary: "Origin" };
  const allowed = resolveAllowedOrigin(req);
  if (allowed) headers["access-control-allow-origin"] = allowed;
  return new Response(null, { status: 204, headers });
}

