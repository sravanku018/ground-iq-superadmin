import {
  AGE_OPTIONS,
  ageBucket,
} from "./analytics/answers.ts";
import {
  GEO_ALIASES,
} from "./geo-aliases.ts";

/** Telugu place names → English (district etc.), applied when confirming */
export const TELUGU_ALIAS: Record<string, string> = (GEO_ALIASES as {
  telugu?: Record<string, string>;
}).telugu || {};
export const TELUGU_SCRIPT = /[\u0C00-\u0C7F]/;

/** English canonical place → Telugu (longest alias wins). */
export const EN_TO_TE_PLACE = (() => {
  const m = new Map<string, string>();
  for (const [te, en] of Object.entries(TELUGU_ALIAS)) {
    const key = String(en || "").trim().toLowerCase();
    if (!key) continue;
    const prev = m.get(key);
    if (!prev || te.length > prev.length) m.set(key, te);
  }
  return m;
})();

export const EXPORT_FIXED_TE: Record<string, string> = {
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

export const EXPORT_VALUE_TE: Record<string, string> = {
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

export function toTeluguPlace(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (TELUGU_SCRIPT.test(s)) return s;
  return EN_TO_TE_PLACE.get(s.toLowerCase()) || s;
}

export function toTeluguValue(v: unknown, optTe?: Map<string, string>): string {
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
export function withTeLabels<T extends { name: string }>(
  arr: T[],
  kind: "place" | "value" = "value",
  optTe?: Map<string, string>,
): (T & { label: string })[] {
  return arr.map((d) => ({
    ...d,
    label: kind === "place" ? toTeluguPlace(d.name) : toTeluguValue(d.name, optTe),
  }));
}

export function coerceOptionName(o: unknown): string {
  if (o == null) return "";
  if (typeof o === "object") {
    const rec = o as Record<string, unknown>;
    return String(rec.label || rec.value || rec.name || "").trim();
  }
  return String(o).trim();
}

export const CHOICE_Q_TYPES = new Set([
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

export function defaultQuestionOptions(type: string): string[] {
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
export function chartNamesFromAnswer(
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

export function optionTeMap(options: unknown, optionsTe: unknown): Map<string, string> {
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

export function translateGeoEnglish(
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

