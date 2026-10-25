import {
  setSonioxRuntimeKey,
} from "../../../lib/soniox.ts";
import {
  sql,
} from "./db.ts";

// ── Router ────────────────────────────────────────────────
/** Load the Super-Admin-saved Soniox key (cached briefly per isolate). */
let sonioxDbKeyLoadedAt = 0;
export async function syncSonioxKeyFromDb(force = false): Promise<void> {
  if (!sql) return;
  if (!force && Date.now() - sonioxDbKeyLoadedAt < 60_000) return;
  const rows = await sql`
    SELECT value FROM app_settings WHERE key = 'soniox_api_key' LIMIT 1
  `.catch(() => []);
  setSonioxRuntimeKey(
    String((rows[0] as { value?: unknown } | undefined)?.value || ""),
  );
  sonioxDbKeyLoadedAt = Date.now();
}

/** Force the next syncSonioxKeyFromDb() call to re-read the key from the DB. */
export function invalidateSonioxKeyCache(): void {
  sonioxDbKeyLoadedAt = 0;
}

/** Mark the in-memory Soniox key as freshly synced. */
export function markSonioxKeyFresh(): void {
  sonioxDbKeyLoadedAt = Date.now();
}

