import type { Ctx } from "./ctx.ts";
import {
  setSonioxRuntimeKey,
  sonioxConfigInfo,
  sonioxKeyHint,
  sonioxKeySource,
  validateSonioxKey,
} from "../../../lib/soniox.ts";
import {
  logAudit,
  uniqueUserKeyId,
} from "../lib/audit.ts";
import {
  hashPasswordAsync,
} from "../lib/crypto.ts";
import {
  sql,
} from "../lib/db.ts";
import {
  json,
  readBody,
} from "../lib/http.ts";
import {
  invalidateSonioxKeyCache,
  markSonioxKeyFresh,
  syncSonioxKeyFromDb,
} from "../lib/soniox-sync.ts";
import {
  SA_SLOT_STARTER_PASSWORD,
  newTotpSecret,
  seedMissingSuperAdminSlots,
  totpSetupPayload,
} from "../lib/totp.ts";

export async function handleSuperAdmin(c: Ctx): Promise<Response | null> {
  const { req, path, method, me } = c;
  // Super Admin: manage the Soniox key without shell/server access.
  if (path === "/api/super-admin/soniox" && (method === "GET" || method === "PUT" || method === "DELETE")) {
    if (!me) return json({ error: "Login required" }, 401);
    if (me.role !== "super_admin") return json({ error: "Super Admin only" }, 403);

    if (method === "GET") {
      await syncSonioxKeyFromDb(true);
      return json({
        enabled: sonioxConfigInfo().enabled,
        source: sonioxKeySource(),
        key_hint: sonioxKeyHint(),
      });
    }

    if (method === "DELETE") {
      await sql`DELETE FROM app_settings WHERE key = 'soniox_api_key'`.catch(() => null);
      invalidateSonioxKeyCache();
      await syncSonioxKeyFromDb(true);
      logAudit(me, "soniox_key_clear", "app_settings", null, {});
      return json({
        ok: true,
        enabled: sonioxConfigInfo().enabled,
        source: sonioxKeySource(),
      });
    }

    const body = await readBody(req);
    const key = String(body.api_key || body.key || "").trim();
    if (!key) return json({ error: "api_key is required" }, 400);
    try {
      await validateSonioxKey(key);
    } catch (e) {
      return json({
        error: (e as Error)?.message || "Soniox rejected the API key",
      }, 400);
    }
    await sql`
        INSERT INTO app_settings (key, value, updated_at)
        VALUES ('soniox_api_key', ${key}, NOW())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      `;
    setSonioxRuntimeKey(key);
    markSonioxKeyFresh();
    logAudit(me, "soniox_key_update", "app_settings", null, {
      key_hint: sonioxKeyHint(),
    });
    return json({
      ok: true,
      enabled: true,
      source: "database",
      key_hint: sonioxKeyHint(),
    });
  }

  // Create a Super Admin (max 3 platform-wide) — Super Admin console only.
  // Client Admin portal must never create Super Admins.
  if (path === "/api/super-admin" && method === "POST") {
    if (!me) return json({ error: "Login required" }, 401);
    if (me.role !== "super_admin") {
      return json({
        error: "Super Admin only — Client Admin cannot create Super Admin accounts",
      }, 403);
    }
    const body = await readBody(req);
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");
    const name = String(body.name || "Super Admin").trim();
    if (!username || !password) return json({ error: "username and password required" }, 400);
    if (password.length < 8) return json({ error: "Password min 8 characters" }, 400);
    const countRows = await sql`SELECT COUNT(*) AS n FROM app_users WHERE role = 'super_admin'`;
    const count = Number((countRows[0] as { n?: unknown } | undefined)?.n ?? 0);
    if (count >= 3) return json({ error: "Super Admin cap of 3 reached" }, 403);
    await sql`ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check`.catch(() => null);
    await sql`ALTER TABLE app_users ADD CONSTRAINT app_users_role_check CHECK (role IN ('super_admin','admin','field','user','surveyor'))`.catch(() => null);
    try {
      const password_hash = await hashPasswordAsync(password);
      const key_id = await uniqueUserKeyId();
      const totpSecret = newTotpSecret();
      const inserted = await sql`
          INSERT INTO app_users (username, password_hash, display_name, role, active, key_id, totp_secret, totp_enabled)
          VALUES (${username}, ${password_hash}, ${name}, 'super_admin', TRUE, ${key_id}, ${totpSecret}, FALSE)
          RETURNING id, username, display_name, role, active, created_at, key_id
        `;
      const u = inserted[0] as Record<string, unknown>;
      logAudit(me, "super_admin_create", "user", u.id, { username: u.username, totp: true });
      return json({
        user: {
          id: u.id,
          username: u.username,
          name: u.display_name || u.username,
          role: u.role,
          active: u.active !== false,
          created_at: u.created_at,
          key_id: u.key_id || key_id,
          totp_enabled: false,
        },
        ...totpSetupPayload(String(u.username), totpSecret),
      }, 201);
    } catch (e) {
      const msg = (e as Error).message || "";
      if (msg.includes("unique") || msg.includes("duplicate")) {
        return json({ error: "Username already exists" }, 409);
      }
      return json({ error: msg || "Could not create super admin" }, 500);
    }
  }

  // Check & fill remaining Super Admin seats (superadmin2 / superadmin3).
  if (path === "/api/super-admin/seed-slots" && method === "POST") {
    if (!me) return json({ error: "Login required" }, 401);
    if (me.role !== "super_admin") return json({ error: "Super Admin only" }, 403);
    const out = await seedMissingSuperAdminSlots(sql);
    return json({
      ok: true,
      created: out.created,
      starter_password: out.created.length ? SA_SLOT_STARTER_PASSWORD : null,
      note: out.created.length
        ? "New slots initialized. Existing accounts were not changed."
        : "All 3 slots already exist — nothing created.",
    });
  }


  // Reset TOTP for a Super Admin slot — Super Admin console only. New secret shown once.
  if (path.match(/^\/api\/super-admin\/\d+\/totp\/reset$/) && method === "POST") {
    if (!me) return json({ error: "Login required" }, 401);
    if (me.role !== "super_admin") {
      return json({ error: "Super Admin only" }, 403);
    }
    const id = Number(path.split("/")[3]);
    const rows = await sql`
        SELECT id, username, role FROM app_users WHERE id = ${id} AND role = 'super_admin' LIMIT 1
      `.catch(() => []);
    const u = rows[0] as { id: number; username: string } | undefined;
    if (!u) return json({ error: "Super Admin slot not found" }, 404);
    const secret = newTotpSecret();
    await sql`
        UPDATE app_users SET totp_secret = ${secret}, totp_enabled = FALSE WHERE id = ${u.id}
      `;
    logAudit(me, "super_admin_totp_reset", "user", u.id, { username: u.username });
    return json({
      ok: true,
      user: { id: u.id, username: u.username, totp_enabled: false },
      ...totpSetupPayload(u.username, secret),
    });
  }

  // Super Admin password reset — Super Admin console only (not Client Admin).
  if (path === "/api/super-admin/reset" && method === "POST") {
    if (!me) return json({ error: "Login required" }, 401);
    if (me.role !== "super_admin") {
      return json({
        error: "Super Admin only — Client Admin cannot reset Super Admin passwords",
      }, 403);
    }
    const body = await readBody(req);
    const password = String(body.password || "");
    if (password.length < 8) return json({ error: "Password min 8 characters" }, 400);
    const countRows = await sql`SELECT COUNT(*) AS n FROM app_users WHERE role = 'super_admin'`;
    const count = Number((countRows[0] as { n?: unknown } | undefined)?.n ?? 0);
    if (count < 1) {
      return json({ error: "No Super Admin found" }, 404);
    }
    const saRows = await sql`SELECT id, username FROM app_users WHERE role = 'super_admin' LIMIT 1`;
    const sa = saRows[0] as { id: number; username: string } | undefined;
    if (!sa) return json({ error: "No Super Admin found" }, 404);
    const password_hash = await hashPasswordAsync(password);
    await sql`UPDATE app_users SET password_hash = ${password_hash} WHERE id = ${sa.id}`;
    logAudit(me, "super_admin_reset", "user", sa.id, { username: sa.username });
    return json({ ok: true, username: sa.username });
  }
  return null;
}
