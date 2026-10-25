// ── Analytics helpers (filters + super-set / sub-set) ──────
/**
 * Answer lookup keyed by the Client Admin's question naming — matches
 * question id OR label, case-insensitively (question "Gender" ↔ answer "gender").
 */
export function surveyDisplayLang(v: unknown): "en" | "te" {
  return String(v || "en").trim().toLowerCase() === "te" ? "te" : "en";
}

export function slugQuestionKeyServer(label: string) {
  return String(label || "")
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

export function skipAnswerKey(k: string) {
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
export function aliasesForQuestions(
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
export function answersByQuestionId(
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

export function answerOf(
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
export const AGE_RANGES = [
  { lo: 0, hi: 17, name: "0-17" },
  { lo: 18, hi: 25, name: "18-25" },
  { lo: 26, hi: 35, name: "26-35" },
  { lo: 36, hi: 45, name: "36-45" },
  { lo: 46, hi: 60, name: "46-60" },
  { lo: 61, hi: Infinity, name: "60+" },
];
export const AGE_OPTIONS = AGE_RANGES.map((r) => r.name);
export function ageBucket(v: unknown): string | null {
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

export function normParty(v: string) {
  const s = String(v || "").trim();
  if (!s) return "Undecided";
  if (/bjp|బీజేపీ/i.test(s)) return "BJP";
  if (/congress|కాంగ్ర/i.test(s)) return "Congress";
  if (/brs|trs|బీఆర్/i.test(s)) return "BRS";
  if (/undecided|not decided/i.test(s)) return "Undecided";
  if (/other/i.test(s)) return "Others";
  return s;
}
export function normGender(v: string) {
  const s = String(v || "").trim();
  if (!s) return "Unknown";
  if (/^female\b|^woman\b|స్త్రీ/i.test(s)) return "Female";
  if (/^male\b|^man\b|పురుష/i.test(s)) return "Male";
  return s;
}
export function normCaste(v: string) {
  const s = String(v || "").trim();
  if (!s) return "Unknown";
  if (/\bbc\b|backward/i.test(s)) return "BC";
  if (/\bsc\b/i.test(s)) return "SC";
  if (/\bst\b/i.test(s)) return "ST";
  if (/\boc\b|open|forward/i.test(s)) return "OC";
  if (/minority|muslim/i.test(s)) return "Minority";
  return s;
}
export function normPm(v: string) {
  const s = String(v || "").trim();
  if (!s) return "Undecided";
  if (/modi|మోదీ/i.test(s)) return "Narendra Modi";
  if (/rahul|రాహుల్/i.test(s)) return "Rahul Gandhi";
  if (/undecided/i.test(s)) return "Undecided";
  if (/other/i.test(s)) return "Other";
  return s;
}
export function softEq(a: string, b: string) {
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

export function countBy(list: { key: string }[], keyFn: (r: { key: string }) => string) {
  const map = new Map<string, number>();
  for (const r of list) {
    const k = keyFn(r) || "Unknown";
    map.set(k, (map.get(k) || 0) + 1);
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value, pct: 0 }))
    .sort((a, b) => b.value - a.value);
}
export function withPct(arr: { name: string; value: number; pct: number }[]) {
  const total = arr.reduce((s, x) => s + x.value, 0) || 1;
  return arr.map((x) => ({
    ...x,
    pct: Math.round((x.value / total) * 1000) / 10,
  }));
}
export function pctDist(list: Record<string, unknown>[], key: string) {
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
export function compareSets(
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

