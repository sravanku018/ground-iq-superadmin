import type { Ctx } from "./ctx.ts";
import {
  corsHeaders,
} from "../lib/cors.ts";
import {
  sql,
} from "../lib/db.ts";
import {
  json,
} from "../lib/http.ts";
import {
  listAdminInbox,
  listPendingWebNotices,
  mapInboxRow,
} from "../lib/inbox.ts";
import {
  isPortalAdmin,
} from "../lib/users.ts";

export async function handleAuditNotifications(c: Ctx): Promise<Response | null> {
  const { url, path, method, me } = c;
  // ── Super Admin platform governance (01-PRD.md §Super Admin) ──
  // FR-AUD-02: platform-wide audit log, per actor account, Super Admin only.
  if (path === "/api/audit-log" && method === "GET") {
    if (!me) return json({ error: "Login required" }, 401);
    if (me.role !== "super_admin") return json({ error: "Super Admin only" }, 403);
    const action = String(url.searchParams.get("action") || "").trim();
    const actor = String(url.searchParams.get("actor") || "").trim();
    const entity = String(url.searchParams.get("entity") || "").trim();
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 150, 1), 500);
    const rows = await sql`
        SELECT id, actor_id, actor_name, actor_role, action, entity_type, entity_id, meta, created_at
        FROM audit_log
        WHERE (${action} = '' OR action = ${action})
          AND (${actor} = '' OR actor_name ILIKE ${`%${actor}%`})
          AND (${entity} = '' OR entity_type = ${entity})
        ORDER BY id DESC LIMIT ${limit}
      `.catch(() => []);
    return json({ entries: rows, count: (rows as unknown[]).length });
  }

  // Live inbox for Client Admin / Super Admin — events written when a
  // surveyor uploads verification docs or a field record (not a timer).
  if (path === "/api/notifications" && method === "GET") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    const after = Math.max(0, Number(url.searchParams.get("after")) || 0);
    const rows = await listAdminInbox(sql, me, after);
    const fromAudit = (rows as Record<string, unknown>[]).map(mapInboxRow);
    const pendingWeb = after > 0 ? [] : await listPendingWebNotices(sql, me);
    const seen = new Set(fromAudit.map((i) => String(i.submissionId || "")));
    const extra = pendingWeb.filter((i) => !seen.has(String(i.submissionId || "")));
    const items = [...extra, ...fromAudit].slice(0, 80);
    return json({
      items,
      count: items.length,
    });
  }

  if (path === "/api/notifications/stream" && method === "GET") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    let lastId = Math.max(0, Number(url.searchParams.get("after")) || 0);
    const encoder = new TextEncoder();
    let timer: number | undefined;
    const stream = new ReadableStream({
      start(controller) {
        const send = (obj: unknown) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
          } catch {
            /* closed */
          }
        };
        send({ type: "hello", after: lastId });
        // Submission ids already streamed on THIS connection, across both
        // sources. Audit rows and pending-web rows describe the same event but
        // key it differently (`evt-<auditId>` vs `web-sub-<submissionId>`), so
        // the browser can't dedupe them — without this the same notice shows
        // twice, which is why the list endpoint dedupes the same way.
        const sentSubIds = new Set<string>();
        const tick = async () => {
          const rows = await listAdminInbox(sql, me, lastId);
          const list = (rows as Record<string, unknown>[]).slice().reverse();
          for (const r of list) {
            const seq = Number(r.id) || 0;
            if (seq <= lastId) continue;
            lastId = seq;
            const item = mapInboxRow(r);
            const subId = (item as { submissionId?: unknown }).submissionId;
            if (subId != null) sentSubIds.add(String(subId));
            send({ type: "item", item });
          }
          // The list endpoint also merges listPendingWebNotices(), read straight
          // from the submissions table. Stream that source too: when audit_log
          // loses or rejects the web backfill, the audit query above silently
          // returns nothing and the bell would never hear about new web
          // responses until a full reload. Rows that DO have an audit row are
          // already in sentSubIds, so on a healthy database this sends nothing.
          // (lastId above stays an audit id — web items never advance it.)
          const web = await listPendingWebNotices(sql, me).catch(() => []);
          for (const item of web as Record<string, unknown>[]) {
            const key = String(item.submissionId ?? item.id ?? "");
            if (!key || sentSubIds.has(key)) continue;
            sentSubIds.add(key);
            send({ type: "item", item });
          }
        };
        void tick();
        timer = setInterval(() => void tick(), 2000) as unknown as number;
      },
      cancel() {
        if (timer) clearInterval(timer);
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        ...corsHeaders(),
      },
    });
  }
  return null;
}
