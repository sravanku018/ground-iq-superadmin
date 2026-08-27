/**
 * Endpoint tests for the Deno monolith (main.ts).
 *
 * Default: in-process handler, no DATABASE_URL required.
 * With DATABASE_URL: unauthenticated calls expect 401 (Login required).
 * Optional live contract: TEST_API_URL=https://….deno.net deno test -A api_test.ts
 *
 * Does not create or delete production data.
 */
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { handleRequest } from "./main-test.ts";

const LIVE = (Deno.env.get("TEST_API_URL") || "").replace(/\/$/, "");
const HAS_DB = Boolean(Deno.env.get("DATABASE_URL"));

async function call(
  method: string,
  path: string,
  opts: { body?: unknown; headers?: Record<string, string>; token?: string } = {},
): Promise<{ status: number; json: Record<string, unknown>; headers: Headers; text: string }> {
  const headers: Record<string, string> = { Accept: "application/json", ...opts.headers };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

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
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    parsed = { _raw: text };
  }
  return { status: res.status, json: parsed, headers: res.headers, text };
}

function unauthStatus(): number[] {
  // No DB → 500 DATABASE_URL not set. With DB / live → 401 Login required.
  return LIVE || HAS_DB ? [401] : [401, 500];
}

Deno.test("OPTIONS preflight returns 204", async () => {
  const r = await call("OPTIONS", "/api/health");
  assertEquals(r.status, 204);
});

Deno.test("GET / is the API root", async () => {
  const r = await call("GET", "/");
  assertEquals(r.status, 200);
  assertEquals(r.json.platform, "deno");
  assert(String(r.json.message || "").includes("Smart Survey X"));
});

Deno.test("GET /api/health does not require login", async () => {
  const r = await call("GET", "/api/health");
  assertEquals(r.status, 200);
  assertEquals(r.json.ok, true);
  assertEquals(r.json.platform, "deno");
  assertEquals(r.headers.get("cache-control")?.includes("no-store"), true);
});

Deno.test("unknown route is 404 when DB is up, else 500", async () => {
  const r = await call("GET", "/api/does-not-exist");
  if (LIVE || HAS_DB) assertEquals(r.status, 404);
  else assertEquals(r.status, 500);
});

Deno.test("public signup is closed", async () => {
  const r = await call("POST", "/api/auth/register", { body: { username: "x", password: "y" } });
  if (LIVE || HAS_DB) {
    assertEquals(r.status, 403);
    assert(String(r.json.error || "").toLowerCase().includes("signup") ||
      String(r.json.error || "").toLowerCase().includes("create"));
  } else {
    assert([403, 500].includes(r.status));
  }
});

Deno.test("login without username/password is 400", async () => {
  const r = await call("POST", "/api/auth/login", { body: {} });
  if (LIVE || HAS_DB) {
    assertEquals(r.status, 400);
  } else {
    assert([400, 500].includes(r.status));
  }
});

const PROTECTED: [string, string][] = [
  ["GET", "/api/auth/me"],
  ["GET", "/api/stats"],
  ["GET", "/api/users"],
  ["GET", "/api/surveys"],
  ["POST", "/api/surveys"],
  ["GET", "/api/submissions"],
  ["POST", "/api/submissions"],
  ["GET", "/api/submissions/me"],
  ["GET", "/api/admin/analyze"],
  ["GET", "/api/admin/export"],
  ["GET", "/api/analytics"],
  ["GET", "/api/my-surveys"],
  ["GET", "/api/questions"],
  ["GET", "/api/progress"],
  ["GET", "/api/progress/me"],
  ["GET", "/api/audit-log"],
  ["GET", "/api/notifications"],
  ["GET", "/api/companies"],
  ["GET", "/api/geo"],
  ["GET", "/api/question-bank"],
  ["GET", "/api/seat-limit-requests"],
  ["DELETE", "/api/submissions/1"],
  ["DELETE", "/api/surveys/1"],
  ["PATCH", "/api/submissions/1/status"],
  ["PUT", "/api/surveys/1/surveyors"],
  ["PUT", "/api/surveys/1/admins"],
  ["GET", "/api/users/1/surveys"],
];

for (const [method, path] of PROTECTED) {
  Deno.test(`${method} ${path} rejects missing login`, async () => {
    const r = await call(method, path, method === "POST" || method === "PUT" || method === "PATCH"
      ? { body: {} }
      : {});
    assert(
      unauthStatus().includes(r.status),
      `${method} ${path} expected ${unauthStatus().join("|")}, got ${r.status} ${JSON.stringify(r.json)}`,
    );
    assertFalse(r.status === 200, `${method} ${path} must not succeed without a token`);
  });
}

Deno.test("bad Origin is not reflected in CORS", async () => {
  const r = await call("GET", "/api/health", {
    headers: { Origin: "https://evil.example" },
  });
  assertEquals(r.status, 200);
  assertEquals(r.headers.get("access-control-allow-origin"), null);
});

Deno.test("allow-listed Origin is accepted", async () => {
  const r = await call("GET", "/api/health", {
    headers: { Origin: "https://ground-iq-web-lake.vercel.app" },
  });
  assertEquals(r.status, 200);
  assertEquals(r.headers.get("access-control-allow-origin"), "https://ground-iq-web-lake.vercel.app");
});

Deno.test("GitHub Pages Origin is accepted", async () => {
  const r = await call("GET", "/api/health", {
    headers: { Origin: "https://sravanku018.github.io" },
  });
  assertEquals(r.status, 200);
  assertEquals(r.headers.get("access-control-allow-origin"), "https://sravanku018.github.io");
});

Deno.test("OPTIONS preflight echoes GitHub Pages Origin", async () => {
  const r = await call("OPTIONS", "/api/auth/login", {
    headers: {
      Origin: "https://sravanku018.github.io",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  assertEquals(r.status, 204);
  assertEquals(r.headers.get("access-control-allow-origin"), "https://sravanku018.github.io");
});

Deno.test("forged Bearer token does not unlock admin", async () => {
  const r = await call("GET", "/api/stats", { token: "not-a-real-session" });
  assert(
    unauthStatus().includes(r.status),
    `got ${r.status} ${JSON.stringify(r.json)}`,
  );
});

Deno.test("survey DELETE and record DELETE are different routes", async () => {
  const survey = await call("DELETE", "/api/surveys/999999");
  const record = await call("DELETE", "/api/submissions/999999");
  // Both need auth; neither is a 405 on the wrong resource type.
  assert(unauthStatus().includes(survey.status));
  assert(unauthStatus().includes(record.status));
  assertFalse(survey.status === 405);
  assertFalse(record.status === 405);
});
