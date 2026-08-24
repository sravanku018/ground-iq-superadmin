/**
 * Stress tests for the Deno monolith.
 *
 * In-process by default (no production traffic).
 * Live (capped): STRESS_LIVE=1 TEST_API_URL=https://….deno.net deno test -A --no-check stress_test.ts
 */
import { assert, assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./main-test.ts";

const LIVE = Deno.env.get("STRESS_LIVE") === "1"
  ? (Deno.env.get("TEST_API_URL") || "").replace(/\/$/, "")
  : "";
const N_HEALTH = LIVE ? 80 : 400;
const N_MIXED = LIVE ? 40 : 200;
const CONC_HEALTH = LIVE ? 10 : 50;
const CONC_MIXED = LIVE ? 8 : 25;

type Hit = { status: number; ms: number; path: string };

async function one(
  method: string,
  path: string,
  opts: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<Hit> {
  const headers: Record<string, string> = { Accept: "application/json", ...opts.headers };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const t0 = performance.now();
  let res: Response;
  if (LIVE) {
    res = await fetch(`${LIVE}${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } else {
    res = await handleRequest(
      new Request(`http://ssx.test${path}`, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      }),
    );
  }
  await res.arrayBuffer();
  return { status: res.status, ms: performance.now() - t0, path };
}

async function pool(jobs: (() => Promise<Hit>)[], concurrency: number): Promise<Hit[]> {
  const out: Hit[] = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (i < jobs.length) {
      const job = jobs[i++];
      out.push(await job());
    }
  });
  await Promise.all(workers);
  return out;
}

function summary(label: string, hits: Hit[]) {
  const sorted = [...hits].map((h) => h.ms).sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
  const byStatus = new Map<number, number>();
  for (const h of hits) byStatus.set(h.status, (byStatus.get(h.status) || 0) + 1);
  const serverErr = hits.filter((h) => h.status >= 500).length;
  const totalMs = hits.reduce((s, h) => s + h.ms, 0);
  console.log(
    `${label}: n=${hits.length}  5xx=${serverErr}  p50=${pct(50).toFixed(1)}ms  p95=${pct(95).toFixed(1)}ms  p99=${pct(99).toFixed(1)}ms  max=${sorted.at(-1)?.toFixed(1)}ms  rps~${(hits.length / (totalMs / 1000 / CONC_HEALTH)).toFixed(0)}  status=${JSON.stringify(Object.fromEntries(byStatus))}`,
  );
  return { serverErr, p95: pct(95), p99: pct(99) };
}

Deno.test({
  name: `stress GET /api/health x${N_HEALTH} conc=${CONC_HEALTH}`,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const jobs = Array.from({ length: N_HEALTH }, () => () => one("GET", "/api/health"));
    const hits = await pool(jobs, CONC_HEALTH);
    const s = summary("health", hits);
    assertEquals(hits.length, N_HEALTH);
    assertEquals(s.serverErr, 0);
    assert(hits.every((h) => h.status === 200), "health must stay 200 under load");
  },
});

Deno.test({
  name: `stress mixed unauth x${N_MIXED} conc=${CONC_MIXED}`,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const paths: [string, string][] = [
      ["GET", "/api/health"],
      ["GET", "/api/stats"],
      ["GET", "/api/surveys"],
      ["GET", "/api/submissions"],
      ["GET", "/api/analytics"],
      ["GET", "/api/users"],
      ["GET", "/api/my-surveys"],
      ["GET", "/api/geo"],
      ["OPTIONS", "/api/health"],
      ["DELETE", "/api/submissions/1"],
      ["DELETE", "/api/surveys/1"],
    ];
    const jobs = Array.from({ length: N_MIXED }, (_, n) => {
      const [method, path] = paths[n % paths.length];
      return () => one(method, path);
    });
    const hits = await pool(jobs, CONC_MIXED);
    summary("mixed", hits);
    assertEquals(hits.length, N_MIXED);
    const healthHits = hits.filter((h) => h.path === "/api/health");
    assert(healthHits.every((h) => h.status === 200 || h.status === 204));
    assertEquals(
      hits.filter((h) => h.path === "/api/health" && h.status >= 500).length,
      0,
    );
    const unexpected = hits.filter((h) => h.status === 200 && h.path !== "/api/health");
    assertEquals(unexpected.length, 0, "protected routes must not 200 without auth");
  },
});

Deno.test({
  name: "stress login rate limit (same IP)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
    const jobs = Array.from({ length: 12 }, () =>
      () =>
        one("POST", "/api/auth/login", {
          body: { username: "nouser", password: "bad" },
          headers: { "x-forwarded-for": ip },
        }));
    const hits = await pool(jobs, 12);
    summary("login-burst", hits);
    assertEquals(hits.length, 12);
    if (!LIVE && !Deno.env.get("DATABASE_URL")) {
      // Login sits behind the DATABASE_URL gate, so this is a no-crash burst.
      assert(hits.every((h) => h.status === 500));
      return;
    }
    const limited = hits.filter((h) => h.status === 429).length;
    if (LIVE) {
      assert(hits.every((h) => [400, 401, 429, 500].includes(h.status)));
      return;
    }
    assert(
      limited >= 5,
      `expected rate limit 429 after 5 attempts, got statuses ${hits.map((h) => h.status).join(",")}`,
    );
  },
});

Deno.test({
  name: "stress overlapping health + stats (no deadlock)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const n = LIVE ? 20 : 80;
    const jobs = Array.from({ length: n }, (_, i) =>
      i % 2 === 0 ? () => one("GET", "/api/health") : () => one("GET", "/api/stats"));
    const hits = await pool(jobs, LIVE ? 10 : 40);
    summary("overlap", hits);
    assertEquals(hits.length, n);
    assert(hits.filter((h) => h.path === "/api/health").every((h) => h.status === 200));
  },
});
