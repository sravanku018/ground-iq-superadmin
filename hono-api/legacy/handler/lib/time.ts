import {
  isMetaAnswerKey,
} from "./verify.ts";

/** India Standard Time (this product is IST-only). */
export const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

export function istCalendarDate(v: unknown): string {
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

export function dayKey(iso: string) {
  return istCalendarDate(iso);
}

export function istToday(): string {
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

// Neon returns TIMESTAMPTZ as Date objects; String(Date) yields locale text
// ("Tue Aug 04 2026…") which breaks dayKey()/date comparisons. Always ISO.
export function isoStamp(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v || "");
}

/** Admin/export display — always Asia/Kolkata, never the server's UTC clock. */
export function formatIstStamp(v: unknown): string {
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

export function secBetween(a: unknown, b: unknown): string {
  const t1 = new Date(isoStamp(a)).getTime();
  const t2 = new Date(isoStamp(b)).getTime();
  if (!Number.isFinite(t1) || !Number.isFinite(t2) || t2 < t1) return "";
  return String(Math.round((t2 - t1) / 1000));
}

/** Seconds from GPS enable to finish. Voice on/off does not change the clock. */
export function durationSecOf(answers: Record<string, unknown> | undefined | null): number | null {
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

export function formatDurationSec(sec: number): string {
  const n = Math.max(0, Math.round(sec));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

export function collectTimeStats(
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

export function qaFromAnswers(a: Record<string, unknown>, questions: unknown[] = []) {
  const out: { q: string; a: string }[] = [];
  const used = new Set<string>();
  const qs = Array.isArray(questions) ? questions : [];
  for (const raw of qs) {
    const q = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const id = String(q.id || "").trim();
    if (!id) continue;
    let v = a[id];
    if (v == null || v === "") continue;
    if (Array.isArray(v)) v = v.join(", ");
    used.add(id);
    out.push({ q: String(q.label || q.label_te || id), a: String(v) });
  }
  const core: [string, string][] = [
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
  for (const [k, label] of core) {
    if (used.has(k)) continue;
    let v = a[k];
    if (Array.isArray(v)) v = v.join(", ");
    if (v == null || v === "") continue;
    used.add(k);
    out.push({ q: label, a: String(v) });
  }
  for (const [k, raw] of Object.entries(a || {})) {
    if (used.has(k) || isMetaAnswerKey(k)) continue;
    let v: unknown = raw;
    if (Array.isArray(v)) v = v.join(", ");
    if (v == null || v === "") continue;
    out.push({ q: k, a: String(v) });
  }
  return out;
}

