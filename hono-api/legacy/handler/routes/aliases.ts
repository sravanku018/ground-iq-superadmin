import type { Ctx } from "./ctx.ts";
import {
  json,
} from "../lib/http.ts";

export async function handleRemovedAndAliases(c: Ctx): Promise<Response | null> {
  const { req, url, me, redispatch } = c;
  // ── Removed routes → explicit 410 Gone ───────────────────
  const REMOVED: Array<[RegExp, string]> = [
    [/^\/api\/super-admin\/seed-slots$/, "Slots are seeded automatically at deploy time (ensureSchema)."],
    [/^\/api\/submissions\/\d+\/proof$/, "Proof validation removed — submissions no longer store respondent phone/Aadhaar."],
    [/^\/api\/surveys\/\d+\/respondents(\/\d+)?$/, "Respondent CRUD removed — survey collection uses /api/submissions."],
  ];
  for (const [re, why] of REMOVED) {
    if (re.test(url.pathname)) return json({ error: "gone", detail: why }, 410);
  }

  // ── Route aliases (Tier 1 merges) — DELETE after clients migrate ─────────
  const m = req.method;

  // POST /api/users/profile-media          → self-upload
  if (m === "POST" && url.pathname === "/api/users/profile-media" && me) {
    return redispatch(req, `/api/users/${me.id}/media`);
  }
  // POST /api/users/:id/profile-media      → same as :id/media
  if (m === "POST" && /^\/api\/users\/(\d+)\/profile-media$/.test(url.pathname)) {
    return redispatch(req, url.pathname.replace("/profile-media", "/media"));
  }

  // POST /api/seat-limit-requests/:id/approve|deny → PATCH with body
  {
    const hit = url.pathname.match(/^\/api\/seat-limit-requests\/(\d+)\/(approve|deny)$/);
    if (m === "POST" && hit) {
      return redispatch(
        req,
        `/api/seat-limit-requests/${hit[1]}`,
        "PATCH",
        JSON.stringify({ decision: hit[2] }),
      );
    }
  }

  // GET /api/submissions/me → role-scoped list
  if (m === "GET" && url.pathname === "/api/submissions/me") {
    const next = new URL("/api/submissions", req.url);
    next.search = url.search;
    next.searchParams.set("mine", "1");
    return redispatch(req, next.pathname + next.search);
  }

  // GET /api/stats → GET /api/analytics?group_by=kpi
  if (m === "GET" && url.pathname === "/api/stats") {
    const next = new URL("/api/analytics", req.url);
    next.search = url.search;
    next.searchParams.set("group_by", "kpi");
    return redispatch(req, next.pathname + next.search);
  }

  // GET /api/admin/geo-summary → GET /api/analytics?group_by=geo
  if (m === "GET" && url.pathname === "/api/admin/geo-summary") {
    const next = new URL("/api/analytics", req.url);
    next.search = url.search;
    next.searchParams.set("group_by", "geo");
    return redispatch(req, next.pathname + next.search);
  }
  return null;
}
