import {
  uniqueUserKeyId,
} from "./audit.ts";
import {
  hashPasswordAsync,
} from "./crypto.ts";
import {
  sql,
} from "./db.ts";
import {
  sqlCountN,
} from "./users.ts";

// ── Super Admin TOTP (RFC 6238, SHA-1, 30s, 6 digits) ────────────────────
export const TOTP_B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const SUPER_ADMIN_SLOTS = 3;

export function bytesToBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += TOTP_B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += TOTP_B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32ToBytes(s: string): Uint8Array {
  const clean = String(s || "").toUpperCase().replace(/=+$/g, "").replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    const i = TOTP_B32.indexOf(c);
    if (i < 0) continue;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export function newTotpSecret(): string {
  const b = new Uint8Array(20);
  crypto.getRandomValues(b);
  return bytesToBase32(b);
}

export function otpauthUrl(username: string, secret: string): string {
  const label = encodeURIComponent(`Smart Survey X:${username}`);
  const issuer = encodeURIComponent("Smart Survey X");
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}

export async function hotpSha1(secret: Uint8Array, counter: number): Promise<string> {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  // 64-bit big-endian counter (high then low)
  view.setUint32(0, Math.floor(counter / 0x100000000));
  view.setUint32(4, counter >>> 0);
  const key = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, buf));
  const off = sig[sig.length - 1] & 0xf;
  const code =
    ((sig[off] & 0x7f) << 24) |
    ((sig[off + 1] & 0xff) << 16) |
    ((sig[off + 2] & 0xff) << 8) |
    (sig[off + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

export async function verifyTotp(secretB32: string, code: unknown): Promise<boolean> {
  const digits = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(digits) || !secretB32) return false;
  const secret = base32ToBytes(secretB32);
  if (secret.length < 10) return false;
  const step = Math.floor(Date.now() / 1000 / 30);
  for (const d of [-1, 0, 1]) {
    if ((await hotpSha1(secret, step + d)) === digits) return true;
  }
  return false;
}

export function totpSetupPayload(username: string, secret: string) {
  return {
    totp_setup: true,
    totp_secret: secret,
    otpauth_url: otpauthUrl(username, secret),
    issuer: "Smart Survey X",
    account: username,
    digits: 6,
    period: 30,
  };
}

export const SA_SLOT_USERNAMES = ["superadmin", "superadmin2", "superadmin3"] as const;
export const SA_SLOT_STARTER_PASSWORD = "admin123";

/** Create only missing Super Admin usernames. Never updates an existing row. */
export async function seedMissingSuperAdminSlots(
  sqlFn: NonNullable<typeof sql>,
): Promise<{ created: string[] }> {
  const created: string[] = [];
  const countRows = await sqlFn`SELECT COUNT(*)::int AS n FROM app_users WHERE role = 'super_admin'`.catch(() => [{ n: 0 }]);
  let count = sqlCountN(countRows[0]);
  if (count >= SUPER_ADMIN_SLOTS) return { created };

  const starterHash = await hashPasswordAsync(SA_SLOT_STARTER_PASSWORD);
  for (let i = 0; i < SA_SLOT_USERNAMES.length && count < SUPER_ADMIN_SLOTS; i++) {
    const username = SA_SLOT_USERNAMES[i];
    const exists = await sqlFn`SELECT id FROM app_users WHERE LOWER(username) = ${username} LIMIT 1`.catch(() => []);
    if (exists.length) continue;
    const totpSecret = newTotpSecret();
    const name = i === 0 ? "Super Admin" : `Super Admin ${i + 1}`;
    const ins = await sqlFn`
      INSERT INTO app_users (username, password_hash, display_name, role, active, key_id, totp_secret, totp_enabled)
      VALUES (${username}, ${starterHash}, ${name}, 'super_admin', TRUE, ${await uniqueUserKeyId()}, ${totpSecret}, FALSE)
      ON CONFLICT (username) DO NOTHING
      RETURNING id
    `.catch(() => []);
    if ((ins as { id?: unknown }[]).length) {
      created.push(username);
      count += 1;
    }
  }
  return { created };
}

