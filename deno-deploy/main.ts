/**
 * Election Survey API — Deno Deploy / Playground version
 * -------------------------------------------------------
 * Same Neon DB as your Node app. Host the API on Deno so the
 * Android app does not need your PC on the same Wi‑Fi.
 *
 * Playground steps:
 * 1. Open https://dash.deno.com → New Playground (or New Project)
 * 2. Paste this file as main.ts (or upload the deno-deploy folder)
 * 3. Settings → Environment Variables:
 *      DATABASE_URL = your Neon connection string (sslmode=require)
 * 4. Save / Deploy → you get a URL like:
 *      https://election-survey-xxxx.deno.dev
 * 5. In the mobile app: API server settings → that URL
 *    (no trailing slash)
 *
 * Local test:
 *   export DATABASE_URL='postgresql://...'
 *   deno run -A --env main.ts
 */

import { neon } from "npm:@neondatabase/serverless@0.10.4";

// ── Config ────────────────────────────────────────────────
const DATABASE_URL = Deno.env.get("DATABASE_URL");
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL env var");
}

const sql = DATABASE_URL ? neon(DATABASE_URL) : null;
const ROLES = ["admin"] as const;

// ── Crypto helpers (same idea as Node auth) ───────────────
async function pbkdf2Hash(password: string, saltHex: string): Promise<string> {
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
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  const hash = [...new Uint8Array(bits)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `pbkdf2:${saltHex}:${hash}`;
}

async function hashPasswordAsync(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = [...salt].map((b) => b.toString(16).padStart(2, "0")).join("");
  return pbkdf2Hash(password, saltHex);
}

async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  if (!stored) return false;
  // Node scrypt format: salt:hash (no prefix) — cannot verify on Deno edge easily
  // Accept PBKDF2: pbkdf2:salt:hash
  if (stored.startsWith("pbkdf2:")) {
    const [, saltHex, hash] = stored.split(":");
    const next = await pbkdf2Hash(password, saltHex);
    return next === `pbkdf2:${saltHex}:${hash}`;
  }
  // Fallback: for playground demo, allow plain env seed passwords via re-seed
  return false;
}

function newToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, content-type, x-auth-token",
      "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
    },
  });
}

function corsHeaders(_req?: Request): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type, x-auth-token",
    "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
  };
}

function corsPreflight() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  if (h.startsWith("Bearer ")) return h.slice(7);
  return req.headers.get("x-auth-token");
}

async function getUser(token: string | null) {
  if (!token || !sql) return null;
  const rows = await sql`
    SELECT u.id, u.username, u.display_name, u.role, u.active, u.created_at
    FROM app_sessions s
    JOIN app_users u ON u.id = s.user_id
    WHERE s.token = ${token}
      AND s.expires_at > NOW()
      AND u.active = TRUE
      AND u.role IN ('admin', 'surveyor')
    LIMIT 1
  `;
  const u = rows[0];
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    name: u.display_name || u.username,
    role: u.role,
    active: u.active,
    created_at: u.created_at,
  };
}

/** Default Q/A form loaded by field app (admin can edit via dashboard) */
const DEFAULT_QUESTIONS = [
  {
    id: "respondent_name",
    label: "Respondent full name",
    type: "text",
    required: true,
    speak: "What is the respondent full name?",
  },
  {
    id: "district",
    label: "District",
    type: "text",
    required: true,
    speak: "Which district?",
  },
  {
    id: "constituency",
    label: "Assembly constituency",
    type: "text",
    required: true,
    speak: "Which assembly constituency?",
  },
  {
    id: "gender",
    label: "Gender",
    type: "choice",
    options: ["Male", "Female", "Other"],
    required: true,
    speak: "Gender of the respondent?",
  },
  {
    id: "caste",
    label: "Caste category",
    type: "choice",
    options: ["BC", "SC", "ST", "OC", "Minority", "Other"],
    required: false,
    speak: "Caste category?",
  },
  {
    id: "age",
    label: "Age group",
    type: "choice",
    options: ["18-25", "26-35", "36-45", "46-60", "60+"],
    required: false,
    speak: "Age group?",
  },
  {
    id: "winning_party",
    label: "Who will win here?",
    type: "choice",
    options: ["Congress", "BJP", "BRS", "Others", "Undecided"],
    required: true,
    speak: "According to them who will win?",
  },
  {
    id: "pm_preference",
    label: "Preferred PM",
    type: "choice",
    options: ["Narendra Modi", "Rahul Gandhi", "Other", "Undecided"],
    required: false,
    speak: "Preferred Prime Minister?",
  },
  {
    id: "performance",
    label: "Government performance",
    type: "choice",
    options: ["Excellent", "Good", "Average", "Poor", "Very Poor"],
    required: false,
    speak: "How is government performance?",
  },
  {
    id: "issues",
    label: "Top issues (comma separated)",
    type: "text",
    required: false,
    speak: "What are the main issues?",
  },
  {
    id: "notes",
    label: "Notes",
    type: "text",
    required: false,
    speak: "Any extra notes?",
  },
];

async function ensureSchema() {
  if (!sql) return;
  await sql`
    CREATE TABLE IF NOT EXISTS app_users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      role TEXT NOT NULL DEFAULT 'admin',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  // Admin-assigned target: how many records each surveyor must complete
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS target_quota INTEGER NOT NULL DEFAULT 0`
    .catch(() => null);
  await sql`
    CREATE TABLE IF NOT EXISTS app_sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS submissions (
      id BIGSERIAL PRIMARY KEY,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Dynamic questions form (admin dashboard → field app)
  await sql`
    CREATE TABLE IF NOT EXISTS survey_form (
      id SERIAL PRIMARY KEY,
      form_key TEXT NOT NULL UNIQUE DEFAULT 'default',
      title TEXT NOT NULL DEFAULT 'Field Survey',
      questions JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `.catch(() => null);

  // Media separate from Q/A JSON — prefer free external URL links (not Neon base64)
  await sql`
    CREATE TABLE IF NOT EXISTS survey_media (
      id BIGSERIAL PRIMARY KEY,
      submission_id BIGINT REFERENCES submissions(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      mime TEXT,
      data TEXT,
      url TEXT,
      storage TEXT,
      meta JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `.catch(() => null);

  await sql`ALTER TABLE survey_media ADD COLUMN IF NOT EXISTS url TEXT`.catch(() => null);
  await sql`ALTER TABLE survey_media ADD COLUMN IF NOT EXISTS storage TEXT`.catch(() => null);
  await sql`CREATE INDEX IF NOT EXISTS idx_survey_media_sub ON survey_media(submission_id)`.catch(() => null);

  // Multi-survey: surveyors assigned to a survey (field team per survey)
  await sql`
    CREATE TABLE IF NOT EXISTS survey_assignments (
      id SERIAL PRIMARY KEY,
      survey_id INTEGER NOT NULL REFERENCES survey_form(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (survey_id, user_id)
    )
  `.catch(() => null);

  // Multi-survey: respondent list per survey (name/phone, mark done)
  await sql`
    CREATE TABLE IF NOT EXISTS survey_respondents (
      id SERIAL PRIMARY KEY,
      survey_id INTEGER NOT NULL REFERENCES survey_form(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      phone TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      done_at TIMESTAMPTZ,
      submission_id BIGINT REFERENCES submissions(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `.catch(() => null);
  await sql`CREATE INDEX IF NOT EXISTS idx_survey_respondents_survey ON survey_respondents(survey_id)`.catch(() => null);
  await sql`CREATE INDEX IF NOT EXISTS idx_survey_assignments_survey ON survey_assignments(survey_id)`.catch(() => null);

  // Seed default questions if empty
  try {
    const forms = await sql`SELECT id FROM survey_form WHERE form_key = 'default' LIMIT 1`;
    if (!forms.length) {
      await sql`
        INSERT INTO survey_form (form_key, title, questions)
        VALUES (
          'default',
          'Field Survey',
          ${JSON.stringify(DEFAULT_QUESTIONS)}::jsonb
        )
      `;
    }
  } catch (e) {
    console.warn("survey_form seed", e);
  }

  // Allow surveyor role (Client Admin creates field collectors)
  await sql`ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check`.catch(() => null);
  await sql`
    ALTER TABLE app_users
    ADD CONSTRAINT app_users_role_check
    CHECK (role IN ('admin', 'field', 'user', 'surveyor'))
  `.catch(() => null);

  // Indexes for concurrent reads / filters at scale (safe IF NOT EXISTS)
  await sql`CREATE INDEX IF NOT EXISTS idx_submissions_created_at ON submissions (created_at DESC)`.catch(() => null);
  await sql`CREATE INDEX IF NOT EXISTS idx_submissions_answers_district ON submissions ((payload->'answers'->>'district'))`.catch(() => null);
  await sql`CREATE INDEX IF NOT EXISTS idx_submissions_answers_party ON submissions ((payload->'answers'->>'winning_party'))`.catch(() => null);
  await sql`CREATE INDEX IF NOT EXISTS idx_submissions_answers_gender ON submissions ((payload->'answers'->>'gender'))`.catch(() => null);
  await sql`CREATE INDEX IF NOT EXISTS idx_submissions_answers_caste ON submissions ((payload->'answers'->>'caste'))`.catch(() => null);
  await sql`CREATE INDEX IF NOT EXISTS idx_submissions_answers_ac ON submissions ((payload->'answers'->>'constituency'))`.catch(() => null);
  await sql`CREATE INDEX IF NOT EXISTS idx_submissions_submitted_by ON submissions ((payload->>'submitted_by'))`.catch(() => null);
  await sql`CREATE INDEX IF NOT EXISTS idx_submissions_payload_gin ON submissions USING GIN (payload jsonb_path_ops)`.catch(() => null);
  await sql`CREATE INDEX IF NOT EXISTS idx_app_users_role_active ON app_users (role, active)`.catch(() => null);
  await sql`CREATE INDEX IF NOT EXISTS idx_assembly_name ON assembly_constituencies (name)`.catch(() => null);
  await sql`CREATE INDEX IF NOT EXISTS idx_districts_name ON districts (name)`.catch(() => null);
  await sql`CREATE INDEX IF NOT EXISTS idx_mandals_district ON mandals (district)`.catch(() => null);

  // Keep legacy field/user inactive; surveyors are created from admin dashboard
  await sql`
    UPDATE app_users SET active = FALSE WHERE role IN ('field', 'user')
  `.catch(() => null);

  // Seed admin only (PBKDF2 for Deno verify)
  const seeds: [string, string, string, string][] = [
    ["admin", "admin123", "System Admin", "admin"],
  ];
  for (const [username, password, display_name, role] of seeds) {
    const found = await sql`SELECT id, password_hash FROM app_users WHERE username = ${username} LIMIT 1`;
    if (!found.length) {
      const password_hash = await hashPasswordAsync(password);
      await sql`
        INSERT INTO app_users (username, password_hash, display_name, role)
        VALUES (${username}, ${password_hash}, ${display_name}, ${role})
      `;
    } else {
      if (!String((found[0] as { password_hash: string }).password_hash).startsWith("pbkdf2:")) {
        const password_hash = await hashPasswordAsync(password);
        await sql`
          UPDATE app_users
          SET password_hash = ${password_hash}, role = 'admin', active = TRUE, display_name = ${display_name}
          WHERE username = ${username}
        `;
      } else {
        await sql`
          UPDATE app_users SET role = 'admin', active = TRUE WHERE username = ${username}
        `;
      }
    }
  }
}

let schemaReady: Promise<void> | null = null;
function ready() {
  if (!schemaReady) {
    schemaReady = ensureSchema().catch((e) => {
      console.error(e);
      schemaReady = null;
    });
  }
  return schemaReady;
}

// ── Analytics helpers (filters + super-set / sub-set) ──────
function normParty(v: string) {
  const s = String(v || "").trim();
  if (!s) return "Undecided";
  if (/bjp|బీజేపీ/i.test(s)) return "BJP";
  if (/congress|కాంగ్ర/i.test(s)) return "Congress";
  if (/brs|trs|బీఆర్/i.test(s)) return "BRS";
  if (/undecided|not decided/i.test(s)) return "Undecided";
  if (/other/i.test(s)) return "Others";
  return s;
}
function normGender(v: string) {
  const s = String(v || "").trim();
  if (!s) return "Unknown";
  if (/^f|female|woman|స్త్రీ/i.test(s)) return "Female";
  if (/^m|male|man\b|పురుష/i.test(s)) return "Male";
  return s;
}
function normCaste(v: string) {
  const s = String(v || "").trim();
  if (!s) return "Unknown";
  if (/\bbc\b|backward/i.test(s)) return "BC";
  if (/\bsc\b/i.test(s)) return "SC";
  if (/\bst\b/i.test(s)) return "ST";
  if (/\boc\b|open|forward/i.test(s)) return "OC";
  if (/minority|muslim/i.test(s)) return "Minority";
  return s;
}
function normPm(v: string) {
  const s = String(v || "").trim();
  if (!s) return "Undecided";
  if (/modi|మోదీ/i.test(s)) return "Narendra Modi";
  if (/rahul|రాహుల్/i.test(s)) return "Rahul Gandhi";
  if (/undecided/i.test(s)) return "Undecided";
  if (/other/i.test(s)) return "Other";
  return s;
}
function softEq(a: string, b: string) {
  const n = (x: string) =>
    String(x || "")
      .toLowerCase()
      .replace(/\(.*?\)/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const na = n(a);
  const nb = n(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const alias: Record<string, string> = {
    jagitial: "jagtial",
    jagtial: "jagtial",
    bhongir: "bhuvanagiri",
  };
  return (alias[na] || na) === (alias[nb] || nb) || na.includes(nb) || nb.includes(na);
}

function countBy(list: { key: string }[], keyFn: (r: { key: string }) => string) {
  const map = new Map<string, number>();
  for (const r of list) {
    const k = keyFn(r) || "Unknown";
    map.set(k, (map.get(k) || 0) + 1);
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value, pct: 0 }))
    .sort((a, b) => b.value - a.value);
}
function withPct(arr: { name: string; value: number; pct: number }[]) {
  const total = arr.reduce((s, x) => s + x.value, 0) || 1;
  return arr.map((x) => ({
    ...x,
    pct: Math.round((x.value / total) * 1000) / 10,
  }));
}
function pctDist(list: Record<string, unknown>[], key: string) {
  const total = list.length || 1;
  const map = new Map<string, number>();
  for (const r of list) {
    const k = String(r[key] || "Unknown");
    map.set(k, (map.get(k) || 0) + 1);
  }
  return [...map.entries()].map(([name, value]) => ({
    name,
    value: Number(((value / total) * 100).toFixed(1)),
  }));
}
function compareSets(
  selected: { name: string; value: number }[],
  rest: { name: string; value: number }[],
  superPct: { name: string; value: number }[],
) {
  const names = new Set([
    ...selected.map((d) => d.name),
    ...rest.map((d) => d.name),
    ...superPct.map((d) => d.name),
  ]);
  return [...names]
    .map((name) => {
      const s = selected.find((d) => d.name === name)?.value ?? 0;
      const r = rest.find((d) => d.name === name)?.value ?? 0;
      const sp = superPct.find((d) => d.name === name)?.value ?? 0;
      return {
        name,
        selected: s,
        rest: r,
        super: sp,
        delta: Number((s - r).toFixed(1)),
        index: sp > 0 ? Number((s / sp).toFixed(2)) : null,
      };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

type Row = {
  id: string | number;
  created_at: string;
  district: string;
  constituency: string;
  party: string;
  gender: string;
  caste: string;
  pm: string;
  performance: string;
  education: string;
  employment: string;
  age: string;
  mp: string;
  issues: string[];
  status: string;
  completeness: string;
  geo_ok: boolean;
  voice_ok: boolean;
  submitted_by: string;
  respondent: string;
  formKey: string;
  answers: Record<string, unknown>;
};

/** Report status: pending → confirmed (analytics) | rejected */
function payloadStatus(payload: Record<string, unknown>): string {
  const s = String(payload?.status || "").toLowerCase().trim();
  if (s === "confirmed" || s === "rejected" || s === "pending") return s;
  // legacy rows without status: pending until admin confirms
  return "pending";
}

/**
 * Strict verification: geo tagging + voice (audio) required for COMPLETE.
 * Incomplete cannot enter confirmed analytics without override.
 */
function verifySubmission(
  payload: Record<string, unknown>,
  mediaKinds: string[] = [],
) {
  const geo = (payload?.geo || null) as Record<string, unknown> | null;
  const lat = geo != null ? Number(geo.lat ?? geo.latitude) : NaN;
  const lng = geo != null ? Number(geo.lng ?? geo.longitude) : NaN;
  const accuracy =
    geo != null && geo.accuracy != null ? Number(geo.accuracy) : null;

  const geo_ok =
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0);

  // Voice: session audio stored separately or flagged on payload
  const hasAudioFlag = payload?.has_audio === true;
  const hasAudioMedia = mediaKinds.includes("audio");
  const voice_ok = hasAudioFlag || hasAudioMedia;

  const hasPhotoFlag = payload?.has_photo === true;
  const hasPhotoMedia = mediaKinds.includes("photo");
  const photo_ok = hasPhotoFlag || hasPhotoMedia;

  const answers = (payload?.answers || {}) as Record<string, unknown>;
  const answerKeys = Object.keys(answers).filter(
    (k) => answers[k] != null && String(answers[k]).trim() !== "",
  );
  const qa_ok = answerKeys.length >= 1;

  const failures: string[] = [];
  if (!geo_ok) failures.push("geo_missing_or_invalid");
  if (!voice_ok) failures.push("voice_missing");
  if (!photo_ok) failures.push("photo_missing");
  if (!qa_ok) failures.push("qa_empty");

  // Strict complete = geo + voice + photo + at least one answer
  const completeness: "complete" | "incomplete" =
    geo_ok && voice_ok && photo_ok && qa_ok ? "complete" : "incomplete";

  return {
    completeness,
    geo_ok,
    voice_ok,
    photo_ok,
    qa_ok,
    geo: geo_ok
      ? { lat, lng, accuracy, at: geo?.at || null }
      : geo
      ? { lat: geo.lat, lng: geo.lng, invalid: true }
      : null,
    failures,
    checks: {
      geo_tagging: geo_ok ? "pass" : "fail",
      voice_detection: voice_ok ? "pass" : "fail",
      photo: photo_ok ? "pass" : "fail",
      qa: qa_ok ? "pass" : "fail",
    },
  };
}

function parsePayload(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

/** Decode base64 (optionally data-URL stripped already) → bytes */
function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const clean = b64.replace(/\s/g, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** True if bytes start with a known image magic (JPEG/PNG/GIF/WebP/AVIF) */
function isImageBytes(bytes: Uint8Array<ArrayBuffer>): boolean {
  if (bytes.length < 8) return false;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    // require end marker so truncated files are rejected
    for (let i = Math.max(0, bytes.length - 2); i < bytes.length; i++) {
      if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) return true;
    }
    return false;
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return true;
  }
  // GIF: "GIF8"
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return true;
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return true;
  }
  return false;
}

/** Hex encode ArrayBuffer / Uint8Array */
function toHex(buf: ArrayBuffer | Uint8Array): string {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const enc =
    typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  const hash = await crypto.subtle.digest("SHA-256", enc);
  return toHex(hash);
}

async function hmacSha256(
  key: ArrayBuffer | Uint8Array,
  msg: string,
): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(msg));
}

/**
 * Cloudflare R2 PutObject (S3-compatible, SigV4).
 *
 * Bucket endpoint (this project):
 *   https://6f54ac7c46cba07b9dac5e1548348f4f.r2.cloudflarestorage.com/election-survey-media
 *
 * Env:
 *   R2_ACCOUNT_ID / R2_ENDPOINT   (defaults filled below)
 *   R2_BUCKET                     (default: election-survey-media)
 *   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY  (required for upload)
 *   R2_PUBLIC_URL                 (public r2.dev or custom domain — required to open files)
 *
 * Free tier: 10 GB storage / month.
 */
const R2_DEFAULT_ACCOUNT_ID = "6f54ac7c46cba07b9dac5e1548348f4f";
const R2_DEFAULT_BUCKET = "election-survey-media";
const R2_DEFAULT_ENDPOINT =
  `https://${R2_DEFAULT_ACCOUNT_ID}.r2.cloudflarestorage.com`;

function r2Config(): {
  acc: string;
  host: string;
  buck: string;
  ak: string;
  sk: string;
  publicBase: string;
} {
  // Full endpoint like https://<account>.r2.cloudflarestorage.com  (optional /bucket)
  const endpointRaw = (
    Deno.env.get("R2_ENDPOINT") ||
    Deno.env.get("CLOUDFLARE_R2_ENDPOINT") ||
    R2_DEFAULT_ENDPOINT
  ).trim().replace(/\/$/, "");

  let accFromEndpoint = "";
  let hostFromEndpoint = "";
  try {
    const u = new URL(endpointRaw);
    hostFromEndpoint = u.host; // e.g. 6f54….r2.cloudflarestorage.com
    const m = hostFromEndpoint.match(/^([a-f0-9]+)\.r2\.cloudflarestorage\.com$/i);
    if (m) accFromEndpoint = m[1];
  } catch {
    /* ignore */
  }

  const accountId = (Deno.env.get("R2_ACCOUNT_ID") || "").trim();
  const accessKey = (Deno.env.get("R2_ACCESS_KEY_ID") || "").trim();
  const secretKey = (Deno.env.get("R2_SECRET_ACCESS_KEY") || "").trim();
  const bucket = (Deno.env.get("R2_BUCKET") || "").trim();
  let publicBase = (Deno.env.get("R2_PUBLIC_URL") || "").trim().replace(/\/$/, "");

  const acc =
    accountId ||
    (Deno.env.get("CLOUDFLARE_ACCOUNT_ID") || "").trim() ||
    accFromEndpoint ||
    R2_DEFAULT_ACCOUNT_ID;
  const ak = accessKey || (Deno.env.get("CLOUDFLARE_R2_ACCESS_KEY_ID") || "").trim();
  const sk = secretKey || (Deno.env.get("CLOUDFLARE_R2_SECRET_ACCESS_KEY") || "").trim();
  const buck =
    bucket ||
    (Deno.env.get("CLOUDFLARE_R2_BUCKET") || "").trim() ||
    R2_DEFAULT_BUCKET;
  publicBase =
    publicBase ||
    (Deno.env.get("CLOUDFLARE_R2_PUBLIC_URL") || "").trim().replace(/\/$/, "");

  const host = hostFromEndpoint || `${acc}.r2.cloudflarestorage.com`;
  return { acc, host, buck, ak, sk, publicBase };
}

async function uploadToCloudflareR2(
  bytes: Uint8Array<ArrayBuffer>,
  mime: string,
  objectKey: string,
): Promise<{ url: string; provider: string } | null> {
  const { acc, host, buck, ak, sk, publicBase } = r2Config();

  // Keys + public base required; account/bucket have project defaults
  if (!acc || !ak || !sk || !buck || !publicBase) {
    if (!ak || !sk) {
      console.warn("[r2] skip: missing R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY");
    } else if (!publicBase) {
      console.warn(
        "[r2] skip: set R2_PUBLIC_URL (r2.dev public link), e.g. https://pub-xxxxx.r2.dev",
      );
    }
    return null;
  }

  const region = "auto";
  const pathKey = objectKey.split("/").map(encodeURIComponent).join("/");
  const url = `https://${host}/${buck}/${pathKey}`;
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateStamp =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  const amz =
    `${dateStamp}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

  const payloadHash = await sha256Hex(bytes);
  const canonicalHeaders =
    `content-type:${mime}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amz}\n`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    "PUT",
    `/${buck}/${pathKey}`,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amz,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = await hmacSha256(
    new TextEncoder().encode("AWS4" + sk),
    dateStamp,
  );
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, "s3");
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signature = toHex(await hmacSha256(kSigning, stringToSign));

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${ak}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  // Do not set Host header manually — Deno/fetch sets it from the URL (must match signed host)
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": mime,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amz,
      Authorization: authorization,
    },
    body: bytes,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("[r2] put failed", res.status, errText.slice(0, 300));
    return null;
  }

  // Public URL for browsers (r2.dev) — not the private S3 endpoint
  const publicPath = objectKey.split("/").map(encodeURIComponent).join("/");
  return {
    url: `${publicBase}/${publicPath}`,
    provider: "cloudflare_r2",
  };
}

/**
 * Optional external upload — ONLY if already configured (never required, no card).
 * Default path is Neon (DATABASE_URL you already use) — no credit card.
 */
async function tryOptionalExternalUpload(
  bytes: Uint8Array<ArrayBuffer>,
  mime: string,
  kind: string,
  objectKey: string,
  filename: string,
): Promise<{ url: string; provider: string } | null> {
  // Cloudflare R2 only when ALL env vars set (skip if missing — no card signup needed)
  try {
    const r2 = await uploadToCloudflareR2(bytes, mime, objectKey);
    if (r2?.url) return r2;
  } catch {
    /* ignore */
  }

  const custom = (Deno.env.get("MEDIA_UPLOAD_URL") || "").trim();
  if (!custom) return null;
  try {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: mime }), filename);
    form.append("kind", kind);
    const key = Deno.env.get("MEDIA_UPLOAD_KEY") || "";
    const res = await fetch(custom, {
      method: "POST",
      body: form,
      headers: {
        "User-Agent": "GroundIQ-ElectionSurvey/1.6",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
    });
    const text = (await res.text()).trim();
    if (res.ok) {
      try {
        const j = JSON.parse(text);
        const u = j.url || j.link || j.href;
        if (u) return { url: String(u), provider: "custom" };
      } catch {
        if (text.startsWith("http")) return { url: text, provider: "custom" };
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

/**
 * Store photo/audio linked to submission.
 * DEFAULT: Neon free DB (no card) — data column + API file link.
 * OPTIONAL: R2/custom only if env already set.
 */
async function storeMediaLinked(
  bytes: Uint8Array<ArrayBuffer>,
  mime: string,
  kind: string,
): Promise<{
  url: string | null;
  provider: string;
  dataB64: string | null;
  mode: "external" | "neon";
}> {
  const ext =
    kind === "photo"
      ? "jpg"
      : mime.includes("webm")
      ? "webm"
      : mime.includes("mp4")
      ? "m4a"
      : "bin";
  const day = new Date().toISOString().slice(0, 10);
  const objectKey = `election-survey/${kind}/${day}/${crypto.randomUUID()}.${ext}`;
  const filename = `esurvey-${kind}-${Date.now()}.${ext}`;

  // Prefer external ONLY if pre-configured (Cloudflare etc.) — never force signup/card
  const external = await tryOptionalExternalUpload(
    bytes,
    mime,
    kind,
    objectKey,
    filename,
  );
  if (external) {
    return {
      url: external.url,
      provider: external.provider,
      dataB64: null,
      mode: "external",
    };
  }

  // DEFAULT: Neon — no credit card, uses your existing free Neon project
  // Cap ~700KB binary (~930KB base64) to protect free tier
  if (bytes.length > 700_000) {
    throw new Error(
      "Media too large for free Neon storage (max ~700KB). Use a smaller photo / shorter audio.",
    );
  }
  return {
    url: null, // filled after insert with /api/media/:id/file
    provider: "neon",
    dataB64: bytesToBase64(bytes),
    mode: "neon",
  };
}

function dayKey(iso: string) {
  return String(iso || "").slice(0, 10);
}

function qaFromAnswers(a: Record<string, unknown>) {
  const keys = [
    ["respondent_name", "Respondent"],
    ["district", "District"],
    ["constituency", "Assembly (AC)"],
    ["mandal", "Mandal"],
    ["gender", "Gender"],
    ["caste", "Caste"],
    ["age", "Age"],
    ["education", "Education"],
    ["employment", "Employment"],
    ["winning_party", "Winning party"],
    ["pm_preference", "PM preference"],
    ["performance", "Govt performance"],
    ["issues", "Issues"],
    ["notes", "Notes"],
    ["phone", "Phone"],
    ["data_collector", "Collector"],
  ];
  return keys
    .map(([k, label]) => {
      let v = a[k];
      if (Array.isArray(v)) v = v.join(", ");
      if (v == null || v === "") return null;
      return { q: label, a: String(v) };
    })
    .filter(Boolean) as { q: string; a: string }[];
}

async function buildAnalytics(sqlFn: NonNullable<typeof sql>, url: URL) {
  const district = (url.searchParams.get("district") || "").trim();
  const party = (url.searchParams.get("party") || "").trim();
  const gender = (url.searchParams.get("gender") || "").trim();
  const caste = (url.searchParams.get("caste") || "").trim();
  const constituency = (url.searchParams.get("constituency") || "").trim();
  // Report pipeline: default analytics = confirmed only
  // report=locked → Client Admin dashboard: force confirmed + complete (no raw/pending charts)
  const reportLocked = (url.searchParams.get("report") || "").trim().toLowerCase() === "locked";
  let statusFilter = (url.searchParams.get("status") || "confirmed").trim().toLowerCase();
  let completenessFilter = (url.searchParams.get("completeness") || "all").trim().toLowerCase();
  if (reportLocked) {
    statusFilter = "confirmed";
    completenessFilter = "complete";
  }
  let dateFrom = (url.searchParams.get("date_from") || url.searchParams.get("from") || "").trim();
  let dateTo = (url.searchParams.get("date_to") || url.searchParams.get("to") || "").trim();
  const userFilter = (url.searchParams.get("user") || url.searchParams.get("submitted_by") || "").trim();
  const formFilter = (url.searchParams.get("survey") || url.searchParams.get("form_key") || "").trim();
  // period: total | day | month | today — Client Admin data scopes
  const period = (url.searchParams.get("period") || "total").trim().toLowerCase();
  const dayParam = (url.searchParams.get("day") || "").trim(); // YYYY-MM-DD
  const monthParam = (url.searchParams.get("month") || "").trim(); // YYYY-MM
  if (period === "today") {
    const t = new Date().toISOString().slice(0, 10);
    dateFrom = t;
    dateTo = t;
  } else if (period === "day" && dayParam) {
    dateFrom = dayParam;
    dateTo = dayParam;
  } else if (period === "month" && monthParam) {
    const [y, m] = monthParam.split("-").map(Number);
    if (y && m) {
      const last = new Date(y, m, 0).getDate();
      dateFrom = `${monthParam}-01`;
      dateTo = `${monthParam}-${String(last).padStart(2, "0")}`;
    }
  }
  // period=total → leave dateFrom/dateTo as provided (or empty = all time)

  // AC name → first covering district (excel often puts AC in respondent_name)
  const acRows = await sqlFn`
    SELECT name, covering_districts, mp_constituency FROM assembly_constituencies
  `.catch(() => []);

  type AcEntry = { canonical: string; district: string; covering: string[]; mp: string };
  const acList: AcEntry[] = [];
  for (const ac of acRows as {
    name: string;
    covering_districts: string;
    mp_constituency: string;
  }[]) {
    const covering = String(ac.covering_districts || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    acList.push({
      canonical: String(ac.name || "").trim(),
      district: covering[0] || "",
      covering,
      mp: String(ac.mp_constituency || "").replace(/\s*\(.*?\)\s*$/, "").trim(),
    });
  }

  function softNameEq(a: string, b: string) {
    const n = (s: string) =>
      String(s || "")
        .toLowerCase()
        .replace(/\(.*?\)/g, " ")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return n(a) === n(b);
  }

  /** One row → one district only (primary AC district). No multi-cover overlap. */
  function exclusiveDistrict(surveyDistrict: string, resolved: AcEntry | null) {
    const sd = String(surveyDistrict || "").trim();
    if (!resolved) return sd || "Unknown";
    const covering = resolved.covering || [];
    const primary = resolved.district || covering[0] || "";
    if (sd && covering.some((d) => softNameEq(d, sd))) {
      return covering.find((d) => softNameEq(d, sd)) || sd;
    }
    return primary || sd || "Unknown";
  }

  function resolveAc(name: string): AcEntry | null {
    if (!name?.trim()) return null;
    const key = name
      .toLowerCase()
      .replace(/\(.*?\)/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!key) return null;
    // exact-ish
    for (const ac of acList) {
      const n = ac.canonical
        .toLowerCase()
        .replace(/\(.*?\)/g, " ")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (n === key) return ac;
    }
    // Safe fuzzy: longest unique match only (no ambiguous cross-AC hits)
    if (key.length < 5) return null;
    let best: AcEntry | null = null;
    let bestLen = 0;
    let ties = 0;
    for (const ac of acList) {
      const n = ac.canonical
        .toLowerCase()
        .replace(/\(.*?\)/g, " ")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!n || n.length < 5) continue;
      const hit =
        n === key ||
        (n.includes(key) && key.length >= 5) ||
        (key.includes(n) && n.length >= 5);
      if (!hit) continue;
      const score = Math.min(n.length, key.length);
      if (score > bestLen) {
        best = ac;
        bestLen = score;
        ties = 1;
      } else if (score === bestLen && best && best.canonical !== ac.canonical) {
        ties += 1;
      }
    }
    if (ties > 1) return null;
    return best;
  }

  const raw = await sqlFn`
    SELECT id, payload, created_at
    FROM submissions
    ORDER BY created_at DESC
    LIMIT 10000
  `;

  const allRows: Row[] = (raw as Record<string, unknown>[]).map((row) => {
    let payload = row.payload as Record<string, unknown>;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        payload = {};
      }
    }
    const a = (payload?.answers as Record<string, unknown>) || payload || {};
    let dist = String(a.district || "").trim();
    let ac = String(a.constituency || a.assembly_constituency || "").trim();
    const respondent = String(a.respondent_name || a.respondentName || "").trim();

    // Resolve AC — exclusive single district (primary only, no multi-cover overlap)
    let resolved = resolveAc(ac) || resolveAc(respondent);
    if (resolved) {
      ac = resolved.canonical;
      dist = exclusiveDistrict(dist, resolved);
    }

    let issues = a.issues as string[] | string;
    if (typeof issues === "string") {
      issues = issues.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
    }
    if (!Array.isArray(issues)) issues = [];

    const status = payloadStatus(payload);
    const verify = verifySubmission(payload, []);
    return {
      id: row.id as string | number,
      created_at: String(row.created_at || ""),
      district: dist || "Unknown",
      constituency: ac || "Unknown",
      party: normParty(String(a.winning_party || a.winningParty || "")),
      gender: normGender(String(a.gender || "")),
      caste: normCaste(String(a.caste || "")),
      pm: normPm(String(a.pm_preference || a.pmPreference || "")),
      performance: String(a.performance || a.govt_performance || "Unknown") || "Unknown",
      education: String(a.education || "Unknown") || "Unknown",
      employment: String(a.employment || a.occupation || "Unknown") || "Unknown",
      age: String(a.age || a.age_group || "Unknown") || "Unknown",
      mp: String(a.mp_constituency || a.mpConstituency || "")
        .replace(/\s*\(.*?\)\s*$/, "")
        .trim() || resolved?.mp || "",
      issues: issues as string[],
      status,
      completeness: verify.completeness,
      geo_ok: verify.geo_ok,
      voice_ok: verify.voice_ok,
      submitted_by: String(
        payload.submitted_by || a.data_collector || "",
      ),
      respondent: respondent || String(a.respondent_name || ""),
      formKey: String(payload.form_key || payload.formKey || "default"),
      answers: a,
    };
  });

  const statusCounts = {
    pending: allRows.filter((r) => r.status === "pending").length,
    confirmed: allRows.filter((r) => r.status === "confirmed").length,
    rejected: allRows.filter((r) => r.status === "rejected").length,
    total: allRows.length,
  };

  // Analytics universe: confirmed report by default (after Q/A confirm)
  let universe = allRows;
  if (statusFilter === "confirmed") {
    universe = allRows.filter((r) => r.status === "confirmed");
  } else if (statusFilter === "pending") {
    universe = allRows.filter((r) => r.status === "pending");
  } else if (statusFilter === "rejected") {
    universe = allRows.filter((r) => r.status === "rejected");
  }
  // status=all → full universe

  // Client Admin: date + user scope before charts
  if (dateFrom) {
    universe = universe.filter((r) => dayKey(r.created_at) >= dateFrom);
  }
  if (dateTo) {
    universe = universe.filter((r) => dayKey(r.created_at) <= dateTo);
  }
  if (userFilter) {
    const uf = userFilter.toLowerCase();
    universe = universe.filter((r) =>
      String(r.submitted_by || "").toLowerCase().includes(uf)
    );
  }
  if (formFilter) {
    universe = universe.filter((r) =>
      String(r.formKey || "") === formFilter
    );
  }

  // Dynamic filters: q_<questionId>=value (driven by survey questions)
  const dynFilters = new Map<string, string>();
  for (const [k, v] of url.searchParams) {
    if (k.startsWith("q_") && v) dynFilters.set(k.slice(2), v);
  }
  if (dynFilters.size) {
    universe = universe.filter((r) => {
      for (const [qid, want] of dynFilters) {
        const av = r.answers?.[qid];
        const hit = Array.isArray(av)
          ? av.map(String).includes(want)
          : String(av ?? "") === want;
        if (!hit) return false;
      }
      return true;
    });
  }

  // Survey questions → dynamic filter bar (options from defined choices + submitted answers)
  const surveyQuestions: { id: string; label: string; type: string; options: string[] }[] = [];
  if (formFilter) {
    const frows = await sqlFn`
      SELECT questions FROM survey_form WHERE form_key = ${formFilter} LIMIT 1
    `.catch(() => []);
    if (frows.length) {
      let qs = (frows[0] as { questions: unknown }).questions;
      if (typeof qs === "string") {
        try { qs = JSON.parse(qs); } catch { qs = []; }
      }
      if (Array.isArray(qs)) {
        for (const q of qs as Record<string, unknown>[]) {
          const type = String(q.type || "text");
          const defined = Array.isArray(q.options) ? q.options.map(String) : [];
          const seen = new Set<string>(defined);
          if (type === "text" || !defined.length) {
            for (const r of universe) {
              const av = r.answers?.[String(q.id || "")];
              const vals = Array.isArray(av) ? av.map(String) : [String(av ?? "")];
              for (const v of vals) if (v && v !== "Unknown") seen.add(v);
            }
          }
          surveyQuestions.push({
            id: String(q.id || ""),
            label: String(q.label || q.id || ""),
            type,
            options: [...seen].slice(0, 100),
          });
        }
      }
    }
  }
  if (completenessFilter === "complete") {
    universe = universe.filter((r) => r.completeness === "complete");
  } else if (completenessFilter === "incomplete") {
    universe = universe.filter((r) => r.completeness === "incomplete");
  }

  const totalAll = universe.length;
  const filterOptions = {
    districts: [...new Set(universe.map((r) => r.district).filter((d) => d && d !== "Unknown"))].sort(),
    parties: [...new Set(universe.map((r) => r.party))].sort(),
    genders: [...new Set(universe.map((r) => r.gender))].sort(),
    castes: [...new Set(universe.map((r) => r.caste))].sort(),
    constituencies: [
      ...new Set(universe.map((r) => r.constituency).filter((c) => c && c !== "Unknown")),
    ]
      .sort()
      .slice(0, 200),
    statuses: ["confirmed", "pending", "rejected", "all"],
    users: [...new Set(universe.map((r) => r.submitted_by).filter(Boolean))].sort().slice(0, 200),
    completeness: ["complete", "incomplete", "all"],
  };

  let subset = universe;
  if (district) subset = subset.filter((r) => softEq(r.district, district));
  if (party) subset = subset.filter((r) => r.party === party);
  if (gender) subset = subset.filter((r) => r.gender === gender);
  if (caste) subset = subset.filter((r) => r.caste === caste);
  if (constituency) subset = subset.filter((r) => softEq(r.constituency, constituency));

  const isFiltered = subset.length < universe.length;
  const subsetIds = new Set(subset.map((r) => r.id));
  const restRows = universe.filter((r) => !subsetIds.has(r.id));
  const rows = subset;

  const countKey = (list: Row[], key: keyof Row) =>
    withPct(
      countBy(
        list.map((r) => ({ key: String(r[key]) })),
        (r) => r.key,
      ),
    );

  const byParty = countKey(rows, "party");
  // ALL districts with data for maps (no artificial top-N cut that hides small districts)
  const byDistrictRaw = countBy(
    rows.map((r) => ({ key: r.district })),
    (r) => r.key,
  );
  const byDistrict = withPct(
    byDistrictRaw.filter((d) => d.name !== "Unknown"),
  );
  const byGender = countKey(rows, "gender");
  const byCaste = countKey(rows, "caste");
  const byPm = countKey(rows, "pm");
  const byPerformance = countKey(rows, "performance").slice(0, 10);
  const byEducation = countKey(rows, "education").slice(0, 10);
  const byEmployment = countKey(rows, "employment").slice(0, 10);
  // Full AC list for assembly map coloring (not just top 12)
  const byConstituency = withPct(
    countBy(
      rows.filter((r) => r.constituency !== "Unknown").map((r) => ({ key: r.constituency })),
      (r) => r.key,
    ),
  );
  const byAge = countKey(rows, "age");
  const byMp = withPct(
    countBy(
      rows.filter((r) => r.mp).map((r) => ({ key: r.mp })),
      (r) => r.key,
    ),
  );

  const issueMap = new Map<string, number>();
  for (const r of rows) {
    for (const iss of r.issues) {
      const name = String(iss).trim();
      if (!name) continue;
      issueMap.set(name, (issueMap.get(name) || 0) + 1);
    }
  }
  const issues = withPct(
    [...issueMap.entries()]
      .map(([name, value]) => ({ name, value, pct: 0 }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 12),
  );

  const dayMap = new Map<string, number>();
  for (const r of rows) {
    const day = (r.created_at || "").slice(0, 10);
    if (!day) continue;
    dayMap.set(day, (dayMap.get(day) || 0) + 1);
  }
  const timeline = [...dayMap.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-60);

  // Cross-tabs for maps
  const partyOrder = ["Congress", "BJP", "BRS", "Others", "Undecided"];
  function crossTab(list: Row[], rowKey: keyof Row, colKey: keyof Row) {
    const rowMap = new Map<string, Record<string, number | string>>();
    for (const r of list) {
      const rk = String(r[rowKey] || "Unknown");
      const ck = String(r[colKey] || "Unknown");
      if (!rowMap.has(rk)) rowMap.set(rk, { name: rk, total: 0 });
      const row = rowMap.get(rk)!;
      row[ck] = Number(row[ck] || 0) + 1;
      row.total = Number(row.total || 0) + 1;
    }
    const columns = partyOrder;
    const outRows = [...rowMap.values()]
      .map((r) => {
        for (const c of columns) if (r[c] == null) r[c] = 0;
        return r;
      })
      .sort((a, b) => Number(b.total) - Number(a.total));
    return { columns, rows: outRows };
  }

  const partyByDistrict = crossTab(rows, "district", "party");
  const partyByDistrictChart = {
    columns: partyByDistrict.columns,
    rows: partyByDistrict.rows.slice(0, 12),
  };
  const partyByCaste = crossTab(rows, "caste", "party");
  const partyByGender = crossTab(rows, "gender", "party");
  const partyByConstituency = crossTab(
    rows.filter((r) => r.constituency !== "Unknown"),
    "constituency",
    "party",
  );
  const partyByMp = crossTab(
    rows.filter((r) => r.mp),
    "mp",
    "party",
  );

  const contrastParty = isFiltered
    ? compareSets(pctDist(subset, "party"), pctDist(restRows, "party"), pctDist(universe, "party"))
    : [];
  const contrastGender = isFiltered
    ? compareSets(pctDist(subset, "gender"), pctDist(restRows, "gender"), pctDist(universe, "gender"))
    : [];
  const contrastCaste = isFiltered
    ? compareSets(pctDist(subset, "caste"), pctDist(restRows, "caste"), pctDist(universe, "caste"))
    : [];
  const contrastPm = isFiltered
    ? compareSets(pctDist(subset, "pm"), pctDist(restRows, "pm"), pctDist(universe, "pm"))
    : [];

  const topParty = byParty[0];
  const topIssue = issues[0];
  const topDistrict = byDistrict[0];

  return {
    totalAll,
    filtered: rows.length,
    restCount: restRows.length,
    isFiltered,
    reportStatus: statusFilter,
    reportLocked,
    statusCounts,
    completenessCounts: {
      complete: universe.filter((r) => r.completeness === "complete").length,
      incomplete: universe.filter((r) => r.completeness === "incomplete").length,
    },
    pipeline: {
      step: "1 Users → 2 Collect → 3 Verify geo+voice → 4 Client Admin confirms → 5 Report forms",
      analytics_on: statusFilter,
      note: reportLocked
        ? "Dashboard locked to confirmed + complete only. Unconfirmed data never forms charts."
        : statusFilter === "confirmed"
        ? "Report uses confirmed surveys. Strict geo + voice required for complete."
        : `Analytics scope: ${statusFilter}`,
    },
    filters: {
      district,
      party,
      gender,
      caste,
      constituency,
      status: statusFilter,
      date_from: dateFrom || null,
      date_to: dateTo || null,
      user: userFilter || null,
      survey: formFilter || null,
      completeness: completenessFilter,
      period,
      day: dayParam || null,
      month: monthParam || null,
    },
    // Client Admin summaries: daily / monthly / surveyor daily / surveyor monthly
    dataFilters: {
      period,
      total: universe.length,
      by_user: (() => {
        const map = new Map<string, number>();
        for (const r of universe) {
          const u = r.submitted_by || "unknown";
          map.set(u, (map.get(u) || 0) + 1);
        }
        return [...map.entries()]
          .map(([name, value]) => ({
            name,
            value,
            pct: universe.length
              ? Math.round((value / universe.length) * 1000) / 10
              : 0,
          }))
          .sort((a, b) => b.value - a.value);
      })(),
      by_day: (() => {
        const map = new Map<string, number>();
        for (const r of universe) {
          const d = dayKey(r.created_at) || "unknown";
          map.set(d, (map.get(d) || 0) + 1);
        }
        return [...map.entries()]
          .map(([name, value]) => ({ name, value }))
          .sort((a, b) => b.name.localeCompare(a.name));
      })(),
      by_month: (() => {
        const map = new Map<string, number>();
        for (const r of universe) {
          const m = dayKey(r.created_at).slice(0, 7) || "unknown";
          map.set(m, (map.get(m) || 0) + 1);
        }
        return [...map.entries()]
          .map(([name, value]) => ({ name, value }))
          .sort((a, b) => b.name.localeCompare(a.name));
      })(),
      // Surveyor × day (each surveyor's daily totals)
      by_surveyor_day: (() => {
        const map = new Map<string, { surveyor: string; day: string; value: number }>();
        for (const r of universe) {
          const surveyor = r.submitted_by || "unknown";
          const day = dayKey(r.created_at) || "unknown";
          const key = `${surveyor}::${day}`;
          const cur = map.get(key);
          if (cur) cur.value += 1;
          else map.set(key, { surveyor, day, value: 1 });
        }
        return [...map.values()].sort((a, b) => {
          const d = b.day.localeCompare(a.day);
          if (d !== 0) return d;
          return b.value - a.value || a.surveyor.localeCompare(b.surveyor);
        });
      })(),
      // Dynamic per-question filter dropdowns (from the selected survey)
      questions: surveyQuestions.map((q) => ({
        id: q.id,
        label: q.label,
        type: q.type,
        options: q.options,
        counts: (() => {
          const map = new Map<string, number>();
          for (const r of universe) {
            const av = r.answers?.[q.id];
            const vals = Array.isArray(av) ? av.map(String) : [String(av ?? "")];
            for (const v of vals) {
              if (!v || v === "Unknown") continue;
              map.set(v, (map.get(v) || 0) + 1);
            }
          }
          return [...map.entries()]
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 100);
        })(),
      })),
      // Surveyor × month (each surveyor's monthly totals)
      by_surveyor_month: (() => {
        const map = new Map<string, { surveyor: string; month: string; value: number }>();
        for (const r of universe) {
          const surveyor = r.submitted_by || "unknown";
          const month = dayKey(r.created_at).slice(0, 7) || "unknown";
          const key = `${surveyor}::${month}`;
          const cur = map.get(key);
          if (cur) cur.value += 1;
          else map.set(key, { surveyor, month, value: 1 });
        }
        return [...map.values()].sort((a, b) => {
          const m = b.month.localeCompare(a.month);
          if (m !== 0) return m;
          return b.value - a.value || a.surveyor.localeCompare(b.surveyor);
        });
      })(),
    },
    filterOptions,
    formula: {
      name: "Super-set / Sub-set",
      description:
        "Subset = filtered selection. Superset = confirmed (or selected status) surveys. Rest = Superset − Subset. Δpp = Subset% − Rest%. Index = Subset% / Superset%.",
      superset_n: totalAll,
      subset_n: subset.length,
      rest_n: restRows.length,
      is_filtered: isFiltered,
      equations: [
        "Subset% = count_in_subset / |subset| × 100",
        "Rest% = count_in_rest / |rest| × 100",
        "Δpp = Subset% − Rest%",
        "Index = Subset% / Superset%",
      ],
    },
    insights: {
      topParty: topParty
        ? `${topParty.name} leads with ${topParty.pct}% (${topParty.value})`
        : "No party data",
      topIssue: topIssue ? `Top issue: ${topIssue.name} (${topIssue.value})` : "No issues tagged",
      topDistrict: topDistrict
        ? `Most responses: ${topDistrict.name} (${topDistrict.value})`
        : "No district data",
      coverage: `${rows.length.toLocaleString()} of ${totalAll.toLocaleString()} records`,
      contrast:
        isFiltered && contrastParty[0]
          ? `Subset vs Rest: ${contrastParty[0].name} Δ ${
            contrastParty[0].delta > 0 ? "+" : ""
          }${contrastParty[0].delta}pp`
          : "Apply a filter to compare Subset vs Superset/Rest",
    },
    charts: {
      byParty,
      byDistrict,
      byGender,
      byCaste,
      byPm,
      byPerformance,
      byEducation,
      byEmployment,
      byConstituency,
      byAge,
      byMp,
      issues,
      timeline,
      partyByDistrict: partyByDistrictChart,
      partyByDistrictFull: partyByDistrict,
      partyByConstituency,
      partyByMp,
      partyByCaste,
      partyByGender,
      contrastParty,
      contrastGender,
      contrastCaste,
      contrastPm,
    },
  };
}

// ── Router ────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const url = new URL(req.url);
  const path = url.pathname.replace(/\/$/, "") || "/";
  const method = req.method;

  try {
    if (!sql) return json({ error: "DATABASE_URL not set" }, 500);
    await ready();

    // Health
    if (path === "/" || path === "/api/health") {
      const r2 = r2Config();
      const r2Status = {
        keys_configured: Boolean(r2.ak && r2.sk),
        public_url_configured: Boolean(r2.publicBase),
        ready: Boolean(r2.ak && r2.sk && r2.publicBase && r2.buck),
      };
      if (path === "/") {
        return json({
          message: "Election Survey API on Deno Deploy",
          platform: "deno",
          auth: true,
          r2: r2Status,
        });
      }
      await sql`SELECT 1`;
      return json({
        ok: true,
        database: "connected",
        auth: true,
        platform: "deno",
        r2: r2Status,
      });
    }

    // Login — admin portal OR surveyor field app (accounts created by Client Admin only)
    if (path === "/api/auth/login" && method === "POST") {
      const body = await readBody(req);
      const username = String(body.username || "").trim().toLowerCase();
      const password = String(body.password || "");
      const expectedRole = String(body.expected_role || "").trim().toLowerCase();
      if (!username || !password) {
        return json({ error: "Username and password required" }, 400);
      }
      const rows = await sql`
        SELECT * FROM app_users WHERE LOWER(username) = ${username} LIMIT 1
      `;
      const user = rows[0] as {
        id: number;
        username: string;
        display_name: string;
        role: string;
        active: boolean;
        created_at: string;
        password_hash: string;
      } | undefined;
      if (!user || !user.active) {
        return json({
          error: "Invalid username or password. Use the login Client Admin created for you.",
        }, 401);
      }
      // Only admin (portal) or surveyor (field app). No public signup / legacy field/user.
      if (user.role !== "admin" && user.role !== "surveyor") {
        return json({
          error:
            "Account not allowed. Ask Client Admin to create a surveyor login for the field app.",
        }, 403);
      }
      // Field app must send expected_role=surveyor — rejects admin & wrong roles
      if (expectedRole === "surveyor") {
        if (user.role !== "surveyor") {
          return json({
            error:
              user.role === "admin"
                ? "Client Admin uses the web portal (/admin), not the field app."
                : "This login is not a surveyor account. Ask Client Admin for a field-app login.",
          }, 403);
        }
      }
      // Portal must send expected_role=admin
      if (expectedRole === "admin") {
        if (user.role !== "admin") {
          return json({
            error:
              "Client Admin portal only. Surveyors sign in on the field app with their app login.",
          }, 403);
        }
      }
      const ok = await verifyPassword(password, user.password_hash);
      if (!ok) {
        return json({
          error: "Invalid username or password. Use the login Client Admin created for you.",
        }, 401);
      }

      const token = newToken();
      const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await sql`
        INSERT INTO app_sessions (token, user_id, expires_at)
        VALUES (${token}, ${user.id}, ${expires.toISOString()})
      `;
      return json({
        token,
        user: {
          id: user.id,
          username: user.username,
          name: user.display_name || user.username,
          role: user.role,
          active: user.active,
          created_at: user.created_at,
        },
        expires_at: expires.toISOString(),
        access:
          user.role === "admin"
            ? "client_admin_portal"
            : "surveyor_field_app",
        note:
          user.role === "surveyor"
            ? "Login created by Client Admin — field app only"
            : "Client Admin portal access",
      });
    }

    // Public registration disabled — only Client Admin creates accounts
    if (path === "/api/auth/register" && method === "POST") {
      return json({
        error:
          "No self-signup. Client Admin must create your surveyor login in the Users screen.",
      }, 403);
    }

    // Auth-required helpers
    const token = bearer(req);
    const me = await getUser(token);

    if (path === "/api/auth/me" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      return json({ user: me });
    }

    if (path === "/api/auth/logout" && method === "POST") {
      if (token) await sql`DELETE FROM app_sessions WHERE token = ${token}`;
      return json({ ok: true });
    }

    if (path === "/api/stats" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      const [subs] = await sql`SELECT COUNT(*)::int AS n FROM submissions`;
      const [dists] = await sql`SELECT COUNT(*)::int AS n FROM districts`.catch(() => [{ n: 0 }]);
      const [mands] = await sql`SELECT COUNT(*)::int AS n FROM mandals`.catch(() => [{ n: 0 }]);
      const [acs] = await sql`SELECT COUNT(*)::int AS n FROM assembly_constituencies`.catch(() => [{ n: 0 }]);
      const [srs] = await sql`SELECT COUNT(*)::int AS n FROM survey_responses`.catch(() => [{ n: 0 }]);

      // Primary KPIs = survey coverage (same as maps/filters), not full master geo tables
      let surveyDistricts = 0;
      let surveyAcs = 0;
      try {
        const emptyUrl = new URL("http://local/api/analytics?status=all");
        const analytics = await buildAnalytics(sql, emptyUrl);
        surveyDistricts = analytics.filterOptions?.districts?.length ?? 0;
        surveyAcs = analytics.filterOptions?.constituencies?.length ?? 0;
      } catch {
        // fall back to 0 if analytics fails
      }

      // Pipeline counts (pending / confirmed)
      let pending = 0;
      let confirmed = 0;
      let rejected = 0;
      try {
        const sample = await sql`
          SELECT payload FROM submissions ORDER BY created_at DESC LIMIT 10000
        `;
        for (const r of sample as { payload: Record<string, unknown> }[]) {
          let p = r.payload;
          if (typeof p === "string") {
            try {
              p = JSON.parse(p);
            } catch {
              p = {};
            }
          }
          const st = payloadStatus(p as Record<string, unknown>);
          if (st === "confirmed") confirmed += 1;
          else if (st === "rejected") rejected += 1;
          else pending += 1;
        }
      } catch {
        /* ignore */
      }

      return json({
        submissions: subs?.n ?? 0,
        survey_responses: srs?.n ?? 0,
        pending,
        confirmed,
        rejected,
        // Survey coverage from confirmed analytics universe
        districts: surveyDistricts,
        assembly_constituencies: surveyAcs,
        districts_master: dists?.n ?? 0,
        mandals: mands?.n ?? 0,
        assembly_constituencies_master: acs?.n ?? 0,
        my_submissions: 0,
        role: me.role,
        platform: "deno",
        pipeline: "users → Q/A → confirm → analytics",
      });
    }

    // Count completed records for one surveyor (by user_id or username/name)
    async function countDoneForUser(u: {
      id: number;
      username: string;
      name?: string;
      display_name?: string;
    }) {
      if (!sql) return 0;
      const uid = String(u.id);
      const uname = u.username;
      const dname = u.name || u.display_name || uname;
      const rows = await sql`
        SELECT COUNT(*)::int AS n FROM submissions
        WHERE payload->>'user_id' = ${uid}
           OR payload->>'submitted_by' = ${uname}
           OR payload->>'submitted_by' = ${dname}
           OR payload->'answers'->>'data_collector' = ${uname}
           OR payload->'answers'->>'data_collector' = ${dname}
      `.catch(() => [{ n: 0 }]);
      return rows[0]?.n ?? 0;
    }

    function progressStatus(done: number, target: number) {
      if (!target || target <= 0) {
        return done > 0 ? "in_progress" : "no_target";
      }
      if (done >= target) return "completed";
      if (done > 0) return "in_progress";
      return "not_started";
    }

    // ── Progress: surveyor self + admin board ───────────────
    if (path === "/api/progress/me" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      const rows = await sql`
        SELECT id, username, display_name, role, active, COALESCE(target_quota, 0) AS target_quota
        FROM app_users WHERE id = ${me.id} LIMIT 1
      `.catch(async () => {
        // column missing fallback
        const r = await sql`
          SELECT id, username, display_name, role, active FROM app_users WHERE id = ${me.id} LIMIT 1
        `;
        return r.map((x: Record<string, unknown>) => ({ ...x, target_quota: 0 }));
      });
      const u = rows[0] as {
        id: number;
        username: string;
        display_name: string;
        target_quota: number;
      };
      if (!u) return json({ error: "User not found" }, 404);
      const done = await countDoneForUser({
        id: u.id,
        username: u.username,
        display_name: u.display_name,
      });
      const target = Number(u.target_quota) || 0;
      const remaining = target > 0 ? Math.max(0, target - done) : null;
      const pct = target > 0 ? Math.min(100, Math.round((done / target) * 100)) : null;
      const status = progressStatus(done, target);
      return json({
        user_id: u.id,
        username: u.username,
        name: u.display_name || u.username,
        target,
        done,
        remaining,
        pct,
        status,
        next_record: target > 0 ? Math.min(done + 1, target) : done + 1,
        complete: status === "completed",
        label:
          target > 0
            ? `${done} / ${target} records · ${status}`
            : `${done} records (no target set)`,
      });
    }

    if (path === "/api/progress" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "admin") return json({ error: "Admin only" }, 403);
      const rows = await sql`
        SELECT id, username, display_name, role, active, COALESCE(target_quota, 0) AS target_quota, created_at
        FROM app_users
        WHERE role IN ('surveyor', 'field')
        ORDER BY id
      `.catch(async () => {
        const r = await sql`
          SELECT id, username, display_name, role, active, created_at
          FROM app_users WHERE role IN ('surveyor', 'field') ORDER BY id
        `;
        return r.map((x: Record<string, unknown>) => ({ ...x, target_quota: 0 }));
      });
      const surveyors = [];
      for (const r of rows as {
        id: number;
        username: string;
        display_name: string;
        active: boolean;
        target_quota: number;
        created_at: string;
      }[]) {
        const done = await countDoneForUser(r);
        const target = Number(r.target_quota) || 0;
        const status = progressStatus(done, target);
        surveyors.push({
          id: r.id,
          username: r.username,
          name: r.display_name || r.username,
          active: r.active,
          target,
          done,
          remaining: target > 0 ? Math.max(0, target - done) : null,
          pct: target > 0 ? Math.min(100, Math.round((done / target) * 100)) : null,
          status,
          label:
            target > 0
              ? `${done}/${target}`
              : `${done}/—`,
          created_at: r.created_at,
        });
      }
      const totals = {
        surveyors: surveyors.length,
        targets: surveyors.reduce((s, x) => s + (x.target || 0), 0),
        done: surveyors.reduce((s, x) => s + x.done, 0),
        completed_users: surveyors.filter((x) => x.status === "completed").length,
        in_progress: surveyors.filter((x) => x.status === "in_progress").length,
      };
      return json({ surveyors, totals });
    }

    // Admin sets quota for one or all surveyors
    if (path === "/api/progress/quota" && method === "POST") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "admin") return json({ error: "Admin only" }, 403);
      const body = await readBody(req);
      const target = Math.max(0, Math.min(Number(body.target) || 0, 100000));
      if (body.user_id) {
        await sql`
          UPDATE app_users SET target_quota = ${target} WHERE id = ${Number(body.user_id)}
        `;
        return json({ ok: true, user_id: Number(body.user_id), target });
      }
      if (body.all_surveyors) {
        await sql`
          UPDATE app_users SET target_quota = ${target} WHERE role = 'surveyor'
        `;
        return json({ ok: true, all_surveyors: true, target });
      }
      return json({ error: "Provide user_id or all_surveyors:true" }, 400);
    }

    // ── Users: list / generate (admin) ───────────────────────
    if (path === "/api/users" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "admin") return json({ error: "Admin only" }, 403);
      const assignedRows = await sql`
        SELECT sa.user_id, f.id AS survey_id, f.title, f.form_key
        FROM survey_assignments sa JOIN survey_form f ON f.id = sa.survey_id
        ORDER BY f.title
      `.catch(() => []);
      const assignedMap = new Map<number, { id: number; title: string; form_key: string }[]>();
      for (const a of assignedRows as {
        user_id: number;
        survey_id: number;
        title: string;
        form_key: string;
      }[]) {
        const arr = assignedMap.get(Number(a.user_id)) || [];
        arr.push({ id: Number(a.survey_id), title: a.title, form_key: a.form_key });
        assignedMap.set(Number(a.user_id), arr);
      }
      const rows = await sql`
        SELECT id, username, display_name, role, active, created_at,
               COALESCE(target_quota, 0) AS target_quota
        FROM app_users
        ORDER BY id
      `.catch(async () =>
        await sql`
          SELECT id, username, display_name, role, active, created_at
          FROM app_users ORDER BY id
        `
      );
      const users = [];
      for (const r of rows as Record<string, unknown>[]) {
        let done = 0;
        if (r.role === "surveyor" || r.role === "field") {
          done = await countDoneForUser({
            id: Number(r.id),
            username: String(r.username),
            display_name: String(r.display_name || r.username),
          });
        }
        const target = Number(r.target_quota) || 0;
        const isCollector = r.role === "surveyor" || r.role === "field";
        users.push({
          id: r.id,
          username: r.username,
          name: r.display_name || r.username,
          role: r.role,
          active: r.active,
          created_at: r.created_at,
          target_quota: target,
          done,
          surveys: assignedMap.get(Number(r.id)) || [],
          status: isCollector ? progressStatus(done, target) : "admin",
          progress_label: isCollector
            ? target > 0
              ? `${done}/${target}`
              : `${done}/—`
            : "—",
        });
      }
      return json({ users });
    }

    if (path === "/api/users" && method === "POST") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "admin") return json({ error: "Admin only" }, 403);
      const body = await readBody(req);
      const username = String(body.username || "").trim().toLowerCase();
      const password = String(body.password || "");
      const name = String(body.name || username).trim();
      const target_quota = Math.max(0, Math.min(Number(body.target_quota) || 0, 100000));
      // surveyor = field collector (can login field app); admin = portal only
      const role = body.role === "admin" ? "admin" : "surveyor";
      if (!username || !password) {
        return json({ error: "username and password required" }, 400);
      }
      if (password.length < 4) {
        return json({ error: "Password min 4 characters" }, 400);
      }
      // Ensure role check allows surveyor
      await sql`ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check`.catch(() => null);
      await sql`
        ALTER TABLE app_users
        ADD CONSTRAINT app_users_role_check
        CHECK (role IN ('admin', 'field', 'user', 'surveyor'))
      `.catch(() => null);
      await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS target_quota INTEGER NOT NULL DEFAULT 0`
        .catch(() => null);
      try {
        const password_hash = await hashPasswordAsync(password);
        const inserted = await sql`
          INSERT INTO app_users (username, password_hash, display_name, role, target_quota, active)
          VALUES (${username}, ${password_hash}, ${name}, ${role}, ${target_quota}, TRUE)
          RETURNING id, username, display_name, role, active, created_at, target_quota
        `;
        const u = inserted[0] as Record<string, unknown>;
        return json({
          user: {
            id: u.id,
            username: u.username,
            name: u.display_name || u.username,
            role: u.role,
            active: u.active !== false,
            created_at: u.created_at,
            target_quota: u.target_quota ?? target_quota,
          },
          field_app_access: role === "surveyor",
          field_app_login: role === "surveyor"
            ? { username, note: "Use these credentials on field app (/) " }
            : null,
        }, 201);
      } catch (e) {
        const msg = (e as Error).message || "";
        if (msg.includes("unique") || msg.includes("duplicate")) {
          return json({ error: "Username already exists" }, 409);
        }
        return json({ error: msg || "Could not create user" }, 500);
      }
    }

    // Bulk generate surveyors: { count, prefix, password, target_quota }
    if (path === "/api/users/generate" && method === "POST") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "admin") return json({ error: "Admin only" }, 403);
      const body = await readBody(req);
      const count = Math.min(Math.max(Number(body.count) || 1, 1), 100);
      const prefix = String(body.prefix || "s").trim().toLowerCase().replace(/[^a-z0-9_]/g, "") || "s";
      const password = String(body.password || "survey123");
      const target_quota = Math.max(0, Math.min(Number(body.target_quota) || 0, 100000));
      const created: {
        username: string;
        password: string;
        name: string;
        target_quota: number;
      }[] = [];
      await sql`ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check`.catch(() => null);
      await sql`
        ALTER TABLE app_users
        ADD CONSTRAINT app_users_role_check
        CHECK (role IN ('admin', 'field', 'user', 'surveyor'))
      `.catch(() => null);
      await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS target_quota INTEGER NOT NULL DEFAULT 0`
        .catch(() => null);

      const password_hash = await hashPasswordAsync(password);
      const errors: string[] = [];
      for (let i = 1; i <= count; i++) {
        const username = `${prefix}${String(i).padStart(3, "0")}`;
        const name = `Surveyor ${username}`;
        try {
          await sql`
            INSERT INTO app_users (username, password_hash, display_name, role, target_quota, active)
            VALUES (${username}, ${password_hash}, ${name}, ${"surveyor"}, ${target_quota}, TRUE)
          `;
          created.push({ username, password, name, target_quota });
        } catch (e) {
          errors.push(`${username}: ${(e as Error).message || "exists"}`);
        }
      }
      return json({
        ok: true,
        created: created.length,
        target_quota,
        users: created,
        field_app_access: true,
        field_app_url: "/",
        note: created.length
          ? `Each surveyor can login to field app with password "${password}". Target = ${target_quota}.`
          : "No users created — usernames may already exist. Try prefix t or s2.",
        errors: errors.length ? errors.slice(0, 5) : undefined,
      }, 201);
    }

    // Client Admin: edit username/password/name, disable, revoke sessions
    if (path.startsWith("/api/users/") && method === "PATCH") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "admin") return json({ error: "Admin only" }, 403);
      const id = Number(path.split("/").pop());
      if (!id) return json({ error: "Invalid id" }, 400);
      const body = await readBody(req);
      const existing = await sql`SELECT * FROM app_users WHERE id = ${id}`;
      if (!existing.length) return json({ error: "Not found" }, 404);
      const ex = existing[0] as {
        id: number;
        username: string;
        password_hash: string;
        display_name: string;
        role: string;
        active: boolean;
        target_quota?: number;
      };

      // revoke_sessions only — kick user offline without other changes
      if (body.revoke_sessions === true && body.password == null && body.username == null &&
          body.active == null && body.name == null && body.target_quota == null && body.role == null) {
        const del = await sql`DELETE FROM app_sessions WHERE user_id = ${id}`;
        return json({
          ok: true,
          revoked: true,
          sessions_cleared: Array.isArray(del) ? del.length : true,
          user_id: id,
          username: ex.username,
        });
      }

      let password_hash = ex.password_hash;
      let passwordChanged = false;
      if (body.password != null && String(body.password).length > 0) {
        if (String(body.password).length < 4) {
          return json({ error: "Password min 4 characters" }, 400);
        }
        password_hash = await hashPasswordAsync(String(body.password));
        passwordChanged = true;
      }

      let nextUsername = ex.username;
      if (body.username != null && String(body.username).trim()) {
        nextUsername = String(body.username).trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
        if (!nextUsername || nextUsername.length < 2) {
          return json({ error: "Username min 2 characters (letters/numbers)" }, 400);
        }
        if (nextUsername !== ex.username) {
          const clash = await sql`
            SELECT id FROM app_users WHERE LOWER(username) = ${nextUsername} AND id <> ${id} LIMIT 1
          `;
          if (clash.length) return json({ error: "Username already taken" }, 409);
        }
      }

      const nextActive = typeof body.active === "boolean" ? body.active : ex.active;
      if (id === me.id && nextActive === false) {
        return json({ error: "Cannot disable your own admin account" }, 400);
      }
      if (id === me.id && nextUsername !== ex.username) {
        // allow rename self carefully
      }

      const nextName = body.name != null ? String(body.name).trim() : ex.display_name;
      const nextRole =
        body.role === "admin" || body.role === "surveyor" ? body.role : ex.role;
      const nextQuota =
        body.target_quota != null
          ? Math.max(0, Math.min(Number(body.target_quota) || 0, 100000))
          : Number(ex.target_quota) || 0;

      let rows;
      try {
        rows = await sql`
          UPDATE app_users
          SET username = ${nextUsername},
              password_hash = ${password_hash},
              display_name = ${nextName},
              role = ${nextRole},
              active = ${nextActive},
              target_quota = ${nextQuota}
          WHERE id = ${id}
          RETURNING id, username, display_name, role, active, created_at, target_quota
        `;
      } catch (e) {
        const msg = (e as Error).message || "";
        if (msg.includes("unique") || msg.includes("duplicate")) {
          return json({ error: "Username already taken" }, 409);
        }
        return json({ error: msg || "Update failed" }, 500);
      }

      // Disable or password/username change → revoke all sessions (force re-login)
      const shouldRevoke =
        body.revoke_sessions === true ||
        nextActive === false ||
        passwordChanged ||
        nextUsername !== ex.username;
      let sessionsCleared = 0;
      if (shouldRevoke) {
        const del = await sql`DELETE FROM app_sessions WHERE user_id = ${id}`;
        sessionsCleared = Array.isArray(del) ? del.length : 0;
      }

      const u = rows[0] as Record<string, unknown>;
      return json({
        ok: true,
        user: {
          id: u.id,
          username: u.username,
          name: u.display_name || u.username,
          role: u.role,
          active: u.active,
          created_at: u.created_at,
          target_quota: u.target_quota ?? nextQuota,
        },
        password_changed: passwordChanged,
        username_changed: nextUsername !== ex.username,
        disabled: nextActive === false,
        sessions_revoked: shouldRevoke,
        sessions_cleared: sessionsCleared,
        plain_password: passwordChanged ? String(body.password) : undefined,
      });
    }

    // DELETE user (optional hard remove) — prefer disable
    if (path.startsWith("/api/users/") && method === "DELETE") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "admin") return json({ error: "Admin only" }, 403);
      const id = Number(path.split("/").pop());
      if (!id) return json({ error: "Invalid id" }, 400);
      if (id === me.id) return json({ error: "Cannot delete your own account" }, 400);
      const existing = await sql`SELECT id, username, role FROM app_users WHERE id = ${id}`;
      if (!existing.length) return json({ error: "Not found" }, 404);
      await sql`DELETE FROM app_sessions WHERE user_id = ${id}`;
      await sql`DELETE FROM app_users WHERE id = ${id}`;
      return json({
        ok: true,
        deleted: true,
        id,
        username: (existing[0] as { username: string }).username,
      });
    }

    if (path === "/api/submissions" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "admin") return json({ error: "Admin only" }, 403);
      const limit = Math.min(Number(url.searchParams.get("limit") || 200), 1000);
      const statusQ = (url.searchParams.get("status") || "").trim().toLowerCase();
      const dateFrom = (url.searchParams.get("date_from") || "").trim();
      const dateTo = (url.searchParams.get("date_to") || "").trim();
      const userQ = (url.searchParams.get("user") || "").trim().toLowerCase();
      const completenessQ = (url.searchParams.get("completeness") || "").trim().toLowerCase();
      const rows = await sql`
        SELECT id, payload, created_at FROM submissions
        ORDER BY created_at DESC LIMIT ${limit}
      `;
      // media kinds for strict voice/photo checks
      const mediaRows = await sql`
        SELECT submission_id, kind FROM survey_media
      `.catch(() => []);
      const mediaMap = new Map<number, string[]>();
      for (const m of mediaRows as { submission_id: number; kind: string }[]) {
        const arr = mediaMap.get(Number(m.submission_id)) || [];
        arr.push(m.kind);
        mediaMap.set(Number(m.submission_id), arr);
      }

      let items = (rows as Record<string, unknown>[]).map((r) => {
        const payload = parsePayload(r.payload);
        const answers = (payload?.answers || payload) as Record<string, unknown>;
        const status = payloadStatus(payload);
        const kinds = mediaMap.get(Number(r.id)) || [];
        const verify = verifySubmission(payload, kinds);
        // keep payload flags in sync for analytics path
        if (kinds.includes("audio")) payload.has_audio = true;
        if (kinds.includes("photo")) payload.has_photo = true;
        return {
          id: r.id,
          source: (payload?.source as string) || "app",
          form_id: (payload?.form_id as string) || "",
          form_key: String(payload?.form_key || "default"),
          created_at: r.created_at,
          date: dayKey(String(r.created_at || "")),
          status,
          completeness: verify.completeness,
          verification: verify,
          submitted_by: String(
            payload?.submitted_by || answers?.data_collector || "",
          ),
          user_id: payload?.user_id ?? null,
          confirmed_at: payload?.confirmed_at || null,
          confirmed_by: payload?.confirmed_by || null,
          answers,
          qa: qaFromAnswers(answers || {}),
          has_geo: verify.geo_ok,
          has_voice: verify.voice_ok,
          has_photo: verify.photo_ok,
          // Free storage links (not Neon blobs)
          photo_url: payload?.photo_url || null,
          audio_url: payload?.audio_url || null,
          media_storage: payload?.media_storage || null,
        };
      });

      if (statusQ && statusQ !== "all") {
        items = items.filter((x) => x.status === statusQ);
      }
      if (dateFrom) items = items.filter((x) => x.date >= dateFrom);
      if (dateTo) items = items.filter((x) => x.date <= dateTo);
      if (userQ) {
        items = items.filter((x) =>
          String(x.submitted_by || "").toLowerCase().includes(userQ)
        );
      }
      const surveyQ = (url.searchParams.get("survey") || url.searchParams.get("form_key") || "").trim();
      if (surveyQ) {
        items = items.filter((x) => String(x.form_key || "") === surveyQ);
      }
      if (completenessQ === "complete" || completenessQ === "incomplete") {
        items = items.filter((x) => x.completeness === completenessQ);
      }

      const summary = {
        total: items.length,
        complete: items.filter((x) => x.completeness === "complete").length,
        incomplete: items.filter((x) => x.completeness === "incomplete").length,
        pending: items.filter((x) => x.status === "pending").length,
        confirmed: items.filter((x) => x.status === "confirmed").length,
        geo_fail: items.filter((x) => !x.has_geo).length,
        voice_fail: items.filter((x) => !x.has_voice).length,
        by_user: {} as Record<string, { total: number; complete: number; incomplete: number }>,
        by_date: {} as Record<string, { total: number; complete: number; incomplete: number }>,
      };
      for (const it of items) {
        const u = it.submitted_by || "unknown";
        if (!summary.by_user[u]) {
          summary.by_user[u] = { total: 0, complete: 0, incomplete: 0 };
        }
        summary.by_user[u].total += 1;
        summary.by_user[u][it.completeness] += 1;
        const d = it.date || "unknown";
        if (!summary.by_date[d]) {
          summary.by_date[d] = { total: 0, complete: 0, incomplete: 0 };
        }
        summary.by_date[d].total += 1;
        summary.by_date[d][it.completeness] += 1;
      }

      return json({
        items,
        total: items.length,
        summary,
        filters: {
          status: statusQ || "all",
          date_from: dateFrom || null,
          date_to: dateTo || null,
          user: userQ || null,
          completeness: completenessQ || "all",
        },
        strict: {
          geo_tagging: "required",
          voice_detection: "required",
          photo: "required",
          rule: "complete = geo_ok AND voice_ok AND photo_ok AND qa_ok",
        },
      });
    }

    // Client Admin analyze board: by date + user
    if (path === "/api/admin/analyze" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "admin") return json({ error: "Admin only" }, 403);
      let dateFrom = (url.searchParams.get("date_from") || "").trim();
      let dateTo = (url.searchParams.get("date_to") || "").trim();
      const userQ = (url.searchParams.get("user") || "").trim().toLowerCase();
      const period = (url.searchParams.get("period") || "total").trim().toLowerCase();
      const dayParam = (url.searchParams.get("day") || "").trim();
      const monthParam = (url.searchParams.get("month") || "").trim();
      if (period === "today") {
        const t = new Date().toISOString().slice(0, 10);
        dateFrom = t;
        dateTo = t;
      } else if (period === "day" && dayParam) {
        dateFrom = dayParam;
        dateTo = dayParam;
      } else if (period === "month" && monthParam) {
        const [y, m] = monthParam.split("-").map(Number);
        if (y && m) {
          const last = new Date(y, m, 0).getDate();
          dateFrom = `${monthParam}-01`;
          dateTo = `${monthParam}-${String(last).padStart(2, "0")}`;
        }
      }
      const rows = await sql`
        SELECT id, payload, created_at FROM submissions
        ORDER BY created_at DESC LIMIT 5000
      `;
      const mediaRows = await sql`
        SELECT submission_id, kind FROM survey_media
      `.catch(() => []);
      const mediaMap = new Map<number, string[]>();
      for (const m of mediaRows as { submission_id: number; kind: string }[]) {
        const arr = mediaMap.get(m.submission_id) || [];
        arr.push(m.kind);
        mediaMap.set(m.submission_id, arr);
      }

      type RowA = {
        id: number;
        date: string;
        month: string;
        user: string;
        status: string;
        completeness: string;
        geo_ok: boolean;
        voice_ok: boolean;
        photo_ok: boolean;
        district: string;
        party: string;
      };
      let list: RowA[] = [];
      for (const r of rows as { id: number; payload: unknown; created_at: string }[]) {
        const payload = parsePayload(r.payload);
        const a = (payload.answers || {}) as Record<string, unknown>;
        const kinds = mediaMap.get(r.id) || [];
        if (kinds.includes("audio")) payload.has_audio = true;
        if (kinds.includes("photo")) payload.has_photo = true;
        const v = verifySubmission(payload, kinds);
        const user = String(payload.submitted_by || a.data_collector || "unknown");
        const date = dayKey(String(r.created_at || ""));
        const month = date.slice(0, 7);
        if (dateFrom && date < dateFrom) continue;
        if (dateTo && date > dateTo) continue;
        if (userQ && !user.toLowerCase().includes(userQ)) continue;
        list.push({
          id: r.id,
          date,
          month,
          user,
          status: payloadStatus(payload),
          completeness: v.completeness,
          geo_ok: v.geo_ok,
          voice_ok: v.voice_ok,
          photo_ok: v.photo_ok,
          district: String(a.district || "Unknown"),
          party: normParty(String(a.winning_party || "")),
        });
      }

      const byDate: Record<string, unknown> = {};
      const byMonth: Record<string, unknown> = {};
      const byUser: Record<string, unknown> = {};
      const bySurveyorDay: Record<string, unknown> = {};
      const bySurveyorMonth: Record<string, unknown> = {};
      for (const row of list) {
        if (!byDate[row.date]) {
          byDate[row.date] = {
            date: row.date,
            total: 0,
            complete: 0,
            incomplete: 0,
            geo_fail: 0,
            voice_fail: 0,
            confirmed: 0,
          };
        }
        const d = byDate[row.date] as Record<string, number>;
        d.total += 1;
        d[row.completeness] += 1;
        if (!row.geo_ok) d.geo_fail += 1;
        if (!row.voice_ok) d.voice_fail += 1;
        if (row.status === "confirmed") d.confirmed += 1;

        const mk = row.month || row.date.slice(0, 7);
        if (!byMonth[mk]) {
          byMonth[mk] = {
            month: mk,
            total: 0,
            complete: 0,
            incomplete: 0,
            geo_fail: 0,
            voice_fail: 0,
            confirmed: 0,
          };
        }
        const mo = byMonth[mk] as Record<string, number>;
        mo.total += 1;
        mo[row.completeness] += 1;
        if (!row.geo_ok) mo.geo_fail += 1;
        if (!row.voice_ok) mo.voice_fail += 1;
        if (row.status === "confirmed") mo.confirmed += 1;

        if (!byUser[row.user]) {
          byUser[row.user] = {
            user: row.user,
            total: 0,
            complete: 0,
            incomplete: 0,
            geo_fail: 0,
            voice_fail: 0,
            confirmed: 0,
            pending: 0,
          };
        }
        const u = byUser[row.user] as Record<string, number>;
        u.total += 1;
        u[row.completeness] += 1;
        if (!row.geo_ok) u.geo_fail += 1;
        if (!row.voice_ok) u.voice_fail += 1;
        if (row.status === "confirmed") u.confirmed += 1;
        if (row.status === "pending") u.pending += 1;

        // Surveyor daily
        const sdk = `${row.user}::${row.date}`;
        if (!bySurveyorDay[sdk]) {
          bySurveyorDay[sdk] = {
            surveyor: row.user,
            day: row.date,
            total: 0,
            complete: 0,
            incomplete: 0,
            confirmed: 0,
            geo_fail: 0,
            voice_fail: 0,
          };
        }
        const sd = bySurveyorDay[sdk] as Record<string, number>;
        sd.total += 1;
        sd[row.completeness] += 1;
        if (row.status === "confirmed") sd.confirmed += 1;
        if (!row.geo_ok) sd.geo_fail += 1;
        if (!row.voice_ok) sd.voice_fail += 1;

        // Surveyor monthly
        const smk = `${row.user}::${mk}`;
        if (!bySurveyorMonth[smk]) {
          bySurveyorMonth[smk] = {
            surveyor: row.user,
            month: mk,
            total: 0,
            complete: 0,
            incomplete: 0,
            confirmed: 0,
            geo_fail: 0,
            voice_fail: 0,
          };
        }
        const sm = bySurveyorMonth[smk] as Record<string, number>;
        sm.total += 1;
        sm[row.completeness] += 1;
        if (row.status === "confirmed") sm.confirmed += 1;
        if (!row.geo_ok) sm.geo_fail += 1;
        if (!row.voice_ok) sm.voice_fail += 1;
      }

      return json({
        filters: {
          date_from: dateFrom || null,
          date_to: dateTo || null,
          user: userQ || null,
          period,
          day: dayParam || null,
          month: monthParam || null,
        },
        totals: {
          records: list.length,
          complete: list.filter((x) => x.completeness === "complete").length,
          incomplete: list.filter((x) => x.completeness === "incomplete").length,
          geo_fail: list.filter((x) => !x.geo_ok).length,
          voice_fail: list.filter((x) => !x.voice_ok).length,
          confirmed: list.filter((x) => x.status === "confirmed").length,
        },
        by_user: Object.values(byUser).sort(
          (a, b) =>
            Number((b as { total: number }).total) -
            Number((a as { total: number }).total),
        ),
        by_date: Object.values(byDate).sort((a, b) =>
          String((b as { date: string }).date).localeCompare(
            String((a as { date: string }).date),
          )
        ),
        by_month: Object.values(byMonth).sort((a, b) =>
          String((b as { month: string }).month).localeCompare(
            String((a as { month: string }).month),
          )
        ),
        by_day: Object.values(byDate).sort((a, b) =>
          String((b as { date: string }).date).localeCompare(
            String((a as { date: string }).date),
          )
        ),
        by_surveyor_day: Object.values(bySurveyorDay).sort((a, b) => {
          const da = a as { day: string; total: number; surveyor: string };
          const db = b as { day: string; total: number; surveyor: string };
          const d = db.day.localeCompare(da.day);
          if (d !== 0) return d;
          return db.total - da.total || da.surveyor.localeCompare(db.surveyor);
        }),
        by_surveyor_month: Object.values(bySurveyorMonth).sort((a, b) => {
          const ma = a as { month: string; total: number; surveyor: string };
          const mb = b as { month: string; total: number; surveyor: string };
          const m = mb.month.localeCompare(ma.month);
          if (m !== 0) return m;
          return mb.total - ma.total || ma.surveyor.localeCompare(mb.surveyor);
        }),
        strict: {
          geo_tagging: "required",
          voice_detection: "required",
          photo: "required",
        },
        sample: list.slice(0, 100),
      });
    }

    // Client Admin: get one submission (full payload for edit)
    if (path.match(/^\/api\/submissions\/\d+$/) && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "admin") return json({ error: "Admin only" }, 403);
      const id = Number(path.split("/")[3]);
      const rows = await sql`
        SELECT id, payload, created_at FROM submissions WHERE id = ${id}
      `;
      if (!rows.length) return json({ error: "Not found" }, 404);
      const r = rows[0] as { id: number; payload: unknown; created_at: string };
      const payload = parsePayload(r.payload);
      const answers = (payload.answers || {}) as Record<string, unknown>;
      const mediaKinds = (
        await sql`SELECT kind FROM survey_media WHERE submission_id = ${id}`.catch(() => [])
      ).map((m) => m.kind);
      if (mediaKinds.includes("audio")) payload.has_audio = true;
      if (mediaKinds.includes("photo")) payload.has_photo = true;
      const verify = verifySubmission(payload, mediaKinds);
      return json({
        id: r.id,
        created_at: r.created_at,
        status: payloadStatus(payload),
        completeness: verify.completeness,
        verification: verify,
        submitted_by: String(
          payload.submitted_by || answers.data_collector || "",
        ),
        user_id: payload.user_id ?? null,
        source: payload.source || "app",
        form_id: payload.form_id || "",
        geo: payload.geo || null,
        has_audio: !!payload.has_audio,
        has_photo: !!payload.has_photo,
        answers,
        qa: qaFromAnswers(answers),
        edit_history: Array.isArray(payload.edit_history)
          ? payload.edit_history
          : [],
        confirmed_at: payload.confirmed_at || null,
        confirmed_by: payload.confirmed_by || null,
      });
    }

    // Client Admin: EDIT survey data (answers, surveyor, geo, status)
    if (path.match(/^\/api\/submissions\/\d+$/) && method === "PATCH") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "admin") return json({ error: "Admin only" }, 403);
      const id = Number(path.split("/")[3]);
      const body = await readBody(req);
      const rows = await sql`SELECT id, payload FROM submissions WHERE id = ${id}`;
      if (!rows.length) return json({ error: "Not found" }, 404);

      let payload = parsePayload(rows[0].payload);
      const prevAnswers = {
        ...((payload.answers || {}) as Record<string, unknown>),
      };
      const changed: string[] = [];

      // Merge answer fields (partial update)
      if (body.answers && typeof body.answers === "object" && !Array.isArray(body.answers)) {
        const nextAns = {
          ...prevAnswers,
          ...(body.answers as Record<string, unknown>),
        };
        // Drop empty-string keys only if client sent null to clear? Keep empties as ""
        for (const [k, v] of Object.entries(body.answers as Record<string, unknown>)) {
          if (v === null || v === undefined) {
            delete nextAns[k];
            if (prevAnswers[k] != null) changed.push(`answers.${k}`);
          } else if (String(prevAnswers[k] ?? "") !== String(v)) {
            changed.push(`answers.${k}`);
          }
        }
        payload.answers = nextAns;
      }

      if (body.submitted_by != null && String(body.submitted_by).trim()) {
        const sb = String(body.submitted_by).trim();
        if (String(payload.submitted_by || "") !== sb) {
          changed.push("submitted_by");
          payload.submitted_by = sb;
        }
        const ans = (payload.answers || {}) as Record<string, unknown>;
        ans.data_collector = sb;
        payload.answers = ans;
      }

      // Optional geo fix by Client Admin
      if (body.geo && typeof body.geo === "object") {
        const g = body.geo as Record<string, unknown>;
        const lat = Number(g.lat ?? g.latitude);
        const lng = Number(g.lng ?? g.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          payload.geo = {
            lat,
            lng,
            accuracy: g.accuracy != null ? Number(g.accuracy) : null,
            at: g.at || new Date().toISOString(),
            source: "admin_edit",
          };
          changed.push("geo");
        }
      }

      // Media flags override (admin may mark present after offline repair)
      if (body.has_audio === true) {
        payload.has_audio = true;
        changed.push("has_audio");
      }
      if (body.has_photo === true) {
        payload.has_photo = true;
        changed.push("has_photo");
      }
      if (body.has_audio === false) {
        payload.has_audio = false;
        changed.push("has_audio");
      }
      if (body.has_photo === false) {
        payload.has_photo = false;
        changed.push("has_photo");
      }

      const mediaKinds = (
        await sql`SELECT kind FROM survey_media WHERE submission_id = ${id}`.catch(() => [])
      ).map((m) => m.kind);
      if (mediaKinds.includes("audio")) payload.has_audio = true;
      if (mediaKinds.includes("photo")) payload.has_photo = true;

      const verify = verifySubmission(payload, mediaKinds);
      payload.completeness = verify.completeness;
      payload.verification = verify;

      // Optional status change in same edit
      if (body.status != null && String(body.status).trim()) {
        const next = String(body.status).toLowerCase().trim();
        if (!["confirmed", "rejected", "pending"].includes(next)) {
          return json({ error: "status must be confirmed | rejected | pending" }, 400);
        }
        const force = body.force === true;
        if (next === "confirmed" && verify.completeness !== "complete" && !force) {
          return json({
            error: "Strict verification failed — cannot confirm incomplete record",
            completeness: "incomplete",
            verification: verify,
            hint: "Fix answers/geo/voice/photo first, or pass force:true.",
          }, 422);
        }
        if (payloadStatus(payload) !== next) changed.push("status");
        payload.status = next;
        payload.confirmed_at = next === "pending" ? null : new Date().toISOString();
        payload.confirmed_by = next === "pending" ? null : me.name || me.username;
        payload.confirm_note = body.note || payload.confirm_note || null;
        if (next === "confirmed" && force) payload.force_confirm = true;
      }

      if (!changed.length && body.answers == null && body.geo == null && body.status == null) {
        return json({ error: "Nothing to update — send answers, geo, submitted_by, or status" }, 400);
      }

      const history = Array.isArray(payload.edit_history)
        ? [...(payload.edit_history as unknown[])]
        : [];
      history.unshift({
        at: new Date().toISOString(),
        by: me.name || me.username,
        fields: changed.length ? changed : ["answers"],
        note: body.note ? String(body.note).slice(0, 500) : null,
      });
      payload.edit_history = history.slice(0, 50);
      payload.updated_at = new Date().toISOString();
      payload.updated_by = me.name || me.username;

      await sql`
        UPDATE submissions
        SET payload = ${JSON.stringify(payload)}::jsonb
        WHERE id = ${id}
      `;

      const answers = (payload.answers || {}) as Record<string, unknown>;
      return json({
        ok: true,
        id,
        status: payloadStatus(payload),
        completeness: verify.completeness,
        verification: verify,
        submitted_by: payload.submitted_by || answers.data_collector || "",
        answers,
        qa: qaFromAnswers(answers),
        changed,
        updated_by: payload.updated_by,
        updated_at: payload.updated_at,
      });
    }

    // Client Admin: DELETE survey record
    if (path.match(/^\/api\/submissions\/\d+$/) && method === "DELETE") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "admin") return json({ error: "Admin only" }, 403);
      const id = Number(path.split("/")[3]);
      const rows = await sql`SELECT id FROM submissions WHERE id = ${id}`;
      if (!rows.length) return json({ error: "Not found" }, 404);
      await sql`DELETE FROM survey_media WHERE submission_id = ${id}`.catch(() => null);
      await sql`DELETE FROM submissions WHERE id = ${id}`;
      return json({
        ok: true,
        id,
        deleted: true,
        deleted_by: me.name || me.username,
      });
    }

    // Confirm / reject — strict: complete only (unless force)
    if (path.match(/^\/api\/submissions\/\d+\/status$/) && method === "PATCH") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "admin") return json({ error: "Admin only" }, 403);
      const id = Number(path.split("/")[3]);
      const body = await readBody(req);
      const next = String(body.status || "").toLowerCase();
      const force = body.force === true;
      if (!["confirmed", "rejected", "pending"].includes(next)) {
        return json({ error: "status must be confirmed | rejected | pending" }, 400);
      }
      const rows = await sql`SELECT id, payload FROM submissions WHERE id = ${id}`;
      if (!rows.length) return json({ error: "Not found" }, 404);
      let payload = parsePayload(rows[0].payload);
      const mediaKinds = (
        await sql`SELECT kind FROM survey_media WHERE submission_id = ${id}`.catch(() => [])
      ).map((m) => m.kind);
      if (mediaKinds.includes("audio")) payload.has_audio = true;
      if (mediaKinds.includes("photo")) payload.has_photo = true;
      const verify = verifySubmission(payload, mediaKinds);

      if (next === "confirmed" && verify.completeness !== "complete" && !force) {
        return json({
          error: "Strict verification failed — cannot confirm incomplete record",
          completeness: "incomplete",
          verification: verify,
          hint: "Needs valid geo tag + voice (audio) + photo + Q/A. Pass force:true only if Client Admin overrides.",
        }, 422);
      }

      payload = {
        ...payload,
        status: next,
        completeness: verify.completeness,
        verification: verify,
        confirmed_at: next === "pending" ? null : new Date().toISOString(),
        confirmed_by: next === "pending" ? null : me.name || me.username,
        confirm_note: body.note || null,
        force_confirm: next === "confirmed" && force ? true : undefined,
      };
      await sql`
        UPDATE submissions
        SET payload = ${JSON.stringify(payload)}::jsonb
        WHERE id = ${id}
      `;
      return json({
        ok: true,
        id,
        status: next,
        completeness: verify.completeness,
        verification: verify,
        confirmed_by: payload.confirmed_by,
        confirmed_at: payload.confirmed_at,
      });
    }

    // Bulk confirm all pending (bootstrap / after review)
    if (path === "/api/submissions/confirm-pending" && method === "POST") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "admin") return json({ error: "Admin only" }, 403);
      const body = await readBody(req);
      const max = Math.min(Number(body.limit) || 500, 2000);
      const rows = await sql`
        SELECT id, payload FROM submissions ORDER BY created_at DESC LIMIT ${max}
      `;
      let n = 0;
      const who = me.name || me.username;
      const when = new Date().toISOString();
      for (const r of rows as { id: number; payload: Record<string, unknown> }[]) {
        let payload = r.payload;
        if (typeof payload === "string") {
          try {
            payload = JSON.parse(payload);
          } catch {
            payload = {};
          }
        }
        if (payloadStatus(payload) !== "pending") continue;
        payload = {
          ...payload,
          status: "confirmed",
          confirmed_at: when,
          confirmed_by: who,
          confirm_note: body.note || "bulk confirm",
        };
        await sql`
          UPDATE submissions SET payload = ${JSON.stringify(payload)}::jsonb WHERE id = ${r.id}
        `;
        n += 1;
      }
      return json({ ok: true, confirmed: n });
    }

    // ── Surveys (multi-survey: name + own questions + team + respondents) ────
    if (path === "/api/surveys" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "admin") return json({ error: "Admin only" }, 403);
      const q = (url.searchParams.get("q") || "").trim().toLowerCase();
      const rows = await sql`
        SELECT id, form_key, title, questions, updated_at FROM survey_form ORDER BY title
      `;
      const asg = await sql`
        SELECT survey_id, COUNT(*)::int AS n FROM survey_assignments GROUP BY survey_id
      `.catch(() => []);
      const rsp = await sql`
        SELECT survey_id, COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE status = 'done')::int AS done
        FROM survey_respondents GROUP BY survey_id
      `.catch(() => []);
      const sub = await sql`
        SELECT payload->>'form_key' AS fk, COUNT(*)::int AS n FROM submissions GROUP BY payload->>'form_key'
      `.catch(() => []);
      const asgMap = new Map(asg.map((r) => [Number((r as { survey_id: number }).survey_id), (r as { n: number }).n]));
      const rspMap = new Map(rsp.map((r) => [Number((r as { survey_id: number }).survey_id), r as { total: number; done: number }]));
      const subMap = new Map(sub.map((r) => [String((r as { fk: string }).fk), (r as { n: number }).n]));
      const items = (rows as Record<string, unknown>[]).map((r) => {
        let qs = r.questions;
        if (typeof qs === "string") {
          try { qs = JSON.parse(qs); } catch { qs = []; }
        }
        return {
          id: r.id,
          form_key: r.form_key,
          title: r.title,
          question_count: Array.isArray(qs) ? qs.length : 0,
          updated_at: r.updated_at,
          surveyors: asgMap.get(Number(r.id)) || 0,
          respondents_total: rspMap.get(Number(r.id))?.total || 0,
          respondents_done: rspMap.get(Number(r.id))?.done || 0,
          submissions: subMap.get(String(r.form_key)) || 0,
        };
      });
      const filtered = q
        ? items.filter((s) => String(s.title || "").toLowerCase().includes(q))
        : items;
      return json({ items: filtered, count: filtered.length });
    }

    if (path === "/api/surveys" && method === "POST") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "admin") return json({ error: "Admin only" }, 403);
      const body = await readBody(req);
      const title = String(body.title || "").trim();
      if (!title) return json({ error: "Survey name required" }, 400);
      const questions = Array.isArray(body.questions) ? body.questions : [];
      const dup = await sql`
        SELECT id, form_key FROM survey_form WHERE LOWER(title) = LOWER(${title}) LIMIT 1
      `.catch(() => []);
      if (dup.length) {
        const d = dup[0] as { id: number; form_key: string };
        return json({
          error: `Survey "${title}" already exists`,
          existing_id: d.id,
          form_key: d.form_key,
        }, 409);
      }
      const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "survey";
      let formKey = base;
      let n = 1;
      for (;;) {
        const clash = await sql`SELECT id FROM survey_form WHERE form_key = ${formKey} LIMIT 1`;
        if (!clash.length) break;
        n += 1;
        formKey = `${base}-${n}`;
      }
      const rows = await sql`
        INSERT INTO survey_form (form_key, title, questions, updated_at)
        VALUES (${formKey}, ${title}, ${JSON.stringify(questions)}::jsonb, NOW())
        RETURNING id, form_key, title, updated_at
      `;
      return json({ ok: true, survey: rows[0] }, 201);
    }

    if (path.match(/^\/api\/surveys\/\d+$/) && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "admin") return json({ error: "Admin only" }, 403);
      const id = Number(path.split("/")[3]);
      const rows = await sql`
        SELECT id, form_key, title, questions, updated_at FROM survey_form WHERE id = ${id}
      `;
      if (!rows.length) return json({ error: "Not found" }, 404);
      const r = rows[0] as { id: number; form_key: string; title: string; questions: unknown; updated_at: string };
      let questions = r.questions;
      if (typeof questions === "string") {
        try { questions = JSON.parse(questions); } catch { questions = []; }
      }
      const team = await sql`
        SELECT u.id, u.username, u.display_name, u.active
        FROM survey_assignments sa JOIN app_users u ON u.id = sa.user_id
        WHERE sa.survey_id = ${id} ORDER BY u.username
      `.catch(() => []);
      const respondents = await sql`
        SELECT id, name, phone, status, done_at, submission_id, created_at
        FROM survey_respondents WHERE survey_id = ${id} ORDER BY id DESC
      `.catch(() => []);
      return json({
        survey: {
          id: r.id,
          form_key: r.form_key,
          title: r.title,
          questions,
          updated_at: r.updated_at,
          surveyors: team,
          respondents,
        },
      });
    }

    if (path.match(/^\/api\/surveys\/\d+$/) && method === "PUT") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "admin") return json({ error: "Admin only" }, 403);
      const id = Number(path.split("/")[3]);
      const body = await readBody(req);
      const rows = await sql`SELECT id, title FROM survey_form WHERE id = ${id}`;
      if (!rows.length) return json({ error: "Not found" }, 404);
      const title = String(body.title || "").trim();
      if (title) {
        const dup = await sql`
          SELECT id FROM survey_form
          WHERE LOWER(title) = LOWER(${title}) AND id <> ${id} LIMIT 1
        `.catch(() => []);
        if (dup.length) return json({ error: `Survey "${title}" already exists` }, 409);
      }
      if (title) {
        await sql`
          UPDATE survey_form SET title = ${title}, updated_at = NOW() WHERE id = ${id}
        `;
      }
      if (Array.isArray(body.questions)) {
        await sql`
          UPDATE survey_form SET questions = ${JSON.stringify(body.questions)}::jsonb, updated_at = NOW()
          WHERE id = ${id}
        `;
      }
      return json({ ok: true });
    }

    if (path.match(/^\/api\/surveys\/\d+$/) && method === "DELETE") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "admin") return json({ error: "Admin only" }, 403);
      const id = Number(path.split("/")[3]);
      const rows = await sql`SELECT form_key FROM survey_form WHERE id = ${id}`;
      if (!rows.length) return json({ error: "Not found" }, 404);
      await sql`DELETE FROM survey_assignments WHERE survey_id = ${id}`.catch(() => null);
      await sql`DELETE FROM survey_respondents WHERE survey_id = ${id}`.catch(() => null);
      await sql`DELETE FROM survey_form WHERE id = ${id}`;
      return json({ ok: true, deleted: true });
    }

    // Replace the surveyor team for a survey
    if (path.match(/^\/api\/surveys\/\d+\/surveyors$/) && method === "PUT") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "admin") return json({ error: "Admin only" }, 403);
      const id = Number(path.split("/")[3]);
      const body = await readBody(req);
      const ids = (Array.isArray(body.user_ids) ? body.user_ids : [])
        .map(Number)
        .filter((v: number) => Number.isFinite(v));
      const rows = await sql`SELECT id FROM survey_form WHERE id = ${id}`;
      if (!rows.length) return json({ error: "Not found" }, 404);
      await sql`DELETE FROM survey_assignments WHERE survey_id = ${id}`.catch(() => null);
      for (const uid of ids) {
        await sql`
          INSERT INTO survey_assignments (survey_id, user_id)
          VALUES (${id}, ${uid})
          ON CONFLICT (survey_id, user_id) DO NOTHING
        `.catch(() => null);
      }
      return json({ ok: true, assigned: ids.length });
    }

    // Surveyor view: surveys assigned to me (with their questions) — field app
    if (path === "/api/my-surveys" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "surveyor" && me.role !== "admin") {
        return json({ error: "Forbidden" }, 403);
      }
      const rows = await sql`
        SELECT f.id, f.form_key, f.title, f.questions, f.updated_at
        FROM survey_assignments sa
        JOIN survey_form f ON f.id = sa.survey_id
        WHERE sa.user_id = ${me.id}
        ORDER BY f.title
      `.catch(() => []);
      const items = (rows as Record<string, unknown>[]).map((r) => {
        let qs = r.questions;
        if (typeof qs === "string") {
          try { qs = JSON.parse(qs); } catch { qs = []; }
        }
        return {
          id: r.id,
          form_key: r.form_key,
          title: r.title,
          questions: Array.isArray(qs) ? qs : [],
          updated_at: r.updated_at,
        };
      });
      return json({ items, count: items.length });
    }

    // Respondents per survey
    if (path.match(/^\/api\/surveys\/\d+\/respondents$/) && method === "POST") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "admin") return json({ error: "Admin only" }, 403);
      const id = Number(path.split("/")[3]);
      const body = await readBody(req);
      const name = String(body.name || "").trim();
      if (!name) return json({ error: "Name required" }, 400);
      const rows = await sql`
        INSERT INTO survey_respondents (survey_id, name, phone)
        VALUES (${id}, ${name}, ${String(body.phone || "").trim() || null})
        RETURNING id, name, phone, status, created_at
      `;
      return json({ ok: true, respondent: rows[0] }, 201);
    }

    if (path.match(/^\/api\/surveys\/\d+\/respondents\/\d+$/) && method === "PATCH") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "admin") return json({ error: "Admin only" }, 403);
      const body = await readBody(req);
      const status = String(body.status || "").toLowerCase();
      if (status === "done") {
        await sql`
          UPDATE survey_respondents SET status = 'done', done_at = NOW()
          WHERE id = ${Number(path.split("/")[5])} AND survey_id = ${Number(path.split("/")[3])}
        `;
      } else if (status === "pending") {
        await sql`
          UPDATE survey_respondents SET status = 'pending', done_at = NULL
          WHERE id = ${Number(path.split("/")[5])} AND survey_id = ${Number(path.split("/")[3])}
        `;
      }
      return json({ ok: true });
    }

    if (path.match(/^\/api\/surveys\/\d+\/respondents\/\d+$/) && method === "DELETE") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "admin") return json({ error: "Admin only" }, 403);
      await sql`
        DELETE FROM survey_respondents
        WHERE id = ${Number(path.split("/")[5])} AND survey_id = ${Number(path.split("/")[3])}
      `;
      return json({ ok: true, deleted: true });
    }

    // ── Dynamic questions (field app loads automatically) ───
    if (path === "/api/questions" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      try {
        const rows = await sql`
          SELECT form_key, title, questions, updated_at
          FROM survey_form WHERE form_key = 'default' LIMIT 1
        `;
        if (!rows.length) {
          return json({
            form_key: "default",
            title: "Field Survey",
            questions: DEFAULT_QUESTIONS,
            updated_at: null,
          });
        }
        const f = rows[0] as {
          form_key: string;
          title: string;
          questions: unknown;
          updated_at: string;
        };
        let questions = f.questions;
        if (typeof questions === "string") {
          try {
            questions = JSON.parse(questions);
          } catch {
            questions = DEFAULT_QUESTIONS;
          }
        }
        if (!Array.isArray(questions) || !questions.length) {
          questions = DEFAULT_QUESTIONS;
        }
        return json({
          form_key: f.form_key,
          title: f.title,
          questions,
          updated_at: f.updated_at,
          require_geo: true,
          require_photo: true,
          require_audio: true,
        });
      } catch (e) {
        return json({
          form_key: "default",
          title: "Field Survey",
          questions: DEFAULT_QUESTIONS,
          require_geo: true,
          require_photo: true,
          require_audio: true,
          warning: (e as Error).message,
        });
      }
    }

    // Admin saves question bank (dashboard)
    if (path === "/api/admin/questions" && method === "PUT") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "admin") return json({ error: "Admin only" }, 403);
      const body = await readBody(req);
      const title = String(body.title || "Field Survey");
      const questions = Array.isArray(body.questions) ? body.questions : DEFAULT_QUESTIONS;
      await sql`
        INSERT INTO survey_form (form_key, title, questions, updated_at)
        VALUES ('default', ${title}, ${JSON.stringify(questions)}::jsonb, NOW())
        ON CONFLICT (form_key) DO UPDATE
        SET title = EXCLUDED.title,
            questions = EXCLUDED.questions,
            updated_at = NOW()
      `;
      return json({ ok: true, title, questions, count: questions.length });
    }

    // Surveyor's own records (field app "My records" screen)
    if (path === "/api/submissions/me" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      const uId = String(me.id);
      const names = [me.name, me.username].filter(Boolean);
      const rows = await sql`
        SELECT id, payload, created_at FROM submissions
        WHERE payload->>'user_id' = ${uId}
           OR payload->>'submitted_by' = ANY(${names})
        ORDER BY created_at DESC LIMIT 500
      `.catch(() => []);
      const mediaRows = await sql`
        SELECT submission_id, kind, url, storage, meta FROM survey_media
      `.catch(() => []);
      const mediaMap = new Map<number, { url: string | null; kind: string }[]>();
      for (const m of mediaRows as {
        submission_id: number;
        kind: string;
        url: string | null;
        storage: string | null;
        meta: unknown;
      }[]) {
        const meta =
          typeof m.meta === "string"
            ? parsePayload(m.meta)
            : (m.meta as Record<string, unknown>) || {};
        const url = m.url || (meta.url as string) || null;
        const arr = mediaMap.get(Number(m.submission_id)) || [];
        arr.push({ url, kind: m.kind });
        mediaMap.set(Number(m.submission_id), arr);
      }
      const items = (rows as Record<string, unknown>[]).map((r) => {
        const payload = parsePayload(r.payload);
        const answers = (payload?.answers || payload) as Record<string, unknown>;
        const media = mediaMap.get(Number(r.id)) || [];
        return {
          id: r.id,
          created_at: r.created_at,
          status: payloadStatus(payload),
          submitted_by: String(
            payload?.submitted_by || answers?.data_collector || "",
          ),
          photo_url: media.find((m) => m.kind === "photo")?.url || null,
          audio_url: media.find((m) => m.kind === "audio")?.url || null,
          media,
        };
      });
      return json({ items, count: items.length });
    }

    if (path === "/api/submissions" && method === "POST") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "admin" && me.role !== "surveyor") {
        return json({ error: "Login required as admin or surveyor" }, 403);
      }
      const body = await readBody(req);
      // Q/A only — media uploaded separately to /api/submissions/:id/media
      const answers = (body.answers || body) as Record<string, unknown>;
      const geo = body.geo || null;
      const agent =
        String(body.submitted_by || "").trim() || me.name || me.username;
      // Require geo lock on every field submission
      if (!geo || typeof geo !== "object") {
        return json({
          error: "GPS lock required — lat/lng missing",
          code: "geo_lock_required",
        }, 422);
      }
      const gLat = Number((geo as Record<string, unknown>).lat ?? (geo as Record<string, unknown>).latitude);
      const gLng = Number((geo as Record<string, unknown>).lng ?? (geo as Record<string, unknown>).longitude);
      if (!Number.isFinite(gLat) || !Number.isFinite(gLng) || (gLat === 0 && gLng === 0)) {
        return json({
          error: "GPS lock invalid",
          code: "geo_lock_invalid",
        }, 422);
      }

      const payload = {
        form_key: body.form_key || "default",
        form_id: body.form_id || `field-${Date.now()}`,
        source: body.source || "mobile-field-survey",
        submitted_by: agent,
        user_id: me.id,
        user_role: me.role,
        status: "pending",
        geo: geo,
        location_details: body.location_details || null,
        locks: body.locks || { geo: true },
        has_photo: false,
        has_audio: false,
        answers: { ...answers, data_collector: agent },
        // Q/A separated from media blobs
        content_type: "qa",
        // Client app version (pushed from React build)
        app_version: body.app_version ? String(body.app_version) : null,
        app_build: body.app_build ? String(body.app_build) : null,
        app_version_code: body.app_version_code != null
          ? Number(body.app_version_code)
          : null,
      };
      // Idempotent: a field-app sync retry of the same package must not insert a duplicate
      const pkgId = String(
        (answers as Record<string, unknown>)?.client_package_id ||
          body.client_package_id ||
          "",
      ).trim();
      if (pkgId) {
        const existing = await sql`
          SELECT id FROM submissions
          WHERE payload->'answers'->>'client_package_id' = ${pkgId}
             OR payload->>'client_package_id' = ${pkgId}
          ORDER BY id LIMIT 1
        `.catch(() => []);
        if (existing.length) {
          return json({
            ok: true,
            duplicate: true,
            id: (existing[0] as { id: number }).id,
            note: "Already received — returning existing record",
          });
        }
      }
      const rows = await sql`
        INSERT INTO submissions (payload)
        VALUES (${JSON.stringify(payload)}::jsonb)
        RETURNING id, payload, created_at
      `;
      const row = rows[0];
      return json({
        ok: true,
        id: row.id,
        form_id: payload.form_id,
        source: payload.source,
        submitted_by: agent,
        status: "pending",
        answers: payload.answers,
        geo,
        created_at: row.created_at,
        next: "POST /api/submissions/:id/media with kind=photo|audio",
        note: "Q/A saved. Upload photo and audio separately.",
      }, 201);
    }

    // Separate media upload — DEFAULT Neon (no card). Optional R2/custom if env set.
    if (path.match(/^\/api\/submissions\/\d+\/media$/) && method === "POST") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "admin" && me.role !== "surveyor") {
        return json({ error: "Forbidden" }, 403);
      }
      const id = Number(path.split("/")[3]);
      const body = await readBody(req);
      const kind = String(body.kind || "").toLowerCase(); // photo | audio
      if (kind !== "photo" && kind !== "audio") {
        return json({ error: "kind must be photo or audio" }, 400);
      }

      const exists = await sql`SELECT id, payload FROM submissions WHERE id = ${id}`;
      if (!exists.length) return json({ error: "Submission not found" }, 404);

      let mime = String(
        body.mime || (kind === "photo" ? "image/jpeg" : "audio/webm"),
      );
      let publicUrl = body.url ? String(body.url).trim() : "";
      let provider = body.storage ? String(body.storage) : "";
      let dataB64 = "";
      let byteLen = 0;
      let mode: "external" | "neon" | "client_url" = "neon";

      if (publicUrl && /^https?:\/\//i.test(publicUrl)) {
        provider = provider || "client_url";
        mode = "client_url";
      } else {
        let data = String(body.data || "");
        const mimeMatch = data.match(/^data:([^;]+);base64,/);
        if (mimeMatch) {
          mime = String(body.mime || mimeMatch[1] || mime);
          data = data.slice(mimeMatch[0].length);
        }
        // Incoming cap (~1.2MB base64)
        if (data.length > 1_200_000) {
          return json({
            error: "Media too large. Compress photo or shorten audio (max ~700KB).",
          }, 413);
        }
        if (!data) {
          return json({ error: "data (base64) required" }, 400);
        }
        let bytes: Uint8Array<ArrayBuffer>;
        try {
          bytes = b64ToBytes(data);
        } catch {
          return json({ error: "Invalid base64 media data" }, 400);
        }
        byteLen = bytes.length;
        if (byteLen < 50) {
          return json({ error: "Media file too small / empty" }, 400);
        }
        if (kind === "photo" && !isImageBytes(bytes)) {
          return json({ error: "Not a valid image file (JPEG/PNG/GIF/WebP)" }, 400);
        }
        try {
          const stored = await storeMediaLinked(bytes, mime, kind);
          provider = stored.provider;
          mode = stored.mode;
          publicUrl = stored.url || "";
          dataB64 = stored.dataB64 || "";
        } catch (e) {
          return json({
            error: (e as Error).message || "Media store failed",
            hint: "No credit card needed — media is stored free in Neon (size-limited).",
          }, 413);
        }
      }

      const meta = {
        ...(body.meta && typeof body.meta === "object" ? body.meta : {}),
        storage: provider,
        bytes: byteLen || null,
        mode,
        no_card: true,
      };

      const mediaRows = await sql`
        INSERT INTO survey_media (submission_id, kind, mime, data, url, storage, meta)
        VALUES (
          ${id},
          ${kind},
          ${mime},
          ${dataB64},
          ${publicUrl || null},
          ${provider},
          ${JSON.stringify(meta)}::jsonb
        )
        RETURNING id, kind, mime, url, storage, created_at
      `.catch(async () =>
        await sql`
          INSERT INTO survey_media (submission_id, kind, mime, data, meta)
          VALUES (
            ${id},
            ${kind},
            ${mime},
            ${dataB64 || (publicUrl ? `url:${publicUrl}` : "")},
            ${JSON.stringify(meta)}::jsonb
          )
          RETURNING id, kind, mime, created_at
        `
      );

      const mediaId = Number((mediaRows[0] as { id: number }).id);
      // Neon-hosted files are served by API (auth) — no external card service
      if (mode === "neon" && !publicUrl) {
        publicUrl = `/api/media/${mediaId}/file`;
        await sql`
          UPDATE survey_media SET url = ${publicUrl} WHERE id = ${mediaId}
        `.catch(() => null);
      }

      let payload = parsePayload(exists[0].payload);
      if (kind === "photo") {
        payload.has_photo = true;
        payload.photo_url = publicUrl;
        payload.photo_media_id = mediaId;
      }
      if (kind === "audio") {
        payload.has_audio = true;
        payload.audio_url = publicUrl;
        payload.audio_media_id = mediaId;
      }
      payload.media_storage = provider;
      payload.media_updated_at = new Date().toISOString();
      await sql`
        UPDATE submissions SET payload = ${JSON.stringify(payload)}::jsonb WHERE id = ${id}
      `;

      return json({
        ok: true,
        submission_id: id,
        media: {
          id: mediaId,
          kind,
          mime,
          url: publicUrl,
          storage: provider,
          mode,
        },
        free_storage: true,
        no_card: true,
        linked: true,
        url: publicUrl,
        storage: provider,
        note:
          mode === "neon"
            ? `${kind} linked free in Neon (no credit card). Admin opens via API.`
            : `${kind} linked on ${provider}.`,
      }, 201);
    }

    // Stream media file (Neon storage) — admin or surveyor who owns session
    if (path.match(/^\/api\/media\/\d+\/file$/) && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      const mediaId = Number(path.split("/")[3]);
      const rows = await sql`
        SELECT id, kind, mime, data, url, storage, submission_id
        FROM survey_media WHERE id = ${mediaId} LIMIT 1
      `.catch(async () =>
        await sql`
          SELECT id, kind, mime, data, submission_id
          FROM survey_media WHERE id = ${mediaId} LIMIT 1
        `
      );
      if (!rows.length) return json({ error: "Not found" }, 404);
      const row = rows[0] as {
        id: number;
        kind: string;
        mime: string;
        data: string;
        url?: string;
        storage?: string;
      };
      // Redirect external URLs
      if (row.url && /^https?:\/\//i.test(String(row.url))) {
        return new Response(null, {
          status: 302,
          headers: { Location: String(row.url), ...corsHeaders(req) },
        });
      }
      const raw = String(row.data || "");
      if (!raw || raw.startsWith("url:")) {
        if (raw.startsWith("url:")) {
          return new Response(null, {
            status: 302,
            headers: { Location: raw.slice(4), ...corsHeaders(req) },
          });
        }
        return json({ error: "No media data" }, 404);
      }
      let bytes: Uint8Array<ArrayBuffer>;
      try {
        bytes = b64ToBytes(raw);
      } catch {
        return json({ error: "Corrupt media data" }, 500);
      }
      return new Response(bytes, {
        status: 200,
        headers: {
          "content-type": row.mime || "application/octet-stream",
          "cache-control": "private, max-age=3600",
          "content-disposition": `inline; filename="${row.kind || "media"}-${row.id}"`,
          ...corsHeaders(req),
        },
      });
    }

    // List media for a submission — returns free links (Neon API or external URL)
    if (path.match(/^\/api\/submissions\/\d+\/media$/) && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      const id = Number(path.split("/")[3]);
      if (me.role !== "admin") {
        // Surveyor can view media only for their own submission
        const own = await sql`
          SELECT id FROM submissions WHERE id = ${id}
            AND (payload->>'user_id' = ${String(me.id)}
                 OR payload->>'submitted_by' = ANY(${[me.name, me.username].filter(Boolean)}))
          LIMIT 1
        `.catch(() => []);
        if (!own.length) return json({ error: "Admin only" }, 403);
      }
      const rows = await sql`
        SELECT id, kind, mime, url, storage, meta, created_at,
               CASE WHEN data IS NULL OR data = '' THEN 0 ELSE length(data) END AS neon_bytes
        FROM survey_media WHERE submission_id = ${id} ORDER BY id
      `.catch(async () =>
        await sql`
          SELECT id, kind, mime, meta, created_at, data,
                 length(data) AS neon_bytes
          FROM survey_media WHERE submission_id = ${id} ORDER BY id
        `
      );
      const media = (rows as Record<string, unknown>[]).map((r) => {
        const meta =
          typeof r.meta === "string"
            ? parsePayload(r.meta)
            : (r.meta as Record<string, unknown>) || {};
        let url = (r.url as string) || (meta.url as string) || null;
        if (!url && r.id) url = `/api/media/${r.id}/file`;
        if (!url && typeof r.data === "string" && String(r.data).startsWith("url:")) {
          url = String(r.data).slice(4);
        }
        return {
          id: r.id,
          kind: r.kind,
          mime: r.mime,
          url,
          storage: r.storage || meta.storage || "neon",
          neon_bytes: r.neon_bytes || 0,
          no_card: true,
          meta,
          created_at: r.created_at,
        };
      });
      return json({
        submission_id: id,
        media,
        free_storage: true,
        no_card: true,
        note: "Default storage is free Neon (no credit card). Paths /api/media/:id/file need admin login.",
      });
    }

    // Minimal geo for cascading dropdowns
    if (path === "/api/geo" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      try {
        const acs = await sql`
          SELECT name AS constituency, covering_districts AS district,
                 mp_constituency AS "mpConstituency"
          FROM assembly_constituencies ORDER BY name
        `;
        const districtsRows = await sql`SELECT name FROM districts ORDER BY name`;
        const districtSet = new Set(districtsRows.map((d) => d.name));
        const constituencies = acs.map((r: Record<string, string>) => {
          const covering = String(r.district || "").split(",").map((s) => s.trim()).filter(Boolean);
          covering.forEach((d) => districtSet.add(d));
          return {
            constituency: r.constituency,
            district: covering[0] || "",
            coveringDistricts: covering,
            mpConstituency: String(r.mpConstituency || "").replace(/\s*\(.*?\)\s*$/, ""),
          };
        });
        return json({
          constituencies,
          districts: [...districtSet].sort(),
          mpConstituencies: [],
        });
      } catch {
        return json({ constituencies: [], districts: [], mpConstituencies: [] });
      }
    }

    if (path === "/api/geo/mandals" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      const district = url.searchParams.get("district") || "";
      try {
        const rows = district
          ? await sql`
              SELECT mandal_name AS "mandalName", district,
                     revenue_division AS "revenueDivision", mandal_code AS "mandalCode"
              FROM mandals WHERE district = ${district} ORDER BY mandal_name
            `
          : await sql`
              SELECT mandal_name AS "mandalName", district,
                     revenue_division AS "revenueDivision", mandal_code AS "mandalCode"
              FROM mandals ORDER BY district, mandal_name LIMIT 500
            `;
        return json({ mandals: rows });
      } catch {
        return json({ mandals: [] });
      }
    }

    if (path === "/api/geo/revenue_divisions" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      try {
        const rows = await sql`SELECT name, district FROM revenue_divisions ORDER BY name LIMIT 200`;
        return json({ revenueDivisions: rows });
      } catch {
        return json({ revenueDivisions: [] });
      }
    }

    // Dashboard + filters — full super-set / sub-set analytics
    if (path === "/api/analytics" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      return json(await buildAnalytics(sql, url));
    }

    // Admin geo summary (for Upload tab)
    if (path === "/api/admin/geo-summary" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "admin") return json({ error: "Admin only" }, 403);
      try {
        const [d] = await sql`SELECT COUNT(*)::int AS n FROM districts`;
        const [m] = await sql`SELECT COUNT(*)::int AS n FROM mandals`;
        const [a] = await sql`SELECT COUNT(*)::int AS n FROM assembly_constituencies`;
        const [p] = await sql`SELECT COUNT(*)::int AS n FROM mp_constituencies`;
        const [r] = await sql`SELECT COUNT(*)::int AS n FROM revenue_divisions`;
        const [s] = await sql`SELECT COUNT(*)::int AS n FROM submissions`;
        const districts = await sql`SELECT * FROM districts ORDER BY name LIMIT 100`;
        const acs = await sql`
          SELECT name, covering_districts, mp_constituency, reservation
          FROM assembly_constituencies ORDER BY name LIMIT 150
        `;
        const mps = await sql`SELECT * FROM mp_constituencies ORDER BY name LIMIT 50`;
        return json({
          counts: {
            districts: d?.n ?? 0,
            mandals: m?.n ?? 0,
            assembly_constituencies: a?.n ?? 0,
            mp_constituencies: p?.n ?? 0,
            revenue_divisions: r?.n ?? 0,
            submissions: s?.n ?? 0,
          },
          districts,
          assembly_constituencies: acs,
          mp_constituencies: mps,
        });
      } catch (e) {
        return json({ error: (e as Error).message }, 500);
      }
    }

    return json({ error: `Not found: ${method} ${path}` }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: (err as Error).message || "Server error" }, 500);
  }
});
