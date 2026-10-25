import {
  sql,
} from "./db.ts";

export function logAudit(
  actor: { id: unknown; username: unknown; role: unknown } | null,
  action: string,
  entityType?: string,
  entityId?: unknown,
  meta?: Record<string, unknown>,
): void {
  if (!sql || !actor) return;
  void sql`
    INSERT INTO audit_log (actor_id, actor_name, actor_role, action, entity_type, entity_id, meta)
    VALUES (
      ${actor.id},
      ${actor.username},
      ${actor.role},
      ${action},
      ${entityType || null},
      ${entityId != null ? String(entityId) : null},
      ${meta || {}}::jsonb
    )
  `.catch((e) => console.error("AUDIT LOG FAILED:", (e as Error)?.message || e));
}


/** Unique surveyor key ID, e.g. GROUND-8F3K2Q (no 0/O/1/I) */
export function genUserKeyId(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let k = "";
  for (let i = 0; i < 6; i++) {
    k += chars[Math.floor(Math.random() * chars.length)];
  }
  return `GROUND-${k}`;
}

export async function uniqueUserKeyId(): Promise<string> {
  for (let i = 0; i < 25; i++) {
    const k = genUserKeyId();
    const hit = await sql`SELECT id FROM app_users WHERE key_id = ${k} LIMIT 1`.catch(() => []);
    if (!hit.length) return k;
  }
  return `GROUND-${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

