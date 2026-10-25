import {
  normCaste,
  normGender,
  normParty,
  normPm,
} from "./answers.ts";
import {
  sql,
} from "../db.ts";
import {
  GEO_ALIASES,
} from "../geo-aliases.ts";
import {
  TELUGU_ALIAS,
} from "../i18n-te.ts";
import {
  parsePayload,
} from "../payload.ts";
import {
  durationSecOf,
  isoStamp,
} from "../time.ts";
import {
  type Row,
  loadMediaKindsMap,
  surveyorNameOf,
  verifyWithMedia,
  workStatusOf,
} from "../verify.ts";

// In-memory cache for assembly_constituencies — this table is only ever
// changed by a manual seed script run outside the app (see REDEPLOY.md,
// which already says to re-seed after a redeploy, i.e. after a fresh Deno
// isolate anyway), never by any endpoint. So a plain per-isolate cache with
// no TTL is correct, not just faster: previously this was queried and
// re-parsed from scratch on every single analytics request.
export type AcEntry = { canonical: string; district: string; covering: string[]; mp: string };
export let acListCache: AcEntry[] | null = null;

export async function getAcList(sqlFn: NonNullable<typeof sql>): Promise<AcEntry[]> {
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

export function normKeyStatic(s: string) {
  return String(s || "")
    .toLowerCase()
    .replace(/\(([^)]*)\)/g, " $1 ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export let mandalLookupCache: Map<string, string> | null = null;

export async function getMandalLookup(sqlFn: NonNullable<typeof sql>): Promise<Map<string, string>> {
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

export async function countAnalyticsRows(
  sqlFn: NonNullable<typeof sql>,
  scopeKeys: string[] | null,
): Promise<number> {
  const rows = scopeKeys
    ? await sqlFn`SELECT COUNT(*)::int AS n FROM submissions WHERE payload->>'form_key' = ANY(${scopeKeys})`
    : await sqlFn`SELECT COUNT(*)::int AS n FROM submissions`;
  return (rows as { n: number }[])[0]?.n ?? 0;
}

export async function loadAnalyticsRows(
  sqlFn: NonNullable<typeof sql>,
  limit = 500000,
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
      source: String(payload.source || "app"),
      answers: a,
      duration_sec: durationSecOf(a),
    };
  });
  return allRows;
}

