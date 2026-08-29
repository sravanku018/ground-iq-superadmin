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
import { scryptSync, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

// ── Geo aliases (inlined so the Deno Playground deploys a single file) ──

/** Telugu-script district spellings → canonical district name. */
const TELUGU_DISTRICTS: Record<string, string> = {
  "ఆదిలాబాద్": "Adilabad",
  "భద్రాద్రి కొత్తగూడెం": "Bhadradri Kothagudem",
  "భద్రాచలం": "Bhadradri Kothagudem",
  "కొత్తగూడెం": "Bhadradri Kothagudem",
  "హనుమకొండ": "Hanumakonda",
  "హన్మకొండ": "Hanumakonda",
  "వరంగల్ (అర్బన్)": "Hanumakonda",
  "హైదరాబాద్": "Hyderabad",
  "జగిత్యాల": "Jagitial",
  "జనగామ": "Jangaon",
  "జనగాం": "Jangaon",
  "జయశంకర్ భూపాలపల్లి": "Jayashankar Bhupalapally",
  "భూపాలపల్లి": "Jayashankar Bhupalapally",
  "జోగులాంబ గద్వాల్": "Jogulamba Gadwal",
  "గద్వాల్": "Jogulamba Gadwal",
  "కామారెడ్డి": "Kamareddy",
  "కరీంనగర్": "Karimnagar",
  "ఖమ్మం": "Khammam",
  "కొమరంభీమ్ ఆసిఫాబాద్": "Komarambheem Asifabad",
  "కొమరంభీం": "Komarambheem Asifabad",
  "కొమరంభీం ఆసిఫాబాద్": "Komarambheem Asifabad",
  "అసిఫాబాద్": "Komarambheem Asifabad",
  "ఆసిఫాబాద్": "Komarambheem Asifabad",
  "మహబూబాబాద్": "Mahabubabad",
  "మహబూబాబాదు": "Mahabubabad",
  "మహబూబ్నగర్": "Mahabubnagar",
  "మహబూబ్ నగర్": "Mahabubnagar",
  "మంచిర్యాల": "Mancherial",
  "మెదక్": "Medak",
  "మేడ్చల్ మల్కాజ్గిరి": "Medchal Malkajgiri",
  "మేడ్చెల్ మల్కాజ్గిరి": "Medchal Malkajgiri",
  "మేడ్చల్-మల్కాజ్గిరి": "Medchal Malkajgiri",
  "మల్కాజ్గిరి": "Medchal Malkajgiri",
  "\u0C2E\u0C32\u0C4D\u0C15\u0C3E\u0C1C\u0C4D\u200C\u0C17\u0C3F\u0C30\u0C3F": "Medchal Malkajgiri", // contains invisible ZWNJ — do not "clean up"
  "మేడ్చల్": "Medchal Malkajgiri",
  "ములుగు": "Mulugu",
  "నాగర్కర్నూల్": "Nagarkurnool",
  "నాగర్ కర్నూల్": "Nagarkurnool",
  "నల్గొండ": "Nalgonda",
  "నారాయణపేట": "Narayanpet",
  "నిర్మల్": "Nirmal",
  "నిజామాబాద్": "Nizamabad",
  "పెద్దపల్లి": "Peddapalli",
  "రాజన్న సిరిసిల్ల": "Rajanna Sircilla",
  "సిరిసిల్ల": "Rajanna Sircilla",
  "రంగారెడ్డి": "Rangareddy",
  "సంగారెడ్డి": "Sangareddy",
  "సిద్ధిపేట్": "Siddipet",
  "సిద్దిపేట": "Siddipet",
  "సూర్యాపేట": "Suryapet",
  "వికారాబాద్": "Vikarabad",
  "వికారాబాదు": "Vikarabad",
  "వనపర్తి": "Wanaparthy",
  "వరంగల్": "Warangal",
  "వరంగల్ (రూరల్)": "Warangal",
  "యాదాద్రి భువనగిరి": "Yadadri Bhuvanagiri",
  "యాదాద్రి": "Yadadri Bhuvanagiri",
  "భువనగిరి": "Yadadri Bhuvanagiri",
};

/** Romanized district spelling variants → canonical district name. */
const ROMAN_DISTRICTS: Record<string, string> = {
  adilabad: "Adilabad",
  "bhadradri kothagudem": "Bhadradri Kothagudem",
  bhadradri: "Bhadradri Kothagudem",
  kothagudem: "Bhadradri Kothagudem",
  "bhadradri kothagudam": "Bhadradri Kothagudem",
  "bhadradri kothgudem": "Bhadradri Kothagudem",
  hanumakonda: "Hanumakonda",
  hanamkonda: "Hanumakonda",
  hanmakonda: "Hanumakonda",
  "warangal urban": "Hanumakonda",
  "warangal city": "Hanumakonda",
  hyderabad: "Hyderabad",
  hyd: "Hyderabad",
  "hyderabad district": "Hyderabad",
  jagitial: "Jagitial",
  jagtial: "Jagitial",
  jagityal: "Jagitial",
  jagtiyal: "Jagitial",
  jagital: "Jagitial",
  jagityala: "Jagitial",
  jangaon: "Jangaon",
  jangaun: "Jangaon",
  "jayashankar bhupalapally": "Jayashankar Bhupalapally",
  jayashankar: "Jayashankar Bhupalapally",
  "jayashankar bhupalpally": "Jayashankar Bhupalapally",
  "jayashankar bhoopalpally": "Jayashankar Bhupalapally",
  jayshankar: "Jayashankar Bhupalapally",
  bhupalpally: "Jayashankar Bhupalapally",
  bhupalapally: "Jayashankar Bhupalapally",
  bhupalpalle: "Jayashankar Bhupalapally",
  "jaya shankar": "Jayashankar Bhupalapally",
  "jogulamba gadwal": "Jogulamba Gadwal",
  jogulamba: "Jogulamba Gadwal",
  gadwal: "Jogulamba Gadwal",
  kamareddy: "Kamareddy",
  kamareddi: "Kamareddy",
  kamaredi: "Kamareddy",
  karimnagar: "Karimnagar",
  "karim nagar": "Karimnagar",
  khammam: "Khammam",
  "komarambheem asifabad": "Komarambheem Asifabad",
  komarambheem: "Komarambheem Asifabad",
  "komaram bheem": "Komarambheem Asifabad",
  "komaram bheem asifabad": "Komarambheem Asifabad",
  kumurambheem: "Komarambheem Asifabad",
  "kumuram bheem": "Komarambheem Asifabad",
  kumrambheem: "Komarambheem Asifabad",
  "kumurambheem asifabad": "Komarambheem Asifabad",
  asifabad: "Komarambheem Asifabad",
  mahabubabad: "Mahabubabad",
  mahbubabad: "Mahabubabad",
  mahaboobabad: "Mahabubabad",
  mahabubnagar: "Mahabubnagar",
  mahbubnagar: "Mahabubnagar",
  mahaboobnagar: "Mahabubnagar",
  mancherial: "Mancherial",
  manchirial: "Mancherial",
  manchariyal: "Mancherial",
  medak: "Medak",
  "medchal malkajgiri": "Medchal Malkajgiri",
  medchal: "Medchal Malkajgiri",
  malkajgiri: "Medchal Malkajgiri",
  "medchal malkajgiri district": "Medchal Malkajgiri",
  mulugu: "Mulugu",
  mulug: "Mulugu",
  nagarkurnool: "Nagarkurnool",
  "nagar kurnool": "Nagarkurnool",
  nagarkurnul: "Nagarkurnool",
  nalgonda: "Nalgonda",
  nalgunda: "Nalgonda",
  narayanpet: "Narayanpet",
  narayanapet: "Narayanpet",
  narayampet: "Narayanpet",
  nirmal: "Nirmal",
  nizamabad: "Nizamabad",
  peddapalli: "Peddapalli",
  peddapalle: "Peddapalli",
  peddapally: "Peddapalli",
  "rajanna sircilla": "Rajanna Sircilla",
  sircilla: "Rajanna Sircilla",
  siricilla: "Rajanna Sircilla",
  "rajanna siricilla": "Rajanna Sircilla",
  rangareddy: "Rangareddy",
  "ranga reddy": "Rangareddy",
  rangareddi: "Rangareddy",
  "ranga reddi": "Rangareddy",
  sangareddy: "Sangareddy",
  sangareddi: "Sangareddy",
  "sanga reddy": "Sangareddy",
  siddipet: "Siddipet",
  siddhipet: "Siddipet",
  suryapet: "Suryapet",
  vikarabad: "Vikarabad",
  vicarabad: "Vikarabad",
  wanaparthy: "Wanaparthy",
  wanaparthi: "Wanaparthy",
  warangal: "Warangal",
  "warangal rural": "Warangal",
  "yadadri bhuvanagiri": "Yadadri Bhuvanagiri",
  yadadri: "Yadadri Bhuvanagiri",
  "yadadri bhongir": "Yadadri Bhuvanagiri",
  "yadadri bhongiri": "Yadadri Bhuvanagiri",
  bhuvanagiri: "Yadadri Bhuvanagiri",
};

/** All 119 Assembly Constituencies (canonical display names). */
const AC_NAMES = [
  "Sirpur", "Chennur", "Bellampalle", "Mancherial", "Asifabad", "Khanapur",
  "Adilabad", "Boath", "Nirmal", "Mudhole", "Armur", "Bodhan",
  "Jukkal", "Banswada", "Yellareddy", "Kamareddy", "Nizamabad Urban", "Nizamabad Rural",
  "Balkonda", "Korutla", "Jagtial", "Dharmapuri", "Ramagundam", "Manthani",
  "Peddapalli", "Karimnagar", "Choppadandi", "Vemulawada", "Sircilla", "Manakondur",
  "Huzurabad", "Husnabad", "Siddipet", "Medak", "Narayankhed", "Andole",
  "Narsapur", "Zahirabad", "Sangareddy", "Patancheru", "Dubbak", "Gajwel",
  "Quthbullapur", "Kukatpally", "Uppal", "Malkajgiri", "Medchal", "Secunderabad Cantonment",
  "Musheerabad", "Malakpet", "Amberpet", "Khairatabad", "Jubilee Hills", "Sanathnagar",
  "Nampally", "Karwan", "Goshamahal", "Charminar", "Chandrayangutta", "Yakutpura",
  "Bahadurpura", "Maheshwaram", "Rajendranagar", "Serilingampally", "Chevella", "Pargi",
  "Vikarabad", "Tandur", "Kodangal", "Narayanpet", "Mahbubnagar", "Jadcherla",
  "Devarkadra", "Makthal", "Wanaparthy", "Gadwal", "Alampur", "Nagarkurnool",
  "Achampet", "Kalwakurthy", "Shadnagar", "Kollapur", "Devarakonda", "Nagarjuna Sagar",
  "Miryalaguda", "Huzurnagar", "Kodad", "Suryapet", "Nalgonda", "Munugode",
  "Bhongir", "Nakrekal", "Thungathurthi", "Alair", "Jangaon", "Ghanpur (Station)",
  "Palakurthi", "Dornakal", "Mahabubabad", "Narsampet", "Parkal", "Warangal West",
  "Warangal East", "Wardhannapet", "Bhupalpalle", "Mulug", "Pinapaka", "Yellandu",
  "Khammam", "Palair", "Madhira", "Wyra", "Sathupalli", "Kothagudem",
  "Aswaraopeta", "Bhadrachalam", "Secunderabad", "Lal Bahadur Nagar", "Ibrahimpatnam",
];

/** AC spelling variants → canonical AC name. Canonical keys come from AC_NAMES. */
const AC_VARIANTS: Record<string, string> = {
  siripuram: "Sirpur",
  chennuru: "Chennur",
  chenur: "Chennur",
  bellampalli: "Bellampalle",
  bellampally: "Bellampalle",
  manchirial: "Mancherial",
  both: "Boath",
  mudhol: "Mudhole",
  armoor: "Armur",
  banswara: "Banswada",
  bansuvada: "Banswada",
  yellareddi: "Yellareddy",
  kamareddi: "Kamareddy",
  "nizamabad city": "Nizamabad Urban",
  "nizamabad u": "Nizamabad Urban",
  "nizamabad r": "Nizamabad Rural",
  koratla: "Korutla",
  jagitial: "Jagtial",
  jagityal: "Jagtial",
  jagtiyal: "Jagtial",
  peddapalle: "Peddapalli",
  peddapally: "Peddapalli",
  "karim nagar": "Karimnagar",
  chopardandi: "Choppadandi",
  choppadandhi: "Choppadandi",
  vemulavada: "Vemulawada",
  siricilla: "Sircilla",
  siddhipet: "Siddipet",
  sangareddi: "Sangareddy",
  dubbaka: "Dubbak",
  qutbullapur: "Quthbullapur",
  kutbullapur: "Quthbullapur",
  quthbullapally: "Quthbullapur",
  quathbullapur: "Quthbullapur",
  kukatpalle: "Kukatpally",
  kukatpalli: "Kukatpally",
  "malkajgiri urban": "Malkajgiri",
  "malkajgiri east": "Malkajgiri",
  "malkajgiri west": "Malkajgiri",
  "secunderabad cantt": "Secunderabad Cantonment",
  "secunderabad cant": "Secunderabad Cantonment",
  "sc cantonment": "Secunderabad Cantonment",
  "secunderabad cantt sc": "Secunderabad Cantonment",
  musherabad: "Musheerabad",
  khairtabad: "Khairatabad",
  "sanath nagar": "Sanathnagar",
  "gosha mahal": "Goshamahal",
  chandragutta: "Chandrayangutta",
  yaqutpura: "Yakutpura",
  maheswaram: "Maheshwaram",
  "rajendra nagar": "Rajendranagar",
  serilingampalli: "Serilingampally",
  "seri lingampally": "Serilingampally",
  parigi: "Pargi",
  vicarabad: "Vikarabad",
  narayanapet: "Narayanpet",
  mahabubnagar: "Mahbubnagar",
  mahaboobnagar: "Mahbubnagar",
  "nagar kurnool": "Nagarkurnool",
  kalwakurthi: "Kalwakurthy",
  "shad nagar": "Shadnagar",
  devarkonda: "Devarakonda",
  nagarjunasagar: "Nagarjuna Sagar",
  "miryala guda": "Miryalaguda",
  miryalguda: "Miryalaguda",
  "huzur nagar": "Huzurnagar",
  bhongiri: "Bhongir",
  bhuvanagiri: "Bhongir",
  thungaturthi: "Thungathurthi",
  thungaturthy: "Thungathurthi",
  "ghanpur station": "Ghanpur (Station)",
  "ghanpur stn": "Ghanpur (Station)",
  ghanpur: "Ghanpur (Station)",
  palakurthy: "Palakurthi",
  mahbubabad: "Mahabubabad",
  mahaboobabad: "Mahabubabad",
  "warangal w": "Warangal West",
  "warangal e": "Warangal East",
  waradhanapet: "Wardhannapet",
  wardannapet: "Wardhannapet",
  bhupalpally: "Bhupalpalle",
  bhupalapally: "Bhupalpalle",
  bhupalpalli: "Bhupalpalle",
  mulugu: "Mulug",
  sathupalle: "Sathupalli",
  aswaraopet: "Aswaraopeta",
  "lb nagar": "Lal Bahadur Nagar",
  lbnagar: "Lal Bahadur Nagar",
  brahimpatnam: "Ibrahimpatnam",
  ibrahimpatan: "Ibrahimpatnam",
};

/** Auto-expand "<alias> gen|sc|st" reservation-suffix variants. */
function withReservationSuffixes(base: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [alias, name] of Object.entries(base)) {
    out[alias] = name;
    out[`${alias} gen`] = name;
    out[`${alias} sc`] = name;
    out[`${alias} st`] = name;
  }
  return out;
}

const AC_BASE: Record<string, string> = { ...AC_VARIANTS };
for (const name of AC_NAMES) AC_BASE[name.toLowerCase()] = name;

const GEO_ALIASES = {
  telugu: TELUGU_DISTRICTS,
  districts: ROMAN_DISTRICTS,
  districtNames: [...new Set(Object.values(ROMAN_DISTRICTS))].sort(),
  acs: withReservationSuffixes(AC_BASE),
};

// ── Config ────────────────────────────────────────────────
const DATABASE_URL = Deno.env.get("DATABASE_URL");
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL env var");
}

const sql = DATABASE_URL ? neon(DATABASE_URL) : null;

// ── Rate Limiting (In-Memory) ────────────────────────────
const loginAttempts = new Map<string, { count: number; reset: number }>();
function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const a = loginAttempts.get(ip);
  if (!a || now > a.reset) {
    loginAttempts.set(ip, { count: 1, reset: now + 60000 });
    return true;
  }
  a.count++;
  return a.count <= 5;
}

// ── Crypto helpers (same idea as Node auth) ───────────────
async function pbkdf2Hash(password: string, saltHex: string, iterations = 600_000): Promise<string> {
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

async function hashPasswordAsync(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = [...salt].map((b) => b.toString(16).padStart(2, "0")).join("");
  return pbkdf2Hash(password, saltHex, 600_000);
}


async function verifyPassword(
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

function newToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// ── Super Admin TOTP (RFC 6238, SHA-1, 30s, 6 digits) ────────────────────
const TOTP_B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const SUPER_ADMIN_SLOTS = 3;

function bytesToBase32(bytes: Uint8Array): string {
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

function base32ToBytes(s: string): Uint8Array {
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

function newTotpSecret(): string {
  const b = new Uint8Array(20);
  crypto.getRandomValues(b);
  return bytesToBase32(b);
}

function otpauthUrl(username: string, secret: string): string {
  const label = encodeURIComponent(`Smart Survey X:${username}`);
  const issuer = encodeURIComponent("Smart Survey X");
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}

async function hotpSha1(secret: Uint8Array, counter: number): Promise<string> {
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

async function verifyTotp(secretB32: string, code: unknown): Promise<boolean> {
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

function totpSetupPayload(username: string, secret: string) {
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

const SA_SLOT_USERNAMES = ["superadmin", "superadmin2", "superadmin3"] as const;
const SA_SLOT_STARTER_PASSWORD = "admin123";

/** Create only missing Super Admin usernames. Never updates an existing row. */
async function seedMissingSuperAdminSlots(
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

// ── CORS allowlist ────────────────────────────────────────────────────────
// Portals run on GitHub Pages (origin https://sravanku018.github.io) and Vercel.
// The Android WebView origin is https://localhost (androidScheme: "https").
// ALLOWED_ORIGINS env (comma-separated) is merged with the defaults, not a replace.
const DEFAULT_ALLOWED_ORIGINS = [
  "https://ground-iq-web-lake.vercel.app",
  "https://ground-iq-superadmin.vercel.app",
  "https://sravanku018.github.io",
  "https://localhost",
  "http://localhost",
  "http://localhost:5173",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:4173",
  "capacitor://localhost",
  "ionic://localhost",
];
const ALLOWED_ORIGINS = new Set([
  ...DEFAULT_ALLOWED_ORIGINS,
  ...(Deno.env.get("ALLOWED_ORIGINS")?.split(",").map((s) => s.trim()).filter(Boolean) ?? []),
]);

function originIsAllowed(origin: string): boolean {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  const host = u.hostname;
  if (host === "localhost" || host === "127.0.0.1") return true;
  if (host === "sravanku018.github.io") return true;
  if (
    host.endsWith(".vercel.app") &&
    (host.startsWith("ground-iq-web") || host.startsWith("ground-iq-superadmin"))
  ) {
    return true;
  }
  return false;
}

/** The request's Origin iff it is allow-listed, else null. */
function resolveAllowedOrigin(req?: Request): string | null {
  const origin = req?.headers.get("origin");
  if (!origin) return null; // non-browser client (curl / server-to-server): CORS N/A
  return originIsAllowed(origin) ? origin : null;
}
/** Single choke point: stamp the correct CORS origin on every outgoing response. */
function withCors(req: Request, res: Response): Response {
  try {
    const allowed = resolveAllowedOrigin(req);
    if (allowed) res.headers.set("access-control-allow-origin", allowed);
    else res.headers.delete("access-control-allow-origin"); // block disallowed origins
    res.headers.append("vary", "Origin");
  } catch { /* streamed/guarded headers — leave as-is */ }
  return res;
}

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-headers":
    "authorization, content-type, x-auth-token, accept, origin, range, content-disposition, cache-control, pragma, x-requested-with",
  "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
  "access-control-expose-headers":
    "content-disposition, content-type, content-length, location",
  "access-control-max-age": "86400",
};

function corsHeaders(_req?: Request): Record<string, string> {
  return { ...CORS_HEADERS };
}

function corsPreflight(req: Request): Response {
  const headers: Record<string, string> = { ...CORS_HEADERS, vary: "Origin" };
  const allowed = resolveAllowedOrigin(req);
  if (allowed) headers["access-control-allow-origin"] = allowed;
  return new Response(null, { status: 204, headers });
}

function json(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  const cl = Number(req.headers.get("content-length") || 0);
  if (cl > 10_000_000) throw new Error("Body too large");
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  if (h.startsWith("Bearer ")) return h.slice(7);
  const x = req.headers.get("x-auth-token");
  if (x) return x;
  return null; // Removed URL query token support for security
}

const BOOL_FIELDS = [
  "verified",
  "can_manage_questions",
  "can_edit_surveys",
  "can_review_data",
  "can_verify_surveyors",
  "can_assign_surveyors",
  "can_crud_questionnaire",
  "can_validate_proof",
  "can_web_survey",
  "can_record_voice",
] as const;

const NUM_FIELDS = [
  "max_questions_per_survey",
  "max_surveys",
  "max_surveyors",
  "max_records",
] as const;

const USER_COLUMNS = [
  "u.id", "u.username", "u.display_name", "u.role", "u.active", "u.created_at",
  "u.company_id", "u.company_name", "u.key_id", "u.phone",
  ...BOOL_FIELDS.map((f) => `u.${f}`),
  ...NUM_FIELDS.map((f) => `u.${f}`),
].join(", ");

type PortalUser = {
  id: unknown;
  username: string;
  name: string;
  role: string;
  active: unknown;
  created_at: unknown;
  company_id: number | null;
  company_name: string | null;
  key_id: string | null;
  phone: string | null;
} & Record<(typeof BOOL_FIELDS)[number], boolean> &
  Record<(typeof NUM_FIELDS)[number], number>;

async function getUser(token: string | null): Promise<PortalUser | null> {
  if (!token || !sql) return null;
  const rows = (await sql(
    `SELECT ${USER_COLUMNS}
     FROM app_sessions s
     JOIN app_users u ON u.id = s.user_id
     WHERE s.token = $1
       AND s.expires_at > NOW()
       AND u.active = TRUE
       AND u.role IN ('super_admin', 'admin', 'surveyor')
     LIMIT 1`,
    [token],
  ).catch(() => [])) as Record<string, unknown>[];

  const u = rows[0];
  if (!u) return null;

  const me: Record<string, unknown> = {
    id: u.id,
    username: u.username,
    name: u.display_name || u.username,
    role: u.role,
    active: u.active,
    created_at: u.created_at,
    company_id: u.company_id != null ? Number(u.company_id) : null,
    company_name: u.company_name ? String(u.company_name) : null,
    key_id: u.key_id || null,
    phone: u.phone || null,
  };
  for (const f of BOOL_FIELDS) me[f] = sqlBool(u[f]);
  for (const f of NUM_FIELDS) me[f] = Number(u[f]) || 0;
  return me as PortalUser;
}

/** Portal roles: Client Admin + platform Super Admin (01-PRD.md §2). Super Admin has all admin powers. */
function isPortalAdmin(role: unknown): boolean {
  return role === "admin" || role === "super_admin";
}

/** Coerce Postgres/JSON boolean-ish values (true | 't' | 'true' | 1). */
function sqlBool(v: unknown): boolean {
  if (v === true || v === 1) return true;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "t" || s === "true" || s === "1" || s === "yes";
  }
  return false;
}

/**
 * Read COUNT(*) row from `const [row] = await sql\`SELECT COUNT(*)::int AS n …\``.
 * Must use row.n — treating the row as an array always yields 0 and breaks limits/UI.
 */
function sqlCountN(row: unknown): number {
  if (row == null) return 0;
  if (typeof row === "object" && "n" in (row as object)) {
    const n = Number((row as { n?: unknown }).n);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Parse survey_form.questions whether stored as jsonb array or double-encoded string. */
function parseQuestionsArray(raw: unknown): unknown[] {
  let qs: unknown = raw;
  if (typeof qs === "string") {
    try {
      qs = JSON.parse(qs);
    } catch {
      return [];
    }
  }
  // Some rows store a JSON string inside jsonb
  if (typeof qs === "string") {
    try {
      qs = JSON.parse(qs);
    } catch {
      return [];
    }
  }
  return Array.isArray(qs) ? qs : [];
}

/** Retry a query once — transient HTTP failure on the serverless driver. */
async function retryOnce<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch {
    return await run();
  }
}

/** Surveys assigned to a surveyor, with questions parsed for the field app. */
async function listAssignedSurveys(
  sqlFn: NonNullable<typeof sql>,
  userId: number,
): Promise<{
  id: unknown;
  form_key: unknown;
  title: unknown;
  display_lang: "en" | "te";
  questions: unknown[];
  updated_at: unknown;
  voice_required: boolean;
  voice_time_limit: number;
}[]> {
  const rows = await retryOnce(() =>
    sqlFn`
      SELECT f.id, f.form_key, f.title, f.display_lang, f.questions, f.updated_at,
             COALESCE(f.voice_required, FALSE) AS voice_required,
             COALESCE(f.voice_time_limit, 0) AS voice_time_limit
      FROM survey_assignments sa
      JOIN survey_form f ON f.id = sa.survey_id
      WHERE sa.user_id = ${userId}
      ORDER BY f.title
    `
  ).catch(() => []);
  return (rows as Record<string, unknown>[]).map((r) => ({
    id: r.id,
    form_key: r.form_key,
    title: r.title,
    display_lang: surveyDisplayLang(r.display_lang),
    questions: parseQuestionsArray(r.questions),
    updated_at: r.updated_at,
    voice_required: r.voice_required === true,
    voice_time_limit: Number(r.voice_time_limit) || 0,
  }));
}

/**
 * Peak questions in any one survey a Client Admin can use (owned + shared + company projects).
 * Used for "Questions / survey (peak)" vs max_questions_per_survey.
 */
async function peakQuestionsForAdmin(
  sqlFn: NonNullable<typeof sql>,
  adminId: number,
  companyName?: string | null,
): Promise<number> {
  void companyName;
  const rows = await sqlFn`
      SELECT questions FROM survey_form
      WHERE form_key NOT IN ('default', 'legacy')
        AND (
          created_by = ${adminId}
          OR id IN (SELECT survey_id FROM survey_admin_access WHERE admin_id = ${adminId})
        )
    `.catch(() => []);
  let peak = 0;
  for (const r of rows as { questions?: unknown }[]) {
    peak = Math.max(peak, parseQuestionsArray(r.questions).length);
  }
  return peak;
}

/** Grant-based power check — Super Admin always has every power; Client Admins need the grant. */
function hasPower(
  me: { role: unknown } & Record<string, unknown> | null,
  key: string,
): boolean {
  return !!me && (me.role === "super_admin" || sqlBool(me[key]));
}

/**
 * Surveyor ↔ survey mapping. ON CONFLICT needs UNIQUE(survey_id, user_id);
 * if an older table is missing that constraint, fall back to a plain INSERT.
 */
async function upsertSurveyAssignment(surveyId: number, userId: number): Promise<boolean> {
  if (!sql || !Number.isFinite(surveyId) || !Number.isFinite(userId)) return false;
  try {
    await sql`
      INSERT INTO survey_assignments (survey_id, user_id)
      VALUES (${surveyId}, ${userId})
      ON CONFLICT (survey_id, user_id) DO NOTHING
    `;
    return true;
  } catch {
    return false;
  }
}

/** Telugu add / type / auto-translate — question-management powers only (no separate grant). */
function canQuestionCopy(
  me: { role: unknown } & Record<string, unknown> | null,
): boolean {
  return hasPower(me, "can_manage_questions") || hasPower(me, "can_crud_questionnaire");
}

function stripTeluguUnlessAllowed(
  me: { role: unknown } & Record<string, unknown> | null,
  questions: unknown[],
): unknown[] {
  if (canQuestionCopy(me)) return questions;
  return questions.map((q) => {
    if (!q || typeof q !== "object") return q;
    const rec = { ...(q as Record<string, unknown>) };
    delete rec.label_te;
    delete rec.options_te;
    delete rec.options_te_text;
    return rec;
  });
}

function decodeTranslateHtml(s: string): string {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

/** Google Translate (official Cloud key, else public translate endpoint). */
async function googleTranslateToTelugu(texts: string[]): Promise<string[]> {
  const items = texts.map((t) => String(t || ""));
  if (!items.length) return [];
  const official =
    Deno.env.get("GOOGLE_TRANSLATE_API_KEY") || Deno.env.get("GOOGLE_API_KEY") || "";
  if (official) {
    const res = await fetch(
      `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(official)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ q: items, source: "en", target: "te", format: "text" }),
      },
    );
    const data = await res.json().catch(() => ({})) as {
      data?: { translations?: { translatedText?: string }[] };
      error?: { message?: string };
    };
    if (!res.ok) {
      const err = new Error(data.error?.message || `Google Translate failed (${res.status})`);
      (err as { status?: number }).status = 502;
      throw err;
    }
    const rows = data.data?.translations || [];
    return items.map((_, i) => decodeTranslateHtml(String(rows[i]?.translatedText || "")));
  }

  const out: string[] = [];
  for (const t of items) {
    if (!t.trim()) {
      out.push("");
      continue;
    }
    const url =
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=te&dt=t&q=${encodeURIComponent(t)}`;
    const res = await fetch(url);
    const arr = await res.json().catch(() => null) as unknown;
    if (!res.ok || !Array.isArray(arr)) {
      const err = new Error(`Google Translate failed (${res.status})`);
      (err as { status?: number }).status = 502;
      throw err;
    }
    const chunks = Array.isArray(arr[0]) ? arr[0] : [];
    const te = chunks.map((c) => (Array.isArray(c) ? String(c[0] || "") : "")).join("");
    out.push(te.trim());
  }
  return out;
}

async function translateQuestionToTelugu(
  text: string,
  options: string[],
): Promise<{ text_te: string; options_te: string[] }> {
  try {
    const batch = [text, ...options];
    const te = await googleTranslateToTelugu(batch);
    return { text_te: te[0] || "", options_te: te.slice(1) };
  } catch (googleErr) {
    const xai = Deno.env.get("XAI_API_KEY") || "";
    if (!xai) throw googleErr;
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${xai}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "grok-4.5",
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              'Translate English survey questions into Telugu (te-IN). Reply with JSON only: {"text_te":"...","options_te":[...]}. options_te must match the input options in length and order. Keep numbers and party names readable.',
          },
          { role: "user", content: JSON.stringify({ text, options }) },
        ],
      }),
    });
    const raw = await res.text();
    if (!res.ok) throw googleErr;
    let parsed: { choices?: { message?: { content?: string } }[] } = {};
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      throw googleErr;
    }
    let content = String(parsed.choices?.[0]?.message?.content || "").trim();
    content = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const out = JSON.parse(content) as { text_te?: string; options_te?: unknown };
    const optionsTe = Array.isArray(out.options_te)
      ? out.options_te.map((s) => String(s ?? ""))
      : [];
    return { text_te: String(out.text_te || "").trim(), options_te: optionsTe };
  }
}

/**
 * Append a platform audit-log entry (FR-AUD-01/02) — fire-and-forget so the
 * request path never slows down. Actor is the specific account (id + username),
 * never just the role.
 */
function mapInboxRow(r: Record<string, unknown>) {
  const action = String(r.action || "");
  let meta: Record<string, unknown> = {};
  if (r.meta && typeof r.meta === "object") meta = r.meta as Record<string, unknown>;
  else if (typeof r.meta === "string") {
    try {
      meta = JSON.parse(r.meta) as Record<string, unknown>;
    } catch {
      meta = {};
    }
  }
  const fields = Array.isArray(meta.fields) ? (meta.fields as unknown[]).map(String) : [];
  const actorId = r.actor_id != null ? Number(r.actor_id) : null;
  const entityId = r.entity_id != null && String(r.entity_id) !== "" ? Number(r.entity_id) : null;
  const verified = sqlBool((r as { surveyor_verified?: unknown }).surveyor_verified);
  if (action === "profile_media") {
    return {
      id: `evt-${r.id}`,
      seq: Number(r.id) || 0,
      kind: "docs",
      page: "users",
      userId: entityId || actorId,
      submissionId: null,
      verified,
      title: `@${r.actor_name || "surveyor"} uploaded verification docs`,
      detail: fields.length ? fields.join(" · ") : "photo / Aadhaar",
      at: r.created_at,
    };
  }
  return {
    id: `evt-${r.id}`,
    seq: Number(r.id) || 0,
    kind: "activity",
    page: "review",
    userId: actorId,
    submissionId: entityId,
    verified,
    title: `New activity #${r.entity_id || ""}`.trim(),
    detail: String(r.actor_name || "surveyor"),
    at: r.created_at,
  };
}

async function listAdminInbox(
  sqlFn: NonNullable<typeof sql>,
  admin: { id: unknown; role: unknown },
  afterId = 0,
) {
  const after = Math.max(0, Number(afterId) || 0);
  const isSuper = admin.role === "super_admin";
  const adminId = Number(admin.id);

  return await sqlFn`
    SELECT a.id, a.actor_id, a.actor_name, a.action, a.entity_type, a.entity_id, a.meta, a.created_at,
           COALESCE(u.verified, FALSE) AS surveyor_verified
    FROM audit_log a
    LEFT JOIN app_users u ON u.id = CASE
      WHEN a.action = 'profile_media' AND a.entity_id ~ '^[0-9]+$' THEN a.entity_id::int
      ELSE a.actor_id
    END
    WHERE (a.action = 'submission_create' OR (${!isSuper} AND a.action = 'profile_media'))
      AND a.id > ${after}
      AND (
        ${isSuper}
        OR CASE
          WHEN a.action = 'profile_media' AND a.entity_id ~ '^[0-9]+$' THEN a.entity_id::int
          ELSE a.actor_id
        END IN (
          SELECT id FROM app_users
          WHERE role = 'surveyor'
            AND (
              created_by = ${adminId}
              OR company_id = (SELECT company_id FROM app_users WHERE id = ${adminId} AND company_id IS NOT NULL)
            )
        )
      )
    ORDER BY a.id DESC
    LIMIT 50
  `.catch(() => []);
}

function logAudit(
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
      ${JSON.stringify(meta || {})}::jsonb
    )
  `.catch((e) => console.error("AUDIT LOG FAILED:", (e as Error)?.message || e));
}


/** Unique surveyor key ID, e.g. GROUND-8F3K2Q (no 0/O/1/I) */
function genUserKeyId(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let k = "";
  for (let i = 0; i < 6; i++) {
    k += chars[Math.floor(Math.random() * chars.length)];
  }
  return `GROUND-${k}`;
}

async function uniqueUserKeyId(): Promise<string> {
  for (let i = 0; i < 25; i++) {
    const k = genUserKeyId();
    const hit = await sql`SELECT id FROM app_users WHERE key_id = ${k} LIMIT 1`.catch(() => []);
    if (!hit.length) return k;
  }
  return `GROUND-${Date.now().toString(36).toUpperCase().slice(-6)}`;
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



const PII_KEYS = new Set([
  "aadhaar", "aadhaarnumber", "aadhaar_no", "aadhaarno",
  "phone", "phonenumber", "phoneno", "mobile", "mobileno",
  "respondentphone", "respondentmobile",
]);

/** Remove Aadhaar / phone answers before persisting a submission. */
function stripPii(answers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(answers)) {
    const key = k.toLowerCase().replace(/[\s_\-().]/g, "");
    if (PII_KEYS.has(key)) continue;
    out[k] = v;
  }
  return out;
}

async function ensureSchema(): Promise<void> {
  if (!sql) return;

  const steps: Array<() => Promise<unknown>> = [
    // app_users — columns getUser() reads
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS company_id INTEGER`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS company_name TEXT`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS key_id TEXT`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS phone TEXT`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT FALSE`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS can_manage_questions BOOLEAN NOT NULL DEFAULT FALSE`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS can_edit_surveys BOOLEAN NOT NULL DEFAULT FALSE`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS can_review_data BOOLEAN NOT NULL DEFAULT FALSE`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS can_verify_surveyors BOOLEAN NOT NULL DEFAULT FALSE`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS can_assign_surveyors BOOLEAN NOT NULL DEFAULT FALSE`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS can_crud_questionnaire BOOLEAN NOT NULL DEFAULT FALSE`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS can_validate_proof BOOLEAN NOT NULL DEFAULT FALSE`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS can_web_survey BOOLEAN NOT NULL DEFAULT FALSE`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS can_record_voice BOOLEAN NOT NULL DEFAULT FALSE`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS max_questions_per_survey INTEGER NOT NULL DEFAULT 0`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS max_surveys INTEGER NOT NULL DEFAULT 0`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS max_surveyors INTEGER NOT NULL DEFAULT 0`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS max_records INTEGER NOT NULL DEFAULT 0`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS totp_secret TEXT`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS target_quota INTEGER NOT NULL DEFAULT 0`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS created_by INT`,
    // Role check (moved out of seedMissingSuperAdminSlots)
    () => sql`ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check`,
    () => sql`ALTER TABLE app_users ADD CONSTRAINT app_users_role_check CHECK (role IN ('super_admin','admin','field','user','surveyor'))`,
    // Enables ON CONFLICT (survey_id, user_id) in upsertSurveyAssignment
    () => sql`CREATE UNIQUE INDEX IF NOT EXISTS survey_assignments_survey_user_uidx ON survey_assignments (survey_id, user_id)`,
    // Companies table
    () => sql`
      CREATE TABLE IF NOT EXISTS companies (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        created_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    () => sql`CREATE INDEX IF NOT EXISTS idx_app_users_company ON app_users(company_id)`,
    () => sql`ALTER TABLE survey_form ADD COLUMN IF NOT EXISTS created_by INT`,
    () => sql`ALTER TABLE survey_form ADD COLUMN IF NOT EXISTS display_lang TEXT NOT NULL DEFAULT 'en'`,
    () => sql`ALTER TABLE survey_form ADD COLUMN IF NOT EXISTS voice_required BOOLEAN NOT NULL DEFAULT FALSE`,
    () => sql`ALTER TABLE survey_form ADD COLUMN IF NOT EXISTS voice_time_limit INT NOT NULL DEFAULT 0`,
    () => sql`ALTER TABLE survey_form ADD COLUMN IF NOT EXISTS company_name TEXT`,
    () => sql`ALTER TABLE survey_form ADD COLUMN IF NOT EXISTS company_id INT`,
    () => sql`CREATE INDEX IF NOT EXISTS idx_survey_form_company ON survey_form(company_id)`,
    () => sql`
      ALTER TABLE survey_form
      ADD CONSTRAINT survey_form_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL
    `,
    // Optional self-healing respondent phone drop
    () => sql`ALTER TABLE survey_respondents DROP COLUMN IF EXISTS phone`,
  ];

  for (const step of steps) {
    await step().catch(() => null);
  }

  // Backfill key_id for existing users
  const noKey = await sql`
    SELECT id FROM app_users WHERE key_id IS NULL OR key_id = ''
  `.catch(() => []);
  for (const r of noKey as { id: number }[]) {
    await sql`UPDATE app_users SET key_id = ${await uniqueUserKeyId()} WHERE id = ${r.id}`
      .catch(() => null);
  }

  // Fill empty Super Admin seats as superadmin2 / superadmin3
  await seedMissingSuperAdminSlots(sql).catch((e) => {
    console.log("super admin slot seed skipped:", (e as Error).message);
  });
}

async function ensureCompanyExists(
  sqlClient: typeof sql,
  rawName: string | null | undefined,
  createdBy: number | null
): Promise<{ id: number; name: string } | null> {
  if (!rawName || !sqlClient) return null;
  const name = String(rawName).trim().slice(0, 160);
  if (!name) return null;

  try {
    const existing = await sqlClient`
      SELECT id, name FROM companies WHERE LOWER(name) = LOWER(${name}) LIMIT 1
    `.catch(() => []);
    if (existing.length) {
      const comp = { id: Number((existing[0] as { id: unknown }).id), name: String((existing[0] as { name: unknown }).name) };
      await sqlClient`
        UPDATE app_users
        SET company_id = ${comp.id}, company_name = ${comp.name}
        WHERE LOWER(company_name) = LOWER(${comp.name}) AND (company_id IS NULL OR company_id <> ${comp.id})
      `.catch(() => null);
      return comp;
    }

    const inserted = await sqlClient`
      INSERT INTO companies (name, created_by) VALUES (${name}, ${createdBy})
      ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
      RETURNING id, name
    `.catch(() => []);
    if (inserted.length) {
      const comp = { id: Number((inserted[0] as { id: unknown }).id), name: String((inserted[0] as { name: unknown }).name) };
      await sqlClient`
        UPDATE app_users
        SET company_id = ${comp.id}, company_name = ${comp.name}
        WHERE LOWER(company_name) = LOWER(${comp.name}) AND (company_id IS NULL OR company_id <> ${comp.id})
      `.catch(() => null);
      return comp;
    }
  } catch {
    /* ignore fallback to re-select below */
  }

  const re = await sqlClient`
    SELECT id, name FROM companies WHERE LOWER(name) = LOWER(${name}) LIMIT 1
  `.catch(() => []);
  if (re.length) {
    return { id: Number((re[0] as { id: unknown }).id), name: String((re[0] as { name: unknown }).name) };
  }
  return null;
}

let schemaReady: Promise<void> | null = null;
function ready() {
  if (!schemaReady) {
    schemaReady = ensureSchema()
      .catch((e) => {
        console.error(e);
        schemaReady = null;
      })
      .then(() => {
        // Legacy fact catch-up runs AFTER the request path is served, so even a
        // large backfill can never stall boot or the deploy health check.
        if (sql) {
          void backfillFacts(sql).catch((e) => console.warn("fact backfill", e));
        }
      });
  }
  return schemaReady;
}

// ── Analytics helpers (filters + super-set / sub-set) ──────
/**
 * Answer lookup keyed by the Client Admin's question naming — matches
 * question id OR label, case-insensitively (question "Gender" ↔ answer "gender").
 */
function surveyDisplayLang(v: unknown): "en" | "te" {
  return String(v || "en").trim().toLowerCase() === "te" ? "te" : "en";
}

function slugQuestionKeyServer(label: string) {
  return String(label || "")
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function skipAnswerKey(k: string) {
  const s = String(k || "").toLowerCase();
  if (!s || s.startsWith("_") || s.startsWith("geo_") || s.startsWith("location_")) return true;
  if (s.startsWith("ts_") || s.startsWith("sec_")) return true;
  return [
    "draft", "has_photo", "has_audio", "photo_url", "audio_url",
    "latitude", "longitude", "lat", "lng", "form_key", "user_id",
    "submitted_by", "status", "content_type", "mandal", "district",
    "constituency", "state", "respondent_name", "respondent",
    "client_package_id", "data_collector", "surveyor", "package_id",
    "answer_pattern",
  ].includes(s);
}

/**
 * Map leftover answer keys (old q_<time> or a renamed Field ID) onto the
 * current survey questions, in form order. Used for every survey, including
 * new ones, so charts/export stay aligned after a question is edited.
 */
function aliasesForQuestions(
  questions: { id: string; label: string }[],
  answerBags: Record<string, unknown>[],
): Map<string, string[]> {
  const aliases = new Map<string, string[]>();
  const add = (qid: string, key: string) => {
    if (!qid || !key || qid === key) return;
    const arr = aliases.get(qid) || [];
    if (!arr.includes(key)) arr.push(key);
    aliases.set(qid, arr);
  };
  const leftover = new Set<string>();
  for (const a of answerBags) {
    for (const k of Object.keys(a || {})) {
      if (skipAnswerKey(k)) continue;
      const hit = questions.find((q) => {
        const id = q.id.toLowerCase();
        const label = q.label.toLowerCase();
        const slug = slugQuestionKeyServer(q.label);
        const kk = k.toLowerCase();
        return kk === id || kk === label || (slug && kk === slug);
      });
      if (hit) add(hit.id, k);
      else leftover.add(k);
    }
  }
  function scoreKeyToQuestion(key: string, q: { id: string; label: string }): number {
    const kk = key.toLowerCase().replace(/^_+|_+$/g, "");
    if (!kk || /^q_\d+$/i.test(key)) return 0;
    const id = String(q.id || "").toLowerCase();
    const slug = slugQuestionKeyServer(q.label);
    const toks = (s: string) => s.split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
    const kt = toks(kk);
    const against = (c: string): number => {
      if (!c) return 0;
      if (c === kk) return 100;
      if (c.startsWith(kk) || kk.startsWith(c)) {
        const ratio = Math.min(c.length, kk.length) / Math.max(c.length, kk.length);
        if (ratio >= 0.5) return Math.round(ratio * 90);
      }
      let i = 0;
      while (i < c.length && i < kk.length && c[i] === kk[i]) i++;
      if (i >= 10) return Math.round((i / Math.max(c.length, kk.length)) * 85);
      const ct = toks(c);
      if (!kt.length || !ct.length) return 0;
      const set = new Set(ct);
      const hit = kt.filter((t) => set.has(t));
      const distinctive = hit.filter((t) => t.length >= 4);
      if (distinctive.length === 0 && hit.length < 2) return 0;
      const union = new Set([...kt, ...ct]).size || 1;
      return Math.round((hit.length / union) * 75);
    };
    return Math.max(against(id), against(slug));
  }

  // Attach renamed Field IDs to every question, including those that already
  // have today's answers under the current id — otherwise only new records count.
  for (const k of leftover) {
    if (/^q_\d+$/i.test(k)) continue;
    let bestQ: { id: string } | null = null;
    let best = 0;
    let second = 0;
    for (const q of questions) {
      if (!q.id) continue;
      const s = scoreKeyToQuestion(k, q);
      if (s > best) {
        second = best;
        best = s;
        bestQ = q;
      } else if (s > second) {
        second = s;
      }
    }
    if (bestQ && best >= 45 && best >= second + 8) add(bestQ.id, k);
  }
  return aliases;
}

/** Per-record answers: current id/label/slug/aliases, then leftover q_<time> in form order. */
function answersByQuestionId(
  answers: Record<string, unknown> | undefined | null,
  questions: { id: string; label: string; aliases: string[] }[],
): Map<string, unknown> {
  const a = answers || {};
  const taken = new Set<string>();
  const out = new Map<string, unknown>();
  const take = (q: { id: string; label: string; aliases: string[] }, keys: string[]) => {
    for (const want of keys) {
      const w = String(want || "").trim();
      if (!w) continue;
      if (a[w] != null && a[w] !== "" && !taken.has(w)) {
        taken.add(w);
        out.set(q.id, a[w]);
        return true;
      }
      const low = w.toLowerCase();
      for (const [k, v] of Object.entries(a)) {
        if (taken.has(k) || v == null || v === "") continue;
        if (k.toLowerCase() === low) {
          taken.add(k);
          out.set(q.id, v);
          return true;
        }
      }
    }
    return false;
  };
  for (const q of questions) {
    take(q, [q.id, q.label, slugQuestionKeyServer(q.label), ...(q.aliases || [])]);
  }
  const stamps = Object.keys(a)
    .filter((k) => /^q_\d+$/i.test(k) && !taken.has(k) && a[k] != null && a[k] !== "")
    .sort();
  let si = 0;
  for (const q of questions) {
    if (out.has(q.id) || si >= stamps.length) continue;
    const k = stamps[si++];
    taken.add(k);
    out.set(q.id, a[k]);
  }
  return out;
}

function answerOf(
  a: Record<string, unknown> | undefined | null,
  qid: string,
  qlabel?: string,
  aliases: string[] = [],
): unknown {
  if (!a) return undefined;
  const keys = [qid, qlabel || "", slugQuestionKeyServer(qlabel || ""), ...aliases]
    .map((k) => String(k || "").trim())
    .filter(Boolean);
  for (const want of keys) {
    if (a[want] != null) return a[want];
    const low = want.toLowerCase();
    for (const [k, v] of Object.entries(a)) {
      if (k.toLowerCase() === low) return v;
    }
  }
  return undefined;
}

// Age grouping — "age" type questions bucket answers into ranges everywhere
const AGE_RANGES = [
  { lo: 0, hi: 17, name: "0-17" },
  { lo: 18, hi: 25, name: "18-25" },
  { lo: 26, hi: 35, name: "26-35" },
  { lo: 36, hi: 45, name: "36-45" },
  { lo: 46, hi: 60, name: "46-60" },
  { lo: 61, hi: Infinity, name: "60+" },
];
const AGE_OPTIONS = AGE_RANGES.map((r) => r.name);
function ageBucket(v: unknown): string | null {
  const s = String(v ?? "").trim();
  // Range values like "26-35 years" (legacy excel) → exact bucket
  const range = s.match(/(\d{1,2})\s*[-–—to]+\s*(\d{1,3})/);
  if (range) {
    const hit = AGE_RANGES.find((r) => r.lo === Number(range[1]) && r.hi === Number(range[2]));
    if (hit) return hit.name;
  }
  const n = Number(s.replace(/[^0-9]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  for (const r of AGE_RANGES) if (n >= r.lo && n <= r.hi) return r.name;
  return null;
}

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
  if (/^female\b|^woman\b|స్త్రీ/i.test(s)) return "Female";
  if (/^male\b|^man\b|పురుష/i.test(s)) return "Male";
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
      .replace(/\(([^)]*)\)/g, " $1 ")
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
    hanamkonda: "hanumakonda",
    hanumakonda: "hanumakonda",
    "warangal urban": "hanumakonda",
    "warangal city": "hanumakonda",
    "warangal rural": "warangal rural",
    "ranga reddy": "rangareddy",
    medchal: "medchal malkajgiri",
    "medchal malkajgiri": "medchal malkajgiri",
    bhadradri: "bhadradri kothagudem",
    "bhadradri kothagudem": "bhadradri kothagudem",
    jayashankar: "jayashankar bhupalapally",
    "jayashankar bhupalapally": "jayashankar bhupalapally",
    mahbubnagar: "mahabubnagar",
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

/** Keys that are locks/geo metadata, not real survey answers */
function isMetaAnswerKey(k: string): boolean {
  const s = String(k || "").toLowerCase();
  if (!s || s.startsWith("_")) return true;
  if (s.startsWith("geo_") || s.startsWith("location_")) return true;
  if (s.startsWith("ts_") || s.startsWith("sec_")) return true;
  if (s === "answer_pattern") return true;
  return (
    s === "lat" ||
    s === "lng" ||
    s === "latitude" ||
    s === "longitude" ||
    s === "accuracy" ||
    s === "data_collector" ||
    s === "client_package_id" ||
    s === "surveyor" ||
    s === "agent"
  );
}

/**
 * Resolve surveyor display name from payload + answers (never invent from respondent).
 */
function surveyorNameOf(payload: Record<string, unknown>): string {
  const a = (payload?.answers || {}) as Record<string, unknown>;
  const name = String(
    payload?.submitted_by ||
      a.data_collector ||
      a.surveyor ||
      a.agent ||
      "",
  ).trim();
  return name || "unknown";
}

/**
 * Field drafts are not finished work. Even if status was wrongly set to
 * confirmed, keep them out of "completed" and count under pending.
 * Example Anumula1: 3 status=pending + 1 confirmed-with-_draft → 4 pending, 6 completed.
 */
function isDraftSubmission(payload: Record<string, unknown>): boolean {
  const a = (payload?.answers || {}) as Record<string, unknown>;
  return (
    payload?.draft === true ||
    a._draft === true ||
    a.draft === true ||
    String(payload?.content_type || "").toLowerCase() === "draft"
  );
}

/** Field Send / POST must not keep phone-only draft markers on the server row. */
function stripDraftFlags(payload: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...payload, draft: false };
  const ans = { ...((next.answers || {}) as Record<string, unknown>) };
  delete ans._draft;
  delete ans.draft;
  next.answers = ans;
  if (String(next.content_type || "").toLowerCase() === "draft") next.content_type = "qa";
  return next;
}

/** Field record number (1, 2, 3…) — not the database id. */
function recordIndexOf(payload: Record<string, unknown>): number | null {
  const a = (payload?.answers || {}) as Record<string, unknown>;
  const n = Number(
    payload?.record_index ??
      payload?.recordIndex ??
      a._recordIndex ??
      a.recordIndex,
  );
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}


/**
 * Surveyor work status for Report boards:
 * - completed = Client Admin confirmed AND not a draft
 * - pending   = still open (status pending/rejected OR still tagged draft)
 */
function workStatusOf(
  payload: Record<string, unknown>,
): "completed" | "pending" | "rejected" {
  const status = payloadStatus(payload);
  const draft = isDraftSubmission(payload);
  if (draft) return "pending";
  if (status === "confirmed") return "completed";
  if (status === "rejected") return "rejected";
  return "pending";
}

/**
 * Strict verification: geo + photo + Q/A. Voice is required only when the
 * Client Admin marked the survey voice_required — optional by default.
 * Incomplete cannot enter confirmed analytics without override.
 *
 * LEGACY rows (collected before GPS/camera existed — no geo and never any
 * media) are exempt: they are not subject to the geo/voice/photo checks, so
 * old data can be confirmed and reported normally. Only at least one answer
 * is required.
 */
function verifySubmission(
  payload: Record<string, unknown>,
  mediaKinds: string[] = [],
  voiceRequired = false,
) {
  const answers = (payload?.answers || {}) as Record<string, unknown>;
  const geoPayload = (payload?.geo || null) as Record<string, unknown> | null;
  // Fallback: some clients store coords only under answers.geo_lat / geo_lng
  const lat = Number(
    geoPayload != null
      ? (geoPayload.lat ?? geoPayload.latitude)
      : (answers.geo_lat ?? answers.latitude ?? answers.lat ?? NaN),
  );
  const lng = Number(
    geoPayload != null
      ? (geoPayload.lng ?? geoPayload.longitude)
      : (answers.geo_lng ?? answers.longitude ?? answers.lng ?? NaN),
  );
  const accuracyRaw =
    geoPayload != null && geoPayload.accuracy != null
      ? Number(geoPayload.accuracy)
      : answers.geo_accuracy != null
      ? Number(answers.geo_accuracy)
      : null;
  const accuracy = accuracyRaw != null && Number.isFinite(accuracyRaw)
    ? accuracyRaw
    : null;
  const hasGeoObject = geoPayload != null ||
    (Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0));

  const geo_ok =
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0);

  const kinds = (mediaKinds || []).map((k) => String(k || "").toLowerCase());

  // URL / media-id on payload also count (R2 or free Neon links may not re-set flags)
  const hasPhotoUrl = Boolean(
    payload?.photo_url ||
      payload?.photo_media_id ||
      payload?.photoUrl ||
      payload?.photoMediaId,
  );
  const hasAudioUrl = Boolean(
    payload?.audio_url ||
      payload?.audio_media_id ||
      payload?.audioUrl ||
      payload?.audioMediaId,
  );

  // Legacy = pre GPS/camera data: no geo ever attached AND no media/flags/urls.
  // (New submissions always carry geo — the server requires it on POST.)
  const legacy =
    !hasGeoObject &&
    kinds.length === 0 &&
    payload?.has_photo !== true &&
    payload?.has_audio !== true &&
    !hasPhotoUrl &&
    !hasAudioUrl;

  // Voice: required only when Client Admin set the survey to mandatory.
  const hasAudioFlag = payload?.has_audio === true;
  const hasAudioMedia = kinds.includes("audio");
  const hasVoice = hasAudioFlag || hasAudioMedia || hasAudioUrl;
  const voice_ok = legacy || !voiceRequired || hasVoice;

  const hasPhotoFlag = payload?.has_photo === true;
  const hasPhotoMedia = kinds.includes("photo");
  const photo_ok = legacy || hasPhotoFlag || hasPhotoMedia || hasPhotoUrl;

  // Real Q/A only — ignore lock flags / geo metadata stuffed into answers
  const answerKeys = Object.keys(answers).filter((k) => {
    if (isMetaAnswerKey(k)) return false;
    const v = answers[k];
    if (v == null) return false;
    if (Array.isArray(v)) return v.length > 0;
    return String(v).trim() !== "";
  });
  const qa_ok = answerKeys.length >= 1;

  const failures: string[] = [];
  if (!legacy) {
    if (!geo_ok) failures.push("geo_missing_or_invalid");
    if (voiceRequired && !voice_ok) failures.push("voice_missing");
    if (!photo_ok) failures.push("photo_missing");
  }
  if (!qa_ok) failures.push("qa_empty");

  // Strict complete = geo + photo + Q/A (+ voice only if Client Admin required it).
  const completeness: "complete" | "incomplete" = legacy
    ? qa_ok
      ? "complete"
      : "incomplete"
    : geo_ok && photo_ok && qa_ok && (!voiceRequired || voice_ok)
    ? "complete"
    : "incomplete";

  return {
    completeness,
    legacy,
    geo_ok: legacy ? true : geo_ok,
    voice_ok,
    photo_ok,
    qa_ok,
    geo: geo_ok
      ? {
          lat,
          lng,
          accuracy,
          at: geoPayload?.at || answers.geo_at || null,
        }
      : geoPayload
      ? { lat: geoPayload.lat, lng: geoPayload.lng, invalid: true }
      : null,
    failures,
    checks: legacy
      ? {
          geo_tagging: "n/a",
          voice_detection: "n/a",
          photo: "n/a",
          qa: qa_ok ? "pass" : "fail",
        }
      : {
          geo_tagging: geo_ok ? "pass" : "fail",
          voice_detection: voice_ok ? "pass" : "fail",
          photo: photo_ok ? "pass" : "fail",
          qa: qa_ok ? "pass" : "fail",
        },
  };
}

/** Load submission_id → media kinds from survey_media (always Number keys). */
async function loadMediaKindsMap(
  sqlFn: NonNullable<typeof sql>,
): Promise<Map<number, string[]>> {
  const mediaMap = new Map<number, string[]>();
  const mediaRows = await sqlFn`
    SELECT submission_id, kind FROM survey_media
  `.catch(() => []);
  for (const m of mediaRows as { submission_id: number; kind: string }[]) {
    const sid = Number(m.submission_id);
    if (!Number.isFinite(sid)) continue;
    const kind = String(m.kind || "").toLowerCase();
    if (!kind) continue;
    const arr = mediaMap.get(sid) || [];
    arr.push(kind);
    mediaMap.set(sid, arr);
  }
  return mediaMap;
}

/** Apply media kinds onto payload flags then verify (single source of truth). */
function voiceRequiredOf(payload: Record<string, unknown> | null | undefined): boolean {
  if (!payload || typeof payload !== "object") return false;
  if (payload.voice_required === true) return true;
  const a = payload.answers as Record<string, unknown> | undefined;
  return a?._voice_required === true;
}

function verifyWithMedia(
  payload: Record<string, unknown> | null | undefined,
  mediaMap: Map<number, string[]>,
  id: number | string,
) {
  const p: Record<string, unknown> =
    payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const kinds = mediaMap.get(Number(id)) || [];
  if (kinds.includes("audio")) p.has_audio = true;
  if (kinds.includes("photo")) p.has_photo = true;
  return verifySubmission(p, kinds, voiceRequiredOf(p));
}

/** Telugu place names → English (district etc.), applied when confirming */
const TELUGU_ALIAS: Record<string, string> = (GEO_ALIASES as {
  telugu?: Record<string, string>;
}).telugu || {};
const TELUGU_SCRIPT = /[\u0C00-\u0C7F]/;

/** English canonical place → Telugu (longest alias wins). */
const EN_TO_TE_PLACE = (() => {
  const m = new Map<string, string>();
  for (const [te, en] of Object.entries(TELUGU_ALIAS)) {
    const key = String(en || "").trim().toLowerCase();
    if (!key) continue;
    const prev = m.get(key);
    if (!prev || te.length > prev.length) m.set(key, te);
  }
  return m;
})();

const EXPORT_FIXED_TE: Record<string, string> = {
  id: "ఐడి",
  date: "తేదీ",
  survey: "సర్వే",
  surveyor: "సర్వేయర్",
  district: "జిల్లా",
  constituency: "అసెంబ్లీ",
  mandal: "మండలం",
  latitude: "అక్షాంశం",
  longitude: "రేఖాంశం",
  party: "పార్టీ",
  gender: "లింగం",
  caste: "కులం",
  age: "వయస్సు",
  respondent: "ప్రతివాది",
  photo_url: "ఫోటో లింక్",
  audio_url: "ఆడియో లింక్",
  photo_file: "ఫోటో ఫైల్",
  audio_file: "ఆడియో ఫైల్",
  created_at_ist: "సమర్పణ సమయం",
};

const EXPORT_VALUE_TE: Record<string, string> = {
  yes: "అవును",
  no: "కాదు",
  male: "పురుషుడు",
  female: "స్త్రీ",
  other: "ఇతరులు",
  others: "ఇతరులు",
  positive: "సానుకూలం",
  neutral: "తటస్థం",
  negative: "ప్రతికూలం",
  congress: "కాంగ్రెస్",
  bjp: "బీజేపీ",
  brs: "బీఆర్ఎస్",
  undecided: "నిర్ణయం కాలేదు",
  unknown: "తెలియదు",
};

function toTeluguPlace(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (TELUGU_SCRIPT.test(s)) return s;
  return EN_TO_TE_PLACE.get(s.toLowerCase()) || s;
}

function toTeluguValue(v: unknown, optTe?: Map<string, string>): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map((x) => toTeluguValue(x, optTe)).join(" | ");
  const s = String(v).trim();
  if (!s) return "";
  if (TELUGU_SCRIPT.test(s)) return s;
  const hit = optTe?.get(s) || optTe?.get(s.toLowerCase());
  if (hit) return hit;
  const common = EXPORT_VALUE_TE[s.toLowerCase()];
  if (common) return common;
  return toTeluguPlace(s);
}

/** Keep `name` (English, used for filters/maps/colors) and add `label` for Telugu UI. */
function withTeLabels<T extends { name: string }>(
  arr: T[],
  kind: "place" | "value" = "value",
  optTe?: Map<string, string>,
): (T & { label: string })[] {
  return arr.map((d) => ({
    ...d,
    label: kind === "place" ? toTeluguPlace(d.name) : toTeluguValue(d.name, optTe),
  }));
}

function coerceOptionName(o: unknown): string {
  if (o == null) return "";
  if (typeof o === "object") {
    const rec = o as Record<string, unknown>;
    return String(rec.label || rec.value || rec.name || "").trim();
  }
  return String(o).trim();
}

const CHOICE_Q_TYPES = new Set([
  "yesno",
  "abc",
  "choice",
  "sentiment",
  "sentiment_text",
  "meter",
  "age",
  "range",
  "numeric_range",
]);

function defaultQuestionOptions(type: string): string[] {
  if (type === "age") return [...AGE_OPTIONS];
  if (type === "yesno") return ["Yes", "No"];
  if (type === "abc") return ["A", "B", "C", "D"];
  if (type === "sentiment" || type === "sentiment_text" || type === "meter") {
    return ["Positive", "Neutral", "Negative"];
  }
  if (type === "range" || type === "numeric_range") {
    return ["10-20", "21-30", "31-40", "41-50", "50+"];
  }
  return [];
}

/** Map a raw answer onto chart/filter option name(s). */
function chartNamesFromAnswer(
  type: string,
  raw: unknown,
  options: string[],
): string[] {
  const vals = Array.isArray(raw) ? raw : [raw];
  const out: string[] = [];
  for (const v of vals) {
    const s = String(v ?? "").trim();
    if (!s || s === "Unknown" || s === "undefined") continue;
    if (type === "age") {
      const b = ageBucket(s);
      if (b) out.push(b);
      continue;
    }
    if (type === "meter") {
      const n = Number(s.replace("%", "").replace(/[^0-9.+-]/g, ""));
      if (Number.isFinite(n) && n > 0) {
        out.push(n <= 33 ? "Negative" : n <= 66 ? "Neutral" : "Positive");
        continue;
      }
    }
    if (type === "sentiment" || type === "sentiment_text") {
      const tag = s.match(/\[(Positive|Neutral|Negative)\]/i);
      if (tag) {
        const t = tag[1].toLowerCase();
        out.push(t.charAt(0).toUpperCase() + t.slice(1));
        continue;
      }
      const low = s.toLowerCase();
      if (/\bpositive\b/.test(low)) out.push("Positive");
      else if (/\bnegative\b/.test(low)) out.push("Negative");
      else if (/\bneutral\b/.test(low)) out.push("Neutral");
      continue;
    }
    const hit = options.find((o) => o.toLowerCase() === s.toLowerCase());
    out.push(hit || s);
  }
  return out;
}

function optionTeMap(options: unknown, optionsTe: unknown): Map<string, string> {
  const opts = Array.isArray(options) ? options.map(coerceOptionName) : [];
  const tes = Array.isArray(optionsTe) ? optionsTe.map((x) => String(x ?? "")) : [];
  const m = new Map<string, string>();
  opts.forEach((en, i) => {
    const te = String(tes[i] || "").trim();
    if (en && te) {
      m.set(en, te);
      m.set(en.toLowerCase(), te);
    }
  });
  return m;
}

function translateGeoEnglish(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const a = (payload.answers || {}) as Record<string, unknown>;
  const geoKeys = [
    "district",
    "location_district",
    "constituency",
    "assembly_constituency",
    "mp_constituency",
    "mandal",
    "location_mandal",
    "ward",
    "village",
    "revenue_division",
    "location_area",
    "location_state",
    "location_display",
  ];
  // Longer keys first so "వరంగల్ (అర్బన్)" beats "వరంగల్"
  const teluguEntries = Object.entries(TELUGU_ALIAS).sort(
    (x, y) => y[0].length - x[0].length,
  );
  const translate = (v: unknown): unknown => {
    if (typeof v !== "string" || !TELUGU_SCRIPT.test(v)) return v;
    const simple = v.replace(/\s+/g, " ").trim();
    const direct =
      TELUGU_ALIAS[simple] || TELUGU_ALIAS[simple.toLowerCase()];
    if (direct) return direct;
    let out = simple;
    for (const [te, en] of teluguEntries) {
      if (out.includes(te)) out = out.split(te).join(en);
    }
    return out !== simple ? out : v;
  };
  let changed = false;
  for (const k of geoKeys) {
    if (a[k] == null) continue;
    const t = translate(a[k]);
    if (t !== a[k]) {
      a[k] = t;
      changed = true;
    }
  }
  if (changed) {
    payload.answers = a;
    payload.translated_from_telugu = true;
  }
  return payload;
}

function parsePayload(raw: unknown): Record<string, unknown> {
  let v: unknown = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return {};
    }
  }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return {};
}

/**
 * Strip a data URL header, including MIME parameters such as
 * `data:audio/webm;codecs=opus;base64,...` (MediaRecorder Opus).
 */
function splitDataUrl(raw: string): { mime: string; b64: string } {
  const s = String(raw || "").trim();
  if (!/^data:/i.test(s)) return { mime: "", b64: s };
  const comma = s.indexOf(",");
  if (comma < 0) return { mime: "", b64: s };
  const header = s.slice(5, comma);
  const payload = s.slice(comma + 1);
  const mime = header.split(";").map((p) => p.trim()).find((p) => p.includes("/")) || "";
  return { mime, b64: payload };
}

/** Decode base64 (optionally data-URL stripped already) → bytes */
function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  let clean = String(b64 || "").replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = clean.length % 4;
  if (pad) clean += "=".repeat(4 - pad);
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
    return bytes.length >= 2 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
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
  // Cap ~1.5MB binary (~2.0MB base64) to protect free tier
  if (bytes.length > 1_500_000) {
    throw new Error(
      "Media too large (max ~1.5MB). Use a smaller photo / shorter audio.",
    );
  }
  return {
    url: null, // filled after insert with /api/media/:id/file
    provider: "neon",
    dataB64: bytesToBase64(bytes),
    mode: "neon",
  };
}

/** India Standard Time (this product is IST-only). */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

function istCalendarDate(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return new Date(v.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
  }
  const s = String(v || "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.slice(0, 10);
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function dayKey(iso: string) {
  return istCalendarDate(iso);
}

function istToday(): string {
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

// Neon returns TIMESTAMPTZ as Date objects; String(Date) yields locale text
// ("Tue Aug 04 2026…") which breaks dayKey()/date comparisons. Always ISO.
function isoStamp(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v || "");
}

/** Admin/export display — always Asia/Kolkata, never the server's UTC clock. */
function formatIstStamp(v: unknown): string {
  const s = isoStamp(v);
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(v || "");
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(d);
}

function secBetween(a: unknown, b: unknown): string {
  const t1 = new Date(isoStamp(a)).getTime();
  const t2 = new Date(isoStamp(b)).getTime();
  if (!Number.isFinite(t1) || !Number.isFinite(t2) || t2 < t1) return "";
  return String(Math.round((t2 - t1) / 1000));
}

/** Seconds from GPS enable to finish. Voice on/off does not change the clock. */
function durationSecOf(answers: Record<string, unknown> | undefined | null): number | null {
  const a = answers && typeof answers === "object" ? answers : {};
  const stored = Number(a._duration_sec);
  if (Number.isFinite(stored) && stored >= 0 && stored < 86400) return Math.round(stored);
  const t = (a._timing && typeof a._timing === "object" ? a._timing : {}) as Record<string, unknown>;
  const start = t.gps_start || a.ts_gps_start || "";
  const finish = t.finish || a.ts_finish || "";
  const n = Number(secBetween(start, finish));
  if (Number.isFinite(n) && n >= 0 && n < 86400) return n;
  return null;
}

function formatDurationSec(sec: number): string {
  const n = Math.max(0, Math.round(sec));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

function collectTimeStats(
  rowList: { answers?: Record<string, unknown>; submitted_by?: string }[],
) {
  const secs: number[] = [];
  const byUser = new Map<string, number[]>();
  for (const r of rowList) {
    const d = durationSecOf(r.answers);
    if (d == null) continue;
    secs.push(d);
    const who = String(r.submitted_by || "Surveyor").trim() || "Surveyor";
    const arr = byUser.get(who) || [];
    arr.push(d);
    byUser.set(who, arr);
  }
  if (!secs.length) {
    return { count: 0, avg_sec: null, median_sec: null, min_sec: null, max_sec: null, avg_label: "—", by_surveyor: [] as { name: string; n: number; avg_sec: number; avg_label: string }[] };
  }
  const sum = secs.reduce((a, b) => a + b, 0);
  const sorted = [...secs].sort((a, b) => a - b);
  const avg = Math.round(sum / secs.length);
  const mid = sorted[Math.floor(sorted.length / 2)];
  const by_surveyor = [...byUser.entries()]
    .map(([name, list]) => {
      const a = Math.round(list.reduce((x, y) => x + y, 0) / list.length);
      return { name, n: list.length, avg_sec: a, avg_label: formatDurationSec(a) };
    })
    .sort((a, b) => b.n - a.n)
    .slice(0, 20);
  return {
    count: secs.length,
    avg_sec: avg,
    median_sec: mid,
    min_sec: sorted[0],
    max_sec: sorted[sorted.length - 1],
    avg_label: formatDurationSec(avg),
    median_label: formatDurationSec(mid),
    by_surveyor,
  };
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

/** Load + resolve all submissions into analytics rows (AC → district resolution, mandal fallback, party/gender/caste normalisation). Shared by analytics + export. */
// ── Fact materialization (Processing — 17-ANALYTICS-PROCESSING-SEQUENCE.md §1.2/§3) ──

/** Answer keys that are internal bookkeeping, never analytics facts. */
const FACT_META_KEYS = new Set([
  "_draft", "draft", "_startedAt", "_lastQuestion", "_answeredCount", "_syncedAt",
  "_recordIndex", "recordIndex", "data_collector", "submitted_by", "notes",
  // geo-ish / media-ish keys are bookkeeping — geo lives on record_facts.geo instead
  "latitude", "longitude", "lat", "lng", "geo_lat", "geo_lng", "gps_lat", "gps_lng",
]);

/** Normalize an answer value into its fact-safe form (09-ANALYTICS-SPEC §2.1). */
function normalizeFactValue(v: unknown): unknown {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (Array.isArray(v)) return [...new Set(v.map((x) => String(x).trim()).filter(Boolean))].sort();
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (Number.isFinite(Number(s)) && /^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

/** Narrow fact payload: only real answer keys (metadata/media excluded) — keeps the table lean. */
function buildFilterableAnswers(payload: Record<string, unknown>): Record<string, unknown> {
  const answers = ((payload.answers as Record<string, unknown>) || payload) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(answers)) {
    if (FACT_META_KEYS.has(k)) continue;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) continue; // no nested blobs in facts
    const norm = normalizeFactValue(v);
    if (norm !== null && norm !== undefined && !(Array.isArray(norm) && norm.length === 0)) {
      out[k] = norm;
    }
  }
  return out;
}

/**
 * Insert one record_facts row for a confirmed submission. Idempotent
 * (ON CONFLICT DO NOTHING). On unexpected error the record is flagged
 * fact_status='failed' for manual retry — the confirm decision is never lost.
 */
async function materializeFact(
  sqlFn: NonNullable<typeof sql>,
  submissionId: number,
): Promise<{ inserted: boolean; already_existed: boolean }> {
  const rows = await sqlFn`SELECT id, payload FROM submissions WHERE id = ${submissionId}`;
  if (!rows.length) throw new Error("submission not found");
  const payload = parsePayload((rows[0] as { payload: unknown }).payload);
  if (payloadStatus(payload) !== "confirmed") {
    throw new Error("record is not confirmed — facts are only materialized for confirmed records");
  }
  const answers = ((payload.answers as Record<string, unknown>) || payload) as Record<string, unknown>;
  const surveyKey = String(payload.form_key || payload.formKey || "default");
  const confirmedAt = String(payload.confirmed_at || new Date().toISOString());
  const geo = (payload.geo as Record<string, unknown> | undefined) || null;
  const filterable = buildFilterableAnswers(payload);

  const inserted = await sqlFn`
    INSERT INTO record_facts (
      submission_id, survey_key, submitted_by, district, constituency,
      filterable_answers, geo, confirmed_at, fact_status
    ) VALUES (
      ${submissionId}, ${surveyKey}, ${surveyorNameOf(payload)},
      ${String(answers.district || "").trim()}, ${String(answers.constituency || "").trim()},
      ${JSON.stringify(filterable)}::jsonb, ${geo ? JSON.stringify(geo) : null}::jsonb,
      ${confirmedAt}::timestamptz, 'materialized'
    )
    ON CONFLICT (submission_id) DO NOTHING
    RETURNING submission_id
  `;
  await sqlFn`
    UPDATE submissions SET fact_status = 'materialized', fact_error = NULL WHERE id = ${submissionId}
  `.catch(() => null);
  return {
    inserted: inserted.length > 0,
    already_existed: inserted.length === 0,
  };
}

/** Flag a record so Review surfaces it and retry-fact can re-run materialization. */
async function markFactFailed(sqlFn: NonNullable<typeof sql>, id: number, err: unknown) {
  const msg = String((err as Error)?.message || err || "unknown error").slice(0, 500);
  await sqlFn`UPDATE submissions SET fact_status = 'failed', fact_error = ${msg} WHERE id = ${id}`.catch(() => null);
}

/**
 * Completeness bookkeeping only. Client Admin confirms in Review QA —
 * field sync must not auto-confirm (wrong clock + skips review).
 */
async function autoConfirmIfComplete(
  sqlFn: NonNullable<typeof sql>,
  submissionId: number,
): Promise<{ auto_confirmed: boolean; completeness: string }> {
  const rows = await sqlFn`
    SELECT id, payload FROM submissions WHERE id = ${submissionId} LIMIT 1
  `.catch(() => []);
  if (!rows.length) return { auto_confirmed: false, completeness: "incomplete" };

  const rawPayload = parsePayload((rows[0] as { payload: unknown }).payload);
  let payload = stripDraftFlags(rawPayload);
  const cur = payloadStatus(payload);

  if (isDraftSubmission(rawPayload)) {
    await sqlFn`
      UPDATE submissions SET payload = ${JSON.stringify(payload)}::jsonb WHERE id = ${submissionId}
    `.catch(() => null);
  }

  if (cur === "confirmed") return { auto_confirmed: false, completeness: "complete" };
  if (cur === "rejected") return { auto_confirmed: false, completeness: "incomplete" };

  const mediaKinds = (
    await sqlFn`SELECT kind FROM survey_media WHERE submission_id = ${submissionId}`.catch(() => [])
  ).map((m) => String((m as { kind?: string }).kind || "").toLowerCase());
  if (mediaKinds.includes("audio")) payload.has_audio = true;
  if (mediaKinds.includes("photo")) payload.has_photo = true;

  const formKey = String(payload.form_key || "").trim();
  let voiceReq = voiceRequiredOf(payload);
  if (formKey) {
    const vr = await sqlFn`
      SELECT voice_required FROM survey_form WHERE form_key = ${formKey} LIMIT 1
    `.catch(() => []);
    if (vr.length) {
      voiceReq = (vr[0] as { voice_required?: boolean }).voice_required === true;
      payload.voice_required = voiceReq;
    }
  }

  const verify = verifySubmission(payload, mediaKinds, voiceReq);
  payload = {
    ...payload,
    completeness: verify.completeness,
    verification: verify,
    has_audio: mediaKinds.includes("audio") || payload.has_audio === true,
    has_photo: verify.photo_ok ? true : payload.has_photo,
    status: cur === "pending" ? "pending" : cur,
  };
  await sqlFn`
    UPDATE submissions SET payload = ${JSON.stringify(payload)}::jsonb WHERE id = ${submissionId}
  `.catch(() => null);
  return { auto_confirmed: false, completeness: verify.completeness };
}

/**
 * Idempotent fact catch-up for confirmed submissions without a fact row.
 * Batched multi-row INSERTs — never one query per row — so even thousands of
 * legacy rows complete in a handful of round trips (boot/first-request safe).
 */
async function backfillFacts(
  sqlFn: NonNullable<typeof sql>,
  opts: { limit?: number } = {},
): Promise<{ materialized: number; failed: number }> {
  const limit = opts.limit ?? 10000;
  const rows = await sqlFn`
    SELECT s.id, s.payload FROM submissions s
    WHERE s.payload->>'status' = 'confirmed'
      AND NOT EXISTS (SELECT 1 FROM record_facts f WHERE f.submission_id = s.id)
    ORDER BY s.id
    LIMIT ${limit}
  `.catch(() => []);
  if (!rows.length) return { materialized: 0, failed: 0 };

  const rawSql = sqlFn as unknown as (text: string, params: unknown[]) => Promise<unknown[]>;
  const BATCH = 200;
  const COLS = 9; // submission_id, survey_key, submitted_by, district, constituency, filterable_answers, geo, confirmed_at, fact_status
  let materialized = 0;
  const failedIds: number[] = [];

  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = (rows as { id: number; payload: unknown }[]).slice(i, i + BATCH);
    const valueRows: unknown[][] = [];
    for (const r of chunk) {
      try {
        const payload = parsePayload(r.payload);
        if (payloadStatus(payload) !== "confirmed") continue;
        const answers = ((payload.answers as Record<string, unknown>) || payload) as Record<string, unknown>;
        // Guard against malformed confirmed_at poisoning the whole batch
        const confirmedAt = (() => {
          const ts = String(payload.confirmed_at || "");
          return ts && !Number.isNaN(Date.parse(ts)) ? ts : new Date().toISOString();
        })();
        valueRows.push([
          Number(r.id),
          String(payload.form_key || payload.formKey || "default"),
          surveyorNameOf(payload),
          String(answers.district || "").trim(),
          String(answers.constituency || "").trim(),
          JSON.stringify(buildFilterableAnswers(payload)),
          payload.geo ? JSON.stringify(payload.geo) : null,
          confirmedAt,
          "materialized",
        ]);
      } catch {
        failedIds.push(Number(r.id));
      }
    }
    if (!valueRows.length) continue;
    const placeholders = valueRows
      .map((_, r) =>
        `(${Array.from({ length: COLS }, (_, c) => `$${r * COLS + c + 1}`).join(", ")})`,
      )
      .join(", ");
    try {
      await rawSql(
        `INSERT INTO record_facts (submission_id, survey_key, submitted_by, district, constituency, filterable_answers, geo, confirmed_at, fact_status)
         VALUES ${placeholders}
         ON CONFLICT (submission_id) DO NOTHING`,
        valueRows.flat(),
      );
      materialized += valueRows.length;
      await sqlFn`UPDATE submissions SET fact_status = 'materialized', fact_error = NULL WHERE id = ANY(${valueRows.map((v) => v[0])})`.catch(() => null);
    } catch {
      for (const r of chunk) failedIds.push(Number(r.id));
    }
  }

  for (const id of failedIds) {
    await markFactFailed(sqlFn, id, new Error("fact backfill failed"));
  }
  return { materialized, failed: failedIds.length };
}

/**
 * BR-004 record-layer scope: the form_keys a Client Admin may read/write.
 * - Surveys they created (created_by)
 * - Explicit shares (survey_admin_access)
 * Super Admin / surveyors: unrestricted (null).
 * Never match company_name / company_id here — that is company-wide
 * auto-share with no grant event. Company share happens only as an
 * explicit Super Admin write of survey_admin_access rows at POST time.
 */
async function adminFormKeyScope(
  sqlFn: NonNullable<typeof sql>,
  me: { role: unknown; id: unknown } | null,
): Promise<string[] | null> {
  if (!me || me.role !== "admin") return null;
  const rows = await sqlFn`
    SELECT form_key FROM survey_form
    WHERE created_by = ${me.id}
       OR id IN (SELECT survey_id FROM survey_admin_access WHERE admin_id = ${me.id})
  `.catch(() => []);
  return [...new Set((rows as { form_key: string }[]).map((r) => String(r.form_key)))];
}

// In-memory cache for assembly_constituencies — this table is only ever
// changed by a manual seed script run outside the app (see REDEPLOY.md,
// which already says to re-seed after a redeploy, i.e. after a fresh Deno
// isolate anyway), never by any endpoint. So a plain per-isolate cache with
// no TTL is correct, not just faster: previously this was queried and
// re-parsed from scratch on every single analytics request.
type AcEntry = { canonical: string; district: string; covering: string[]; mp: string };
let acListCache: AcEntry[] | null = null;

async function getAcList(sqlFn: NonNullable<typeof sql>): Promise<AcEntry[]> {
  if (acListCache) return acListCache;
  const acRows = await sqlFn`
    SELECT name, covering_districts, mp_constituency FROM assembly_constituencies
  `.catch(() => []);
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
  acListCache = acList;
  return acList;
}

function normKeyStatic(s: string) {
  return String(s || "")
    .toLowerCase()
    .replace(/\(([^)]*)\)/g, " $1 ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

let mandalLookupCache: Map<string, string> | null = null;

async function getMandalLookup(sqlFn: NonNullable<typeof sql>): Promise<Map<string, string>> {
  if (mandalLookupCache) return mandalLookupCache;
  const mandalRows = await sqlFn`
    SELECT mandal_name, district FROM mandals LIMIT 30000
  `.catch(() => []);
  const lookup = new Map<string, string>();
  for (const m of mandalRows as { mandal_name?: string; district?: string }[]) {
    const k = normKeyStatic(String(m.mandal_name || ""));
    const d = String(m.district || "").trim();
    if (k && d && !lookup.has(k)) lookup.set(k, d);
  }
  mandalLookupCache = lookup;
  return lookup;
}

async function loadAnalyticsRows(
  sqlFn: NonNullable<typeof sql>,
  limit = 10000,
  scopeKeys: string[] | null = null,
): Promise<Row[]> {
  const acList = await getAcList(sqlFn);

  function softNameEq(a: string, b: string) {
    const n = (s: string) =>
      String(s || "")
        .toLowerCase()
        .replace(/\(([^)]*)\)/g, " $1 ")
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

  /** District spelling variants → canonical (Hanamkonda = 2022 name of Warangal Urban) */
  const DISTRICT_ALIAS: Record<string, string> = GEO_ALIASES.districts as Record<
    string,
    string
  >;
  const normKey = (s: string) =>
    String(s || "")
      .toLowerCase()
      .replace(/\(([^)]*)\)/g, " $1 ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  /** Edit distance — tolerant fuzzy name matching for any spelling variant */
  function editDistance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i, ...Array(n).fill(0)] as number[];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(
          prev[j] + 1,
          cur[j - 1] + 1,
          prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
      }
      prev = cur;
    }
    return prev[n];
  }

  /** Unique closest candidate by edit distance (ambiguous → null) */
  function closestName(key: string, candidates: string[]): string | null {
    if (!key || key.length < 5 || !candidates?.length) return null;
    const limit = Math.max(1, Math.floor(Math.max(key.length, 6) / 5));
    let best: string | null = null;
    let bestD = Infinity;
    let secondD = Infinity;
    for (const c of candidates) {
      const d = editDistance(key, c);
      if (d < bestD) {
        secondD = bestD;
        bestD = d;
        best = c;
      } else if (d < secondD) {
        secondD = d;
      }
    }
    if (!best || bestD > limit || bestD >= secondD) return null;
    return best;
  }

  function normDistrict(v: string): string {
    const raw = String(v || "").trim();
    const tel = TELUGU_ALIAS[raw] || TELUGU_ALIAS[raw.replace(/\s+/g, " ")];
    if (tel) return tel;
    const key = normKey(raw);
    if (!key) return v;
    const hit = DISTRICT_ALIAS[key];
    if (hit) return hit;
    const close = closestName(
      key,
      (GEO_ALIASES.districtNames as string[]) || [],
    );
    return close || v;
  }

  /** AC spelling variants → canonical AC name (fixes old/unofficial Excel labels) */
  const AC_ALIAS: Record<string, string> = GEO_ALIASES.acs as Record<
    string,
    string
  >;

  function resolveAc(name: string): AcEntry | null {
    if (!name?.trim()) return null;
    const key = name
      .toLowerCase()
      .replace(/\(([^)]*)\)/g, " $1 ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!key) return null;
    // Known spelling variants first (deterministic, before fuzzy scan)
    const aliased = AC_ALIAS[key];
    if (aliased) {
      const hit = acList.find((ac) => normKey(ac.canonical) === normKey(aliased));
      if (hit) return hit;
    }
    // exact-ish
    for (const ac of acList) {
      const n = ac.canonical
        .toLowerCase()
        .replace(/\(([^)]*)\)/g, " $1 ")
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
        .replace(/\(([^)]*)\)/g, " $1 ")
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
    if (best) return best;
    // Last resort: unique edit-distance match (handles any misspelling)
    const near = closestName(key, acList.map((ac) => normKey(ac.canonical)));
    if (near) return acList.find((ac) => normKey(ac.canonical) === near) || null;
    return null;
  }

  // Mandal name → district (auto district when AC is unknown). Same
  // caching rationale as assembly_constituencies above — mandals is only
  // ever changed by the manual seed script, never by a live endpoint.
  const mandalLookup = await getMandalLookup(sqlFn);

  // BR-004: Client Admin scope = own/assigned projects' form_keys (null = unrestricted).
  const raw = scopeKeys
    ? await sqlFn`
        SELECT id, payload, created_at
        FROM submissions
        WHERE payload->>'form_key' = ANY(${scopeKeys})
        ORDER BY created_at DESC
        LIMIT ${limit}
      `
    : await sqlFn`
        SELECT id, payload, created_at
        FROM submissions
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;

  // Must load media — empty kinds made field surveys with only survey_media look incomplete
  const mediaMap = await loadMediaKindsMap(sqlFn);

  const allRows: Row[] = (raw as Record<string, unknown>[]).map((row) => {
    const payload = parsePayload(row.payload);
    const a = (payload.answers as Record<string, unknown>) || payload || {};
    let dist = String(a.district || "").trim();
    let ac = String(a.constituency || a.assembly_constituency || "").trim();
    const respondent = String(a.respondent_name || a.respondentName || "").trim();
    const mandal = String(a.mandal || "").trim();

    // Resolve AC — exclusive single district (primary only, no multi-cover overlap)
    let resolved = resolveAc(ac) || resolveAc(respondent);
    if (resolved) {
      ac = resolved.canonical;
      dist = exclusiveDistrict(normDistrict(dist), resolved);
    } else {
      // No AC match → fall back to mandal → district (mandals table) when district missing
      if (!dist) {
        const md = mandalLookup.get(normKey(mandal));
        if (md) dist = md;
      }
      dist = normDistrict(dist);
    }

    let issues = a.issues as string[] | string;
    if (typeof issues === "string") {
      issues = issues.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
    }
    if (!Array.isArray(issues)) issues = [];

    // Drafts (even if status was wrongly set to confirmed) stay out of
    // dashboard confirmed counts — same rule as workStatusOf().
    const work = workStatusOf(payload);
    const status = work === "completed" ? "confirmed" : work;
    const verify = verifyWithMedia(payload, mediaMap, Number(row.id));
    const surveyor = surveyorNameOf(payload);
    return {
      id: row.id as string | number,
      created_at: isoStamp(row.created_at),
      district: dist || "Unknown",
      constituency: ac || "Unknown",
      mandal: mandal || "",
      lat: String(
        a.latitude || a.lat || a.geo_lat ||
          (payload.geo as Record<string, unknown> | undefined)?.lat ||
          payload.latitude || payload.lat || "",
      ),
      lng: String(
        a.longitude || a.lng || a.geo_lng ||
          (payload.geo as Record<string, unknown> | undefined)?.lng ||
          payload.longitude || payload.lng || "",
      ),
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
      submitted_by: surveyor === "unknown" ? "" : surveyor,
      respondent: respondent || String(a.respondent_name || ""),
      formKey: String(payload.form_key || payload.formKey || "default"),
      answers: a,
      duration_sec: durationSecOf(a),
    };
  });
  return allRows;
}

async function buildAnalytics(
  sqlFn: NonNullable<typeof sql>,
  url: URL,
  scopeKeys: string[] | null = null,
) {
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
  let formFilter = (url.searchParams.get("survey") || url.searchParams.get("form_key") || "").trim();
  // Client Admin: never load another tenant's questionnaire via a guessable form_key.
  // Super Admin (scopeKeys = null) may still select any survey.
  if (scopeKeys && formFilter && !scopeKeys.includes(formFilter)) {
    formFilter = "";
  }
  // period: total | day | month | today — Client Admin data scopes
  const period = (url.searchParams.get("period") || "total").trim().toLowerCase();
  const dayParam = (url.searchParams.get("day") || "").trim(); // YYYY-MM-DD
  const monthParam = (url.searchParams.get("month") || "").trim(); // YYYY-MM
  if (period === "today") {
    const t = istToday();
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

  const allRows = await loadAnalyticsRows(sqlFn, 10000, scopeKeys);

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

  // Survey questions → dynamic filter bar (options from defined choices + submitted answers)
  const surveyQuestions: {
    id: string;
    label: string;
    label_te: string;
    type: string;
    visible: boolean;
    options: string[];
    authored: string[];
    options_te: string[];
    aliases: string[];
    optTe: Map<string, string>;
  }[] = [];
  {
    // Never pull platform `legacy` / `default` into a new account's filter bar
    // unless that survey is explicitly selected (or it is the only scoped key).
    const PLATFORM_FORM_KEYS = new Set(["default", "legacy"]);
    let formRows: { questions?: unknown }[] = [];
    if (formFilter) {
      formRows = scopeKeys
        ? await sqlFn`
            SELECT form_key, questions FROM survey_form
            WHERE form_key = ${formFilter} AND form_key = ANY(${scopeKeys})
            LIMIT 1
          `.catch(() => [])
        : await sqlFn`
            SELECT form_key, questions FROM survey_form WHERE form_key = ${formFilter} LIMIT 1
          `.catch(() => []);
    } else {
      const scoped = Array.isArray(scopeKeys)
        ? scopeKeys.map(String).filter(Boolean)
        : [];
      const keysInData = [
        ...new Set(
          universe.map((r) => String(r.formKey || "")).filter(Boolean),
        ),
      ];
      // Keep any survey that actually has rows in this report (including
      // legacy/default). Only hide platform forms when they have no data —
      // that is what made Analyze charts disappear after we dropped them.
      let keys = scoped.length ? scoped : keysInData;
      if (!keys.length && !scopeKeys) {
        keys = [];
      }
      keys = keys.filter(
        (k) => !PLATFORM_FORM_KEYS.has(k) || keysInData.includes(k),
      );
      if (!keys.length) keys = keysInData;
      if (keys.length) {
        formRows = await sqlFn`
          SELECT form_key, questions FROM survey_form WHERE form_key = ANY(${keys})
        `.catch(() => []);
      }
    }
    const seen = new Set<string>();
    const parsedForms: { form_key: string; qs: Record<string, unknown>[] }[] = [];
    for (const frow of formRows as { form_key?: string; questions?: unknown }[]) {
      let qs = frow?.questions;
      if (typeof qs === "string") {
        try { qs = JSON.parse(qs); } catch { qs = []; }
      }
      if (!Array.isArray(qs)) continue;
      parsedForms.push({
        form_key: String(frow.form_key || ""),
        qs: qs as Record<string, unknown>[],
      });
    }
    const aliasesById = new Map<string, string[]>();
    for (const form of parsedForms) {
      const qs = form.qs.map((q) => ({
        id: String(q.id || slugQuestionKeyServer(String(q.label || ""))).trim(),
        label: String(q.label || "").trim(),
      })).filter((q) => q.id);
      const bags = universe
        .filter((r) => !form.form_key || String(r.formKey || "") === form.form_key)
        .map((r) => r.answers || {});
      for (const [qid, als] of aliasesForQuestions(qs, bags)) {
        const prev = aliasesById.get(qid) || [];
        for (const a of als) if (!prev.includes(a)) prev.push(a);
        aliasesById.set(qid, prev);
      }
    }
    for (const form of parsedForms) {
      for (const q of form.qs) {
        const id = String(q.id || "").trim() || slugQuestionKeyServer(String(q.label || ""));
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const type = String(q.type || "text");
        const defined = Array.isArray(q.options)
          ? q.options.map(coerceOptionName).filter(Boolean)
          : [];
        const aliases = aliasesById.get(id) || [];
        const opts: string[] = [];
        const authored: string[] = [];
        const pushOpt = (name: string, intoAuthored = false) => {
          const n = String(name || "").trim();
          if (!n) return;
          if (!opts.some((o) => o.toLowerCase() === n.toLowerCase())) opts.push(n);
          if (
            intoAuthored &&
            !authored.some((o) => o.toLowerCase() === n.toLowerCase())
          ) {
            authored.push(n);
          }
        };
        // Authored choices only. Type defaults fill in when the form has none.
        if (defined.length) {
          for (const d of defined) pushOpt(d, true);
        } else {
          for (const d of defaultQuestionOptions(type)) pushOpt(d, true);
        }
        for (const r of universe) {
          const av = answerOf(r.answers, id, String(q.label || ""), aliases);
          for (const n of chartNamesFromAnswer(type, av, opts)) pushOpt(n, false);
        }
        const optionsTe = Array.isArray(q.options_te) ? q.options_te.map(String) : [];
        const optTe = optionTeMap(defined.length ? defined : authored, optionsTe);
        surveyQuestions.push({
          id,
          label: String(q.label || "").trim() || "Question",
          label_te: String(q.label_te || "").trim(),
          type,
          visible: q.visible !== false,
          options: opts,
          authored,
          options_te: optionsTe,
          aliases,
          optTe,
        });
      }
    }
  }

  // Dynamic filters: q_<questionId>=value (driven by survey questions)
  const dynFilters = new Map<string, string>();
  for (const [k, v] of url.searchParams) {
    if (k.startsWith("q_") && v) dynFilters.set(k.slice(2), v);
  }
  if (dynFilters.size) {
    universe = universe.filter((r) => {
      const bag = answersByQuestionId(r.answers, surveyQuestions);
      for (const [qid, want] of dynFilters) {
        const q = surveyQuestions.find((sq) => sq.id === qid || sq.aliases.includes(qid));
        const av = q ? bag.get(q.id) : answerOf(r.answers, qid, q?.label, q?.aliases);
        const names = chartNamesFromAnswer(q?.type || "", av, q?.options || []);
        const hit = names.some((n) => n === want) ||
          (Array.isArray(av) ? av.map(String).includes(want) : String(av ?? "") === want);
        if (!hit) return false;
      }
      return true;
    });
  }

  // Survey titles for the by_survey board (participants + locations per survey)
  const surveyTitles = new Map<string, string>();
  {
    const trows = scopeKeys
      ? await sqlFn`
          SELECT form_key, title FROM survey_form WHERE form_key = ANY(${scopeKeys})
        `.catch(() => [])
      : await sqlFn`SELECT form_key, title FROM survey_form`.catch(() => []);
    for (const t of trows as { form_key?: string; title?: string }[]) {
      surveyTitles.set(String(t.form_key || ""), String(t.title || ""));
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

  const byParty = withTeLabels(countKey(rows, "party"), "value");
  // ALL districts with data for maps (no artificial top-N cut that hides small districts)
  const byDistrictRaw = countBy(
    rows.map((r) => ({ key: r.district })),
    (r) => r.key,
  );
  const byDistrict = withTeLabels(
    withPct(byDistrictRaw.filter((d) => d.name !== "Unknown")),
    "place",
  );
  const byGender = withTeLabels(countKey(rows, "gender"), "value");
  const byCaste = withTeLabels(countKey(rows, "caste"), "value");
  const byPm = withTeLabels(countKey(rows, "pm"), "value");
  const byPerformance = withTeLabels(countKey(rows, "performance").slice(0, 10), "value");
  const byEducation = withTeLabels(countKey(rows, "education").slice(0, 10), "value");
  const byEmployment = withTeLabels(countKey(rows, "employment").slice(0, 10), "value");
  // Full AC list for assembly map coloring (not just top 12)
  const byConstituency = withTeLabels(
    withPct(
      countBy(
        rows.filter((r) => r.constituency !== "Unknown").map((r) => ({ key: r.constituency })),
        (r) => r.key,
      ),
    ),
    "place",
  );
  const byAge = withTeLabels(countKey(rows, "age"), "value");
  const byMp = withTeLabels(
    withPct(
      countBy(
        rows.filter((r) => r.mp).map((r) => ({ key: r.mp })),
        (r) => r.key,
      ),
    ),
    "place",
  );

  const issueMap = new Map<string, number>();
  for (const r of rows) {
    for (const iss of r.issues) {
      const name = String(iss).trim();
      if (!name) continue;
      issueMap.set(name, (issueMap.get(name) || 0) + 1);
    }
  }
  const issues = withTeLabels(
    withPct(
      [...issueMap.entries()]
        .map(([name, value]) => ({ name, value, pct: 0 }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 12),
    ),
    "value",
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

  function meterStatsForQuestion(
    q: (typeof surveyQuestions)[number],
    list: Row[],
  ): { avg: number; n: number } | null {
    if (q.type !== "meter" && q.type !== "tapometer") return null;
    const nums: number[] = [];
    for (const r of list) {
      const av = answersByQuestionId(r.answers, surveyQuestions).get(q.id);
      const n = Number(String(av ?? "").replace("%", "").replace(/[^0-9.+-]/g, ""));
      if (Number.isFinite(n) && n > 0) nums.push(Math.min(100, Math.max(1, n)));
    }
    if (!nums.length) return { avg: 0, n: 0 };
    const avg = Math.round((nums.reduce((s, x) => s + x, 0) / nums.length) * 10) / 10;
    return { avg, n: nums.length };
  }

  function countsForQuestion(
    q: (typeof surveyQuestions)[number],
    list: Row[],
  ) {
    const map = new Map<string, number>();
    const seed = q.authored?.length ? q.authored : q.options;
    const choice = CHOICE_Q_TYPES.has(q.type) || (q.type !== "text" && seed.length > 0);
    if (choice) {
      for (const opt of seed) map.set(opt, 0);
    }
    for (const r of list) {
      const av = answersByQuestionId(r.answers, surveyQuestions).get(q.id);
      for (const name of chartNamesFromAnswer(q.type, av, q.options)) {
        map.set(name, (map.get(name) || 0) + 1);
      }
    }
    const order = q.options;
    let entries = [...map.entries()];
    entries.sort((a, b) => {
      const ia = order.findIndex((o) => o.toLowerCase() === a[0].toLowerCase());
      const ib = order.findIndex((o) => o.toLowerCase() === b[0].toLowerCase());
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return b[1] - a[1] || a[0].localeCompare(b[0]);
    });
    if (!choice && entries.length > 50) {
      entries = [...entries].sort((a, b) => b[1] - a[1]).slice(0, 50);
    }
    return withTeLabels(
      withPct(entries.map(([name, value]) => ({ name, value, pct: 0 }))),
      "value",
      q.optTe,
    );
  }

  // Per-question charts: every survey question, every defined option (0 counts stay visible).
  const questionCharts = surveyQuestions.filter((q) => q.visible).map((q) => ({
    id: q.id,
    label: q.label,
    label_en: q.label,
    label_te: q.label_te || "",
    type: q.type,
    visible: q.visible,
    options: q.options,
    authored: q.authored,
    counts: countsForQuestion(q, rows),
    meter: meterStatsForQuestion(q, rows),
  }));

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
    const seen = new Set<string>();
    for (const r of rowMap.values()) {
      for (const k of Object.keys(r)) {
        if (k !== "name" && k !== "total") seen.add(k);
      }
    }
    const extra = [...seen].filter((c) => !partyOrder.includes(c)).sort();
    const columns = [...partyOrder, ...extra];
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
    column_labels: Object.fromEntries(
      partyByDistrict.columns.map((c) => [c, toTeluguValue(c)]),
    ),
    rows: partyByDistrict.rows.slice(0, 12).map((r) => ({
      ...r,
      label: toTeluguPlace(String(r.name || "")),
    })),
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
    ? withTeLabels(compareSets(pctDist(subset, "party"), pctDist(restRows, "party"), pctDist(universe, "party")), "value")
    : [];
  const contrastGender = isFiltered
    ? withTeLabels(compareSets(pctDist(subset, "gender"), pctDist(restRows, "gender"), pctDist(universe, "gender")), "value")
    : [];
  const contrastCaste = isFiltered
    ? withTeLabels(compareSets(pctDist(subset, "caste"), pctDist(restRows, "caste"), pctDist(universe, "caste")), "value")
    : [];
  const contrastPm = isFiltered
    ? withTeLabels(compareSets(pctDist(subset, "pm"), pctDist(restRows, "pm"), pctDist(universe, "pm")), "value")
    : [];
  const contrastConstituency = isFiltered
    ? withTeLabels(
        compareSets(
          pctDist(subset.filter((r) => r.constituency && r.constituency !== "Unknown"), "constituency"),
          pctDist(restRows.filter((r) => r.constituency && r.constituency !== "Unknown"), "constituency"),
          pctDist(universe.filter((r) => r.constituency && r.constituency !== "Unknown"), "constituency"),
        ).slice(0, 25),
        "place",
      )
    : [];
  const contrastDistrict = isFiltered
    ? withTeLabels(
        compareSets(
          pctDist(subset.filter((r) => r.district && r.district !== "Unknown"), "district"),
          pctDist(restRows.filter((r) => r.district && r.district !== "Unknown"), "district"),
          pctDist(universe.filter((r) => r.district && r.district !== "Unknown"), "district"),
        ),
        "place",
      )
    : [];
  const contrastMp = isFiltered
    ? withTeLabels(
        compareSets(
          pctDist(subset.filter((r) => r.mp), "mp"),
          pctDist(restRows.filter((r) => r.mp), "mp"),
          pctDist(universe.filter((r) => r.mp), "mp"),
        ),
        "place",
      )
    : [];

  const topParty = byParty[0];
  const topIssue = issues[0];
  const topDistrict = byDistrict[0];

  return {
    collectTime: collectTimeStats(rows),
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
        ? "Report uses confirmed surveys. GPS + photo + Q/A required; voice only when Super Admin/Client Admin set it required."
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
      // Dynamic per-question filter dropdowns (from the selected survey).
      // Counts come from `subset` (all active filters applied — district/party/
      // gender/caste/q_* included) so the numbers shown next to each option
      // match what the charts are currently displaying, not the unfiltered universe.
      questions: surveyQuestions.filter((q) => q.visible).map((q) => ({
        id: q.id,
        label: q.label,
        label_en: q.label,
        label_te: q.label_te || "",
        type: q.type,
        visible: q.visible,
        options: q.options,
        authored: q.authored,
        options_te: q.options_te,
        counts: countsForQuestion(q, subset),
        meter: meterStatsForQuestion(q, subset),
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
      // By survey: submissions, participating surveyors, locations covered
      by_survey: (() => {
        type SurveyStat = {
          name: string;
          title: string;
          value: number;
          surveyors: Set<string>;
          districts: Set<string>;
          constituencies: Set<string>;
        };
        const map = new Map<string, SurveyStat>();
        for (const r of universe) {
          const key = r.formKey || "default";
          let row = map.get(key);
          if (!row) {
            row = {
              name: key,
              title: surveyTitles.get(key) || key,
              value: 0,
              surveyors: new Set(),
              districts: new Set(),
              constituencies: new Set(),
            };
            map.set(key, row);
          }
          row.value += 1;
          if (r.submitted_by) row.surveyors.add(r.submitted_by);
          if (r.district && r.district !== "Unknown") row.districts.add(r.district);
          if (r.constituency && r.constituency !== "Unknown") {
            row.constituencies.add(r.constituency);
          }
        }
        return [...map.values()]
          .map((s) => ({
            name: s.name,
            title: s.title,
            value: s.value,
            surveyors: [...s.surveyors].sort(),
            districts: [...s.districts].sort(),
            constituencies: [...s.constituencies].sort(),
          }))
          .sort((a, b) => b.value - a.value);
      })(),
    },
    filterOptions,
    filterLabels: {
      districts: Object.fromEntries(
        (filterOptions.districts as string[]).map((n) => [n, toTeluguPlace(n)]),
      ),
      parties: Object.fromEntries(
        (filterOptions.parties as string[]).map((n) => [n, toTeluguValue(n)]),
      ),
      genders: Object.fromEntries(
        (filterOptions.genders as string[]).map((n) => [n, toTeluguValue(n)]),
      ),
      castes: Object.fromEntries(
        (filterOptions.castes as string[]).map((n) => [n, toTeluguValue(n)]),
      ),
      constituencies: Object.fromEntries(
        (filterOptions.constituencies as string[]).map((n) => [n, toTeluguPlace(n)]),
      ),
    },
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
      questionCharts,
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
      contrastConstituency,
      contrastDistrict,
      contrastMp,
    },
  };
}

/** Alias support: re-run rawHandler with a rewritten path/method/body. */
function redispatch(req: Request, pathAndQuery: string, method?: string, body?: string): Promise<Response> {
  const next = new Request(new URL(pathAndQuery, req.url), {
    method: method || req.method,
    headers: req.headers,
    body: (method || req.method) === "GET" || (method || req.method) === "HEAD"
      ? undefined
      : (body !== undefined ? body : req.body),
    // @ts-expect-error — required by Deno when streaming a body
    duplex: "half",
  });
  return rawHandler(next);
}

// ── Router ────────────────────────────────────────────────
async function rawHandler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return corsPreflight(req);

  const url = new URL(req.url);
  const path = url.pathname.replace(/\/$/, "") || "/";
  const method = req.method;

  try {
    if (!sql) return json({ error: "DATABASE_URL not set" }, 500);
    // Login / health must not wait for the full schema pass (dozens of ALTERs)
    // on a cold Deno isolate — that is the main "Signing in…" stall.
    const isLogin = path === "/api/auth/login" && method === "POST";
    const isHealth = path === "/" || path === "/api/health";
    if (isLogin || isHealth) void ready();
    else await ready();

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
          message: "Smart Survey X API on Deno Deploy",
          platform: "deno",
          auth: true,
          r2: r2Status,
        });
      }
      return json({
        ok: true,
        database: "connected",
        auth: true,
        platform: "deno",
        r2: r2Status,
      });
    }

    // App Version & In-App OTA Update Metadata (Telegram-style auto-update)
    if (path === "/api/app-version" && method === "GET") {
      const repo = "sravanku018/ground-iq-web";
      return json(
        {
          appName: "Smart Survey X",
          version: "2.0.25",
          versionCode: 20025,
          minSupportedVersionCode: 20000,
          apkUrl: `https://github.com/${repo}/releases/latest/download/ElectionSurvey-release.apk`,
          apkDebugUrl: `https://github.com/${repo}/releases/latest/download/ElectionSurvey-debug.apk`,
          releaseUrl: `https://github.com/${repo}/releases/latest`,
          changelog: "In-app APK install, voice only when Super Admin/Client Admin requires it, IST timestamps.",
          publishedAt: new Date().toISOString(),
        },
        200,
        { "cache-control": "no-store, no-cache, must-revalidate" },
      );
    }

    // Login — admin portal OR surveyor field app (accounts created by Client Admin only)
    if (path === "/api/auth/login" && method === "POST") {
      const ip = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "unknown";
      if (!checkRateLimit(ip)) {
        return json({ error: "Too many login attempts. Try again later." }, 429);
      }
      const body = await readBody(req);
      const username = String(body.username || "").trim().toLowerCase();
      const password = String(body.password || "");
      const expectedRole = String(body.expected_role || "").trim().toLowerCase();
      if (!username || !password) {
        return json({ error: "Username and password required" }, 400);
      }
      const rows = await sql`
        SELECT id, username, display_name, role, active, created_at, password_hash,
               company_id, company_name, key_id, phone,
               COALESCE(verified, FALSE) AS verified,
               COALESCE(can_manage_questions, FALSE) AS can_manage_questions,
               COALESCE(can_edit_surveys, FALSE) AS can_edit_surveys,
               COALESCE(can_review_data, FALSE) AS can_review_data,
               COALESCE(can_verify_surveyors, FALSE) AS can_verify_surveyors,
               COALESCE(can_assign_surveyors, FALSE) AS can_assign_surveyors,
               COALESCE(can_crud_questionnaire, FALSE) AS can_crud_questionnaire,
               COALESCE(can_validate_proof, FALSE) AS can_validate_proof,
               COALESCE(can_web_survey, FALSE) AS can_web_survey,
               COALESCE(can_record_voice, FALSE) AS can_record_voice,
               COALESCE(totp_enabled, FALSE) AS totp_enabled,
               totp_secret,
               COALESCE(max_questions_per_survey, 0) AS max_questions_per_survey,
               COALESCE(max_surveys, 0) AS max_surveys,
               COALESCE(max_surveyors, 0) AS max_surveyors,
               COALESCE(max_records, 0) AS max_records
        FROM app_users WHERE LOWER(username) = ${username} LIMIT 1
      `.catch(async () =>
        await sql`
          SELECT id, username, display_name, role, active, created_at, password_hash
          FROM app_users WHERE LOWER(username) = ${username} LIMIT 1
        `
      );
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
      // Only admin/super_admin (portal) or surveyor (field app). No public signup / legacy field/user.
      if (user.role !== "super_admin" && user.role !== "admin" && user.role !== "surveyor") {
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
        if (user.role !== "admin" && user.role !== "super_admin") {
          return json({
            error:
              "Client Admin portal only. Surveyors sign in on the field app with their app login.",
          }, 403);
        }
      }
      // Super Admin console (separate GitHub page) — server-enforced super_admin only
      if (expectedRole === "super_admin") {
        if (user.role !== "super_admin") {
          return json({
            error: "Super Admin console only. Client Admin uses the main portal.",
          }, 403);
        }
      }
      const ok = await verifyPassword(password, user.password_hash);
      if (!ok) {
        return json({
          error: "Invalid username or password. Use the login Client Admin created for you.",
        }, 401);
      }

      // Super Admin: password + authenticator TOTP (3 slots). Client Admin / surveyor unchanged.
      if (user.role === "super_admin") {
        const totpCode = (body as { totp?: unknown }).totp ?? (body as { otp?: unknown }).otp;
        const rec = user as Record<string, unknown>;
        let secret = String(rec.totp_secret || "").trim();
        const enabled = sqlBool(rec.totp_enabled);
        if (!secret) {
          secret = newTotpSecret();
          await sql`UPDATE app_users SET totp_secret = ${secret}, totp_enabled = FALSE WHERE id = ${user.id}`
            .catch(() => null);
        }
        const totpOk = await verifyTotp(secret, totpCode);
        if (!totpOk) {
          return json({
            error: enabled
              ? "Enter the 6-digit code from your authenticator app."
              : "Scan the authenticator QR / secret, then enter the 6-digit code.",
            totp_required: true,
            totp_setup: !enabled,
            ...(enabled ? {} : totpSetupPayload(user.username, secret)),
          }, 401);
        }
        if (!enabled) {
          await sql`UPDATE app_users SET totp_enabled = TRUE WHERE id = ${user.id}`.catch(() => null);
        }
      }

      const token = newToken();
      const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await sql`
        INSERT INTO app_sessions (token, user_id, expires_at)
        VALUES (${token}, ${user.id}, ${expires.toISOString()})
      `;
      logAudit(
        { id: user.id, username: user.username, role: user.role },
        "login",
        "user",
        user.id,
        { expected_role: expectedRole },
      );
      const uu = user as Record<string, unknown>;
      return json({
        token,
        user: {
          id: user.id,
          username: user.username,
          name: user.display_name || user.username,
          role: user.role,
          active: user.active,
          created_at: user.created_at,
          company_id: uu.company_id != null ? Number(uu.company_id) : null,
          company_name: uu.company_name ? String(uu.company_name) : null,
          key_id: uu.key_id || null,
          phone: uu.phone || null,
          verified: sqlBool(uu.verified),
          can_manage_questions: sqlBool(uu.can_manage_questions),
          can_edit_surveys: sqlBool(uu.can_edit_surveys),
          can_review_data: sqlBool(uu.can_review_data),
          can_verify_surveyors: sqlBool(uu.can_verify_surveyors),
          can_assign_surveyors: sqlBool(uu.can_assign_surveyors),
          can_crud_questionnaire: sqlBool(uu.can_crud_questionnaire),
          can_validate_proof: sqlBool(uu.can_validate_proof),
          can_web_survey: sqlBool(uu.can_web_survey),
          can_record_voice: sqlBool(uu.can_record_voice),
          totp_enabled: uu.role === "super_admin" ? sqlBool(uu.totp_enabled) : undefined,
          max_questions_per_survey: Number(uu.max_questions_per_survey) || 0,
          max_surveys: Number(uu.max_surveys) || 0,
          max_surveyors: Number(uu.max_surveyors) || 0,
          max_records: Number(uu.max_records) || 0,
        },
        expires_at: expires.toISOString(),
        access:
          user.role === "surveyor"
            ? "surveyor_field_app"
            : user.role === "super_admin"
              ? "super_admin_portal"
              : "client_admin_portal",
        note:
          user.role === "surveyor"
            ? "Login created by Client Admin — field app only"
            : user.role === "super_admin"
              ? "Platform Super Admin — full access"
              : "Client Admin portal access",
      });
    }


    // Auth-required helpers
    const token = bearer(req);
    const me = await getUser(token);

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

    if (path === "/api/auth/me" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      // Profile photos live on /me only — never on login or every session lookup.
      // If this SELECT fails, omit the keys so the app does not replace a
      // displayed photo with null.
      const mediaRows = await sql`
        SELECT photo, aadhaar_front, aadhaar_back FROM app_users WHERE id = ${me.id} LIMIT 1
      `.catch(() => null);
      const media = Array.isArray(mediaRows) && mediaRows[0]
        ? (mediaRows[0] as Record<string, unknown>)
        : null;
      const withMedia = {
        ...me,
        ...(media
          ? {
              photo: media.photo || null,
              aadhaar_front: media.aadhaar_front || null,
              aadhaar_back: media.aadhaar_back || null,
            }
          : {}),
      };
      // Client Admin: attach live usage vs Super-Admin-set caps so Overview "My allocation" works
      // without relying only on GET /api/users (which can be filtered / slow).
      if (me.role === "admin" && sql) {
        const meCompany = String((me as { company_name?: unknown }).company_name || "").trim();
        const [sCnt] = await sql`SELECT COUNT(*)::int AS n FROM survey_form WHERE created_by = ${me.id}`.catch(() => [{ n: 0 }]);
        const [srCnt] = await sql`SELECT COUNT(*)::int AS n FROM app_users WHERE role = 'surveyor' AND created_by = ${me.id}`.catch(() => [{ n: 0 }]);
        // Peak Q across owned + shared + company projects (not only created_by)
        const questionPeak = await peakQuestionsForAdmin(sql, Number(me.id), meCompany);
        const [recCnt] = await sql`
          SELECT COUNT(*)::int AS n
          FROM submissions s JOIN app_users u ON (
            s.payload->>'user_id' = u.id::text
            OR s.payload->>'submitted_by' = u.username
            OR s.payload->>'submitted_by' = COALESCE(u.display_name, u.username)
          )
          WHERE u.role = 'surveyor' AND u.created_by = ${me.id}
            AND COALESCE(s.payload->>'status', 'pending') <> 'rejected'
            AND COALESCE(s.payload->>'draft', 'false') NOT IN ('true', 't', '1')
        `.catch(() => [{ n: 0 }]);
        const teamRows = await sql`
          SELECT f.id AS sid, f.title,
                 jsonb_array_length(COALESCE(
                   CASE WHEN jsonb_typeof(f.questions) = 'array' THEN f.questions ELSE '[]'::jsonb END,
                   '[]'::jsonb
                 ))::int AS qn,
                 COALESCE(array_agg(jsonb_build_object('id', u.id, 'username', u.username, 'name', COALESCE(u.display_name, u.username)))
                   FILTER (WHERE u.id IS NOT NULL), '[]'::jsonb) AS surveyors
          FROM survey_form f
          LEFT JOIN survey_assignments a ON a.survey_id = f.id
          LEFT JOIN app_users u ON u.id = a.user_id AND u.created_by = ${me.id} AND u.role = 'surveyor'
          WHERE f.created_by = ${me.id}
             OR f.id IN (SELECT survey_id FROM survey_admin_access WHERE admin_id = ${me.id})
          GROUP BY f.id, f.title, f.questions ORDER BY f.title
        `.catch(() => []);
        const survey_team = (teamRows as { sid: number; title: string; qn?: number; surveyors: unknown }[]).map((t) => ({
          id: Number(t.sid),
          title: String(t.title),
          question_count: Number(t.qn) || 0,
          surveyors: Array.isArray(t.surveyors)
            ? (t.surveyors as { id: number; username: string; name: string }[])
            : [],
        }));
        // If SQL qn was 0 for all (double-encoded questions), prefer JS peak per row via peakQuestionsForAdmin
        const granted = await sql`
          SELECT f.id, f.title
          FROM survey_admin_access saa JOIN survey_form f ON f.id = saa.survey_id
          WHERE saa.admin_id = ${me.id} ORDER BY f.title
        `.catch(() => []);
        return json({
          user: {
            ...withMedia,
            survey_count: sqlCountN(sCnt),
            surveyor_count: sqlCountN(srCnt),
            question_count: questionPeak,
            record_count: sqlCountN(recCnt),
            surveyor_record_count: sqlCountN(recCnt),
            max_records: Number((me as { max_records?: unknown }).max_records) || 0,
            survey_team,
            granted_surveys: (granted as { id: number; title: string }[]).map((p) => ({
              id: Number(p.id),
              title: String(p.title),
            })),
          },
        });
      }
      return json({ user: withMedia });
    }

    if (path === "/api/auth/logout" && method === "POST") {
      if (token) await sql`DELETE FROM app_sessions WHERE token = ${token}`;
      return json({ ok: true });
    }


    // Count finished records for one surveyor (by user_id or username/name).
    // Excludes drafts and rejected rows so targets reflect real completed work.
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
        WHERE (
             payload->>'user_id' = ${uid}
          OR payload->>'submitted_by' = ${uname}
          OR payload->>'submitted_by' = ${dname}
          OR payload->'answers'->>'data_collector' = ${uname}
          OR payload->'answers'->>'data_collector' = ${dname}
        )
          AND COALESCE(payload->>'status', 'pending') <> 'rejected'
          AND COALESCE(payload->>'draft', 'false') NOT IN ('true', 't', '1')
          AND COALESCE(payload->'answers'->>'_draft', 'false') NOT IN ('true', 't', '1')
          AND COALESCE(payload->'answers'->>'draft', 'false') NOT IN ('true', 't', '1')
          AND COALESCE(payload->>'content_type', '') <> 'draft'
      `.catch(() => [{ n: 0 }]);
      return sqlCountN(rows[0]);
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
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);

      // Catch-up: auto-confirm complete pending packages so Client Admin sees done work
      // without opening Review. Bounded batch keeps this cheap.
      try {
        const pendingRows = me.role === "super_admin"
          ? await sql`
              SELECT id FROM submissions
              WHERE COALESCE(payload->>'status', 'pending') = 'pending'
                AND COALESCE(payload->>'draft', 'false') NOT IN ('true', 't', '1')
                AND (
                  payload->>'has_photo' = 'true'
                  OR payload->>'has_audio' = 'true'
                  OR EXISTS (SELECT 1 FROM survey_media m WHERE m.submission_id = submissions.id)
                )
              ORDER BY id DESC LIMIT 40
            `.catch(() => [])
          : await sql`
              SELECT s.id FROM submissions s
              WHERE COALESCE(s.payload->>'status', 'pending') = 'pending'
                AND COALESCE(s.payload->>'draft', 'false') NOT IN ('true', 't', '1')
                AND (
                  s.payload->>'user_id' IN (
                    SELECT id::text FROM app_users WHERE created_by = ${me.id} AND role IN ('surveyor', 'field')
                  )
                  OR s.payload->>'submitted_by' IN (
                    SELECT username FROM app_users WHERE created_by = ${me.id} AND role IN ('surveyor', 'field')
                  )
                  OR s.payload->>'form_key' = ANY(
                    SELECT form_key FROM survey_form WHERE created_by = ${me.id}
                    UNION
                    SELECT f.form_key FROM survey_admin_access saa
                    JOIN survey_form f ON f.id = saa.survey_id WHERE saa.admin_id = ${me.id}
                  )
                )
              ORDER BY s.id DESC LIMIT 40
            `.catch(() => []);
        for (const pr of pendingRows as { id: number }[]) {
          await autoConfirmIfComplete(sql, Number(pr.id)).catch(() => null);
        }
      } catch {
        /* non-fatal */
      }

      // Client Admin: only their surveyors. Super Admin: all.
      const rows = me.role === "super_admin"
        ? await sql`
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
          })
        : await sql`
            SELECT id, username, display_name, role, active, COALESCE(target_quota, 0) AS target_quota, created_at
            FROM app_users
            WHERE role IN ('surveyor', 'field') AND created_by = ${me.id}
            ORDER BY id
          `.catch(async () => {
            const r = await sql`
              SELECT id, username, display_name, role, active, created_at
              FROM app_users
              WHERE role IN ('surveyor', 'field') AND created_by = ${me.id}
              ORDER BY id
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
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      const body = await readBody(req);
      const target = Math.max(0, Math.min(Number(body.target) || 0, 100000));
      if (body.user_id) {
        if (me.role !== "super_admin") {
          const own = await sql`
            SELECT id FROM app_users
            WHERE id = ${Number(body.user_id)} AND created_by = ${me.id} AND role IN ('surveyor', 'field')
            LIMIT 1
          `.catch(() => []);
          if (!own.length) return json({ error: "Not your surveyor" }, 403);
        }
        await sql`
          UPDATE app_users SET target_quota = ${target} WHERE id = ${Number(body.user_id)}
        `;
        return json({ ok: true, user_id: Number(body.user_id), target });
      }
      if (body.all_surveyors) {
        if (me.role === "super_admin") {
          await sql`
            UPDATE app_users SET target_quota = ${target} WHERE role = 'surveyor'
          `;
        } else {
          await sql`
            UPDATE app_users SET target_quota = ${target}
            WHERE role = 'surveyor' AND created_by = ${me.id}
          `;
        }
        return json({ ok: true, all_surveyors: true, target });
      }
      return json({ error: "Provide user_id or all_surveyors:true" }, 400);
    }

    // ── Users: list / generate (admin) ───────────────────────
    if (path === "/api/users" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      const assignedRows = await sql`
        SELECT sa.user_id, f.id AS survey_id, f.title, f.form_key
        FROM survey_assignments sa JOIN survey_form f ON f.id = sa.survey_id
        ORDER BY f.title
      `.catch(async () =>
        await sql`
          SELECT sa.user_id, sa.survey_id, COALESCE(f.title, '') AS title, COALESCE(f.form_key, '') AS form_key
          FROM survey_assignments sa
          LEFT JOIN survey_form f ON f.id = sa.survey_id
        `.catch(() => [])
      );
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
      // BR-004 tenant scoping: a Client Admin only sees themselves + surveyors they
      // created (created_by = me.id). Super Admin sees every account. This stops
      // survey names/surveyors from being mixed across client admins.
      // NOTE: two explicit queries — the Deno-deployed neon driver rejects nested
      // composed ${...} sql fragments with 'syntax error at or near $1'.
      const rows = me.role === "super_admin"
        ? await sql`
            SELECT id, username, display_name, company_name, role, active, created_at,
                   COALESCE(target_quota, 0) AS target_quota,
                   key_id, phone, photo, aadhaar_front, aadhaar_back,
                   COALESCE(verified, FALSE) AS verified,
                   COALESCE(can_manage_questions, FALSE) AS can_manage_questions,
                   COALESCE(can_edit_surveys, FALSE) AS can_edit_surveys,
                   COALESCE(can_review_data, FALSE) AS can_review_data,
                   COALESCE(can_verify_surveyors, FALSE) AS can_verify_surveyors,
                   COALESCE(can_assign_surveyors, FALSE) AS can_assign_surveyors,
                   COALESCE(can_crud_questionnaire, FALSE) AS can_crud_questionnaire,
                   COALESCE(can_validate_proof, FALSE) AS can_validate_proof,
               COALESCE(can_web_survey, FALSE) AS can_web_survey,
               COALESCE(can_record_voice, FALSE) AS can_record_voice,
                   COALESCE(totp_enabled, FALSE) AS totp_enabled,
                   COALESCE(max_questions_per_survey, 0) AS max_questions_per_survey,
                   COALESCE(max_surveys, 0) AS max_surveys,
                   COALESCE(max_surveyors, 0) AS max_surveyors,
                   COALESCE(max_records, 0) AS max_records
            FROM app_users
            ORDER BY id
          `.catch(async () =>
            await sql`
              SELECT id, username, display_name, NULL::TEXT AS company_name, role, active, created_at,
                     FALSE AS can_manage_questions, FALSE AS can_edit_surveys,
                     FALSE AS can_review_data, FALSE AS can_verify_surveyors,
                     FALSE AS can_assign_surveyors,
                     FALSE AS can_crud_questionnaire, FALSE AS can_validate_proof, FALSE AS can_web_survey, FALSE AS can_record_voice,
                     0 AS max_questions_per_survey, 0 AS max_surveys, 0 AS max_surveyors, 0 AS max_records
              FROM app_users ORDER BY id
            `
          )
        : await sql`
            SELECT id, username, display_name, company_name, role, active, created_at,
                   COALESCE(target_quota, 0) AS target_quota,
                   key_id, phone, photo, aadhaar_front, aadhaar_back,
                   COALESCE(verified, FALSE) AS verified,
                   COALESCE(can_manage_questions, FALSE) AS can_manage_questions,
                   COALESCE(can_edit_surveys, FALSE) AS can_edit_surveys,
                   COALESCE(can_review_data, FALSE) AS can_review_data,
                   COALESCE(can_verify_surveyors, FALSE) AS can_verify_surveyors,
                   COALESCE(can_assign_surveyors, FALSE) AS can_assign_surveyors,
                   COALESCE(can_crud_questionnaire, FALSE) AS can_crud_questionnaire,
                   COALESCE(can_validate_proof, FALSE) AS can_validate_proof,
               COALESCE(can_web_survey, FALSE) AS can_web_survey,
               COALESCE(can_record_voice, FALSE) AS can_record_voice,
                   COALESCE(totp_enabled, FALSE) AS totp_enabled,
                   COALESCE(max_questions_per_survey, 0) AS max_questions_per_survey,
                   COALESCE(max_surveys, 0) AS max_surveys,
                   COALESCE(max_surveyors, 0) AS max_surveyors,
                   COALESCE(max_records, 0) AS max_records
            FROM app_users
            WHERE (id = ${me.id} OR created_by = ${me.id})
            ORDER BY id
          `.catch(async () =>
            await sql`
              SELECT id, username, display_name, NULL::TEXT AS company_name, role, active, created_at,
                     FALSE AS can_manage_questions, FALSE AS can_edit_surveys,
                     FALSE AS can_review_data, FALSE AS can_verify_surveyors,
                     FALSE AS can_assign_surveyors,
                     FALSE AS can_crud_questionnaire, FALSE AS can_validate_proof, FALSE AS can_web_survey, FALSE AS can_record_voice,
                     0 AS max_questions_per_survey, 0 AS max_surveys, 0 AS max_surveyors, 0 AS max_records
              FROM app_users
              WHERE (id = ${me.id} OR created_by = ${me.id})
              ORDER BY id
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
        // Usage vs allocated caps (Super Admin console → Client Admins tab)
        let survey_count = 0;
        let surveyor_count = 0;
        let surveyor_record_count = 0;
        let question_count = 0;
        let survey_team: { id: number; title: string; surveyors: { id: number; username: string; name: string }[] }[] = [];
        if (r.role === "admin") {
          const [sCnt] = await sql`SELECT COUNT(*)::int AS n FROM survey_form WHERE created_by = ${Number(r.id)}`.catch(() => [{ n: 0 }]);
          survey_count = sqlCountN(sCnt);
          const [srCnt] = await sql`SELECT COUNT(*)::int AS n FROM app_users WHERE role = 'surveyor' AND created_by = ${Number(r.id)}`.catch(() => [{ n: 0 }]);
          surveyor_count = sqlCountN(srCnt);
          const [recordCnt] = await sql`
            SELECT COUNT(*)::int AS n
            FROM submissions s JOIN app_users u ON (
              s.payload->>'submitted_by' = u.username
              OR s.payload->>'submitted_by' = COALESCE(u.display_name, u.username)
            )
            WHERE u.role = 'surveyor' AND u.created_by = ${Number(r.id)}
          `.catch(() => [{ n: 0 }]);
          surveyor_record_count = sqlCountN(recordCnt);
          // Peak questions across owned + shared + company projects
          question_count = await peakQuestionsForAdmin(
            sql,
            Number(r.id),
            r.company_name ? String(r.company_name) : null,
          );
          // Survey → surveyor mapping for this admin (only their own surveys + own surveyors)
          const teamRows = await sql`
            SELECT f.id AS sid, f.title,
                   COALESCE(array_agg(jsonb_build_object('id', u.id, 'username', u.username, 'name', COALESCE(u.display_name, u.username)))
                     FILTER (WHERE u.id IS NOT NULL), '[]'::jsonb) AS surveyors
            FROM survey_form f
            LEFT JOIN survey_assignments a ON a.survey_id = f.id
            LEFT JOIN app_users u ON u.id = a.user_id AND (u.created_by = ${Number(r.id)} OR u.role = 'admin' OR u.role = 'super_admin')
            WHERE f.created_by = ${Number(r.id)}
            GROUP BY f.id, f.title ORDER BY f.title
          `.catch(() => []);
          survey_team = (teamRows as { sid: number; title: string; surveyors: unknown }[]).map((t) => ({
            id: Number(t.sid),
            title: String(t.title),
            surveyors: Array.isArray(t.surveyors)
              ? (t.surveyors as { id: number; username: string; name: string }[])
              : [],
          }));
        }
        users.push({
          id: r.id,
          username: r.username,
          name: r.display_name || r.username,
          company_name: r.company_name || null,
          role: r.role,
          active: r.active,
          created_at: r.created_at,
          target_quota: target,
          survey_count,
          surveyor_count,
          surveyor_record_count,
          question_count,
          survey_team,
          // Projects explicitly assigned by Super Admin to this Client Admin.
          granted_surveys: r.role === "admin"
            ? (await sql`
                SELECT f.id, f.title
                FROM survey_admin_access saa JOIN survey_form f ON f.id = saa.survey_id
                WHERE saa.admin_id = ${Number(r.id)} ORDER BY f.title
              `.catch(() => []) as { id: number; title: string }[]).map((project) => ({
                id: Number(project.id), title: String(project.title),
              }))
            : [],
          done,
          key_id: r.key_id || null,
          phone: r.phone || null,
          photo: r.photo || null,
          aadhaar_front: r.aadhaar_front || null,
          aadhaar_back: r.aadhaar_back || null,
          verified: sqlBool(r.verified),
          can_manage_questions: sqlBool(r.can_manage_questions),
          can_edit_surveys: sqlBool(r.can_edit_surveys),
          can_review_data: sqlBool(r.can_review_data),
          can_verify_surveyors: sqlBool(r.can_verify_surveyors),
          can_assign_surveyors: sqlBool(r.can_assign_surveyors),
          can_crud_questionnaire: sqlBool(r.can_crud_questionnaire),
          can_validate_proof: sqlBool(r.can_validate_proof),
          can_web_survey: sqlBool(r.can_web_survey),
          can_record_voice: sqlBool(r.can_record_voice),
          totp_enabled: r.role === "super_admin" ? sqlBool(r.totp_enabled) : undefined,
          max_questions_per_survey: Number(r.max_questions_per_survey) || 0,
          max_surveys: Number(r.max_surveys) || 0,
          max_surveyors: Number(r.max_surveyors) || 0,
          max_records: Number(r.max_records) || 0,
          // Alias for Client Admin allocation UI
          record_count: surveyor_record_count,
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
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      const body = await readBody(req);
      const username = String(body.username || "").trim().toLowerCase();
      const password = String(body.password || "");
      const name = String(body.name || username).trim();
      const phone = String(body.phone || "").trim();
      const target_quota = Math.max(0, Math.min(Number(body.target_quota) || 0, 100000));
      // surveyor = field collector (can login field app); admin = portal only
      const role = body.role === "admin" ? "admin" : "surveyor";
      let companyName = role === "admin" ? String(body.company_name || "").trim().slice(0, 160) : "";
      if (role === "admin" && !companyName) {
        companyName = `${name || username} Organisation`;
      }
      if (!username || !password) {
        return json({ error: "username and password required" }, 400);
      }
      if (password.length < 4) {
        return json({ error: "Password min 4 characters" }, 400);
      }
      // BR-006: enforce the approved admin seat limit (Super Admin raises it via approval).
      // Super Admin is the approval authority and is not bound by the cap.
      if (role === "admin" && me.role !== "super_admin") {
        const [sl] = await sql`SELECT approved_limit FROM seat_limits WHERE seat_role = 'admin'`.catch(() => []);
        const limit = sl ? Number((sl as { approved_limit: unknown }).approved_limit) : 5;
        const [cnt] = await sql`SELECT COUNT(*)::int AS n FROM app_users WHERE role = 'admin' AND active = TRUE`.catch(() => [{ n: 0 }]);
        const current = sqlCountN(cnt);
        if (current >= limit) {
          return json({
            error: `Admin seat limit (${limit}) reached — file a seat upgrade request; Super Admin approves it (BR-006)`,
          }, 403);
        }
      }
      // Ensure role check allows surveyor
      await sql`ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check`.catch(() => null);
      await sql`
        ALTER TABLE app_users
        ADD CONSTRAINT app_users_role_check
        CHECK (role IN ('super_admin', 'admin', 'field', 'user', 'surveyor'))
      `.catch(() => null);
      await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS target_quota INTEGER NOT NULL DEFAULT 0`
        .catch(() => null);
      try {
        const password_hash = await hashPasswordAsync(password);
        const key_id = await uniqueUserKeyId();
        // Grant-based powers can be set at admin creation by the Super Admin (least privilege)
        const canSuper = role === "admin" && me.role === "super_admin";
        const canManageQuestions = canSuper && body.can_manage_questions === true;
        const canEditSurveys = canSuper && body.can_edit_surveys === true;
        const canReviewData = canSuper && body.can_review_data === true;
        const canVerifySurveyors = canSuper && body.can_verify_surveyors === true;
        const canAssignSurveyors = canSuper && body.can_assign_surveyors === true;
        const canCrudQuestionnaire = canSuper && body.can_crud_questionnaire === true;
        const canValidateProof = canSuper && body.can_validate_proof === true;
        const canWebSurvey = canSuper && body.can_web_survey === true;
        const canRecordVoice = canSuper && body.can_record_voice === true;
        const maxQuestionsPerSurvey = canSuper
          ? Math.max(0, Math.min(Number(body.max_questions_per_survey) || 0, 100000))
          : 0;      const maxSurveysCreate = canSuper
        ? Math.max(0, Math.min(Number(body.max_surveys) || 0, 100000))
        : 0;
      const maxSurveyorsCreate = canSuper
        ? Math.max(0, Math.min(Number(body.max_surveyors) || 0, 100000))
        : 0;
      const maxRecordsCreate = canSuper
        ? Math.max(0, Math.min(Number(body.max_records) || 0, 10_000_000))
        : 0;
      // Surveyor cap: a Client Admin may only create surveyors up to the Super-Admin-set
      // max_surveyors (0 = unlimited). Ownership is tracked via created_by.
      if (role === "surveyor" && me.role !== "super_admin") {
        const cap = Number((me as Record<string, unknown>).max_surveyors) || 0;
        if (cap > 0) {
          const [sc] = await sql`SELECT COUNT(*)::int AS n FROM app_users WHERE role = 'surveyor' AND created_by = ${me.id}`.catch(() => [{ n: 0 }]);
          const surveyorCount = sqlCountN(sc);
          if (surveyorCount >= cap) {
            return json({
              error: `Surveyor limit reached — max ${cap} surveyors (set by Super Admin). Delete a surveyor or ask Super Admin to raise the limit.`,
            }, 422);
          }
        }
      }
        let finalCompanyName = companyName || null;
        let companyId: number | null = null;
        if (role === "admin" && finalCompanyName && sql) {
          const comp = await ensureCompanyExists(sql, finalCompanyName, me.id);
          if (comp) {
            companyId = comp.id;
            finalCompanyName = comp.name;
          }
        }
        const inserted = await sql`
          INSERT INTO app_users (username, password_hash, display_name, company_name, company_id, role, target_quota, active, key_id, phone, can_manage_questions, can_edit_surveys, can_review_data, can_verify_surveyors, can_assign_surveyors, can_crud_questionnaire, can_validate_proof, can_web_survey, can_record_voice, max_questions_per_survey, max_surveys, max_surveyors, max_records, created_by)
          VALUES (${username}, ${password_hash}, ${name}, ${finalCompanyName}, ${companyId}, ${role}, ${target_quota}, TRUE, ${key_id}, ${phone || null}, ${canManageQuestions}, ${canEditSurveys}, ${canReviewData}, ${canVerifySurveyors}, ${canAssignSurveyors}, ${canCrudQuestionnaire}, ${canValidateProof}, ${canWebSurvey}, ${canRecordVoice}, ${maxQuestionsPerSurvey}, ${maxSurveysCreate}, ${maxSurveyorsCreate}, ${maxRecordsCreate}, ${me.id})
          RETURNING id, username, display_name, company_name, company_id, role, active, created_at, target_quota, key_id, phone, can_manage_questions, can_edit_surveys, can_review_data, can_verify_surveyors, can_assign_surveyors, can_crud_questionnaire, can_validate_proof, can_web_survey, can_record_voice, max_questions_per_survey, max_surveys, max_surveyors, max_records
        `;
        const u = inserted[0] as Record<string, unknown>;

        // New surveyor with no explicit assignment still needs surveys in the
        // field app (/api/my-surveys). Attach them to every survey this admin owns.
        if (role === "surveyor" && me.role === "admin" && u.id != null) {
          const mySurveys = await sql`
            SELECT id FROM survey_form
            WHERE created_by = ${me.id}
              AND form_key NOT IN ('default', 'legacy')
          `.catch(() => []);
          for (const s of mySurveys as { id: number }[]) {
            await upsertSurveyAssignment(Number(s.id), Number(u.id));
          }
        }

        // Auto-provision a starter project for every new Client Admin, in the
        // same request that creates their account (Super Admin does both in
        // one step from the Client Admin profile screen). This gives them a
        // real owned form_key immediately via adminFormKeyScope's
        // `created_by = me.id` clause — no dependency on the shared
        // 'legacy'/'default' fallback bucket.
        let starterFormKey: string | null = null;
        if (role === "admin" && sql) {
          const base = (finalCompanyName || name || username)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "") || "project";
          let formKey = base;
          let n = 1;
          for (;;) {
            const clash = await sql`SELECT id FROM survey_form WHERE form_key = ${formKey} LIMIT 1`;
            if (!clash.length) break;
            n += 1;
            formKey = `${base}-${n}`;
          }
          const starterTitle = `${finalCompanyName || name} — Default Project`;
          await sql`
            INSERT INTO survey_form (form_key, title, questions, updated_at, created_by, company_name, company_id)
            VALUES (${formKey}, ${starterTitle}, '[]'::jsonb, NOW(), ${u.id}, ${finalCompanyName}, ${companyId})
          `.catch(() => null);
          starterFormKey = formKey;
        }

        logAudit(me, "user_create", "user", u.id, {
          username: u.username,
          role,
          target_quota,
          can_manage_questions: canManageQuestions,
          can_edit_surveys: canEditSurveys,
          can_review_data: canReviewData,
          can_verify_surveyors: canVerifySurveyors,
          can_assign_surveyors: canAssignSurveyors,
          can_crud_questionnaire: canCrudQuestionnaire,
          can_validate_proof: canValidateProof,
          can_web_survey: canWebSurvey,
          can_record_voice: canRecordVoice,
          max_questions_per_survey: maxQuestionsPerSurvey,
          max_surveys: maxSurveysCreate,
          max_surveyors: maxSurveyorsCreate,
          max_records: maxRecordsCreate,
          starter_form_key: starterFormKey,
        });
        return json({
          user: {
            id: u.id,
            username: u.username,
            name: u.display_name || u.username,
            company_name: u.company_name || null,
            role: u.role,
            active: u.active !== false,
            created_at: u.created_at,
            target_quota: u.target_quota ?? target_quota,
            key_id: u.key_id || key_id,
            phone: u.phone || null,
            can_manage_questions: u.can_manage_questions === true,
            can_edit_surveys: u.can_edit_surveys === true,
            can_review_data: u.can_review_data === true,
            can_verify_surveyors: u.can_verify_surveyors === true,
            can_assign_surveyors: u.can_assign_surveyors === true,
            can_crud_questionnaire: u.can_crud_questionnaire === true,
            can_validate_proof: u.can_validate_proof === true,
            can_web_survey: u.can_web_survey === true,
            can_record_voice: u.can_record_voice === true,
            starter_form_key: starterFormKey,
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

    // Bulk generate surveyors: { count, prefix, password, target_quota }
    if (path === "/api/users/generate" && method === "POST") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      const body = await readBody(req);
      let count = Math.min(Math.max(Number(body.count) || 1, 1), 100);
      const prefix = String(body.prefix || "s").trim().toLowerCase().replace(/[^a-z0-9_]/g, "") || "s";
      // Surveyor cap: a Client Admin may only create surveyors up to the Super-Admin-set
      // max_surveyors (0 = unlimited). Clamp the requested batch to the remaining allowance.
      let bulkRemaining = -1; // -1 = no cap
      if (me.role !== "super_admin") {
        const cap = Number((me as Record<string, unknown>).max_surveyors) || 0;
        if (cap > 0) {
          const [sc] = await sql`SELECT COUNT(*)::int AS n FROM app_users WHERE role = 'surveyor' AND created_by = ${me.id}`.catch(() => [{ n: 0 }]);
          const surveyorCount = sqlCountN(sc);
          const remaining = Math.max(0, cap - surveyorCount);
          if (remaining <= 0) {
            return json({
              error: `Surveyor limit reached — max ${cap} surveyors (set by Super Admin). Delete a surveyor or ask Super Admin to raise the limit.`,
            }, 422);
          }
          count = Math.min(count, remaining);
          bulkRemaining = remaining;
        }
      }
      const password = String(body.password || "survey123");
      const target_quota = Math.max(0, Math.min(Number(body.target_quota) || 0, 100000));
      // Explicit usernames (one per line / comma separated) take priority over prefix+count
      const rawUsernames = Array.isArray(body.usernames)
        ? body.usernames
        : String(body.usernames_list || "").split(/[\n,;]+/);
      const usernames = rawUsernames
        .map((u: unknown) => String(u).trim().toLowerCase())
        .filter((u: string) => /^[a-z0-9_]{2,40}$/.test(u))
        .slice(0, 100);
      // Explicit usernames must also respect the cap — clamp the list to the allowance
      const names = usernames.length
        ? bulkRemaining >= 0
          ? usernames.slice(0, bulkRemaining)
          : usernames
        : Array.from({ length: count }, (_, i) => `${prefix}${String(i + 1).padStart(3, "0")}`);
      const created: {
        username: string;
        password: string;
        name: string;
        target_quota: number;
        key_id: string;
      }[] = [];
      await sql`ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check`.catch(() => null);
      await sql`
        ALTER TABLE app_users
        ADD CONSTRAINT app_users_role_check
        CHECK (role IN ('super_admin', 'admin', 'field', 'user', 'surveyor'))
      `.catch(() => null);
      await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS target_quota INTEGER NOT NULL DEFAULT 0`
        .catch(() => null);

      const password_hash = await hashPasswordAsync(password);
      const errors: string[] = [];
      for (const username of names) {
        const displayName = `Surveyor ${username}`;
        try {
          const key_id = await uniqueUserKeyId();
          const ins = await sql`
            INSERT INTO app_users (username, password_hash, display_name, role, target_quota, active, key_id, created_by)
            VALUES (${username}, ${password_hash}, ${displayName}, ${"surveyor"}, ${target_quota}, TRUE, ${key_id}, ${me.id})
            RETURNING id
          `;
          const newId = Number((ins[0] as { id?: number } | undefined)?.id);
          // Auto-attach bulk-created surveyors to every survey this admin owns
          if (Number.isFinite(newId) && me.role === "admin") {
            const mySurveys = await sql`
              SELECT id FROM survey_form
              WHERE created_by = ${me.id}
                AND form_key NOT IN ('default', 'legacy')
            `.catch(() => []);
            for (const s of mySurveys as { id: number }[]) {
              await upsertSurveyAssignment(Number(s.id), newId);
            }
          }
          created.push({
            username,
            password,
            name: displayName,
            target_quota,
            key_id,
            id: Number.isFinite(newId) ? newId : undefined,
          });
        } catch (e) {
          errors.push(`${username}: ${(e as Error).message || "exists"}`);
        }
      }
      logAudit(me, "users_bulk_create", "user", null, {
        count: created.length,
        prefix: names[0] || "",
        target_quota,
      });
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

    // Profile media upload endpoint (photo, aadhaar_front, aadhaar_back)
    if (m === "POST" && /^\/api\/users\/\d+\/media$/.test(url.pathname)) {
      if (!me) return json({ error: "Login required" }, 401);
      const urlParts = url.pathname.split("/");
      const targetId = Number(urlParts[3]);
      if (!targetId || !Number.isFinite(targetId)) return json({ error: "Invalid user id" }, 400);
      const body = await readBody(req);

      if (me.role !== "admin" && me.id !== targetId) {
        return json({ error: "Forbidden — can only edit own profile media" }, 403);
      }

      const existing = await sql`
        SELECT id, username, display_name, photo, aadhaar_front, aadhaar_back, verified
        FROM app_users WHERE id = ${targetId}
      `;
      if (!existing.length) return json({ error: "User not found" }, 404);

      // Lock uploads for verified surveyors — only admin can change
      const exUser = existing[0] as Record<string, unknown>;
      if (exUser.verified === true && me.role !== "admin") {
        return json({
          error: "Profile media is locked after Admin Verification. Only Admin can update photo or Aadhaar documents.",
        }, 403);
      }

      let photoVal = body.photo !== undefined ? (body.photo ? String(body.photo) : null) : null;
      let aadhaarFrontVal = body.aadhaar_front !== undefined ? (body.aadhaar_front ? String(body.aadhaar_front) : null) : null;
      let aadhaarBackVal = body.aadhaar_back !== undefined ? (body.aadhaar_back ? String(body.aadhaar_back) : null) : null;

      const field = String(body.field || body.kind || "").toLowerCase();
      const singleData = body.data !== undefined ? String(body.data) : body.url !== undefined ? String(body.url) : body.value !== undefined ? String(body.value) : null;

      if (singleData !== null) {
        if (field === "photo") photoVal = singleData || null;
        else if (field === "aadhaar_front" || field === "aadhaar-front" || field === "aadhaarfront") aadhaarFrontVal = singleData || null;
        else if (field === "aadhaar_back" || field === "aadhaar-back" || field === "aadhaarback") aadhaarBackVal = singleData || null;
      }

      const ex = existing[0] as Record<string, unknown>;
      let nextPhoto = photoVal !== null ? photoVal : ((ex.photo as string | null) || null);
      let nextAadhaarFront = aadhaarFrontVal !== null ? aadhaarFrontVal : ((ex.aadhaar_front as string | null) || null);
      let nextAadhaarBack = aadhaarBackVal !== null ? aadhaarBackVal : ((ex.aadhaar_back as string | null) || null);

      for (const [k, v] of [["photo", nextPhoto], ["aadhaar_front", nextAadhaarFront], ["aadhaar_back", nextAadhaarBack]] as const) {
        if (v && typeof v === "string" && v.length > 4_500_000) {
          return json({ error: `${k} image too large. Max 3MB base64 per image.` }, 413);
        }
      }

      // Store in Cloudflare R2 if configured
      const processR2 = async (field: "photo" | "aadhaar_front" | "aadhaar_back", val: string | null) => {
        if (!val || !val.startsWith("data:image/")) return val;
        const parsed = splitDataUrl(val);
        const mime = parsed.mime || "image/jpeg";
        const b64Data = parsed.b64;
        try {
          const bytes = b64ToBytes(b64Data);
          const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
          const objectKey = `profiles/${targetId}/${field}_${Date.now()}.${ext}`;
          const r2 = await tryOptionalExternalUpload(bytes, mime, field, objectKey, `${field}.${ext}`);
          if (r2?.url) return r2.url;
        } catch {
          /* fallback to dataUrl */
        }
        return val;
      };

      if (photoVal !== null && photoVal) nextPhoto = await processR2("photo", photoVal);
      if (aadhaarFrontVal !== null && aadhaarFrontVal) nextAadhaarFront = await processR2("aadhaar_front", aadhaarFrontVal);
      if (aadhaarBackVal !== null && aadhaarBackVal) nextAadhaarBack = await processR2("aadhaar_back", aadhaarBackVal);

      const updated = await sql`
        UPDATE app_users
        SET photo = ${nextPhoto},
            aadhaar_front = ${nextAadhaarFront},
            aadhaar_back = ${nextAadhaarBack}
        WHERE id = ${targetId}
        RETURNING id, username, display_name, key_id, phone, photo, aadhaar_front, aadhaar_back
      `;

      const u = updated[0] as Record<string, unknown>;
      const fields: string[] = [];
      if (photoVal) fields.push("photo");
      if (aadhaarFrontVal) fields.push("Aadhaar front");
      if (aadhaarBackVal) fields.push("Aadhaar back");
      if (me.role === "surveyor" && fields.length) {
        logAudit(me, "profile_media", "user", targetId, { fields });
      }
      return json({
        ok: true,
        user_id: u.id,
        username: u.username,
        photo: u.photo || null,
        aadhaar_front: u.aadhaar_front || null,
        aadhaar_back: u.aadhaar_back || null,
      });
    }

    // Edit user profile (Admin: all fields / Surveyor: own phone before verification)
    if (path.startsWith("/api/users/") && method === "PATCH") {
      if (!me) return json({ error: "Login required" }, 401);
      const id = Number(path.split("/").pop());
      if (!id) return json({ error: "Invalid id" }, 400);
      const body = await readBody(req);

      const existing = await sql`SELECT * FROM app_users WHERE id = ${id}`;
      if (!existing.length) return json({ error: "Not found" }, 404);
      const ex = existing[0] as Record<string, unknown>;

      const isSelf = me.id === id;
      const isAdmin = isPortalAdmin(me.role);

      if (!isAdmin && !isSelf) {
        return json({ error: "Forbidden — can only update own profile" }, 403);
      }

      // BR-004 tenant scoping: a Client Admin may only manage surveyors they
      // created (created_by = me.id). Super Admin manages every account.
      if (isAdmin && me.role !== "super_admin" && !isSelf &&
          Number(ex.created_by) !== me.id) {
        return json({ error: "Forbidden — that account belongs to another Client Admin" }, 403);
      }

      // Freeze phone, photo and Aadhaar edits for surveyors once verified by Admin
      if (ex.verified === true && !isAdmin) {
        const lockedFields = ['phone', 'photo', 'aadhaar_front', 'aadhaar_back'].filter(f => body[f] !== undefined)
        if (lockedFields.length > 0) {
          return json({
            error: `${lockedFields.join(', ')} ${lockedFields.length > 1 ? 'are' : 'is'} locked after Admin Verification. Only Admin can change them.`,
          }, 403);
        }
      }

      // Non-admins can ONLY update their own phone or photo
      if (!isAdmin) {
        if (body.username !== undefined || body.password !== undefined || body.active !== undefined || body.role !== undefined || body.verified !== undefined || body.target_quota !== undefined) {
          return json({ error: "Surveyors can only update their phone number or profile photo." }, 403);
        }
      }

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
      let nextCompanyName =
        body.company_name !== undefined && me.role === "super_admin" && ex.role === "admin"
          ? String(body.company_name || "").trim().slice(0, 160) || null
          : (ex as Record<string, unknown>).company_name || null;
      if (ex.role === "admin" && !nextCompanyName) {
        nextCompanyName = `${nextName || ex.username} Organisation`;
      }
      // Company registry link: when Super Admin explicitly changes a Client Admin's
      // company_name, relink to a registered company with that name (or unlink).
      const companyNameChanged =
        body.company_name !== undefined && me.role === "super_admin" && ex.role === "admin";
      let nextCompanyId: number | null =
        (ex as Record<string, unknown>).company_id != null
          ? Number((ex as Record<string, unknown>).company_id)
          : null;
      if (companyNameChanged || (ex.role === "admin" && !nextCompanyId)) {
        nextCompanyId = null;
        if (nextCompanyName && sql) {
          const comp = await ensureCompanyExists(sql, nextCompanyName, me.id);
          if (comp) {
            nextCompanyId = comp.id;
            nextCompanyName = comp.name;
          }
        }
      }
      const nextPhone =
        body.phone != null ? String(body.phone).trim() : (ex as Record<string, unknown>).phone || null;
      const nextPhoto =
        body.photo != null ? String(body.photo).trim() : (ex as Record<string, unknown>).photo || null;
      const nextAadhaarFront =
        body.aadhaar_front != null ? String(body.aadhaar_front).trim() : (ex as Record<string, unknown>).aadhaar_front || null;
      const nextAadhaarBack =
        body.aadhaar_back != null ? String(body.aadhaar_back).trim() : (ex as Record<string, unknown>).aadhaar_back || null;
      const nextVerified =
        typeof body.verified === "boolean" ? body.verified : (ex as Record<string, unknown>).verified === true;
      const nextRole =
        body.role === "admin" || body.role === "surveyor" ? body.role : ex.role;
      const nextQuota =
        body.target_quota != null
          ? Math.max(0, Math.min(Number(body.target_quota) || 0, 100000))
          : Number(ex.target_quota) || 0;
      const nextMaxQuestionsPerSurvey =
        body.max_questions_per_survey !== undefined && me.role === "super_admin"
          ? Math.max(0, Math.min(Number(body.max_questions_per_survey) || 0, 100000))
          : Number((ex as Record<string, unknown>).max_questions_per_survey) || 0;
      const nextMaxSurveys =
        body.max_surveys !== undefined && me.role === "super_admin"
          ? Math.max(0, Math.min(Number(body.max_surveys) || 0, 100000))
          : Number((ex as Record<string, unknown>).max_surveys) || 0;
      const nextMaxSurveyors =
        body.max_surveyors !== undefined && me.role === "super_admin"
          ? Math.max(0, Math.min(Number(body.max_surveyors) || 0, 100000))
          : Number((ex as Record<string, unknown>).max_surveyors) || 0;
      const nextMaxRecords =
        body.max_records !== undefined && me.role === "super_admin"
          ? Math.max(0, Math.min(Number(body.max_records) || 0, 10_000_000))
          : Number((ex as Record<string, unknown>).max_records) || 0;
      // Grant-based powers — only Super Admin grants/revokes them (least privilege)
      const POWER_KEYS = [
        "can_manage_questions",
        "can_edit_surveys",
        "can_review_data",
        "can_verify_surveyors",
        "can_assign_surveyors",
        "can_crud_questionnaire",
        "can_validate_proof",
        "can_web_survey",
        "can_record_voice",
      ] as const;
      const nextPowers: Record<string, boolean> = {};
      for (const k of POWER_KEYS) {
        const cur = sqlBool((ex as Record<string, unknown>)[k]);
        if (body[k] === undefined) {
          nextPowers[k] = cur;
        } else if (me.role === "super_admin") {
          // Accept true/false only from Super Admin body (boolean or "true"/"false")
          nextPowers[k] = sqlBool(body[k]);
        } else {
          nextPowers[k] = cur; // Client Admin cannot change own grants
        }
      }
      // Verification gate: surveyors need the granted verify power; client admin accounts
      // can only be verified by the Super Admin (client admins never verify each other)
      if (body.verified !== undefined) {
        const targetRole = String((ex as Record<string, unknown>).role || "");
        const isAdminTarget = targetRole === "admin" || targetRole === "super_admin";
        if (isAdminTarget ? me.role !== "super_admin" : !hasPower(me, "can_verify_surveyors")) {
          return json({
            error: isAdminTarget
              ? "Only Super Admin can verify client admin accounts"
              : "Super Admin has not granted your account surveyor-verification rights",
          }, 403);
        }
      }

      let rows;
      try {
        rows = await sql`
          UPDATE app_users
          SET username = ${nextUsername},
              password_hash = ${password_hash},
              display_name = ${nextName},
              company_name = ${nextCompanyName},
              company_id = ${nextCompanyId},
              role = ${nextRole},
              active = ${nextActive},
              target_quota = ${nextQuota},
              phone = ${nextPhone},
              photo = ${nextPhoto},
              aadhaar_front = ${nextAadhaarFront},
              aadhaar_back = ${nextAadhaarBack},
              verified = ${nextVerified},
              can_manage_questions = ${nextPowers.can_manage_questions},
              can_edit_surveys = ${nextPowers.can_edit_surveys},
              can_review_data = ${nextPowers.can_review_data},
              can_verify_surveyors = ${nextPowers.can_verify_surveyors},
              can_assign_surveyors = ${nextPowers.can_assign_surveyors},
              can_crud_questionnaire = ${nextPowers.can_crud_questionnaire},
              can_validate_proof = ${nextPowers.can_validate_proof},
              can_web_survey = ${nextPowers.can_web_survey},
              can_record_voice = ${nextPowers.can_record_voice},
              max_questions_per_survey = ${nextMaxQuestionsPerSurvey},
              max_surveys = ${nextMaxSurveys},
              max_surveyors = ${nextMaxSurveyors},
              max_records = ${nextMaxRecords}
          WHERE id = ${id}
          RETURNING id, username, display_name, company_name, role, active, created_at, target_quota, key_id, phone, photo, aadhaar_front, aadhaar_back, verified, can_manage_questions, can_edit_surveys, can_review_data, can_verify_surveyors, can_assign_surveyors, can_crud_questionnaire, can_validate_proof, can_web_survey, can_record_voice, max_questions_per_survey, max_surveys, max_surveyors, max_records
        `;
      } catch (e) {
        const msg = (e as Error).message || "";
        if (msg.includes("unique") || msg.includes("duplicate")) {
          return json({ error: "Username already taken" }, 409);
        }
        return json({ error: msg || "Update failed" }, 500);
      }

      // Revoke sessions only when credentials/status/identity change — NOT when
      // Super Admin only updates powers/limits (that was kicking Client Admins
      // on every feature save and made grants look "unsaved").
      const companyIdChanged =
        nextCompanyId !==
        ((ex as Record<string, unknown>).company_id != null
          ? Number((ex as Record<string, unknown>).company_id)
          : null);
      const shouldRevoke =
        body.revoke_sessions === true ||
        nextActive === false ||
        passwordChanged ||
        nextUsername !== ex.username ||
        nextRole !== ex.role ||
        (companyIdChanged && body.company_name !== undefined);
      let sessionsCleared = 0;
      if (shouldRevoke) {
        const del = await sql`DELETE FROM app_sessions WHERE user_id = ${id}`;
        sessionsCleared = Array.isArray(del) ? del.length : 0;
      }

      // FR-AUD-01: log admin-driven account changes (not self phone/photo-only edits)
      const adminChanged =
        nextActive !== ex.active ||
        passwordChanged ||
        nextUsername !== ex.username ||
        body.role !== undefined ||
        body.target_quota !== undefined ||
        body.verified !== undefined ||
        body.max_questions_per_survey !== undefined ||
        body.max_surveys !== undefined ||
        body.max_surveyors !== undefined ||
        body.max_records !== undefined ||
        POWER_KEYS.some((k) => body[k] !== undefined);
      if (adminChanged && isAdmin) {
        logAudit(me, "user_update", "user", id, {
          username: ex.username,
          active: nextActive,
          password_changed: passwordChanged,
          role_changed: body.role !== undefined,
          quota_changed: body.target_quota !== undefined,
          verified_changed: body.verified !== undefined,
          powers_changed: POWER_KEYS.filter((k) => body[k] !== undefined),
        });
      }

      const u = rows[0] as Record<string, unknown>;
      return json({
        ok: true,
        user: {
          id: u.id,
          username: u.username,
          name: u.display_name || u.username,
          company_name: u.company_name || null,
          role: u.role,
          active: u.active,
          created_at: u.created_at,
          target_quota: u.target_quota ?? nextQuota,
          key_id: u.key_id || null,
          phone: u.phone || nextPhone || null,
          photo: u.photo || nextPhoto || null,
          aadhaar_front: u.aadhaar_front || nextAadhaarFront || null,
          aadhaar_back: u.aadhaar_back || nextAadhaarBack || null,
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
          max_questions_per_survey: Number(u.max_questions_per_survey) || 0,
          max_surveys: Number(u.max_surveys) || 0,
          max_surveyors: Number(u.max_surveyors) || 0,
          max_records: Number(u.max_records) || nextMaxRecords || 0,
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
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      const id = Number(path.split("/").pop());
      if (!id) return json({ error: "Invalid id" }, 400);
      if (id === me.id) return json({ error: "Cannot delete your own account" }, 400);
      const existing = await sql`SELECT id, username, role, created_by FROM app_users WHERE id = ${id}`;
      if (!existing.length) return json({ error: "Not found" }, 404);
      // BR-004 tenant scoping: a Client Admin may only delete surveyors they created.
      if (me.role !== "super_admin" && Number((existing[0] as { created_by?: unknown }).created_by) !== me.id) {
        return json({ error: "Forbidden — that account belongs to another Client Admin" }, 403);
      }
      await sql`DELETE FROM app_sessions WHERE user_id = ${id}`;
      await sql`DELETE FROM app_users WHERE id = ${id}`;
      logAudit(me, "user_delete", "user", id, {
        username: (existing[0] as { username: string }).username,
        role: (existing[0] as { role: string }).role,
      });
      return json({
        ok: true,
        deleted: true,
        id,
        username: (existing[0] as { username: string }).username,
      });
    }

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
      return json({
        items: (rows as Record<string, unknown>[]).map(mapInboxRow),
        count: (rows as unknown[]).length,
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
          const tick = async () => {
            const rows = await listAdminInbox(sql, me, lastId);
            const list = (rows as Record<string, unknown>[]).slice().reverse();
            for (const r of list) {
              const seq = Number(r.id) || 0;
              if (seq <= lastId) continue;
              lastId = seq;
              send({ type: "item", item: mapInboxRow(r) });
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

    // FR-QB-02: Global Question Bank — Super Admin authors is_global templates;
    // Client Admins see global + their own, and can copy any into a survey.
    if (path === "/api/questions/translate" && method === "POST") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      if (!canQuestionCopy(me)) {
        return json({
          error: "Super Admin has not granted question-management rights (needed for Telugu translate)",
        }, 403);
      }
      const body = await readBody(req);
      const text = String(body.text || "").trim();
      const options = Array.isArray(body.options)
        ? body.options.map((s: unknown) => String(s ?? "").trim()).filter(Boolean)
        : [];
      if (!text) return json({ error: "Question text required" }, 400);
      try {
        const out = await translateQuestionToTelugu(text, options);
        return json(out);
      } catch (e) {
        const status = Number((e as { status?: number }).status) || 502;
        return json({ error: (e as Error).message || "Translate failed" }, status);
      }
    }

    if (path === "/api/question-bank" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      const rows = await sql`
        SELECT id, name, questions, is_global, created_by, created_at, updated_at
        FROM question_bank
        WHERE is_global = TRUE OR created_by = ${me.id}
        ORDER BY is_global DESC, id DESC
      `.catch(() => []);
      return json({ templates: rows });
    }

    if (path === "/api/question-bank" && method === "POST") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      // FR-QB-02: bank CRUD needs the Super-Admin-granted power (least privilege)
      if (!hasPower(me, "can_manage_questions")) {
        return json({
          error: "Super Admin has not granted your account Question Bank edit rights",
        }, 403);
      }
      const body = await readBody(req);
      const name = String(body.name || "").trim();
      const questions = Array.isArray(body.questions) ? body.questions : [];
      if (!name) return json({ error: "Template name required" }, 400);
      // Reject empty/duplicate question ids at the source — bank templates
      // get copied verbatim into real surveys, so a bad id here poisons
      // every survey created from it.
      {
        const seenIds = new Set<string>();
        for (const qq of questions as Record<string, unknown>[]) {
          const qid = String((qq as { id?: unknown })?.id || "").trim();
          if (!qid) return json({ error: "Every question needs a non-empty id" }, 422);
          if (seenIds.has(qid)) {
            return json({ error: `Duplicate question id "${qid}" — each question needs a unique id` }, 422);
          }
          seenIds.add(qid);
        }
      }
      // is_global forced true only for super_admin (FR-QB-02)
      const isGlobal = me.role === "super_admin" && body.is_global === true;
      const rows = await sql`
        INSERT INTO question_bank (name, questions, is_global, created_by)
        VALUES (${name}, ${JSON.stringify(questions)}::jsonb, ${isGlobal}, ${me.id})
        RETURNING id, name, questions, is_global, created_by, created_at, updated_at
      `.catch(() => []);
      const t = (rows as Record<string, unknown>[])[0];
      if (!t) return json({ error: "Could not create template" }, 500);
      logAudit(me, "question_bank_create", "question_bank", t.id, {
        name,
        is_global: isGlobal,
        questions: questions.length,
      });
      return json({ template: t }, 201);
    }

    if (path.startsWith("/api/question-bank/") && method === "PUT") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      // FR-QB-02: bank CRUD needs the Super-Admin-granted power (least privilege)
      if (!hasPower(me, "can_manage_questions")) {
        return json({
          error: "Super Admin has not granted your account Question Bank edit rights",
        }, 403);
      }
      const id = Number(path.split("/")[3]);
      const body = await readBody(req);
      const rows = await sql`SELECT * FROM question_bank WHERE id = ${id}`.catch(() => []);
      const t = rows[0] as Record<string, unknown> | undefined;
      if (!t) return json({ error: "Not found" }, 404);
      // FR-QB-02 / BR-003: global templates are Super Admin authored — no tenant can alter them
      if (t.is_global === true && me.role !== "super_admin") {
        return json({ error: "Global templates are Super Admin only" }, 403);
      }
      const isOwner = Number(t.created_by) === Number(me.id);
      if (!isOwner && me.role !== "super_admin") {
        return json({ error: "Only the author or Super Admin can edit this template" }, 403);
      }
      const name = String(body.name != null ? body.name : t.name || "Template").trim() || "Template";
      const questions = Array.isArray(body.questions)
        ? body.questions
        : (Array.isArray(t.questions) ? t.questions : []);
      {
        const seenIds = new Set<string>();
        for (const qq of questions as Record<string, unknown>[]) {
          const qid = String((qq as { id?: unknown })?.id || "").trim();
          if (!qid) return json({ error: "Every question needs a non-empty id" }, 422);
          if (seenIds.has(qid)) {
            return json({ error: `Duplicate question id "${qid}" — each question needs a unique id` }, 422);
          }
          seenIds.add(qid);
        }
      }
      const isGlobal = t.is_global === true || (me.role === "super_admin" && body.is_global === true);
      await sql`
        UPDATE question_bank
        SET name = ${name}, questions = ${JSON.stringify(questions)}::jsonb,
            is_global = ${isGlobal}, updated_at = NOW()
        WHERE id = ${id}
      `.catch(() => null);
      logAudit(me, "question_bank_update", "question_bank", id, { name, is_global: isGlobal });
      return json({ ok: true });
    }

    if (path.startsWith("/api/question-bank/") && method === "DELETE") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      // FR-QB-02: bank CRUD needs the Super-Admin-granted power (least privilege)
      if (!hasPower(me, "can_manage_questions")) {
        return json({
          error: "Super Admin has not granted your account Question Bank edit rights",
        }, 403);
      }
      const id = Number(path.split("/")[3]);
      const rows = await sql`SELECT id, name, created_by, is_global FROM question_bank WHERE id = ${id}`.catch(() => []);
      const t = rows[0] as Record<string, unknown> | undefined;
      if (!t) return json({ error: "Not found" }, 404);
      // FR-QB-02 / BR-003: global templates are Super Admin authored — no tenant can alter them
      if (t.is_global === true && me.role !== "super_admin") {
        return json({ error: "Global templates are Super Admin only" }, 403);
      }
      const isOwner = Number(t.created_by) === Number(me.id);
      if (!isOwner && me.role !== "super_admin") {
        return json({ error: "Only the author or Super Admin can delete this template" }, 403);
      }
      await sql`DELETE FROM question_bank WHERE id = ${id}`.catch(() => null);
      logAudit(me, "question_bank_delete", "question_bank", id, { name: t.name });
      return json({ ok: true, deleted: true });
    }

    // Copy a bank template into a real survey (survey_form) so surveyors can use it.
    if (path.match(/^\/api\/question-bank\/\d+\/copy$/) && method === "POST") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      // Copying a template creates a survey — needs questionnaire CRUD or survey-editing power
      if (!hasPower(me, "can_crud_questionnaire") && !hasPower(me, "can_edit_surveys")) {
        return json({
          error: "Super Admin has not granted your account questionnaire-editing rights",
        }, 403);
      }
      const body = await readBody(req);
      const id = Number(path.split("/")[3]);
      // Enforce client-scoped visibility: only global templates or the client's own
      const rows = await sql`SELECT id, name, questions FROM question_bank WHERE id = ${id} AND (is_global = TRUE OR created_by = ${me.id} OR ${me.role} = 'super_admin')`.catch(() => []);
      const t = rows[0] as Record<string, unknown> | undefined;
      if (!t) return json({ error: "Not found" }, 404);
      let questions = Array.isArray(t.questions) ? t.questions : [];
      // Select number of questions — subset by question_count (default all), capped by the
      // Super-Admin-set per-survey question cap for this Client Admin (0 = unlimited)
      const maxQs = Number((me as Record<string, unknown>).max_questions_per_survey) || 0;
      const cap = maxQs > 0 ? Math.min(maxQs, questions.length) : questions.length;
      if (body.question_count) {
        const limit = Math.max(1, Math.min(Number(body.question_count), cap));
        questions = questions.slice(0, limit);
      } else if (maxQs > 0 && questions.length > maxQs) {
        questions = questions.slice(0, maxQs);
      }
      // Super-Admin-set cap on how many surveys this Client Admin may create (0 = unlimited)
      const maxSvCopy = Number((me as Record<string, unknown>).max_surveys) || 0;
      if (maxSvCopy > 0) {
        const mine = await sql`SELECT COUNT(*)::int AS n FROM survey_form WHERE created_by = ${me.id}`.catch(() => [{ n: 0 }]);
        const createdCount = Number((mine[0] as { n?: number })?.n || 0);
        if (createdCount >= maxSvCopy) {
          return json({
            error: `Survey limit reached — maximum ${maxSvCopy} surveys (set by Super Admin). Delete or edit an existing survey first.`,
          }, 422);
        }
      }
      const title = `${String(t.name || "Template").trim()} Survey`;
      const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "survey";
      let formKey = base;
      let n = 1;
      for (;;) {
        const clash = await sql`SELECT id FROM survey_form WHERE form_key = ${formKey} LIMIT 1`;
        if (!(clash as unknown[]).length) break;
        n += 1;
        formKey = `${base}-${n}`;
      }
      const copyCompanyId = (me as Record<string, unknown>).company_id != null
        ? Number((me as Record<string, unknown>).company_id)
        : null;
      const copyCompanyName = (me as Record<string, unknown>).company_name
        ? String((me as Record<string, unknown>).company_name).trim().slice(0, 160) || null
        : null;
      const ins = await sql`
        INSERT INTO survey_form (form_key, title, questions, updated_at, created_by, company_name, company_id)
        VALUES (${formKey}, ${title}, ${JSON.stringify(questions)}::jsonb, NOW(), ${me.id}, ${copyCompanyName}, ${copyCompanyId})
        RETURNING id, form_key, title
      `.catch(() => []);
      const created = (ins as Record<string, unknown>[])[0];
      if (!created) return json({ error: "Could not create survey from template" }, 500);
      logAudit(me, "question_bank_copy", "survey", created.id, { template: id, title });
      return json({ ok: true, survey: created }, 201);
    }

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

    if (m === "GET" && url.pathname === "/api/submissions") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role) && me.role !== "surveyor") {
        return json({ error: "Access denied" }, 403);
      }

      const mine = url.searchParams.get("mine") === "1";
      if (mine || !isPortalAdmin(me.role)) {
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
        const items = (rows as Record<string, unknown>[])
          .map((r) => {
            const payload = parsePayload(r.payload);
            const answers = (payload?.answers || {}) as Record<string, unknown>;
            const media = mediaMap.get(Number(r.id)) || [];
            return {
              id: r.id,
              created_at: r.created_at,
              status: payloadStatus(payload),
              submitted_by: String(
                payload?.submitted_by || answers?.data_collector || "",
              ),
              record_index: recordIndexOf(payload),
              form_key: String(payload?.form_key || "default"),
              answers,
              photo_url: media.find((m) => m.kind === "photo")?.url || null,
              audio_url: media.find((m) => m.kind === "audio")?.url || null,
              media,
            };
          })
          .filter(Boolean);
        return json({ items, count: items.length });
      }

      const limit = Math.min(Number(url.searchParams.get("limit") || 200), 1000);
      const statusQ = (url.searchParams.get("status") || "").trim().toLowerCase();
      let dateFrom = (url.searchParams.get("date_from") || "").trim();
      let dateTo = (url.searchParams.get("date_to") || "").trim();
      const periodQ = (url.searchParams.get("period") || "total").trim().toLowerCase();
      const dayParam = (url.searchParams.get("day") || "").trim();
      const monthParam = (url.searchParams.get("month") || "").trim();
      if (periodQ === "today") {
        const t = istToday();
        dateFrom = t;
        dateTo = t;
      } else if (periodQ === "day" && dayParam) {
        dateFrom = dayParam;
        dateTo = dayParam;
      } else if (periodQ === "month" && monthParam) {
        const [y, m] = monthParam.split("-").map(Number);
        if (y && m) {
          const last = new Date(y, m, 0).getDate();
          dateFrom = `${monthParam}-01`;
          dateTo = `${monthParam}-${String(last).padStart(2, "0")}`;
        }
      }
      const userQ = (url.searchParams.get("user") || "").trim().toLowerCase();
      const districtQ = (url.searchParams.get("district") || "").trim().toLowerCase();
      const completenessQ = (url.searchParams.get("completeness") || "").trim().toLowerCase();
      // Dynamic question filters (q_<questionId> → value) — from Client Admin question naming
      const qFilters: [string, string][] = [];
      for (const [k, v] of url.searchParams) {
        if (k.startsWith("q_") && v.trim()) qFilters.push([k.slice(2), v.trim()]);
      }
      // Filters apply AFTER the LIMIT in JS below — so when any filter is set, fetch
      // a wide slice (oldest rows like legacy data would otherwise be unreachable).
      const hasSliceFilter =
        (statusQ && statusQ !== "all") ||
        Boolean(dateFrom) ||
        Boolean(dateTo) ||
        Boolean(userQ) ||
        Boolean(districtQ) ||
        Boolean(completenessQ && completenessQ !== "all") ||
        qFilters.length > 0 ||
        Boolean((url.searchParams.get("survey") || url.searchParams.get("form_key") || "").trim());
      const fetchRows = hasSliceFilter ? 5000 : limit;
      const scopeKeys = await adminFormKeyScope(sql, me);
      const rows = scopeKeys
        ? await sql`
            SELECT id, payload, fact_status, fact_error, created_at FROM submissions
            WHERE payload->>'form_key' = ANY(${scopeKeys})
            ORDER BY created_at DESC LIMIT ${fetchRows}
          `
        : await sql`
            SELECT id, payload, fact_status, fact_error, created_at FROM submissions
            ORDER BY created_at DESC LIMIT ${fetchRows}
          `;
      // media kinds for strict voice/photo checks
      const mediaMap = await loadMediaKindsMap(sql);

      let items = (rows as Record<string, unknown>[]).map((r) => {
        const payload = parsePayload(r.payload);
        const answers = (payload?.answers || payload) as Record<string, unknown>;
        const status = payloadStatus(payload);
        const verify = verifyWithMedia(payload, mediaMap, Number(r.id));
        const submittedBy = surveyorNameOf(payload);
        const draft = isDraftSubmission(payload);
        const work = workStatusOf(payload);
        return {
          id: r.id,
          source: (payload?.source as string) || "app",
          form_id: (payload?.form_id as string) || "",
          form_key: String(payload?.form_key || "default"),
          created_at: r.created_at,
          date: dayKey(isoStamp(r.created_at)),
          status,
          fact_status: r.fact_status ?? null,
          fact_error: r.fact_error ?? null,
          work,
          draft,
          completeness: verify.completeness,
          verification: verify,
          legacy: !!verify.legacy,
          submitted_by: submittedBy === "unknown" ? "" : submittedBy,
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
          proof_validated: payload?.proof_validated || null,
          record_index: recordIndexOf(payload),
        };
      });

      if (statusQ && statusQ !== "all") {
        if (statusQ === "pending") {
          // Same as Overview "Pending review": not confirmed work, including
          // rows still tagged _draft after Send from the field app.
          items = items.filter((x) => x.work === "pending" || x.status === "pending");
        } else if (statusQ === "confirmed") {
          items = items.filter((x) => x.work === "completed");
        } else {
          items = items.filter((x) => x.status === statusQ);
        }
      }
      if (qFilters.length) {
        // question id → type, so age-type filters bucket-match ranges
        const qTypeMap = new Map<string, string>();
        {
          const frows = scopeKeys
            ? await sql`SELECT questions FROM survey_form WHERE form_key = ANY(${scopeKeys})`.catch(() => [])
            : await sql`SELECT questions FROM survey_form`.catch(() => []);
          for (const f of frows as { questions?: unknown }[]) {
            let qs = f.questions;
            if (typeof qs === "string") { try { qs = JSON.parse(qs); } catch { qs = []; } }
            if (!Array.isArray(qs)) continue;
            for (const q of qs as Record<string, unknown>[]) {
              const id = String(q.id || q.label || "");
              if (id) qTypeMap.set(id, String(q.type || "text"));
            }
          }
        }
        items = items.filter((x) => {
          for (const [qid, want] of qFilters) {
            const av = (x as { answers?: Record<string, unknown> }).answers;
            const val = answerOf(av, qid);
            const hit = qTypeMap.get(qid) === "age"
              ? ageBucket(val) === want
              : Array.isArray(val)
                ? val.map(String).includes(want)
                : String(val ?? "") === want;
            if (!hit) return false;
          }
          return true;
        });
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
      if (districtQ) {
        items = items.filter((x) => {
          const a = (x as { answers?: Record<string, unknown> }).answers || {};
          return String(a.district || "").toLowerCase().includes(districtQ);
        });
      }
      if (completenessQ === "complete" || completenessQ === "incomplete") {
        items = items.filter((x) => x.completeness === completenessQ);
      }

      const summary = {
        total: items.length,
        complete: items.filter((x) => x.completeness === "complete").length,
        incomplete: items.filter((x) => x.completeness === "incomplete").length,
        // Work: drafts count as pending, not completed
        completed: items.filter((x) => x.work === "completed").length,
        pending: items.filter((x) => x.work === "pending").length,
        confirmed: items.filter((x) => x.work === "completed").length,
        rejected: items.filter((x) => x.work === "rejected").length,
        draft: items.filter((x) => x.draft).length,
        status_confirmed: items.filter((x) => x.status === "confirmed").length,
        status_pending: items.filter((x) => x.status === "pending").length,
        geo_fail: items.filter((x) => !x.has_geo).length,
        voice_fail: items.filter((x) => !x.has_voice).length,
        by_user: {} as Record<
          string,
          {
            total: number;
            complete: number;
            incomplete: number;
            completed: number;
            confirmed: number;
            pending: number;
            draft: number;
          }
        >,
        by_date: {} as Record<
          string,
          {
            total: number;
            complete: number;
            incomplete: number;
            completed: number;
            confirmed: number;
            pending: number;
            draft: number;
          }
        >,
      };
      for (const it of items) {
        const u = it.submitted_by || "unknown";
        if (!summary.by_user[u]) {
          summary.by_user[u] = {
            total: 0,
            complete: 0,
            incomplete: 0,
            completed: 0,
            confirmed: 0,
            pending: 0,
            draft: 0,
          };
        }
        summary.by_user[u].total += 1;
        if (it.completeness === "complete") summary.by_user[u].complete += 1;
        else summary.by_user[u].incomplete += 1;
        if (it.work === "completed") {
          summary.by_user[u].completed += 1;
          summary.by_user[u].confirmed += 1;
        } else if (it.work === "pending") {
          summary.by_user[u].pending += 1;
        }
        if (it.draft) summary.by_user[u].draft += 1;
        const d = it.date || "unknown";
        if (!summary.by_date[d]) {
          summary.by_date[d] = {
            total: 0,
            complete: 0,
            incomplete: 0,
            completed: 0,
            confirmed: 0,
            pending: 0,
            draft: 0,
          };
        }
        summary.by_date[d].total += 1;
        if (it.completeness === "complete") summary.by_date[d].complete += 1;
        else summary.by_date[d].incomplete += 1;
        if (it.work === "completed") {
          summary.by_date[d].completed += 1;
          summary.by_date[d].confirmed += 1;
        } else if (it.work === "pending") {
          summary.by_date[d].pending += 1;
        }
        if (it.draft) summary.by_date[d].draft += 1;
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
          legacy: "Legacy rows (no GPS/camera) are exempt from geo/voice/photo checks",
        },
      });
    }

    // Client Admin analyze board: by date + user
    if (path === "/api/admin/analyze" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      let dateFrom = (url.searchParams.get("date_from") || "").trim();
      let dateTo = (url.searchParams.get("date_to") || "").trim();
      const userQ = (url.searchParams.get("user") || "").trim().toLowerCase();
      const surveyQ = (url.searchParams.get("survey") || url.searchParams.get("form_key") || "").trim();
      const districtQ = (url.searchParams.get("district") || "").trim().toLowerCase();
      const constituencyQ = (url.searchParams.get("constituency") || url.searchParams.get("ac") || "").trim().toLowerCase();
      const period = (url.searchParams.get("period") || "total").trim().toLowerCase();
      const dayParam = (url.searchParams.get("day") || "").trim();
      const monthParam = (url.searchParams.get("month") || "").trim();
      const completenessQ = (url.searchParams.get("completeness") || "").trim().toLowerCase();
      // Dynamic question filters (q_<questionId> → value) — from Client Admin question naming
      const qFilters: [string, string][] = [];
      for (const [k, v] of url.searchParams) {
        if (k.startsWith("q_") && v.trim()) qFilters.push([k.slice(2), v.trim()]);
      }
      if (period === "today") {
        const t = istToday();
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
      const scopeKeys = await adminFormKeyScope(sql, me);
      const rows = scopeKeys
        ? await sql`
            SELECT id, payload, created_at FROM submissions
            WHERE payload->>'form_key' = ANY(${scopeKeys})
            ORDER BY created_at DESC LIMIT 5000
          `
        : await sql`
            SELECT id, payload, created_at FROM submissions
            ORDER BY created_at DESC LIMIT 5000
          `;
      // question id → type, so age-type q_ filters bucket-match ranges
      const qTypeMap = new Map<string, string>();
      {
        const frows = scopeKeys
          ? await sql`SELECT questions FROM survey_form WHERE form_key = ANY(${scopeKeys})`.catch(() => [])
          : await sql`SELECT questions FROM survey_form`.catch(() => []);
        for (const f of frows as { questions?: unknown }[]) {
          let qs = f.questions;
          if (typeof qs === "string") { try { qs = JSON.parse(qs); } catch { qs = []; } }
          if (!Array.isArray(qs)) continue;
          for (const q of qs as Record<string, unknown>[]) {
            const id = String(q.id || q.label || "");
            if (id) qTypeMap.set(id, String(q.type || "text"));
          }
        }
      }
      const mediaMap = await loadMediaKindsMap(sql);

      type RowA = {
        id: number;
        date: string;
        month: string;
        user: string;
        status: string;
        /** Work status for surveyor boards: completed | pending | rejected */
        work: "completed" | "pending" | "rejected";
        draft: boolean;
        completeness: string;
        geo_ok: boolean;
        voice_ok: boolean;
        photo_ok: boolean;
        district: string;
        party: string;
      };
      type Bucket = {
        total: number;
        /** Media OK (geo+voice+photo+Q/A) */
        complete: number;
        /** Media fail */
        incomplete: number;
        /** Confirmed + not draft = finished for surveyor */
        completed: number;
        /** Alias of completed (UI uses confirmed column for completed work) */
        confirmed: number;
        /** Status pending OR draft (still open) */
        pending: number;
        rejected: number;
        draft: number;
        geo_fail: number;
        voice_fail: number;
        photo_fail: number;
      };
      const emptyBucket = (): Bucket => ({
        total: 0,
        complete: 0,
        incomplete: 0,
        completed: 0,
        confirmed: 0,
        pending: 0,
        rejected: 0,
        draft: 0,
        geo_fail: 0,
        voice_fail: 0,
        photo_fail: 0,
      });
      const bump = (b: Bucket, row: RowA) => {
        b.total += 1;
        // Media completeness
        if (row.completeness === "complete") b.complete += 1;
        else b.incomplete += 1;
        // Work progress (what Client Admin expects: completed vs pending)
        if (row.work === "completed") {
          b.completed += 1;
          b.confirmed += 1; // confirmed column = completed work
        } else if (row.work === "rejected") {
          b.rejected += 1;
        } else {
          b.pending += 1;
        }
        if (row.draft) b.draft += 1;
        if (!row.geo_ok) b.geo_fail += 1;
        if (!row.voice_ok) b.voice_fail += 1;
        if (!row.photo_ok) b.photo_fail += 1;
      };

      let list: RowA[] = [];
      for (const r of rows as { id: number; payload: unknown; created_at: string }[]) {
        const payload = parsePayload(r.payload);
        const a = (payload.answers || {}) as Record<string, unknown>;
        const v = verifyWithMedia(payload, mediaMap, Number(r.id));
        const user = surveyorNameOf(payload);
        const draft = isDraftSubmission(payload);
        const work = workStatusOf(payload);
        const date = dayKey(isoStamp(r.created_at));
        const month = date.slice(0, 7);
        if (dateFrom && date < dateFrom) continue;
        if (dateTo && date > dateTo) continue;
        if (userQ && !user.toLowerCase().includes(userQ)) continue;
        if (surveyQ && String(payload.form_key || "default") !== surveyQ) continue;
        if (districtQ && !String(a.district || "").toLowerCase().includes(districtQ)) continue;
        if (constituencyQ && !String(a.constituency || a.assembly || "").toLowerCase().includes(constituencyQ)) continue;
        let qSkip = false;
        for (const [qid, want] of qFilters) {
          const val = answerOf(a, qid);
          const hit = qTypeMap.get(qid) === "age"
            ? ageBucket(val) === want
            : Array.isArray(val)
              ? val.map(String).includes(want)
              : String(val ?? "") === want;
          if (!hit) {
            qSkip = true;
            break;
          }
        }
        if (qSkip) continue;
        // Media completeness filter (Complete / Incomplete chips)
        if (
          (completenessQ === "complete" || completenessQ === "incomplete") &&
          v.completeness !== completenessQ
        ) {
          continue;
        }
        list.push({
          id: Number(r.id),
          date,
          month,
          user,
          status: payloadStatus(payload),
          work,
          draft,
          completeness: v.completeness,
          geo_ok: v.geo_ok,
          voice_ok: v.voice_ok,
          photo_ok: v.photo_ok,
          district: String(a.district || "Unknown"),
          party: normParty(String(a.winning_party || "")),
        });
      }

      const byDate: Record<string, Bucket & { date: string }> = {};
      const byMonth: Record<string, Bucket & { month: string }> = {};
      const byUser: Record<string, Bucket & { user: string }> = {};
      const bySurveyorDay: Record<string, Bucket & { surveyor: string; day: string }> = {};
      const bySurveyorMonth: Record<string, Bucket & { surveyor: string; month: string }> = {};
      for (const row of list) {
        if (!byDate[row.date]) byDate[row.date] = { date: row.date, ...emptyBucket() };
        bump(byDate[row.date], row);

        const mk = row.month || row.date.slice(0, 7);
        if (!byMonth[mk]) byMonth[mk] = { month: mk, ...emptyBucket() };
        bump(byMonth[mk], row);

        if (!byUser[row.user]) byUser[row.user] = { user: row.user, ...emptyBucket() };
        bump(byUser[row.user], row);

        // Surveyor daily
        const sdk = `${row.user}::${row.date}`;
        if (!bySurveyorDay[sdk]) {
          bySurveyorDay[sdk] = { surveyor: row.user, day: row.date, ...emptyBucket() };
        }
        bump(bySurveyorDay[sdk], row);

        // Surveyor monthly
        const smk = `${row.user}::${mk}`;
        if (!bySurveyorMonth[smk]) {
          bySurveyorMonth[smk] = { surveyor: row.user, month: mk, ...emptyBucket() };
        }
        bump(bySurveyorMonth[smk], row);
      }

      return json({
        filters: {
          date_from: dateFrom || null,
          date_to: dateTo || null,
          user: userQ || null,
          period,
          day: dayParam || null,
          month: monthParam || null,
          completeness: completenessQ || "all",
        },
        totals: {
          records: list.length,
          // Media
          complete: list.filter((x) => x.completeness === "complete").length,
          incomplete: list.filter((x) => x.completeness === "incomplete").length,
          geo_fail: list.filter((x) => !x.geo_ok).length,
          voice_fail: list.filter((x) => !x.voice_ok).length,
          photo_fail: list.filter((x) => !x.photo_ok).length,
          // Work: completed vs pending (draft never counts completed)
          completed: list.filter((x) => x.work === "completed").length,
          confirmed: list.filter((x) => x.work === "completed").length,
          pending: list.filter((x) => x.work === "pending").length,
          rejected: list.filter((x) => x.work === "rejected").length,
          draft: list.filter((x) => x.draft).length,
          // Raw status (debug / advanced)
          status_confirmed: list.filter((x) => x.status === "confirmed").length,
          status_pending: list.filter((x) => x.status === "pending").length,
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
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      const id = Number(path.split("/")[3]);
      const scopeKeys = await adminFormKeyScope(sql, me);
      const rows = scopeKeys
        ? await sql`
            SELECT id, payload, created_at FROM submissions
            WHERE id = ${id} AND payload->>'form_key' = ANY(${scopeKeys})
          `
        : await sql`
            SELECT id, payload, created_at FROM submissions WHERE id = ${id}
          `;
      if (!rows.length) return json({ error: "Not found" }, 404);
      const r = rows[0] as { id: number; payload: unknown; created_at: string };
      const payload = parsePayload(r.payload);
      const answers = (payload.answers || {}) as Record<string, unknown>;
      const mediaKinds = (
        await sql`SELECT kind FROM survey_media WHERE submission_id = ${id}`.catch(() => [])
      ).map((m) => String((m as { kind?: string }).kind || "").toLowerCase());
      if (mediaKinds.includes("audio")) payload.has_audio = true;
      if (mediaKinds.includes("photo")) payload.has_photo = true;
      const verify = verifySubmission(payload, mediaKinds, voiceRequiredOf(payload));
      const surveyor = surveyorNameOf(payload);
      return json({
        id: r.id,
        created_at: r.created_at,
        status: payloadStatus(payload),
        completeness: verify.completeness,
        verification: verify,
        legacy: !!verify.legacy,
        submitted_by: surveyor === "unknown" ? "" : surveyor,
        user_id: payload.user_id ?? null,
        source: payload.source || "app",
        form_id: payload.form_id || "",
        geo: payload.geo || verify.geo || null,
        has_audio: verify.voice_ok && !verify.legacy ? true : !!payload.has_audio,
        has_photo: verify.photo_ok && !verify.legacy ? true : !!payload.has_photo,
        answers,
        qa: qaFromAnswers(answers),
        edit_history: Array.isArray(payload.edit_history)
          ? payload.edit_history
          : [],
        confirmed_at: payload.confirmed_at || null,
        confirmed_by: payload.confirmed_by || null,
        proof_validated: payload.proof_validated || null,
      });
    }

    // Client Admin: EDIT survey data (answers, surveyor, geo, status)
    if (path.match(/^\/api\/submissions\/\d+$/) && method === "PATCH") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      if (!hasPower(me, "can_review_data")) {
        return json({
          error: "Super Admin has not granted your account data-verification rights",
        }, 403);
      }
      const id = Number(path.split("/")[3]);
      const body = await readBody(req);
      const scopeKeys = await adminFormKeyScope(sql, me);
      const rows = scopeKeys
        ? await sql`SELECT id, payload FROM submissions WHERE id = ${id} AND payload->>'form_key' = ANY(${scopeKeys})`
        : await sql`SELECT id, payload FROM submissions WHERE id = ${id}`;
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
      ).map((m) => String((m as { kind?: string }).kind || "").toLowerCase());
      if (mediaKinds.includes("audio")) payload.has_audio = true;
      if (mediaKinds.includes("photo")) payload.has_photo = true;

      const verify = verifySubmission(payload, mediaKinds, voiceRequiredOf(payload));
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
        if (next === "confirmed") payload = translateGeoEnglish(payload);
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

      // Fact layer: keep facts in sync when status is edited from the edit screen
      // (guard mirrors the status-change block above — empty status must not touch facts)
      if (body.status != null && String(body.status).trim()) {
        const s2 = String(body.status).toLowerCase().trim();
        if (s2 === "confirmed") {
          try {
            await materializeFact(sql, id);
          } catch (e) {
            await markFactFailed(sql, id, e);
          }
        } else {
          await sql`DELETE FROM record_facts WHERE submission_id = ${id}`.catch(() => null);
          await sql`UPDATE submissions SET fact_status = NULL, fact_error = NULL WHERE id = ${id}`.catch(() => null);
        }
      }

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

    // Client Admin / Super Admin: DELETE survey record
    if (path.match(/^\/api\/submissions\/\d+$/) && method === "DELETE") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      if (!hasPower(me, "can_review_data")) {
        return json({
          error: "Super Admin has not granted your account data-verification rights",
        }, 403);
      }
      const id = Number(path.split("/")[3]);
      const scopeKeys = await adminFormKeyScope(sql, me);
      const rows = scopeKeys
        ? await sql`SELECT id FROM submissions WHERE id = ${id} AND payload->>'form_key' = ANY(${scopeKeys})`
        : await sql`SELECT id FROM submissions WHERE id = ${id}`;
      if (!rows.length) return json({ error: "Not found" }, 404);
      // Older DBs may lack ON DELETE CASCADE on record_facts — delete children first
      // or Client Admin Analyze/Overview keeps showing the row after Super Admin delete.
      await sql`DELETE FROM record_facts WHERE submission_id = ${id}`.catch(() => null);
      await sql`DELETE FROM survey_media WHERE submission_id = ${id}`.catch(() => null);
      await sql`UPDATE survey_respondents SET submission_id = NULL WHERE submission_id = ${id}`.catch(() => null);
      await sql`DELETE FROM submissions WHERE id = ${id}`;
      logAudit(me, "submission_delete", "submission", id, {});
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
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      if (!hasPower(me, "can_review_data")) {
        return json({
          error: "Super Admin has not granted your account data-verification rights",
        }, 403);
      }
      const id = Number(path.split("/")[3]);
      const body = await readBody(req);
      const next = String(body.status || "").toLowerCase();
      const force = body.force === true;
      if (!["confirmed", "rejected", "pending"].includes(next)) {
        return json({ error: "status must be confirmed | rejected | pending" }, 400);
      }
      const scopeKeys = await adminFormKeyScope(sql, me);
      const rows = scopeKeys
        ? await sql`SELECT id, payload FROM submissions WHERE id = ${id} AND payload->>'form_key' = ANY(${scopeKeys})`
        : await sql`SELECT id, payload FROM submissions WHERE id = ${id}`;
      if (!rows.length) return json({ error: "Not found" }, 404);
      let payload = parsePayload(rows[0].payload);
      const mediaKinds = (
        await sql`SELECT kind FROM survey_media WHERE submission_id = ${id}`.catch(() => [])
      ).map((m) => String((m as { kind?: string }).kind || "").toLowerCase());
      if (mediaKinds.includes("audio")) payload.has_audio = true;
      if (mediaKinds.includes("photo")) payload.has_photo = true;
      const verify = verifySubmission(payload, mediaKinds, voiceRequiredOf(payload));

      if (next === "confirmed" && verify.completeness !== "complete" && !force) {
        return json({
          error: "Strict verification failed — cannot confirm incomplete record",
          completeness: "incomplete",
          verification: verify,
          hint: "Needs valid geo tag + voice (audio) + photo + Q/A. Pass force:true only if Client Admin overrides.",
        }, 422);
      }

      if (next === "confirmed") payload = translateGeoEnglish(payload);

      // Confirming a final survey clears draft tags so it counts as completed work
      if (next === "confirmed") {
        payload.draft = false;
        const ans = { ...((payload.answers || {}) as Record<string, unknown>) };
        delete ans._draft;
        delete ans.draft;
        payload.answers = ans;
      }

      payload = {
        ...payload,
        status: next,
        completeness: verify.completeness,
        verification: verify,
        has_audio: verify.voice_ok ? true : payload.has_audio,
        has_photo: verify.photo_ok ? true : payload.has_photo,
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

      // Fact layer: confirmed → materialize (idempotent); pending/rejected → never in analytics
      if (next === "confirmed") {
        try {
          await materializeFact(sql, id);
        } catch (e) {
          await markFactFailed(sql, id, e);
        }
      } else {
        await sql`DELETE FROM record_facts WHERE submission_id = ${id}`.catch(() => null);
        await sql`UPDATE submissions SET fact_status = NULL, fact_error = NULL WHERE id = ${id}`.catch(() => null);
      }

      logAudit(me, "submission_status", "submission", id, { status: next, force });
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
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      if (!hasPower(me, "can_review_data")) {
        return json({
          error: "Super Admin has not granted your account data-verification rights",
        }, 403);
      }
      const body = await readBody(req);
      const max = Math.min(Number(body.limit) || 500, 2000);
      const scopeKeys = await adminFormKeyScope(sql, me);
      const rows = scopeKeys
        ? await sql`
            SELECT id, payload FROM submissions
            WHERE payload->>'form_key' = ANY(${scopeKeys})
            ORDER BY created_at DESC LIMIT ${max}
          `
        : await sql`
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
        payload = translateGeoEnglish(payload);

        // FIX: Strip draft flags before confirming, mirroring single-confirm logic
        payload.draft = false;
        const ans = { ...((payload.answers || {}) as Record<string, unknown>) };
        delete ans._draft;
        delete ans.draft;
        payload.answers = ans;

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
        try {
          await materializeFact(sql, r.id);
        } catch (e) {
          await markFactFailed(sql, r.id, e);
        }
        n += 1;
      }
      return json({ ok: true, confirmed: n });
    }

    // Client Admin: retry fact materialization for a failed record (FR-PRC-04)
    if (path.match(/^\/api\/submissions\/\d+\/retry-fact$/) && method === "POST") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      const id = Number(path.split("/")[3]);
      const scopeKeys = await adminFormKeyScope(sql, me);
      const row = scopeKeys
        ? await sql`SELECT id FROM submissions WHERE id = ${id} AND payload->>'form_key' = ANY(${scopeKeys})`
        : await sql`SELECT id FROM submissions WHERE id = ${id}`;
      if (!row.length) return json({ error: "Not found" }, 404);
      try {
        const res = await materializeFact(sql, id);
        return json({ ok: true, ...res, status: "materialized" });
      } catch (e) {
        await markFactFailed(sql, id, e);
        return json({
          ok: false,
          error: "Fact materialization failed",
          detail: String((e as Error)?.message || e),
        }, 422);
      }
    }

    // ── Surveys (multi-survey: name + own questions + team + respondents) ────
    if (path === "/api/surveys" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      const q = (url.searchParams.get("q") || "").trim().toLowerCase();
      // Super Admin: all projects.
      // Client Admin: own surveys + explicit shares only — no company
      // predicate (see SCHEMA.md: company is a display label, never a
      // live access check).
      let rows: Record<string, unknown>[] = [];
      try {
        rows = (me.role === "super_admin"
          ? (q
              ? await sql`SELECT id, form_key, title, display_lang, CASE WHEN jsonb_typeof(questions) = 'array' THEN jsonb_array_length(questions) ELSE 0 END::int AS question_count, updated_at, created_by, company_name, COALESCE(voice_required, FALSE) AS voice_required, COALESCE(voice_time_limit, 0) AS voice_time_limit FROM survey_form WHERE LOWER(title) LIKE ${'%' + q + '%'} ORDER BY title`
              : await sql`SELECT id, form_key, title, display_lang, CASE WHEN jsonb_typeof(questions) = 'array' THEN jsonb_array_length(questions) ELSE 0 END::int AS question_count, updated_at, created_by, company_name, COALESCE(voice_required, FALSE) AS voice_required, COALESCE(voice_time_limit, 0) AS voice_time_limit FROM survey_form ORDER BY title`)
          : (q
                ? await sql`
                    SELECT id, form_key, title, display_lang, CASE WHEN jsonb_typeof(questions) = 'array' THEN jsonb_array_length(questions) ELSE 0 END::int AS question_count, updated_at, created_by, company_name, COALESCE(voice_required, FALSE) AS voice_required, COALESCE(voice_time_limit, 0) AS voice_time_limit FROM survey_form
                    WHERE (created_by = ${me.id} OR id IN (SELECT survey_id FROM survey_admin_access WHERE admin_id = ${me.id}))
                      AND LOWER(title) LIKE ${'%' + q + '%'}
                    ORDER BY title
                  `
                : await sql`
                    SELECT id, form_key, title, display_lang, CASE WHEN jsonb_typeof(questions) = 'array' THEN jsonb_array_length(questions) ELSE 0 END::int AS question_count, updated_at, created_by, company_name, COALESCE(voice_required, FALSE) AS voice_required, COALESCE(voice_time_limit, 0) AS voice_time_limit FROM survey_form
                    WHERE created_by = ${me.id} OR id IN (SELECT survey_id FROM survey_admin_access WHERE admin_id = ${me.id})
                    ORDER BY title
                  `)) as Record<string, unknown>[];
      } catch {
        const fallback = me.role === "super_admin"
          ? await sql`SELECT id, form_key, title, questions, updated_at, created_by, company_name FROM survey_form ORDER BY title`.catch(() => [])
          : await sql`
              SELECT id, form_key, title, questions, updated_at, created_by, company_name FROM survey_form
              WHERE created_by = ${me.id} OR id IN (SELECT survey_id FROM survey_admin_access WHERE admin_id = ${me.id})
              ORDER BY title
            `.catch(() => []);
        rows = (fallback as Record<string, unknown>[]).map((r) => ({
          ...r,
          question_count: parseQuestionsArray(r.questions).length,
        }));
      }

      // Project → Client Admin connections for the Super Admin project list.
      const adminAccess = await sql`
        SELECT saa.survey_id, u.id, u.username, COALESCE(u.display_name, u.username) AS name,
               u.company_name
        FROM survey_admin_access saa JOIN app_users u ON u.id = saa.admin_id
        ORDER BY u.username
      `.catch(() => []);
      const adminAccessMap = new Map<number, { id: number; username: string; name: string; company_name: string | null }[]>();
      for (const a of adminAccess as { survey_id: number; id: number; username: string; name: string; company_name: string | null }[]) {
        const arr = adminAccessMap.get(Number(a.survey_id)) || [];
        arr.push({ id: Number(a.id), username: a.username, name: a.name, company_name: a.company_name || null });
        adminAccessMap.set(Number(a.survey_id), arr);
      }
      const adminRows = await sql`
        SELECT id, COALESCE(display_name, username) AS name, company_name, role FROM app_users WHERE role = 'admin'
      `.catch(() => []);
      const adminById = new Map<number, { name: string; company_name: string | null; role: string }>();
      for (const a of adminRows as { id: number; name: string; company_name: string | null; role: string }[]) {
        adminById.set(Number(a.id), { name: String(a.name), company_name: a.company_name || null, role: String(a.role || 'admin') });
      }
      const asg = await sql`
        SELECT a.survey_id, COUNT(*)::int AS n,
               ARRAY_AGG(DISTINCT COALESCE(u.display_name, u.username)) AS names
        FROM survey_assignments a
        JOIN app_users u ON a.user_id = u.id
        GROUP BY a.survey_id
      `.catch(async () =>
        await sql`
          SELECT survey_id, COUNT(*)::int AS n, NULL AS names
          FROM survey_assignments GROUP BY survey_id
        `.catch(() => [])
      );
      const rsp = await sql`
        SELECT survey_id, COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE status = 'done')::int AS done
        FROM survey_respondents GROUP BY survey_id
      `.catch(() => []);

      // Fast indexed submissions count
      const sub = await sql`
        SELECT survey_id, COUNT(*)::int AS n FROM submissions WHERE survey_id IS NOT NULL GROUP BY survey_id
      `.catch(() => []);
      const subByFk = await sql`
        SELECT payload->>'form_key' AS fk, COUNT(*)::int AS n FROM submissions WHERE survey_id IS NULL AND payload->>'form_key' IS NOT NULL GROUP BY payload->>'form_key'
      `.catch(() => []);

      const asgMap = new Map((asg as any[]).map((r) => [Number(r.survey_id), r]));
      const rspMap = new Map((rsp as any[]).map((r) => [Number(r.survey_id), r]));
      const subMap = new Map((sub as any[]).map((r) => [Number(r.survey_id), Number(r.n)]));
      const subByFkMap = new Map((subByFk as any[]).map((r) => [String(r.fk), Number(r.n)]));

      const items = (rows as Record<string, unknown>[])
        // Client Admin never sees platform seed forms (Field Survey / Legacy)
        .filter((r) => {
          if (me.role === "super_admin") return true;
          const fk = String(r.form_key || "");
          return fk !== "default" && fk !== "legacy";
        })
        .map((r) => {
        const qCount = Number(r.question_count || 0);
        const asgData = asgMap.get(Number(r.id)) as { n?: number; names?: string[] } | undefined;
        const names = Array.isArray(asgData?.names) ? asgData.names.filter(Boolean) : [];
        const connectedAdmins = adminAccessMap.get(Number(r.id)) || [];
        const ownerId = r.created_by != null ? Number(r.created_by) : null;
        const owner = ownerId != null ? adminById.get(ownerId) : undefined;
        // Only include owner if owner is a Client Admin (role === 'admin')
        const admins = (owner && owner.role === 'admin' && !connectedAdmins.some((a) => a.id === ownerId))
          ? [{ id: ownerId, username: '', name: owner.name, company_name: owner.company_name }, ...connectedAdmins]
          : connectedAdmins;
        const subCount = subMap.get(Number(r.id)) || subByFkMap.get(String(r.form_key)) || 0;
        return {
          id: r.id,
          form_key: r.form_key,
          title: r.title,
          display_lang: surveyDisplayLang((r as { display_lang?: unknown }).display_lang),
          voice_required: r.voice_required === true,
          voice_time_limit: Number(r.voice_time_limit) || 0,
          company_name: r.company_name || null,
          owner_company: owner?.company_name ?? null,
          owner_name: owner?.name ?? null,
          question_count: qCount,
          updated_at: r.updated_at,
          surveyors: asgData?.n || 0,
          surveyor_names: names.join(", ") || "",
          admin_count: admins.length,
          admin_names: admins.map((a) => `${a.company_name || 'No company'} · ${a.name}`).join(", "),
          respondents_total: (rspMap.get(Number(r.id)) as any)?.total || 0,
          respondents_done: (rspMap.get(Number(r.id)) as any)?.done || 0,
          submissions: subCount,
        };
      });
      return json({ items, count: items.length });
    }

    if (path === "/api/surveys" && method === "POST") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      // Super Admin creates Projects; Client Admin creates Surveys (needs Create surveys power)
      if (me.role !== "super_admin" && !hasPower(me, "can_crud_questionnaire")) {
        return json({
          error: "Super Admin has not granted Create surveys on your profile",
        }, 403);
      }
      const body = await readBody(req);
      const title = String(body.title || "").trim();
      if (!title) {
        return json({
          error: me.role === "super_admin" ? "Project name required" : "Survey name required",
        }, 400);
      }
      const questions = stripTeluguUnlessAllowed(
        me,
        Array.isArray(body.questions) ? body.questions : [],
      );
      // Same validation as PUT /api/surveys/:id — reject empty/duplicate
      // question ids before they ever reach the database.
      {
        const seenIds = new Set<string>();
        for (const qq of questions as Record<string, unknown>[]) {
          const qid = String((qq as { id?: unknown })?.id || "").trim();
          if (!qid) {
            return json({ error: "Every question needs a non-empty id" }, 422);
          }
          if (seenIds.has(qid)) {
            return json({ error: `Duplicate question id "${qid}" — each question needs a unique id` }, 422);
          }
          seenIds.add(qid);
        }
      }
      // Super Admin registers the company this project is mapped under + the Client
      // Admins who are part of it (they get project access; the Super Admin stays owner).
      let companyName: string | null = null;
      let companyId: number | null = null;
      let connectedAdminIds: number[] = [];
      if (me.role === "super_admin") {
        companyName = String(body.company_name || "").trim().slice(0, 160) || null;
        if (companyName && sql) {
          const comp = await ensureCompanyExists(sql, companyName, me.id);
          if (comp) {
            companyName = comp.name;
            companyId = comp.id;
          }
        }
        connectedAdminIds = [...new Set(
          (Array.isArray(body.admin_ids) ? body.admin_ids : [])
            .map(Number)
            .filter((v: number) => Number.isFinite(v)),
        )];
        if (connectedAdminIds.length) {
          const valid = await sql`SELECT id FROM app_users WHERE role = 'admin' AND id = ANY(${connectedAdminIds})`.catch(() => []);
          const validIds = new Set((valid as { id: number }[]).map((r) => Number(r.id)));
          if (validIds.size !== connectedAdminIds.length) {
            return json({ error: "Only Client Admin accounts can be connected" }, 422);
          }
        }
      } else {
        companyName = (me as Record<string, unknown>).company_name
          ? String((me as Record<string, unknown>).company_name).trim().slice(0, 160)
          : null;
        if ((me as Record<string, unknown>).company_id != null) {
          companyId = Number((me as Record<string, unknown>).company_id);
        }
        if (companyName && sql) {
          const comp = await ensureCompanyExists(sql, companyName, me.id);
          if (comp) {
            companyName = comp.name;
            companyId = comp.id;
          }
        }
      }
      // Super-Admin-set per-survey question cap for this Client Admin (0 = unlimited)
      const maxQsCreate = Number((me as Record<string, unknown>).max_questions_per_survey) || 0;
      if (maxQsCreate > 0 && questions.length > maxQsCreate) {
        return json({
          error: `Survey question cap exceeded — maximum ${maxQsCreate} questions per survey (set by Super Admin)`,
        }, 422);
      }
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
      // Super-Admin-set cap on how many surveys this Client Admin may create (0 = unlimited)
      const maxSvCreate = Number((me as Record<string, unknown>).max_surveys) || 0;
      if (maxSvCreate > 0) {
        const mine = await sql`SELECT COUNT(*)::int AS n FROM survey_form WHERE created_by = ${me.id}`.catch(() => [{ n: 0 }]);
        const createdCount = Number((mine[0] as { n?: number })?.n || 0);
        if (createdCount >= maxSvCreate) {
          return json({
            error: `Survey limit reached — maximum ${maxSvCreate} surveys (set by Super Admin). Delete or edit an existing survey first.`,
          }, 422);
        }
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
        INSERT INTO survey_form (form_key, title, questions, updated_at, created_by, company_name, company_id, voice_required, voice_time_limit)
        VALUES (
          ${formKey}, ${title}, ${JSON.stringify(questions)}::jsonb, NOW(), ${me.id}, ${companyName}, ${companyId},
          ${hasPower(me, "can_record_voice") && body.voice_required === true},
          ${me.role === "super_admin" ? Math.max(0, Math.min(60, Number(body.voice_time_limit) || 0)) : 0}
        )
        RETURNING id, form_key, title, updated_at
      `;
      const surveyId = (rows[0] as { id?: unknown }).id;
      // Super Admin project: grant every Client Admin in that company + any extra admin_ids.
      // Company-mapped projects must show up for all Client Admins of that company.
      if (me.role === "super_admin") {
        const grantIds = new Set<number>(connectedAdminIds);
        if (companyName) {
          const companyAdmins = await sql`
            SELECT id FROM app_users
            WHERE role = 'admin' AND active = TRUE
              AND (
                LOWER(TRIM(COALESCE(company_name, ''))) = LOWER(${companyName})
                OR company_id = (SELECT id FROM companies WHERE LOWER(TRIM(name)) = LOWER(${companyName}) LIMIT 1)
              )
          `.catch(() => []);
          for (const a of companyAdmins as { id: number }[]) {
            grantIds.add(Number(a.id));
          }
        }
        for (const adminId of grantIds) {
          if (!Number.isFinite(adminId)) continue;
          await sql`
            INSERT INTO survey_admin_access (survey_id, admin_id)
            VALUES (${surveyId}, ${adminId})
            ON CONFLICT DO NOTHING
          `.catch(() => null);
        }
        connectedAdminIds = [...grantIds];
      }
      // Client Admin: auto-assign all of their surveyors to the new survey so it
      // appears immediately in the field app (surveyors load via /api/my-surveys).
      let autoAssigned = 0;
      if (me.role === "admin" && surveyId != null) {
        const team = await sql`
          SELECT id FROM app_users
          WHERE role = 'surveyor' AND created_by = ${me.id} AND COALESCE(active, TRUE) = TRUE
        `.catch(() => []);
        for (const t of team as { id: number }[]) {
          const uid = Number(t.id);
          if (!Number.isFinite(uid)) continue;
          if (await upsertSurveyAssignment(Number(surveyId), uid)) autoAssigned += 1;
        }
      }
      logAudit(me, "survey_create", "survey", surveyId, {
        title,
        form_key: formKey,
        questions: questions.length,
        company_name: companyName,
        admin_ids: connectedAdminIds,
        auto_assigned_surveyors: autoAssigned,
      });
      return json({
        ok: true,
        survey: rows[0],
        auto_assigned_surveyors: autoAssigned,
      }, 201);
    }

    if (path.match(/^\/api\/surveys\/\d+$/) && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      const id = Number(path.split("/")[3]);
      // Client Admin: own survey or explicit share only — no company
      // predicate (see SCHEMA.md).
      let rows = me.role === "super_admin"
        ? await sql`SELECT id, form_key, title, display_lang, questions, updated_at, created_by, company_name, COALESCE(voice_required, FALSE) AS voice_required, COALESCE(voice_time_limit, 0) AS voice_time_limit FROM survey_form WHERE id = ${id}`.catch(() => null)
        : await sql`
              SELECT id, form_key, title, display_lang, questions, updated_at, created_by, company_name, COALESCE(voice_required, FALSE) AS voice_required, COALESCE(voice_time_limit, 0) AS voice_time_limit FROM survey_form
              WHERE id = ${id} AND (
                created_by = ${me.id}
                OR id IN (SELECT survey_id FROM survey_admin_access WHERE admin_id = ${me.id})
              )
            `.catch(() => null);
      if (!rows) {
        rows = me.role === "super_admin"
          ? await sql`SELECT id, form_key, title, questions, updated_at, created_by, company_name FROM survey_form WHERE id = ${id}`
          : await sql`
                SELECT id, form_key, title, questions, updated_at, created_by, company_name FROM survey_form
                WHERE id = ${id} AND (
                  created_by = ${me.id}
                  OR id IN (SELECT survey_id FROM survey_admin_access WHERE admin_id = ${me.id})
                )
              `;
      }
      if (!rows.length) return json({ error: "Not found or not your survey" }, 404);
      const r = rows[0] as { id: number; form_key: string; title: string; display_lang?: string; questions: unknown; updated_at: string; created_by: number | null; company_name: string | null; voice_required?: boolean; voice_time_limit?: number };
      const questions = parseQuestionsArray(r.questions);
      const team = me.role === "super_admin"
        ? await sql`
        SELECT u.id, u.username, u.display_name, u.active
        FROM survey_assignments sa JOIN app_users u ON u.id = sa.user_id
        WHERE sa.survey_id = ${id} ORDER BY u.username
      `.catch(() => [])
        : await sql`
        SELECT u.id, u.username, u.display_name, u.active
        FROM survey_assignments sa JOIN app_users u ON u.id = sa.user_id
        WHERE sa.survey_id = ${id} AND u.created_by = ${me.id} ORDER BY u.username
      `.catch(() => []);
      const respondents = await sql`
        SELECT id, name, phone, status, done_at, submission_id, created_at
        FROM survey_respondents WHERE survey_id = ${id} ORDER BY id DESC
      `.catch(() => []);
      const adminRows = await sql`
        SELECT u.id, u.username, u.display_name, u.company_name
        FROM app_users u
        WHERE u.id = ${r.created_by}
        UNION
        SELECT u.id, u.username, u.display_name, u.company_name
        FROM survey_admin_access saa JOIN app_users u ON u.id = saa.admin_id
        WHERE saa.survey_id = ${id}
        ORDER BY username
      `.catch(() => []);
      const admins = (adminRows as Record<string, unknown>[]).map((a) => ({
        id: a.id, username: a.username, name: a.display_name || a.username,
        company_name: a.company_name || null,
      }));
      const owner = admins.find((a) => Number(a.id) === Number(r.created_by));
      return json({
        survey: {
          id: r.id,
          form_key: r.form_key,
          title: r.title,
          display_lang: surveyDisplayLang(r.display_lang),
          voice_required: r.voice_required === true,
          voice_time_limit: Number(r.voice_time_limit) || 0,
          questions,
          updated_at: r.updated_at,
          surveyors: team,
          respondents,
          owner_id: r.created_by,
          owner: owner ? `${owner.name}${owner.company_name ? ` · ${owner.company_name}` : ""}` : null,
          company_name: r.company_name || null,
          admins,
          admin_count: admins.length,
        },
      });
    }

    // Super Admin connects Client Admin accounts to a project. This endpoint
    // intentionally never touches survey_assignments (the surveyor team).
    if (path.match(/^\/api\/surveys\/\d+\/admins$/) && method === "PUT") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "super_admin") return json({ error: "Super Admin only" }, 403);
      const id = Number(path.split("/")[3]);
      const body = await readBody(req);
      const requestedIds = [...new Set((Array.isArray(body.admin_ids) ? body.admin_ids : [])
        .map(Number).filter((value: number) => Number.isFinite(value)))];
      const project = await sql`SELECT id, created_by FROM survey_form WHERE id = ${id}`.catch(() => []);
      if (!project.length) return json({ error: "Project not found" }, 404);
      const ownerId = Number((project[0] as { created_by?: unknown }).created_by) || null;
      const ids = requestedIds.filter((adminId) => adminId !== ownerId);
      if (ids.length) {
        const valid = await sql`SELECT id FROM app_users WHERE role = 'admin' AND id = ANY(${ids})`.catch(() => []);
        const validIds = new Set((valid as { id: number }[]).map((row) => Number(row.id)));
        if (validIds.size !== ids.length) return json({ error: "Only Client Admin accounts can be connected" }, 422);
      }
      await sql`DELETE FROM survey_admin_access WHERE survey_id = ${id}`;
      for (const adminId of ids) {
        await sql`INSERT INTO survey_admin_access (survey_id, admin_id) VALUES (${id}, ${adminId}) ON CONFLICT DO NOTHING`;
      }
      logAudit(me, "project_client_admins_update", "survey", id, { admin_ids: ids });
      return json({ ok: true, connected: ids.length });
    }

    // ── Companies registry (Super Admin creates companies, adds Client Admins) ──
    if (path === "/api/companies" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "super_admin") return json({ error: "Super Admin only" }, 403);
      const rows = await sql`
        SELECT c.id, c.name, c.created_at, c.created_by,
               COALESCE(u.display_name, u.username) AS created_by_name
        FROM companies c
        LEFT JOIN app_users u ON u.id = c.created_by
        ORDER BY c.name
      `.catch(() => []);
      const memberRows = await sql`
        SELECT u.company_id AS cid, u.id, u.username,
               COALESCE(u.display_name, u.username) AS name
        FROM app_users u
        WHERE u.company_id IS NOT NULL
        ORDER BY u.username
      `.catch(() => []);
      const memberMap = new Map<number, { id: number; username: string; name: string }[]>();
      for (const m of memberRows as { cid: number; id: number; username: string; name: string }[]) {
        const arr = memberMap.get(Number(m.cid)) || [];
        arr.push({ id: Number(m.id), username: String(m.username), name: String(m.name) });
        memberMap.set(Number(m.cid), arr);
      }
      const projectRows = await sql`
        SELECT LOWER(company_name) AS key, COUNT(*)::int AS n
        FROM survey_form
        WHERE company_name IS NOT NULL AND company_name <> ''
        GROUP BY LOWER(company_name)
      `.catch(() => []);
      const projectMap = new Map<string, number>();
      for (const p of projectRows as { key: string; n: number }[]) {
        projectMap.set(String(p.key), Number(p.n));
      }
      const items = (rows as Record<string, unknown>[]).map((c) => ({
        id: c.id,
        name: c.name,
        created_at: c.created_at,
        created_by_name: c.created_by_name || null,
        admins: memberMap.get(Number(c.id)) || [],
        admin_count: (memberMap.get(Number(c.id)) || []).length,
        project_count: projectMap.get(String(c.name).toLowerCase()) || 0,
      }));
      return json({ items, count: items.length });
    }

    if (path === "/api/companies" && method === "POST") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "super_admin") return json({ error: "Super Admin only" }, 403);
      const body = await readBody(req);
      const name = String(body.name || "").trim().slice(0, 160);
      if (!name) return json({ error: "Company name required" }, 400);
      const dup = await sql`SELECT id FROM companies WHERE LOWER(name) = LOWER(${name}) LIMIT 1`.catch(() => []);
      if (dup.length) return json({ error: `Company "${name}" already exists` }, 409);
      let rows;
      try {
        rows = await sql`
          INSERT INTO companies (name, created_by) VALUES (${name}, ${me.id})
          RETURNING id, name, created_at
        `;
      } catch (err) {
        const msg = (err as Error).message || "";
        if (msg.includes("unique") || msg.includes("duplicate")) {
          return json({ error: `Company "${name}" already exists` }, 409);
        }
        return json({ error: msg || "Could not create company" }, 500);
      }
      const c = rows[0] as { id: number; name: string; created_at: string } | undefined;
      if (!c) return json({ error: "Could not create company" }, 500);
      await sql`
        UPDATE app_users
        SET company_id = ${c.id}, company_name = ${c.name}
        WHERE LOWER(company_name) = LOWER(${c.name}) AND (company_id IS NULL OR company_id <> ${c.id})
      `.catch(() => null);
      logAudit(me, "company_create", "company", c.id, { name });
      return json({ company: c }, 201);
    }

    if (path.match(/^\/api\/companies\/\d+$/) && method === "PUT") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "super_admin") return json({ error: "Super Admin only" }, 403);
      const id = Number(path.split("/")[3]);
      const body = await readBody(req);
      const name = String(body.name || "").trim().slice(0, 160);
      if (!name) return json({ error: "Company name required" }, 400);
      const ex = await sql`SELECT id, name FROM companies WHERE id = ${id}`.catch(() => []);
      if (!ex.length) return json({ error: "Company not found" }, 404);
      const oldName = String((ex[0] as { name: string }).name);
      const dup = await sql`SELECT id FROM companies WHERE LOWER(name) = LOWER(${name}) AND id <> ${id} LIMIT 1`.catch(() => []);
      if (dup.length) return json({ error: `Company "${name}" already exists` }, 409);
      await sql`UPDATE companies SET name = ${name} WHERE id = ${id}`;
      // Keep member profiles in sync so the admin list/profile show the new name.
      await sql`UPDATE app_users SET company_name = ${name} WHERE company_id = ${id}`.catch(() => null);
      logAudit(me, "company_rename", "company", id, { from: oldName, to: name });
      return json({ ok: true, name });
    }

    if (path.match(/^\/api\/companies\/\d+$/) && method === "DELETE") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "super_admin") return json({ error: "Super Admin only" }, 403);
      const id = Number(path.split("/")[3]);
      const ex = await sql`SELECT id, name FROM companies WHERE id = ${id}`.catch(() => []);
      if (!ex.length) return json({ error: "Company not found" }, 404);
      const name = String((ex[0] as { name: string }).name);
      // Unlink member Client Admins; keep their profile name only if it differs.
      await sql`
        UPDATE app_users SET company_id = NULL,
          company_name = CASE WHEN company_name = ${name} THEN NULL ELSE company_name END
        WHERE company_id = ${id}
      `.catch(() => null);
      await sql`DELETE FROM companies WHERE id = ${id}`;
      logAudit(me, "company_delete", "company", id, { name });
      return json({ ok: true, deleted: true });
    }

    // Replace which Client Admins belong to a company (they become "part of it").
    if (path.match(/^\/api\/companies\/\d+\/admins$/) && method === "PUT") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "super_admin") return json({ error: "Super Admin only" }, 403);
      const id = Number(path.split("/")[3]);
      const body = await readBody(req);
      const company = await sql`SELECT id, name FROM companies WHERE id = ${id}`.catch(() => []);
      if (!company.length) return json({ error: "Company not found" }, 404);
      const companyName = String((company[0] as { name: string }).name);
      const requestedIds = [...new Set((Array.isArray(body.admin_ids) ? body.admin_ids : [])
        .map(Number)
        .filter((v: number) => Number.isFinite(v)))];
      if (requestedIds.length) {
        const valid = await sql`SELECT id FROM app_users WHERE role = 'admin' AND id = ANY(${requestedIds})`.catch(() => []);
        const validIds = new Set((valid as { id: number }[]).map((r) => Number(r.id)));
        if (validIds.size !== requestedIds.length) {
          return json({ error: "Only Client Admin accounts can be added to a company" }, 422);
        }
      }
      // Unlink everyone, then link the requested set (company_name stays in sync).
      await sql`
        UPDATE app_users SET company_id = NULL,
          company_name = CASE WHEN company_name = ${companyName} THEN NULL ELSE company_name END
        WHERE company_id = ${id}
      `.catch(() => null);
      if (requestedIds.length) {
        await sql`
          UPDATE app_users SET company_id = ${id}, company_name = ${companyName}
          WHERE id = ANY(${requestedIds})
        `.catch(() => null);
      }
      logAudit(me, "company_admins_update", "company", id, { admin_ids: requestedIds });
      return json({ ok: true, connected: requestedIds.length });
    }

    // ── Company Client Dashboard API ───────────────────────
    if (path.match(/^\/api\/companies\/([^/]+)\/dashboard$/) && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "super_admin") return json({ error: "Super Admin only" }, 403);

      const rawParam = decodeURIComponent(path.split("/")[3]);
      let company: { id: number; name: string; created_at: string } | undefined;

      if (/^\d+$/.test(rawParam)) {
        const rows = await sql`SELECT id, name, created_at FROM companies WHERE id = ${Number(rawParam)}`.catch(() => []);
        if (rows.length) company = rows[0] as { id: number; name: string; created_at: string };
      }
      if (!company) {
        const rows = await sql`SELECT id, name, created_at FROM companies WHERE LOWER(name) = LOWER(${rawParam}) LIMIT 1`.catch(() => []);
        if (rows.length) company = rows[0] as { id: number; name: string; created_at: string };
      }
      if (!company) {
        company = { id: 0, name: rawParam, created_at: new Date().toISOString() };
      }

      const companyId = Number(company.id);
      const companyName = String(company.name);

      // 1. Client Admins
      const admins = await sql`
        SELECT id, username, COALESCE(display_name, username) AS name, company_name, created_at, verified, active
        FROM app_users
        WHERE role = 'admin' AND (company_id = ${companyId} OR LOWER(company_name) = LOWER(${companyName}))
        ORDER BY username
      `.catch(() => []);

      const adminIds = (admins as { id: number }[]).map((a) => Number(a.id));

      // 2. Surveys / Projects under this company
      const surveyRows = await sql`
        SELECT DISTINCT s.id, s.form_key, s.title, s.questions, s.updated_at, s.created_by, s.company_name
        FROM survey_form s
        LEFT JOIN survey_admin_access a ON a.survey_id = s.id
        WHERE LOWER(s.company_name) = LOWER(${companyName})
           OR (cardinality(${adminIds}) > 0 AND (s.created_by = ANY(${adminIds}) OR a.admin_id = ANY(${adminIds})))
        ORDER BY s.title
      `.catch(() => []);

      const surveyIds = (surveyRows as { id: number }[]).map((s) => Number(s.id));

      // 3. Surveyors mapped to these projects / created by company's client admins
      const surveyors = await sql`
        SELECT DISTINCT u.id, u.username, COALESCE(u.display_name, u.username) AS name,
               u.phone, u.active, u.created_at, u.verified, u.target_quota,
               (SELECT COUNT(*)::int FROM submissions sub WHERE (sub.payload->>'submitted_by' = u.username OR sub.payload->>'surveyor_id' = u.id::text)) AS submission_count
        FROM app_users u
        LEFT JOIN survey_assignments sa ON sa.user_id = u.id
        WHERE (u.role IN ('surveyor', 'field'))
          AND (
            (cardinality(${adminIds}) > 0 AND u.created_by = ANY(${adminIds}))
            OR (cardinality(${surveyIds}) > 0 AND sa.survey_id = ANY(${surveyIds}))
          )
        ORDER BY u.username
      `.catch(() => []);

      // 4. Submissions & Geo Location Data
      const submissions = surveyIds.length
        ? await sql`
            SELECT id, survey_id, created_at, fact_status,
                   payload->>'submitted_by' AS submitted_by,
                   payload->'geo' AS geo,
                   payload->'answers'->>'district' AS district,
                   payload->'answers'->>'constituency' AS constituency,
                   payload->'answers' AS answers,
                   payload->>'latitude' AS latitude,
                   payload->>'longitude' AS longitude
            FROM submissions
            WHERE survey_id = ANY(${surveyIds})
            ORDER BY created_at DESC
            LIMIT 500
          `.catch(() => [])
        : [];

      let totalQuestions = 0;
      const projectsFormatted = (surveyRows as Record<string, unknown>[]).map((s) => {
        let qList: unknown[] = [];
        try {
          qList = typeof s.questions === "string" ? JSON.parse(s.questions) : (Array.isArray(s.questions) ? s.questions : []);
        } catch { qList = []; }
        totalQuestions += qList.length;
        return {
          id: Number(s.id),
          form_key: String(s.form_key || ""),
          title: String(s.title || ""),
          question_count: qList.length,
          questions: qList,
          updated_at: s.updated_at,
          created_by: s.created_by,
          company_name: s.company_name,
        };
      });

      const locations: Record<string, unknown>[] = [];
      const surveyTitleMap = new Map<number, string>();
      for (const p of projectsFormatted) {
        surveyTitleMap.set(p.id, p.title);
      }

      let confirmedCount = 0;
      let pendingCount = 0;

      for (const sub of submissions as Record<string, unknown>[]) {
        if (sub.fact_status === "materialized" || sub.fact_status === "confirmed") {
          confirmedCount++;
        } else {
          pendingCount++;
        }

        let lat: number | null = null;
        let lng: number | null = null;

        if (sub.latitude && sub.longitude) {
          lat = Number(sub.latitude);
          lng = Number(sub.longitude);
        } else if (sub.geo && typeof sub.geo === "object") {
          const g = sub.geo as Record<string, unknown>;
          lat = Number(g.lat || g.latitude);
          lng = Number(g.lng || g.longitude);
        } else if (sub.answers && typeof sub.answers === "object") {
          const a = sub.answers as Record<string, unknown>;
          if (a.latitude && a.longitude) {
            lat = Number(a.latitude);
            lng = Number(a.longitude);
          }
        }

        if (lat && lng && !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
          locations.push({
            id: Number(sub.id),
            survey_id: Number(sub.survey_id),
            survey_title: surveyTitleMap.get(Number(sub.survey_id)) || "Survey",
            lat,
            lng,
            submitted_by: sub.submitted_by || "Surveyor",
            district: sub.district || null,
            constituency: sub.constituency || null,
            created_at: sub.created_at,
          });
        }
      }

      return json({
        company: {
          id: companyId,
          name: companyName,
          created_at: company.created_at,
        },
        summary: {
          total_admins: (admins as unknown[]).length,
          total_projects: projectsFormatted.length,
          total_questions: totalQuestions,
          total_surveyors: (surveyors as unknown[]).length,
          total_submissions: (submissions as unknown[]).length,
          total_locations: locations.length,
          confirmed_qa: confirmedCount,
          pending_qa: pendingCount,
        },
        admins,
        projects: projectsFormatted,
        surveyors,
        locations,
        qa_stats: {
          confirmed: confirmedCount,
          pending: pendingCount,
          total: (submissions as unknown[]).length,
        },
      });
    }

    if (path.match(/^\/api\/surveys\/\d+$/) && method === "PUT") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      if (!hasPower(me, "can_crud_questionnaire") && !hasPower(me, "can_edit_surveys")) {
        return json({
          error: "Super Admin has not granted your account questionnaire-editing rights",
        }, 403);
      }
      const id = Number(path.split("/")[3]);
      const body = await readBody(req);
      // Connected Client Admins may edit the project, while only the owner (or
      // Super Admin) can delete it.
      const rows = me.role === "super_admin"
        ? await sql`SELECT id, title FROM survey_form WHERE id = ${id}`
        : await sql`
            SELECT id, title FROM survey_form
            WHERE id = ${id} AND (created_by = ${me.id}
              OR id IN (SELECT survey_id FROM survey_admin_access WHERE admin_id = ${me.id}))
          `;
      if (!rows.length) return json({ error: "Not found or not your survey" }, 404);
      // Super-Admin-set per-survey question cap for this Client Admin (0 = unlimited)
      const maxQsPut = Number((me as Record<string, unknown>).max_questions_per_survey) || 0;
      if (maxQsPut > 0 && Array.isArray(body.questions) && body.questions.length > maxQsPut) {
        return json({
          error: `Survey question cap exceeded — maximum ${maxQsPut} questions per survey (set by Super Admin)`,
        }, 422);
      }
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
        if (body.translate === true && canQuestionCopy(me)) {
          // Auto-fill missing label_te and options_te via Google Translate
          const toTrans: string[] = [];
          for (const q of body.questions as Record<string, unknown>[]) {
            if (q.label && !q.label_te) toTrans.push(String(q.label));
            if (Array.isArray(q.options)) {
              for (const opt of q.options) {
                if (typeof opt === "string" && opt) toTrans.push(opt);
              }
            }
          }
          if (toTrans.length) {
            try {
              const transMap = new Map<string, string>();
              const translated = await googleTranslateToTelugu(toTrans);
              toTrans.forEach((t, i) => transMap.set(t, translated[i] || t));
              for (const q of body.questions as Record<string, unknown>[]) {
                if (q.label && !q.label_te) q.label_te = transMap.get(String(q.label)) || q.label;
                if (Array.isArray(q.options) && (!Array.isArray(q.options_te) || !q.options_te.length)) {
                  q.options_te = q.options.map((opt: unknown) => (typeof opt === "string" ? transMap.get(opt) || opt : opt));
                }
              }
            } catch {
              /* ignore translation failures */
            }
          }
        }
        body.questions = stripTeluguUnlessAllowed(me, body.questions);
        // Reject malformed question ids before saving — an empty or
        // duplicate id collapses multiple questions onto one key in every
        // downstream per-question map (filters, chart counts), which can
        // break analytics for the whole survey, not just that question.
        const seenIds = new Set<string>();
        for (const q of body.questions as Record<string, unknown>[]) {
          const qid = String((q as { id?: unknown })?.id || "").trim();
          if (!qid) {
            return json({ error: "Every question needs a non-empty id" }, 422);
          }
          if (seenIds.has(qid)) {
            return json({ error: `Duplicate question id "${qid}" — each question needs a unique id` }, 422);
          }
          seenIds.add(qid);
        }
        await sql`
          UPDATE survey_form SET questions = ${JSON.stringify(body.questions)}::jsonb, updated_at = NOW()
          WHERE id = ${id}
        `;
      }
      if (body.display_lang !== undefined) {
        const displayLang = surveyDisplayLang(body.display_lang);
        await sql`
          UPDATE survey_form SET display_lang = ${displayLang}, updated_at = NOW() WHERE id = ${id}
        `;
      }
      if (body.voice_required !== undefined) {
        if (!hasPower(me, "can_record_voice")) {
          return json({
            error: "Super Admin has not granted Voice recording on your profile",
          }, 403);
        }
        await sql`
          UPDATE survey_form
          SET voice_required = ${body.voice_required === true},
              updated_at = NOW()
          WHERE id = ${id}
        `;
      }
      // Minute auto-stop is Super Admin only. Client Admin may send the field
      // from an older UI — ignore it so survey saves still succeed.
      if (body.voice_time_limit !== undefined && me.role === "super_admin") {
        const voiceLimit = Math.max(0, Math.min(60, Number(body.voice_time_limit) || 0));
        await sql`
          UPDATE survey_form
          SET voice_time_limit = ${voiceLimit},
              updated_at = NOW()
          WHERE id = ${id}
        `;
      }
      // The company a project is mapped under is registered by the Super Admin.
      let nextCompanyName: string | null | undefined;
      if (me.role === "super_admin" && body.company_name !== undefined) {
        nextCompanyName = String(body.company_name || "").trim().slice(0, 160) || null;
        let nextCompanyId: number | null = null;
        if (nextCompanyName && sql) {
          const comp = await ensureCompanyExists(sql, nextCompanyName, me.id);
          if (comp) {
            nextCompanyName = comp.name;
            nextCompanyId = comp.id;
          }
        }
        await sql`
          UPDATE survey_form
          SET company_name = ${nextCompanyName}, company_id = ${nextCompanyId}, updated_at = NOW()
          WHERE id = ${id}
        `;
      }
      logAudit(me, "survey_update", "survey", id, {
        title: title || undefined,
        company_name: nextCompanyName === undefined ? undefined : nextCompanyName,
      });
      return json({ ok: true });
    }

    if (path.match(/^\/api\/surveys\/\d+$/) && method === "DELETE") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      if (!hasPower(me, "can_crud_questionnaire") && !hasPower(me, "can_edit_surveys")) {
        return json({
          error: "Super Admin has not granted your account questionnaire-editing rights",
        }, 403);
      }
      const id = Number(path.split("/")[3]);
      // Only the owner (or Super Admin) may delete — shared access does NOT grant
      // delete rights, so one admin can't remove a survey others rely on.
      const rows = me.role === "super_admin"
        ? await sql`SELECT form_key FROM survey_form WHERE id = ${id}`
        : await sql`SELECT form_key FROM survey_form WHERE id = ${id} AND created_by = ${me.id}`;
      if (!rows.length) return json({ error: "Not found or not your survey" }, 404);
      await sql`DELETE FROM survey_assignments WHERE survey_id = ${id}`.catch(() => null);
      await sql`DELETE FROM survey_respondents WHERE survey_id = ${id}`.catch(() => null);
      await sql`DELETE FROM survey_form WHERE id = ${id}`;
      logAudit(me, "survey_delete", "survey", id, { form_key: (rows[0] as { form_key: string }).form_key });
      return json({ ok: true, deleted: true });
    }

    // Replace the surveyor team for a survey
    if (path.match(/^\/api\/surveys\/\d+\/surveyors$/) && method === "PUT") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      if (me.role === "super_admin") {
        return json({ error: "Super Admin connects Client Admins to projects; surveyors are managed only by the Client Admin." }, 403);
      }
      if (!hasPower(me, "can_assign_surveyors")) {
        return json({ error: "Super Admin has not granted your account surveyor-assignment rights" }, 403);
      }
      const id = Number(path.split("/")[3]);
      const body = await readBody(req);
      const ids = [...new Set((Array.isArray(body.user_ids) ? body.user_ids : [])
        .map(Number)
        .filter((v: number) => Number.isFinite(v)))];
      // A Client Admin maps only their own surveyors to owned or assigned projects.
      const rows = await sql`
        SELECT id FROM survey_form
        WHERE id = ${id} AND (created_by = ${me.id}
          OR id IN (SELECT survey_id FROM survey_admin_access WHERE admin_id = ${me.id}))
      `;
      if (!rows.length) return json({ error: "Not found or not your survey" }, 404);
      // Filter in JS — neon ANY(${ids}) has dropped every id on some deploys,
      // which then DELETE'd the team and inserted nobody.
      const mine = await sql`
        SELECT id FROM app_users
        WHERE created_by = ${me.id} AND role IN ('surveyor', 'field')
      `.catch(() => []);
      const mineSet = new Set((mine as { id: number }[]).map((r) => Number(r.id)));
      const allowed = ids.filter((v) => mineSet.has(v));
      if (ids.length > 0 && allowed.length === 0) {
        return json({
          error: "Only surveyors you created can be added to this survey",
        }, 422);
      }
      // Merge — never DELETE the whole team first. A failed insert used to
      // wipe assignments so the field app could not load this survey.
      const currentRows = await sql`
        SELECT user_id FROM survey_assignments
        WHERE survey_id = ${id} AND user_id IN (
          SELECT id FROM app_users WHERE created_by = ${me.id} AND role IN ('surveyor', 'field')
        )
      `.catch(() => []);
      const current = new Set((currentRows as { user_id: number }[]).map((r) => Number(r.user_id)));
      const next = new Set(allowed);
      for (const uid of current) {
        if (!next.has(uid)) {
          await sql`
            DELETE FROM survey_assignments WHERE survey_id = ${id} AND user_id = ${uid}
          `.catch(() => null);
        }
      }
      const saved: number[] = [...next].filter((uid) => current.has(uid));
      for (const uid of next) {
        if (current.has(uid)) continue;
        if (await upsertSurveyAssignment(id, uid)) saved.push(uid);
      }
      if (next.size > 0 && saved.length === 0) {
        return json({ error: "Could not save surveyor assignments" }, 500);
      }
      return json({ ok: true, assigned: saved.length, user_ids: saved });
    }

    // Assigned surveys for one surveyor (Client Admin profile / field my-surveys twin).
    if (path.match(/^\/api\/users\/\d+\/surveys$/) && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      const userId = Number(path.split("/")[3]);
      if (!Number.isFinite(userId)) return json({ error: "Invalid user id" }, 400);
      if (me.role !== "super_admin") {
        const owned = await sql`
          SELECT id FROM app_users WHERE id = ${userId} AND created_by = ${me.id} LIMIT 1
        `.catch(() => []);
        if (!owned.length) return json({ error: "You can only view surveyors you created" }, 403);
      }
      const items = await listAssignedSurveys(sql, userId);
      return json({
        items: items.map((s) => ({
          id: s.id,
          form_key: s.form_key,
          title: s.title,
          display_lang: s.display_lang,
        })),
        count: items.length,
      });
    }

    // Replace which surveys a surveyor is assigned to (user-centric).
    // Used by Client Admin Surveyors tab — NOT the inverted setSurveySurveyors(surveyId, users).
    if (path.match(/^\/api\/users\/\d+\/surveys$/) && method === "PUT") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      if (me.role === "super_admin") {
        return json({
          error: "Super Admin connects Client Admins to projects; surveyors are managed only by the Client Admin.",
        }, 403);
      }
      if (!hasPower(me, "can_assign_surveyors")) {
        return json({ error: "Super Admin has not granted your account surveyor-assignment rights" }, 403);
      }
      const userId = Number(path.split("/")[3]);
      if (!Number.isFinite(userId)) return json({ error: "Invalid user id" }, 400);
      const body = await readBody(req);
      const surveyIds = (Array.isArray(body.survey_ids) ? body.survey_ids : [])
        .map(Number)
        .filter((v: number) => Number.isFinite(v));
      const addIds = [...new Set((Array.isArray(body.add_survey_ids) ? body.add_survey_ids : [])
        .map(Number)
        .filter((v: number) => Number.isFinite(v)))];
      const removeIds = [...new Set((Array.isArray(body.remove_survey_ids) ? body.remove_survey_ids : [])
        .map(Number)
        .filter((v: number) => Number.isFinite(v)))];
      const incremental = addIds.length > 0 || removeIds.length > 0;

      // Must be a surveyor this Client Admin created
      const userRows = await sql`
        SELECT id, role, created_by FROM app_users WHERE id = ${userId} LIMIT 1
      `.catch(() => []);
      if (!userRows.length) return json({ error: "User not found" }, 404);
      const target = userRows[0] as { id: number; role: string; created_by: number | null };
      if (target.role !== "surveyor" && target.role !== "field") {
        return json({ error: "Only surveyors can be assigned surveys" }, 422);
      }
      if (Number(target.created_by) !== Number(me.id)) {
        return json({ error: "You can only assign surveys to surveyors you created" }, 403);
      }

      // Filter in JS — neon ANY(${ids}) has dropped every id on some deploys,
      // which then DELETE'd this surveyor's surveys and inserted nobody.
      const okSurveys = await sql`
        SELECT id FROM survey_form
        WHERE created_by = ${me.id}
           OR id IN (SELECT survey_id FROM survey_admin_access WHERE admin_id = ${me.id})
      `.catch(() => []);
      const okSet = new Set((okSurveys as { id: number }[]).map((r) => Number(r.id)));
      const allowedSurveyIds = [...new Set(surveyIds.filter((v) => okSet.has(v)))];
      if (!incremental && surveyIds.length > 0 && allowedSurveyIds.length === 0) {
        return json({
          error: "None of those surveys belong to your account",
        }, 422);
      }

      const currentRows = await sql`
        SELECT survey_id FROM survey_assignments
        WHERE user_id = ${userId}
          AND survey_id IN (
            SELECT id FROM survey_form
            WHERE created_by = ${me.id}
               OR id IN (SELECT survey_id FROM survey_admin_access WHERE admin_id = ${me.id})
          )
      `.catch(() => []);
      const current = new Set((currentRows as { survey_id: number }[]).map((r) => Number(r.survey_id)));
      // Incremental add/remove keeps already-assigned surveys (tapping survey 2
      // must not drop survey 1). Full replace still used by Edit / bulk assign.
      const next = new Set(incremental ? current : allowedSurveyIds);
      if (incremental) {
        for (const sid of addIds) if (okSet.has(sid)) next.add(sid);
        for (const sid of removeIds) next.delete(sid);
      }
      for (const sid of current) {
        if (!next.has(sid)) {
          await sql`
            DELETE FROM survey_assignments WHERE survey_id = ${sid} AND user_id = ${userId}
          `.catch(() => null);
        }
      }
      const saved: number[] = [...next].filter((sid) => current.has(sid));
      for (const sid of next) {
        if (current.has(sid)) continue;
        if (await upsertSurveyAssignment(sid, userId)) saved.push(sid);
      }
      if (next.size > 0 && saved.length === 0) {
        return json({ error: "Could not save survey assignments" }, 500);
      }
      return json({ ok: true, assigned: saved.length, survey_ids: saved });
    }

    // Surveyor view: surveys assigned to me (with their questions) — field app
    if (path === "/api/my-surveys" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "surveyor" && me.role !== "field" && me.role !== "admin") {
        return json({ error: "Forbidden" }, 403);
      }
      const items = await listAssignedSurveys(sql, Number(me.id));
      return json({ items, count: items.length });
    }


    // ── Dynamic questions (field app loads automatically) ───
    if (path === "/api/questions" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      // Surveyors must get the survey they were assigned (Surveys tab / questions
      // screen), not the platform Field Survey default.
      if (me.role === "surveyor" || me.role === "field") {
        const items = await listAssignedSurveys(sql, Number(me.id));
        const first = items[0];
        if (!first) {
          return json({
            form_key: "",
            title: "No survey assigned",
            questions: [],
            surveys: [],
            updated_at: null,
          });
        }
        return json({
          ...first,
          surveys: items,
          require_geo: true,
          require_photo: true,
          require_audio: first.voice_required === true,
        });
      }
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
          require_audio: false,
          voice_required: false,
        });
      } catch (e) {
        return json({
          form_key: "default",
          title: "Field Survey",
          questions: DEFAULT_QUESTIONS,
          require_geo: true,
          require_photo: true,
          require_audio: false,
          voice_required: false,
          warning: (e as Error).message,
        });
      }
    }

    // Admin saves platform default form (form_key=default / Field Survey).
    // Super Admin console only — Client Admin must edit their own surveys via PUT /api/surveys/:id.
    if (path === "/api/admin/questions" && method === "PUT") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "super_admin") {
        return json({
          error: "Super Admin only — Client Admin cannot edit the platform Field Survey. Edit your own survey under Surveys / Questions.",
        }, 403);
      }
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


    if (path === "/api/web-survey" && method === "POST") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      if (!hasPower(me, "can_web_survey")) {
        return json({
          error: "Super Admin has not granted web survey fill",
        }, 403);
      }
      const body = await readBody(req);
      const answers = (body.answers || {}) as Record<string, unknown>;
      const agent =
        String(body.submitted_by || "").trim() || me.name || me.username;
      const formKey = String(body.form_key || body.form_id || "").trim();
      if (!formKey || formKey === "default" || formKey === "legacy") {
        return json({ error: "Pick a real survey" }, 400);
      }
      if (me.role === "admin") {
        const writeScope = await adminFormKeyScope(sql, me);
        if (writeScope && !writeScope.includes(formKey)) {
          return json({
            error: `You can only submit to your own surveys (${writeScope.length ? writeScope.join(", ") : "none"})`,
          }, 403);
        }
      }
      const payload = {
        form_key: formKey,
        form_id: body.form_id || formKey,
        source: "web-survey",
        submitted_by: agent,
        user_id: me.id,
        user_role: me.role,
        status: "pending",
        geo: null,
        location_details: null,
        locks: { geo: false, web: true },
        has_photo: false,
        has_audio: false,
        answers: stripPii({ ...answers, data_collector: agent }),
        content_type: "qa",
        app_version: body.app_version ? String(body.app_version) : null,
      };
      const rows = await sql`
        INSERT INTO submissions (payload)
        VALUES (${JSON.stringify(payload)}::jsonb)
        RETURNING id, payload, created_at
      `;
      const row = rows[0] as { id: number; created_at: string };
      logAudit(me, "submission_create", "submission", row.id, {
        form_key: formKey,
        source: "web-survey",
      });
      return json({
        ok: true,
        id: row.id,
        form_id: payload.form_id,
        source: "web-survey",
        submitted_by: agent,
        status: "pending",
        created_at: row.created_at,
      }, 201);
    }

    if (path === "/api/submissions" && method === "POST") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role) && me.role !== "surveyor") {
        return json({ error: "Login required as admin, super admin, or surveyor" }, 403);
      }
      const body = await readBody(req);
      const incomingSource = String(body.source || "");
      if (incomingSource === "web-survey" || incomingSource === "web") {
        if (!hasPower(me, "can_web_survey")) {
          return json({
            error: "Super Admin has not granted web survey fill",
          }, 403);
        }
      }
      // Q/A only — media uploaded separately to /api/submissions/:id/media
      const answers = (body.answers || body) as Record<string, unknown>;
      const geo = body.geo || null;
      const agent =
        String(body.submitted_by || "").trim() || me.name || me.username;

      // Super-Admin-set max_records on Client Admin profile (tenant-wide field records)
      if (me.role === "surveyor" || me.role === "admin") {
        let ownerId = Number(me.id);
        let maxRec = Number((me as Record<string, unknown>).max_records) || 0;
        if (me.role === "surveyor") {
          const ownerRows = await sql`
            SELECT id, COALESCE(max_records, 0) AS max_records
            FROM app_users
            WHERE id = (
              SELECT created_by FROM app_users WHERE id = ${me.id} LIMIT 1
            ) AND role = 'admin'
            LIMIT 1
          `.catch(() => []);
          if (ownerRows.length) {
            ownerId = Number((ownerRows[0] as { id: number }).id);
            maxRec = Number((ownerRows[0] as { max_records?: unknown }).max_records) || 0;
          } else {
            maxRec = 0;
          }
        }
        if (maxRec > 0 && Number.isFinite(ownerId)) {
          const [rc] = await sql`
            SELECT COUNT(*)::int AS n
            FROM submissions s JOIN app_users u ON (
              s.payload->>'user_id' = u.id::text
              OR s.payload->>'submitted_by' = u.username
              OR s.payload->>'submitted_by' = COALESCE(u.display_name, u.username)
            )
            WHERE u.role = 'surveyor' AND u.created_by = ${ownerId}
              AND COALESCE(s.payload->>'status', 'pending') <> 'rejected'
              AND COALESCE(s.payload->>'draft', 'false') NOT IN ('true', 't', '1')
          `.catch(() => [{ n: 0 }]);
          const used = sqlCountN(rc);
          if (used >= maxRec) {
            return json({
              error: `Record limit reached — maximum ${maxRec} records for this Client Admin (set by Super Admin).`,
              code: "max_records",
              used,
              max_records: maxRec,
            }, 422);
          }
        }
      }

      // Require geo lock on every field submission. Web-survey fill (power-gated
      // above) is desk entry and has no GPS.
      const isWebFill = incomingSource === "web-survey" || incomingSource === "web";
      if (!isWebFill && (!geo || typeof geo !== "object")) {
        return json({
          error: "GPS lock required — lat/lng missing",
          code: "geo_lock_required",
        }, 422);
      }
      if (!isWebFill) {
        const gLat = Number((geo as Record<string, unknown>).lat ?? (geo as Record<string, unknown>).latitude);
        const gLng = Number((geo as Record<string, unknown>).lng ?? (geo as Record<string, unknown>).longitude);
        if (!Number.isFinite(gLat) || !Number.isFinite(gLng) || (gLat === 0 && gLng === 0)) {
          return json({
            error: "GPS lock invalid",
            code: "geo_lock_invalid",
          }, 422);
        }
      }

      // Reject submission if no actual survey questions were answered
      const answeredKeys = Object.entries(answers || {}).filter(([k, v]) => {
        if (!k || k.startsWith("_") || k.startsWith("geo_") || k.startsWith("location_") || k.startsWith("ts_") || k.startsWith("sec_")) return false;
        if (["draft", "data_collector", "client_package_id", "submitted_by", "has_photo", "has_audio", "photo", "audio", "photo_url", "audio_url", "answer_pattern", "survey_id", "form_id", "form_key"].includes(k)) return false;
        const val = String(v ?? "").trim();
        return val !== "";
      });
      if (answeredKeys.length === 0) {
        return json({
          error: "No questions answered — cannot submit an empty survey record.",
          code: "empty_answers",
        }, 422);
      }

      const recIdxRaw = Number(
        body.record_index ??
          (answers as Record<string, unknown>)?._recordIndex ??
          (answers as Record<string, unknown>)?.recordIndex,
      );
      const recIdx = Number.isFinite(recIdxRaw) && recIdxRaw > 0 ? Math.round(recIdxRaw) : null;
      const payload = stripDraftFlags({
        form_key: body.form_key || "default",
        form_id: body.form_id || `field-${Date.now()}`,
        source: body.source || "mobile-field-survey",
        submitted_by: agent,
        user_id: me.id,
        user_role: me.role,
        status: "pending",
        record_index: recIdx,
        geo: geo,
        location_details: body.location_details || null,
        locks: body.locks || { geo: true },
        voice_required: body.voice_required === true || answers._voice_required === true,
        has_photo: false,
        has_audio: false,
        answers: stripPii({
          ...answers,
          data_collector: agent,
          ...(recIdx != null ? { _recordIndex: recIdx } : {}),
        }),
        // Q/A separated from media blobs
        content_type: "qa",
        // Client app version (pushed from React build)
        app_version: body.app_version ? String(body.app_version) : null,
        app_build: body.app_build ? String(body.app_build) : null,
        app_version_code: body.app_version_code != null
          ? Number(body.app_version_code)
          : null,
      });
      // BR-004 write scope: records may only be written into projects the caller
      // belongs to. Client Admins → own/assigned projects (plus the always-visible
      // legacy/default forms); Surveyors → the surveys they are assigned to (or the
      // shared default form, which the field app uses when no assignment exists).
      if (me.role === "admin") {
        const writeScope = await adminFormKeyScope(sql, me);
        const fk = String(payload.form_key || "default");
        if (writeScope && !writeScope.includes(fk)) {
          return json({
            error: `You can only submit records to your own projects (${writeScope.length ? writeScope.join(", ") : "none"})`,
          }, 403);
        }
      } else if (me.role === "surveyor") {
        const fk = String(payload.form_key || "default");
        if (fk !== "default") {
          const asg = await sql`
            SELECT f.form_key FROM survey_assignments a
            JOIN survey_form f ON f.id = a.survey_id
            WHERE a.user_id = ${me.id} AND f.form_key = ${fk}
            LIMIT 1
          `.catch(() => []);
          if (!asg.length) {
            return json({
              error: "You are not assigned to this survey. Ask your Client Admin for the survey assignment.",
            }, 403);
          }
        }
      }
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
      const row = rows[0] as { id: number; payload: unknown; created_at: string };
      if (me.role === "surveyor") {
        logAudit(me, "submission_create", "submission", row.id, {
          form_key: payload.form_key || null,
        });
      }
      // If package already includes media flags (or later media uploads complete), auto-confirm
      const auto = await autoConfirmIfComplete(sql, Number(row.id)).catch(() => ({
        auto_confirmed: false,
        completeness: "incomplete",
      }));
      return json({
        ok: true,
        id: row.id,
        form_id: payload.form_id,
        source: payload.source,
        submitted_by: agent,
        status: auto.auto_confirmed ? "confirmed" : "pending",
        completeness: auto.completeness,
        auto_confirmed: auto.auto_confirmed,
        answers: payload.answers,
        geo,
        created_at: row.created_at,
        next: auto.auto_confirmed
          ? "Record complete — visible in Client Admin Report automatically"
          : "POST /api/submissions/:id/media with kind=photo|audio",
        note: auto.auto_confirmed
          ? "Q/A + media complete — pending Client Admin review."
          : "Q/A saved. Upload photo and audio separately; stays pending until Client Admin confirms.",
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

      const scopeKeys = await adminFormKeyScope(sql, me);
      const exists = scopeKeys
        ? await sql`SELECT id, payload FROM submissions WHERE id = ${id} AND payload->>'form_key' = ANY(${scopeKeys})`
        : await sql`SELECT id, payload FROM submissions WHERE id = ${id}`;
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
        const parsed = splitDataUrl(data);
        if (parsed.mime) {
          mime = String(body.mime || parsed.mime || mime).split(";")[0].trim() || mime;
          data = parsed.b64;
        } else if (parsed.b64 !== data) {
          data = parsed.b64;
        }
        // Incoming cap (~2.1MB base64 for ~1.5MB binary)
        if (data.length > 2_100_000) {
          return json({
            error: "Media too large. Compress photo or shorten audio (max ~1.5MB).",
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

      // After each media piece: if geo+photo+voice+QA all present, auto-confirm for Client Admin
      const auto = await autoConfirmIfComplete(sql, id).catch(() => ({
        auto_confirmed: false,
        completeness: "incomplete",
      }));

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
        status: auto.auto_confirmed ? "confirmed" : "pending",
        completeness: auto.completeness,
        auto_confirmed: auto.auto_confirmed,
        note: auto.auto_confirmed
          ? `${kind} linked — pending Client Admin review.`
          : mode === "neon"
            ? `${kind} linked free in Neon (no credit card). Admin opens via API.`
            : `${kind} linked on ${provider}.`,
      }, 201);
    }

    // Stream & download media file (Neon storage) — audio, video, photo
    // Only Client Admins / Super Admin may access this — surveyors have no
    // permission here. A Client Admin additionally needs can_review_data,
    // which only Super Admin can grant (see hasPower/isPortalAdmin, 214-224).
    // Also scoped to the requesting admin's own submissions (same
    // payload->>'form_key' = ANY(scopeKeys) pattern used everywhere else in
    // this file) so one Client Admin can't reach another's media by
    // guessing/incrementing the numeric media id.
    if (path.match(/^\/api\/media\/\d+\/file$/) && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      if (!hasPower(me, "can_review_data") && !hasPower(me, "can_validate_proof")) {
        return json({ error: "You don't have permission to view media — ask your Super Admin to enable it." }, 403);
      }
      const mediaId = Number(path.split("/")[3]);
      const scopeKeys = await adminFormKeyScope(sql, me);
      const owns = scopeKeys
        ? await sql`
            SELECT sm.id
            FROM survey_media sm
            JOIN submissions s ON s.id = sm.submission_id
            WHERE sm.id = ${mediaId} AND s.payload->>'form_key' = ANY(${scopeKeys})
            LIMIT 1
          `.catch(() => [])
        : await sql`SELECT id FROM survey_media WHERE id = ${mediaId} LIMIT 1`.catch(() => []);
      if (!owns.length) return json({ error: "Not found" }, 404);
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
      // Proxy external/R2 URLs — never 302. Zip/export fetch from the
      // admin origin cannot follow a storage redirect (CORS NetworkError).
      const external =
        row.url && /^https?:\/\//i.test(String(row.url))
          ? String(row.url)
          : String(row.data || "").startsWith("url:")
            ? String(row.data).slice(4)
            : "";
      if (external) {
        try {
          const up = await fetch(external);
          if (!up.ok) return json({ error: "Upstream media failed" }, 502);
          const body = new Uint8Array(await up.arrayBuffer());
          const mime = row.mime || up.headers.get("content-type") || "application/octet-stream";
          return new Response(body, {
            status: 200,
            headers: {
              "content-type": mime,
              "content-length": String(body.length),
              "cache-control": "private, max-age=3600",
              ...corsHeaders(req),
            },
          });
        } catch (e) {
          return json({ error: (e as Error).message || "Upstream media failed" }, 502);
        }
      }
      const raw = String(row.data || "");
      if (!raw) return json({ error: "No media data" }, 404);
      let bytes: Uint8Array<ArrayBuffer>;
      try {
        bytes = b64ToBytes(raw);
      } catch {
        return json({ error: "Corrupt media data" }, 500);
      }

      const isDownload = url.searchParams.get("download") === "1";
      const mime = row.mime || (row.kind === "audio" ? "audio/webm" : row.kind === "video" ? "video/mp4" : "image/jpeg");
      const ext = mime.includes("audio")
        ? "mp3"
        : mime.includes("video")
        ? "mp4"
        : mime.includes("png")
        ? "png"
        : mime.includes("jpeg") || mime.includes("jpg")
        ? "jpg"
        : "bin";

      const filename = `${row.kind || "media"}-${row.id}.${ext}`;
      const disp = isDownload ? `attachment; filename="${filename}"` : `inline; filename="${filename}"`;

      return new Response(bytes, {
        status: 200,
        headers: {
          "content-type": mime,
          "accept-ranges": "bytes",
          "content-length": String(bytes.length),
          "cache-control": "public, max-age=86400",
          "content-disposition": disp,
          ...corsHeaders(req),
        },
      });
    }

    // List media for a submission — returns free links (Neon API or external URL)
    if (path.match(/^\/api\/submissions\/\d+\/media$/) && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      const id = Number(path.split("/")[3]);
      if (isPortalAdmin(me.role)) {
        // Client Admins see media only for records in their own/assigned projects.
        const scopeKeys = await adminFormKeyScope(sql, me);
        if (scopeKeys) {
          const visible = await sql`
            SELECT id FROM submissions
            WHERE id = ${id} AND payload->>'form_key' = ANY(${scopeKeys}) LIMIT 1
          `.catch(() => []);
          if (!visible.length) return json({ error: "Not found" }, 404);
        }
      } else {
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

    // Minimal geo for cascading dropdowns (cached 1 day)
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
        }, 200, { "cache-control": "public, max-age=86400" });
      } catch {
        return json({ constituencies: [], districts: [], mpConstituencies: [] });
      }
    }

    // Combined geo children lists (mandals + revenue divisions for a district, cached 1 day)
    if (m === "GET" && url.pathname === "/api/geo/children") {
      if (!me) return json({ error: "Login required" }, 401);
      const raw = String(url.searchParams.get("district") || "").trim();
      const district = GEO_ALIASES.districts[raw.toLowerCase()] ?? raw;
      try {
        const mandals = district
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
        const revenueDivisions = district
          ? await sql`SELECT name, district FROM revenue_divisions WHERE district = ${district} ORDER BY name LIMIT 200`
          : await sql`SELECT name, district FROM revenue_divisions ORDER BY name LIMIT 200`;
        return json({
          district,
          mandals,
          divisions: revenueDivisions,
          revenueDivisions,
        }, 200, { "cache-control": "public, max-age=86400" });
      } catch {
        return json({ district, mandals: [], divisions: [], revenueDivisions: [] });
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
        return json({ mandals: rows }, 200, { "cache-control": "public, max-age=86400" });
      } catch {
        return json({ mandals: [] });
      }
    }

    if (path === "/api/geo/revenue_divisions" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      try {
        const rows = await sql`SELECT name, district FROM revenue_divisions ORDER BY name LIMIT 200`;
        return json({ revenueDivisions: rows }, 200, { "cache-control": "public, max-age=86400" });
      } catch {
        return json({ revenueDivisions: [] });
      }
    }

    // Dashboard + filters — full super-set / sub-set analytics (and consolidated kpi / geo groups)
    if (m === "GET" && url.pathname === "/api/analytics") {
      if (!me) return json({ error: "Login required" }, 401);
      const groupBy = (url.searchParams.get("group_by") || "").trim().toLowerCase();
      const envScope = await adminFormKeyScope(sql, me);

      // KPI group (formerly /api/stats)
      if (groupBy === "kpi") {
        const [dists] = await sql`SELECT COUNT(*)::int AS n FROM districts`.catch(() => [{ n: 0 }]);
        const [mands] = await sql`SELECT COUNT(*)::int AS n FROM mandals`.catch(() => [{ n: 0 }]);
        const [acs] = await sql`SELECT COUNT(*)::int AS n FROM assembly_constituencies`.catch(() => [{ n: 0 }]);
        const [srs] = await sql`SELECT COUNT(*)::int AS n FROM survey_responses`.catch(() => [{ n: 0 }]);
        const [factGeo] = await sql`
          SELECT COUNT(DISTINCT district)::int AS dist_count,
                 COUNT(DISTINCT constituency)::int AS ac_count
          FROM record_facts
        `.catch(() => [{ dist_count: 0, ac_count: 0 }]);

        const [statusRow] = envScope
          ? await sql`
              SELECT
                COUNT(*) FILTER (
                  WHERE NOT (
                    COALESCE(payload->>'draft', 'false') IN ('true', 't', '1')
                    OR COALESCE(payload->'answers'->>'_draft', 'false') IN ('true', 't', '1')
                    OR COALESCE(payload->'answers'->>'draft', 'false') IN ('true', 't', '1')
                    OR LOWER(COALESCE(payload->>'content_type', '')) = 'draft'
                  )
                  AND COALESCE(payload->>'status', 'pending') = 'confirmed'
                )::int AS confirmed,
                COUNT(*) FILTER (
                  WHERE NOT (
                    COALESCE(payload->>'draft', 'false') IN ('true', 't', '1')
                    OR COALESCE(payload->'answers'->>'_draft', 'false') IN ('true', 't', '1')
                    OR COALESCE(payload->'answers'->>'draft', 'false') IN ('true', 't', '1')
                    OR LOWER(COALESCE(payload->>'content_type', '')) = 'draft'
                  )
                  AND COALESCE(payload->>'status', 'pending') = 'rejected'
                )::int AS rejected,
                COUNT(*) FILTER (
                  WHERE (
                    COALESCE(payload->>'draft', 'false') IN ('true', 't', '1')
                    OR COALESCE(payload->'answers'->>'_draft', 'false') IN ('true', 't', '1')
                    OR COALESCE(payload->'answers'->>'draft', 'false') IN ('true', 't', '1')
                    OR LOWER(COALESCE(payload->>'content_type', '')) = 'draft'
                  )
                  OR COALESCE(payload->>'status', 'pending') NOT IN ('confirmed', 'rejected')
                )::int AS pending
              FROM submissions WHERE payload->>'form_key' = ANY(${envScope})
            `.catch(() => [{ confirmed: 0, rejected: 0, pending: 0 }])
          : await sql`
              SELECT
                COUNT(*) FILTER (
                  WHERE NOT (
                    COALESCE(payload->>'draft', 'false') IN ('true', 't', '1')
                    OR COALESCE(payload->'answers'->>'_draft', 'false') IN ('true', 't', '1')
                    OR COALESCE(payload->'answers'->>'draft', 'false') IN ('true', 't', '1')
                    OR LOWER(COALESCE(payload->>'content_type', '')) = 'draft'
                  )
                  AND COALESCE(payload->>'status', 'pending') = 'confirmed'
                )::int AS confirmed,
                COUNT(*) FILTER (
                  WHERE NOT (
                    COALESCE(payload->>'draft', 'false') IN ('true', 't', '1')
                    OR COALESCE(payload->'answers'->>'_draft', 'false') IN ('true', 't', '1')
                    OR COALESCE(payload->'answers'->>'draft', 'false') IN ('true', 't', '1')
                    OR LOWER(COALESCE(payload->>'content_type', '')) = 'draft'
                  )
                  AND COALESCE(payload->>'status', 'pending') = 'rejected'
                )::int AS rejected,
                COUNT(*) FILTER (
                  WHERE (
                    COALESCE(payload->>'draft', 'false') IN ('true', 't', '1')
                    OR COALESCE(payload->'answers'->>'_draft', 'false') IN ('true', 't', '1')
                    OR COALESCE(payload->'answers'->>'draft', 'false') IN ('true', 't', '1')
                    OR LOWER(COALESCE(payload->>'content_type', '')) = 'draft'
                  )
                  OR COALESCE(payload->>'status', 'pending') NOT IN ('confirmed', 'rejected')
                )::int AS pending
              FROM submissions
            `.catch(() => [{ confirmed: 0, rejected: 0, pending: 0 }]);

        const confirmed = Number((statusRow as Record<string, unknown>)?.confirmed || 0);
        const rejected = Number((statusRow as Record<string, unknown>)?.rejected || 0);
        const pending = Number((statusRow as Record<string, unknown>)?.pending || 0);

        const [distFromData] = envScope
          ? await sql`
              SELECT COUNT(DISTINCT NULLIF(TRIM(payload->'answers'->>'district'), ''))::int AS n
              FROM submissions
              WHERE payload->>'form_key' = ANY(${envScope})
                AND COALESCE(payload->>'status', 'pending') = 'confirmed'
                AND NOT (
                  COALESCE(payload->>'draft', 'false') IN ('true', 't', '1')
                  OR COALESCE(payload->'answers'->>'_draft', 'false') IN ('true', 't', '1')
                  OR COALESCE(payload->'answers'->>'draft', 'false') IN ('true', 't', '1')
                  OR LOWER(COALESCE(payload->>'content_type', '')) = 'draft'
                )
            `.catch(() => [{ n: 0 }])
          : await sql`
              SELECT COUNT(DISTINCT NULLIF(TRIM(payload->'answers'->>'district'), ''))::int AS n
              FROM submissions
              WHERE COALESCE(payload->>'status', 'pending') = 'confirmed'
                AND NOT (
                  COALESCE(payload->>'draft', 'false') IN ('true', 't', '1')
                  OR COALESCE(payload->'answers'->>'_draft', 'false') IN ('true', 't', '1')
                  OR COALESCE(payload->'answers'->>'draft', 'false') IN ('true', 't', '1')
                  OR LOWER(COALESCE(payload->>'content_type', '')) = 'draft'
                )
            `.catch(() => [{ n: 0 }]);

        const [acFromData] = envScope
          ? await sql`
              SELECT COUNT(DISTINCT NULLIF(TRIM(COALESCE(
                payload->'answers'->>'constituency',
                payload->'answers'->>'assembly_constituency'
              )), ''))::int AS n
              FROM submissions
              WHERE payload->>'form_key' = ANY(${envScope})
                AND COALESCE(payload->>'status', 'pending') = 'confirmed'
                AND NOT (
                  COALESCE(payload->>'draft', 'false') IN ('true', 't', '1')
                  OR COALESCE(payload->'answers'->>'_draft', 'false') IN ('true', 't', '1')
                  OR COALESCE(payload->'answers'->>'draft', 'false') IN ('true', 't', '1')
                  OR LOWER(COALESCE(payload->>'content_type', '')) = 'draft'
                )
            `.catch(() => [{ n: 0 }])
          : await sql`
              SELECT COUNT(DISTINCT NULLIF(TRIM(COALESCE(
                payload->'answers'->>'constituency',
                payload->'answers'->>'assembly_constituency'
              )), ''))::int AS n
              FROM submissions
              WHERE COALESCE(payload->>'status', 'pending') = 'confirmed'
                AND NOT (
                  COALESCE(payload->>'draft', 'false') IN ('true', 't', '1')
                  OR COALESCE(payload->'answers'->>'_draft', 'false') IN ('true', 't', '1')
                  OR COALESCE(payload->'answers'->>'draft', 'false') IN ('true', 't', '1')
                  OR LOWER(COALESCE(payload->>'content_type', '')) = 'draft'
                )
            `.catch(() => [{ n: 0 }]);

        const dataDistricts = Number((distFromData as Record<string, unknown>)?.n || 0);
        const dataAcs = Number((acFromData as Record<string, unknown>)?.n || 0);
        const surveyDistrictsLive = dataDistricts || Number((factGeo as Record<string, unknown>)?.dist_count || 0);
        const surveyAcsLive = dataAcs || Number((factGeo as Record<string, unknown>)?.ac_count || 0);

        return json({
          submissions: confirmed + pending + rejected,
          survey_responses: srs?.n ?? 0,
          pending,
          confirmed,
          rejected,
          districts: surveyDistrictsLive,
          constituencies: surveyAcsLive,
          master_districts: dists?.n ?? 0,
          mandals: mands?.n ?? 0,
          assembly_constituencies: acs?.n ?? 0,
          coverage: {
            districtsWithFacts: factGeo?.dist_count ?? 0,
            constituenciesWithFacts: factGeo?.ac_count ?? 0,
          },
        });
      }

      // Geo summary group (formerly /api/admin/geo-summary)
      if (groupBy === "geo") {
        if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
        try {
          const [d] = await sql`SELECT COUNT(*)::int AS n FROM districts`;
          const [m] = await sql`SELECT COUNT(*)::int AS n FROM mandals`;
          const [a] = await sql`SELECT COUNT(*)::int AS n FROM assembly_constituencies`;
          const [p] = await sql`SELECT COUNT(*)::int AS n FROM mp_constituencies`;
          const [r] = await sql`SELECT COUNT(*)::int AS n FROM revenue_divisions`;
          const [s] = envScope
            ? await sql`SELECT COUNT(*)::int AS n FROM submissions WHERE payload->>'form_key' = ANY(${envScope})`
            : await sql`SELECT COUNT(*)::int AS n FROM submissions`;
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

      const result = await buildAnalytics(sql, url, envScope);
      // Envelope: data_as_of watermark + fact health (09-ANALYTICS-SPEC §5/§8, ADR-014/016)
      const [w] = envScope
        ? await sql`
            SELECT MAX(confirmed_at) AS as_of FROM record_facts WHERE survey_key = ANY(${envScope})
          `.catch(() => [{ as_of: null }])
        : await sql`
            SELECT MAX(confirmed_at) AS as_of FROM record_facts
          `.catch(() => [{ as_of: null }]);
      let dataAsOf: string | null = (w as { as_of?: unknown } | undefined)?.as_of
        ? String((w as { as_of?: unknown }).as_of)
        : null;
      if (!dataAsOf) {
        const [f] = envScope
          ? await sql`
              SELECT MAX((payload->>'confirmed_at')::timestamptz) AS as_of
              FROM submissions
              WHERE payload->>'status' = 'confirmed' AND payload->>'form_key' = ANY(${envScope})
            `.catch(() => [{ as_of: null }])
          : await sql`
              SELECT MAX((payload->>'confirmed_at')::timestamptz) AS as_of
              FROM submissions WHERE payload->>'status' = 'confirmed'
            `.catch(() => [{ as_of: null }]);
        dataAsOf = (f as { as_of?: unknown } | undefined)?.as_of
          ? String((f as { as_of?: unknown }).as_of)
          : null;
      }
      const [fc] = envScope
        ? await sql`SELECT COUNT(*)::int AS n FROM record_facts WHERE survey_key = ANY(${envScope})`.catch(() => [{ n: 0 }])
        : await sql`SELECT COUNT(*)::int AS n FROM record_facts`.catch(() => [{ n: 0 }]);
      const [failedN] = envScope
        ? await sql`
            SELECT COUNT(*)::int AS n FROM submissions
            WHERE fact_status = 'failed' AND payload->>'form_key' = ANY(${envScope})
          `.catch(() => [{ n: 0 }])
        : await sql`
            SELECT COUNT(*)::int AS n FROM submissions WHERE fact_status = 'failed'
          `.catch(() => [{ n: 0 }]);
      const failed = Number((failedN as { n?: number } | undefined)?.n ?? 0);
      const confirmedTotal = Number(result?.statusCounts?.confirmed ?? 0);
      return json({
        ...result,
        data_as_of: dataAsOf,
        empty: confirmedTotal === 0,
        degraded: failed > 0,
        degraded_reason: failed > 0
          ? `${failed} confirmed record${failed === 1 ? "" : "s"} with failed fact materialization — retry in Review`
          : null,
        facts: {
          materialized: Number((fc as { n?: number } | undefined)?.n ?? 0),
          failed,
        },
      });
    }

    // Admin data export: text/CSV of submissions with photo + audio links.
    // Filters: period (total | today | day | month), day, month, user (surveyor),
    // survey (form_key), district, constituency, status (default confirmed).
    if (path === "/api/admin/export" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      try {
        let dateFrom = (url.searchParams.get("date_from") || url.searchParams.get("from") || "").trim();
        let dateTo = (url.searchParams.get("date_to") || url.searchParams.get("to") || "").trim();
        const period = (url.searchParams.get("period") || "total").trim().toLowerCase();
        const dayParam = (url.searchParams.get("day") || "").trim();
        const monthParam = (url.searchParams.get("month") || "").trim();
        if (period === "today") {
          const t = istToday();
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
        const userQ = (url.searchParams.get("user") || "").trim().toLowerCase();
        const surveyQ = (url.searchParams.get("survey") || url.searchParams.get("form_key") || "").trim();
        const districtQ = (url.searchParams.get("district") || "").trim().toLowerCase();
        const constituencyQ = (url.searchParams.get("constituency") || "").trim().toLowerCase();
        const statusQ = (url.searchParams.get("status") || "confirmed").trim().toLowerCase();
        const langQ = (url.searchParams.get("lang") || url.searchParams.get("locale") || "en")
          .trim()
          .toLowerCase();
        const asTe = langQ === "te" || langQ === "telugu" || langQ === "te-in";

        const allRows = await loadAnalyticsRows(sql, 20000, await adminFormKeyScope(sql, me));
        let rows = allRows;
        if (statusQ !== "all") rows = rows.filter((r) => r.status === statusQ);
        if (dateFrom) rows = rows.filter((r) => dayKey(r.created_at) >= dateFrom);
        if (dateTo) rows = rows.filter((r) => dayKey(r.created_at) <= dateTo);
        if (userQ) {
          rows = rows.filter((r) =>
            String(r.submitted_by || "").toLowerCase().includes(userQ)
          );
        }
        if (surveyQ) rows = rows.filter((r) => r.formKey === surveyQ);
        if (districtQ) {
          rows = rows.filter((r) => String(r.district || "").toLowerCase() === districtQ);
        }
        if (constituencyQ) {
          rows = rows.filter((r) => String(r.constituency || "").toLowerCase() === constituencyQ);
        }

        // Photo / audio links per submission (first of each kind).
        // survey_media.url is stored as a relative path ("/api/media/:id/file")
        // for Neon-hosted media — a CSV has no base origin, so a relative path
        // in an exported file is not a usable/clickable link. Make it absolute
        // using this request's own origin; external (R2) URLs are already
        // absolute and pass through unchanged.
        const origin = `${url.protocol}//${url.host}`;
        const mediaRows = await sql`
          SELECT id, submission_id, kind, url FROM survey_media
        `.catch(() => []);
        const photoUrl = new Map<number, string>();
        const audioUrl = new Map<number, string>();
        for (const m of mediaRows as {
          id: number;
          submission_id: number;
          kind: string;
          url: string | null;
        }[]) {
          const id = Number(m.submission_id);
          // Always the API file route so the browser never fetches R2 directly.
          const u = `${origin}/api/media/${Number(m.id)}/file`;
          if (m.kind === "photo" && !photoUrl.has(id)) photoUrl.set(id, u);
          if (m.kind === "audio" && !audioUrl.has(id)) audioUrl.set(id, u);
        }

        // Columns: fixed fields + union of all answer keys
        const photoName = (id: unknown) => `${id}/${id}.jpg`;
        const audioName = (id: unknown) => `${id}/${id}.webm`;
        const asMedia = (url.searchParams.get("format") || "").trim().toLowerCase() === "media";
        if (asMedia) {
          const items = rows.map((r) => ({
            id: r.id,
            photo_url: photoUrl.get(Number(r.id)) || "",
            audio_url: audioUrl.get(Number(r.id)) || "",
            photo_file: photoUrl.has(Number(r.id)) ? photoName(r.id) : "",
            audio_file: audioUrl.has(Number(r.id)) ? audioName(r.id) : "",
          }));
          return json({ items, count: items.length });
        }

        const fixed = [
          "id", "date", "created_at_ist", "survey", "surveyor", "district", "constituency", "mandal",
          "latitude", "longitude", "party", "gender", "caste", "age", "respondent",
          "photo_url", "audio_url", "photo_file", "audio_file",
        ];
        const idToLabel = new Map<string, string>();
        const optTeByKey = new Map<string, Map<string, string>>();
        const questionsByForm = new Map<string, { id: string; label: string }[]>();
        {
          const formRows = await sql`SELECT form_key, questions FROM survey_form`.catch(() => []);
          for (const f of formRows as { form_key?: string; questions?: unknown }[]) {
            const list: { id: string; label: string }[] = [];
            for (const raw of parseQuestionsArray(f.questions)) {
              const q = raw as Record<string, unknown>;
              const qid = String(q.id || "").trim();
              const labelEn = String(q.label || q.speak || qid).trim();
              const labelTe = String(q.label_te || "").trim();
              const label = asTe ? (labelTe || labelEn) : labelEn;
              const opts = Array.isArray(q.options) ? q.options.map((x) => String(x ?? "")) : [];
              const optsTe = Array.isArray(q.options_te) ? q.options_te.map((x) => String(x ?? "")) : [];
              const optMap = new Map<string, string>();
              opts.forEach((en, i) => {
                const te = String(optsTe[i] || "").trim();
                if (en && te) {
                  optMap.set(en, te);
                  optMap.set(en.toLowerCase(), te);
                }
              });
              if (qid && label) idToLabel.set(qid, label);
              if (qid && optMap.size) optTeByKey.set(qid, optMap);
              if (labelEn) list.push({ id: qid, label: labelEn });
            }
            questionsByForm.set(String(f.form_key || ""), list);
          }
        }
        const qKeys = new Set<string>();
        const bagsByForm = new Map<string, Record<string, unknown>[]>();
        for (const r of rows) {
          const fk = String(r.formKey || "");
          if (!bagsByForm.has(fk)) bagsByForm.set(fk, []);
          bagsByForm.get(fk)!.push(r.answers || {});
          for (const k of Object.keys(r.answers || {})) {
            if (!skipAnswerKey(k)) qKeys.add(k);
          }
        }
        for (const [fk, bags] of bagsByForm) {
          const qs = questionsByForm.get(fk) || [];
          for (const [qid, als] of aliasesForQuestions(qs, bags)) {
            const label = idToLabel.get(qid) || qs.find((q) => q.id === qid)?.label;
            const optMap = optTeByKey.get(qid);
            if (label) {
              for (const a of als) idToLabel.set(a, label);
            }
            if (optMap) {
              for (const a of als) optTeByKey.set(a, optMap);
            }
          }
        }
        const qCols = [...qKeys].sort((a, b) => {
          const na = /^q_(\d+)$/i.exec(a);
          const nb = /^q_(\d+)$/i.exec(b);
          if (na && nb) return Number(na[1]) - Number(nb[1]);
          return a.localeCompare(b);
        });
        const usedHeads = new Set<string>(fixed);
        const qHeaders = qCols.map((k) => {
          const head = idToLabel.get(k) || k;
          let unique = head;
          let n = 2;
          while (usedHeads.has(unique)) {
            unique = `${head} (${n})`;
            n += 1;
          }
          usedHeads.add(unique);
          return unique;
        });
        const orientation = (url.searchParams.get("orientation") || url.searchParams.get("layout") || "vertical").trim().toLowerCase();
        const isVertical = orientation !== "horizontal";

        const esc = (v: unknown) => {
          const s = String(v ?? "");
          return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const lines: string[] = [];

        const locVal = (key: string, v: unknown) => {
          if (!asTe) return Array.isArray(v) ? v.join(" | ") : v;
          if (
            key === "id" || key === "date" || key === "latitude" || key === "longitude" ||
            key === "photo_url" || key === "audio_url" || key === "photo_file" ||
            key === "audio_file" || key === "age" ||
            key === "created_at_ist"
          ) {
            return v;
          }
          if (key === "district" || key === "constituency" || key === "mandal" || key === "survey") {
            return toTeluguPlace(v);
          }
          return toTeluguValue(v);
        };
        const locAns = (c: string, v: unknown) =>
          asTe ? toTeluguValue(v, optTeByKey.get(c)) : (Array.isArray(v) ? v.join(" | ") : v);
        const fixedHead = (c: string) => (asTe ? EXPORT_FIXED_TE[c] || c : c);

        const getBaseRecord = (r: (typeof rows)[number]) => {
          const rObj = r as unknown as Record<string, unknown>;
          return {
            id: r.id,
            date: dayKey(r.created_at),
            created_at_ist: formatIstStamp(r.created_at),
            survey: r.formKey,
            surveyor: r.submitted_by,
            district: r.district,
            constituency: r.constituency,
            mandal: rObj.mandal || "",
            latitude: rObj.lat || "",
            longitude: rObj.lng || "",
            party: r.party,
            gender: r.gender,
            caste: r.caste,
            age: r.age,
            respondent: r.respondent,
            photo_url: photoUrl.get(Number(r.id)) || "",
            audio_url: audioUrl.get(Number(r.id)) || "",
            photo_file: photoUrl.has(Number(r.id)) ? photoName(r.id) : "",
            audio_file: audioUrl.has(Number(r.id)) ? audioName(r.id) : "",
          } as Record<string, unknown>;
        };

        if (isVertical) {
          // Vertical Layout: Transposed CSV (Questions / Attributes as Rows, Records as Columns)
          const recLabel = asTe ? "రికార్డ్" : "Record";
          const headerRow = [
            asTe ? "ఫీల్డ్ / ప్రశ్న" : "Field / Question",
            ...rows.map((r, idx) => `${recLabel} #${r.id || idx + 1}`),
          ];
          lines.push(headerRow.map(esc).join(","));

          // Fixed Metadata Fields (Rows)
          for (const c of fixed) {
            const rowVals = [fixedHead(c)];
            for (const r of rows) {
              const base = getBaseRecord(r);
              rowVals.push(esc(locVal(c, base[c])));
            }
            lines.push(rowVals.join(","));
          }

          // Dynamic Survey Questions (Rows)
          qCols.forEach((c, idx) => {
            const qHeader = qHeaders[idx] || c;
            const rowVals = [esc(qHeader)];
            for (const r of rows) {
              const v = (r.answers || {})[c];
              rowVals.push(esc(locAns(c, v)));
            }
            lines.push(rowVals.join(","));
          });
        } else {
          // Horizontal Layout: Standard CSV (One row per record)
          lines.push([...fixed.map(fixedHead), ...qHeaders].map(esc).join(","));
          for (const r of rows) {
            const base = getBaseRecord(r);
            const rec: string[] = [];
            for (const c of fixed) rec.push(esc(locVal(c, base[c])));
            for (const c of qCols) {
              const v = (r.answers || {})[c];
              rec.push(esc(locAns(c, v)));
            }
            lines.push(rec.join(","));
          }
        }
        logAudit(me, "data_export", "export", null, {
          rows: rows.length,
          status: statusQ,
          from: dateFrom,
          to: dateTo,
          lang: asTe ? "te" : "en",
        });
        const stamp = dayParam || monthParam || "total";
        const fname = asTe ? `survey-export-te-${stamp}.csv` : `survey-export-${stamp}.csv`;
        const csvBody = (asTe ? "\uFEFF" : "") + lines.join("\n");
        return new Response(csvBody, {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${fname}"`,
            ...corsHeaders(req),
          },
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
}

Deno.serve(async (req) => withCors(req, await rawHandler(req)));
