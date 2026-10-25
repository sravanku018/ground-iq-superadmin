import {
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import {
  Buffer,
} from "node:buffer";

// ── Crypto helpers (same idea as Node auth) ───────────────
export async function pbkdf2Hash(password: string, saltHex: string, iterations = 600_000): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const salt = new Uint8Array(
    saltHex.match(/.{1,2}/g)!.map((h) => parseInt(h, 16)),
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  const hash = [...new Uint8Array(bits)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `pbkdf2:${saltHex}:${hash}`;
}

export async function hashPasswordAsync(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = [...salt].map((b) => b.toString(16).padStart(2, "0")).join("");
  return pbkdf2Hash(password, saltHex, 600_000);
}


export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  if (!stored) return false;
  // Accept PBKDF2: pbkdf2:salt:hash
  if (stored.startsWith("pbkdf2:")) {
    const [, saltHex, hash] = stored.split(":");
    // Try 600k iterations first, then fallback to legacy 100k iterations for backward compatibility
    let next = await pbkdf2Hash(password, saltHex, 600_000);
    if (next === `pbkdf2:${saltHex}:${hash}`) return true;
    next = await pbkdf2Hash(password, saltHex, 100_000);
    return next === `pbkdf2:${saltHex}:${hash}`;
  }
  // Node scrypt format: salt:hash
  if (stored.includes(":")) {
    try {
      const [salt, key] = stored.split(":");
      const derivedKey = scryptSync(password, salt, 64);
      const keyBuffer = Buffer.from(key, "hex");
      if (keyBuffer.length === derivedKey.length && timingSafeEqual(keyBuffer, derivedKey)) {
        return true;
      }
    } catch {
      // ignore
    }
  }
  return false;
}

export function newToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

