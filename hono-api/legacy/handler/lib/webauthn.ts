import {
  newToken,
} from "./crypto.ts";
import {
  sql,
} from "./db.ts";
import {
  bytesToBase64,
} from "./r2-media.ts";
import {
  sqlBool,
} from "./users.ts";

// ── WebAuthn (fingerprint / passkey) ─────────────────────
export const WEBAUTHN_DEFAULT_ORIGINS = [
  "https://smartsurveyx.com",
  "https://www.smartsurveyx.com",
  "https://sravanku018.github.io",
  "http://localhost:5173",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:4173",
  "https://localhost",
];

/** Only these web origins may register/assert passkeys. */
export function webauthnOrigin(raw: unknown): string {
  const origin = String(raw || "").trim().replace(/\/+$/, "");
  const extra = (Deno.env.get("WEBAUTHN_ORIGINS") || "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  const allowed = new Set([...WEBAUTHN_DEFAULT_ORIGINS, ...extra]);
  if (!allowed.has(origin)) {
    throw new Error("Fingerprint login is not enabled for this site.");
  }
  return origin;
}

export function webauthnRpId(origin: string): string {
  return new URL(origin).hostname;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function webauthnTransports(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  try {
    const parsed = JSON.parse(String(raw || "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** Same shape as /api/auth/login, without password/TOTP secrets. */
export function authUserPayload(u: Record<string, unknown>) {
  return {
    id: Number(u.id),
    username: String(u.username || ""),
    name: String(u.display_name || u.username || ""),
    role: String(u.role || ""),
    active: sqlBool(u.active),
    created_at: u.created_at,
    company_id: u.company_id != null ? Number(u.company_id) : null,
    company_name: u.company_name ? String(u.company_name) : null,
    key_id: u.key_id || null,
    phone: u.phone || null,
    verified: sqlBool(u.verified),
    can_manage_questions: sqlBool(u.can_manage_questions),
    can_edit_surveys: sqlBool(u.can_edit_surveys),
    can_review_data: sqlBool(u.can_review_data),
    can_verify_surveyors: sqlBool(u.can_verify_surveyors),
    can_assign_surveyors: sqlBool(u.can_assign_surveyors),
    can_crud_questionnaire: sqlBool(u.can_crud_questionnaire),
    can_validate_proof: sqlBool(u.can_validate_proof),
    can_web_survey: sqlBool(u.can_web_survey),
    can_record_voice: sqlBool(u.can_record_voice),
    can_translate_telugu: sqlBool(u.can_translate_telugu),
    totp_enabled: u.role === "super_admin" ? sqlBool(u.totp_enabled) : undefined,
    max_questions_per_survey: Number(u.max_questions_per_survey) || 0,
    max_surveys: Number(u.max_surveys) || 0,
    max_surveyors: Number(u.max_surveyors) || 0,
    max_records: Number(u.max_records) || 0,
    max_categories: Number(u.max_categories) || 0,
  };
}

export async function createWebAuthnFlow(opts: {
  userId: number | null;
  kind: "registration" | "authentication";
  challenge: string;
  origin: string;
  rpId: string;
}): Promise<string> {
  const id = newToken();
  await sql`
    INSERT INTO webauthn_challenges (id, user_id, kind, challenge, origin, rp_id, expires_at)
    VALUES (
      ${id}, ${opts.userId}, ${opts.kind}, ${opts.challenge},
      ${opts.origin}, ${opts.rpId}, NOW() + INTERVAL '5 minutes'
    )
  `;
  await sql`DELETE FROM webauthn_challenges WHERE expires_at < NOW()`.catch(() => null);
  return id;
}

export async function takeWebAuthnFlow(
  id: string,
  kind: "registration" | "authentication",
): Promise<Record<string, unknown> | null> {
  if (!id) return null;
  const rows = await sql`
    DELETE FROM webauthn_challenges
    WHERE id = ${id} AND kind = ${kind} AND expires_at > NOW()
    RETURNING *
  `.catch(() => []);
  return (rows[0] as Record<string, unknown>) || null;
}

