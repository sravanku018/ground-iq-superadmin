import type { Ctx } from "./ctx.ts";
import {
  logAudit,
} from "../lib/audit.ts";
import {
  sql,
} from "../lib/db.ts";
import {
  json,
  readBody,
} from "../lib/http.ts";
import {
  isPortalAdmin,
  sqlCountN,
} from "../lib/users.ts";

export async function handleSeatLimits(c: Ctx): Promise<Response | null> {
  const { req, url, path, method, m, me } = c;
  // BR-006 / FR-USR-10: seat-limit upgrade requests.
  if (path === "/api/seat-limit-requests" && method === "GET") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    const [limits] = await sql`SELECT seat_role, approved_limit, updated_at, updated_by FROM seat_limits`.catch(() => []);
    const [cnt] = await sql`SELECT COUNT(*)::int AS n FROM app_users WHERE role = 'admin' AND active = TRUE`.catch(() => [{ n: 0 }]);
    const reqs = me.role === "super_admin"
      ? await sql`
            SELECT id, requested_by, requested_by_name, seat_role, requested_limit, reason,
                   status, decided_by, decided_by_name, decided_at, created_at
            FROM seat_limit_requests ORDER BY id DESC LIMIT 200
          `.catch(() => [])
      : await sql`
            SELECT id, requested_by, requested_by_name, seat_role, requested_limit, reason,
                   status, decided_by, decided_by_name, decided_at, created_at
            FROM seat_limit_requests WHERE requested_by = ${me.id} ORDER BY id DESC LIMIT 200
          `.catch(() => []);
    return json({
      requests: reqs,
      limits: (limits as Record<string, unknown>) || null,
      current_admins: sqlCountN(cnt),
      can_submit: me.role === "admin",
    });
  }

  if (path === "/api/seat-limit-requests" && method === "POST") {
    if (!me) return json({ error: "Login required" }, 401);
    if (me.role !== "admin") {
      return json({ error: "Only Client Admins submit seat upgrade requests" }, 403);
    }
    const body = await readBody(req);
    const requestedLimit = Math.max(1, Math.min(Number(body.requested_limit) || 0, 10000));
    const reason = String(body.reason || "").trim();
    if (!requestedLimit) return json({ error: "requested_limit required" }, 400);
    const open = await sql`
        SELECT id FROM seat_limit_requests WHERE requested_by = ${me.id} AND status = 'pending' LIMIT 1
      `.catch(() => []);
    if ((open as unknown[]).length) {
      return json({ error: "You already have a pending seat upgrade request" }, 409);
    }
    const rows = await sql`
        INSERT INTO seat_limit_requests (requested_by, requested_by_name, seat_role, requested_limit, reason)
        VALUES (${me.id}, ${me.name || me.username}, 'admin', ${requestedLimit}, ${reason || null})
        RETURNING id, seat_role, requested_limit, reason, status, created_at
      `.catch(() => []);
    const r = (rows as Record<string, unknown>[])[0];
    if (!r) return json({ error: "Could not create request" }, 500);
    logAudit(me, "seat_request_submit", "seat_limit_requests", r.id, {
      seat_role: "admin",
      requested_limit: requestedLimit,
    });
    return json({ request: r }, 201);
  }

  // Approve / Deny seat limit request (PATCH /api/seat-limit-requests/:id with {decision: "approve"|"deny"})
  {
    const hit = url.pathname.match(/^\/api\/seat-limit-requests\/(\d+)$/);
    if (m === "PATCH" && hit) {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "super_admin") return json({ error: "Super Admin only" }, 403);
      const id = Number(hit[1]);
      const b = await readBody(req);
      const decision = b.decision === "approve" ? "approve" : b.decision === "deny" ? "deny" : null;
      if (!decision) return json({ error: "decision must be 'approve' or 'deny'" }, 400);
      const approve = decision === "approve";
      const rows = await sql`SELECT * FROM seat_limit_requests WHERE id = ${id}`.catch(() => []);
      const r = rows[0] as Record<string, unknown> | undefined;
      if (!r) return json({ error: "Not found" }, 404);
      if (r.status !== "pending") return json({ error: "Request already decided" }, 409);
      if (approve) {
        await sql`
            INSERT INTO seat_limits (seat_role, approved_limit, updated_at, updated_by)
            VALUES (${String(r.seat_role || "admin")}, ${Number(r.requested_limit)}, NOW(), ${me.name || me.username})
            ON CONFLICT (seat_role)
            DO UPDATE SET approved_limit = ${Number(r.requested_limit)}, updated_at = NOW(), updated_by = ${me.name || me.username}
          `.catch(() => null);
      }
      await sql`
          UPDATE seat_limit_requests
          SET status = ${approve ? "approved" : "denied"}, decided_by = ${me.id},
              decided_by_name = ${me.name || me.username}, decided_at = NOW()
          WHERE id = ${id}
        `.catch(() => null);
      logAudit(me, approve ? "seat_request_approve" : "seat_request_deny", "seat_limit_requests", id, {
        seat_role: r.seat_role,
        requested_limit: r.requested_limit,
        requested_by: r.requested_by_name,
      });
      return json({ ok: true, status: approve ? "approved" : "denied" });
    }
  }
  return null;
}
