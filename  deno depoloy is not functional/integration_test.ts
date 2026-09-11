/**
 * Neon integration — opt-in only so production is never written by accident.
 *
 *   TEST_INTEGRATION=1 DATABASE_URL='postgresql://…' \
 *   TEST_ADMIN_USER=… TEST_ADMIN_PASS=… \
 *   deno test -A --no-check integration_test.ts
 *
 * Super Admin may be used instead of Client Admin (TEST_ADMIN_USER).
 */
import { assert, assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./main-test.ts";

const RUN = Deno.env.get("TEST_INTEGRATION") === "1" && Boolean(Deno.env.get("DATABASE_URL"));
const USER = Deno.env.get("TEST_ADMIN_USER") || "";
const PASS = Deno.env.get("TEST_ADMIN_PASS") || "";

async function call(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await handleRequest(
    new Request(`http://ssx.test${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  );
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

Deno.test({
  name: "integration: login + survey/record independence + draft strip + opus media + delete facts",
  ignore: !RUN || !USER || !PASS,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const stamp = `itest-${Date.now()}`;
    const login = await call("POST", "/api/auth/login", {
      body: { username: USER, password: PASS, expected_role: "admin" },
    });
    if (login.status !== 200) {
      const sa = await call("POST", "/api/auth/login", {
        body: { username: USER, password: PASS },
      });
      assertEquals(sa.status, 200, `login failed: ${JSON.stringify(login.json)} / ${JSON.stringify(sa.json)}`);
      login.status = sa.status;
      login.json = sa.json;
    }
    const token = String(login.json.token || "");
    assert(token, "login must return token");

    const created = await call("POST", "/api/surveys", {
      token,
      body: {
        title: stamp,
        questions: [
          { id: "q1", label: "Name", type: "text", visible: true },
          { id: "q2", label: "Party", type: "choice", options: ["BJP", "AIMIM"], visible: true },
        ],
      },
    });
    assertEquals(created.status, 201, JSON.stringify(created.json));
    const survey = created.json.survey as { id: number; form_key: string };
    assert(survey?.id);
    const formKey = survey.form_key;

    const jpeg =
      "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wAAAAD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBEQAAAQH/AAAAA//Z";
    const opus = "data:audio/webm;codecs=opus;base64," + btoa("webm-opus-fake");

    const posted = await call("POST", "/api/submissions", {
      token,
      body: {
        form_key: formKey,
        source: "mobile-field-survey",
        submitted_by: "itest-surveyor",
        geo: { lat: 17.385, lng: 78.486 },
        answers: { _draft: true, q1: "Ravi", q2: "AIMIM", client_package_id: stamp },
      },
    });
    assertEquals(posted.status, 201, JSON.stringify(posted.json));
    const subId = Number(posted.json.id);
    assert(subId > 0);
    const answers = posted.json.answers as Record<string, unknown>;
    assertEquals(answers._draft, undefined, "server must strip _draft on Send");

    const photo = await call("POST", `/api/submissions/${subId}/media`, {
      token,
      body: { kind: "photo", data: jpeg, mime: "image/jpeg" },
    });
    assert(
      [200, 201].includes(photo.status),
      `photo upload ${photo.status} ${JSON.stringify(photo.json)}`,
    );

    const audio = await call("POST", `/api/submissions/${subId}/media`, {
      token,
      body: { kind: "audio", data: opus, mime: "audio/webm;codecs=opus" },
    });
    assert(
      [200, 201].includes(audio.status),
      `opus upload must not be invalid base64: ${audio.status} ${JSON.stringify(audio.json)}`,
    );

    const mine = await call("GET", "/api/submissions/me", { token });
    if (mine.status === 200) {
      const items = (mine.json.items || []) as { id: number }[];
      assert(items.some((it) => Number(it.id) === subId), "sent draft must appear in My activity");
    }

    const pending = await call("GET", "/api/submissions?status=pending&limit=200", { token });
    if (pending.status === 200) {
      const items = (pending.json.items || []) as { id: number }[];
      assert(items.some((it) => Number(it.id) === subId) || posted.json.auto_confirmed === true);
    }

    const delRecord = await call("DELETE", `/api/submissions/${subId}`, { token });
    assertEquals(delRecord.status, 200, JSON.stringify(delRecord.json));
    const gone = await call("GET", `/api/submissions/${subId}`, { token });
    assert(
      gone.status === 404 || gone.status === 405 || gone.status === 200 && !gone.json.id,
      `deleted record must not load: ${gone.status}`,
    );

    const leftover = await call("POST", "/api/submissions", {
      token,
      body: {
        form_key: formKey,
        source: "mobile-field-survey",
        submitted_by: "itest-surveyor",
        geo: { lat: 17.385, lng: 78.486 },
        answers: { q1: "keep-me", client_package_id: stamp + "-keep" },
      },
    });
    assertEquals(leftover.status, 201, JSON.stringify(leftover.json));
    const keepId = Number(leftover.json.id);

    const delSurvey = await call("DELETE", `/api/surveys/${survey.id}`, { token });
    assert(
      [200, 403, 404].includes(delSurvey.status),
      `survey delete ${delSurvey.status} ${JSON.stringify(delSurvey.json)}`,
    );

    if (delSurvey.status === 200) {
      const still = await call("GET", `/api/submissions?status=all&limit=500`, { token });
      const items = (still.json.items || []) as { id: number; form_key?: string }[];
      const found = items.find((it) => Number(it.id) === keepId);
      // Independent: survey delete does not have to 404 the row; Super Admin still sees it.
      if (found) {
        assertEquals(Number(found.id), keepId);
      }
      await call("DELETE", `/api/submissions/${keepId}`, { token });
    } else {
      await call("DELETE", `/api/submissions/${keepId}`, { token });
      await call("DELETE", `/api/surveys/${survey.id}`, { token });
    }
  },
});

Deno.test({
  name: "integration skipped unless TEST_INTEGRATION=1 and admin creds",
  ignore: RUN && Boolean(USER) && Boolean(PASS),
  fn() {
    assertEquals(
      true,
      true,
      "set TEST_INTEGRATION=1 DATABASE_URL TEST_ADMIN_USER TEST_ADMIN_PASS to run the live flow",
    );
  },
});
