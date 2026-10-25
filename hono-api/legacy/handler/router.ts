/**
 * Request router — runs the route modules in the same order the old
 * monolithic rawHandler checked its `if` blocks. First module that returns a
 * Response wins; `null` means "not mine, try the next one".
 */
import { corsPreflight, withCors } from "./lib/cors.ts";
import { serveAppApk } from "./lib/apk.ts";
import { sql } from "./lib/db.ts";
import { ready } from "./lib/schema.ts";
import { bearer, json } from "./lib/http.ts";
import { getUser } from "./lib/users.ts";
import type { Ctx } from "./routes/ctx.ts";
import { handlePublic } from "./routes/public.ts";
import { handleAuth } from "./routes/auth.ts";
import { handleConversations } from "./routes/conversations.ts";
import { handleRemovedAndAliases } from "./routes/aliases.ts";
import { handleSession } from "./routes/session.ts";
import { handleProgress } from "./routes/progress.ts";
import { handleUsers } from "./routes/users.ts";
import { handleSuperAdmin } from "./routes/super-admin.ts";
import { handleAuditNotifications } from "./routes/audit-notifications.ts";
import { handleQuestions } from "./routes/questions.ts";
import { handleSeatLimits } from "./routes/seat-limits.ts";
import { handleSubmissionsList } from "./routes/submissions-list.ts";
import { handleAdminReports } from "./routes/admin-reports.ts";
import { handleSubmissionsCrud } from "./routes/submissions-crud.ts";
import { handleSurveys } from "./routes/surveys.ts";
import { handleCompanies } from "./routes/companies.ts";
import { handleWebSurvey } from "./routes/web-survey.ts";
import { handleSubmissionsCreate } from "./routes/submissions-create.ts";
import { handleMedia } from "./routes/media.ts";
import { handleGeo } from "./routes/geo.ts";
import { handleAnalytics } from "./routes/analytics.ts";
import { handleExport } from "./routes/export.ts";

type RouteFn = (c: Ctx) => Promise<Response | null>;

/** Order matters (same as the original if-chain). */
const ROUTES: RouteFn[] = [
  handleAuth,
  handleConversations,
  handleRemovedAndAliases,
  handleSession,
  handleProgress,
  handleUsers,
  handleSuperAdmin,
  handleAuditNotifications,
  handleQuestions,
  handleSeatLimits,
  handleSubmissionsList,
  handleAdminReports,
  handleSubmissionsCrud,
  handleSurveys,
  handleCompanies,
  handleWebSurvey,
  handleSubmissionsCreate,
  handleMedia,
  handleGeo,
  handleAnalytics,
  handleExport,
];

/** Alias support: re-run rawHandler with a rewritten path/method/body. */
function redispatch(req: Request, pathAndQuery: string, method?: string, body?: string): Promise<Response> {
  const next = new Request(new URL(pathAndQuery, req.url), {
    method: method || req.method,
    headers: req.headers,
    body: (method || req.method) === "GET" || (method || req.method) === "HEAD"
      ? undefined
      : (body !== undefined ? body : req.body),
    // @ts-expect-error -- required by Deno when streaming a body
    duplex: "half",
  });
  return rawHandler(next);
}

async function rawHandler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return corsPreflight(req);

  const url = new URL(req.url);
  const path = url.pathname.replace(/\/$/, "") || "/";
  const method = req.method;

  try {
    if (
      (path === "/api/app.apk" || path === "/app.apk") &&
      (method === "GET" || method === "HEAD")
    ) {
      return serveAppApk(method);
    }
    if (!sql) return json({ error: "DATABASE_URL not set" }, 500);
    // Login / health must not wait for the full schema pass (dozens of ALTERs)
    // on a cold Deno isolate — that is the main "Signing in…" stall.
    const isLogin = path === "/api/auth/login" && method === "POST";
    const isHealth = path === "/" || path === "/api/health";
    if (isLogin || isHealth) void ready();
    else await ready();

    const pre = { req, url, path, method, m: method, token: null, me: null, redispatch };
    const preRes = await handlePublic(pre);
    if (preRes) return preRes;

    // Auth-required helpers
    const token = bearer(req);
    const me = await getUser(token);
    const c: Ctx = { req, url, path, method, m: method, token, me, redispatch };

    for (const route of ROUTES) {
      const res = await route(c);
      if (res) return res;
    }

    return json({ error: `Not found: ${method} ${path}` }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: (err as Error).message || "Server error" }, 500);
  }
}

/** Used by hono-api/main.ts. Original Playground file is deno-deploy/main.ts (untouched). */
export async function handleRequest(req: Request): Promise<Response> {
  return withCors(req, await rawHandler(req));
}
