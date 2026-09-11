/**
 * Unit tests for monolith helpers (no database).
 */
import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  b64ToBytes,
  dayKey,
  hasPower,
  isDraftSubmission,
  istCalendarDate,
  normParty,
  parsePayload,
  payloadStatus,
  recordIndexOf,
  splitDataUrl,
  stripDraftFlags,
  workStatusOf,
} from "./main-test.ts";

Deno.test("splitDataUrl keeps codecs=opus payload as base64", () => {
  const raw = "data:audio/webm;codecs=opus;base64,GkXf";
  const p = splitDataUrl(raw);
  assertEquals(p.mime, "audio/webm");
  assertEquals(p.b64, "GkXf");
});

Deno.test("splitDataUrl jpeg data URL", () => {
  const p = splitDataUrl("data:image/jpeg;base64,/9j/4AAQ");
  assertEquals(p.mime, "image/jpeg");
  assertEquals(p.b64, "/9j/4AAQ");
});

Deno.test("splitDataUrl raw base64 is unchanged", () => {
  const p = splitDataUrl("YWJjZA==");
  assertEquals(p.mime, "");
  assertEquals(p.b64, "YWJjZA==");
});

Deno.test("b64ToBytes decodes padded and url-safe", () => {
  const bytes = b64ToBytes("YWI");
  assertEquals([...bytes], [97, 98]);
  const urlSafe = b64ToBytes(btoa("hi").replace(/\+/g, "-").replace(/\//g, "_"));
  assertEquals(new TextDecoder().decode(urlSafe), "hi");
});

Deno.test("b64ToBytes throws on invalid", () => {
  assertThrows(() => b64ToBytes("!!!!"));
});

Deno.test("stripDraftFlags removes phone-only draft markers", () => {
  const out = stripDraftFlags({
    draft: true,
    content_type: "draft",
    answers: { _draft: true, draft: true, party: "BRS", q1: "yes" },
  });
  assertEquals(out.draft, false);
  assertEquals(out.content_type, "qa");
  const a = out.answers as Record<string, unknown>;
  assertEquals(a._draft, undefined);
  assertEquals(a.draft, undefined);
  assertEquals(a.party, "BRS");
});

Deno.test("isDraftSubmission / workStatusOf", () => {
  assertEquals(isDraftSubmission({ answers: { _draft: true }, status: "confirmed" }), true);
  assertEquals(workStatusOf({ answers: { _draft: true }, status: "confirmed" }), "pending");
  assertEquals(workStatusOf({ status: "confirmed", answers: {} }), "completed");
  assertEquals(workStatusOf({ status: "rejected", answers: {} }), "rejected");
  assertEquals(workStatusOf({ status: "pending", answers: {} }), "pending");
});

Deno.test("payloadStatus defaults unknown to pending", () => {
  assertEquals(payloadStatus({}), "pending");
  assertEquals(payloadStatus({ status: "CONFIRMED" }), "confirmed");
});

Deno.test("parsePayload null and junk become {}", () => {
  assertEquals(parsePayload(null), {});
  assertEquals(parsePayload("not-json"), {});
  assertEquals(parsePayload({ a: 1 }).a, 1);
});

Deno.test("normParty keeps AIMIM and maps canonical parties", () => {
  assertEquals(normParty("AIMIM"), "AIMIM");
  assertEquals(normParty("bjp"), "BJP");
  assertEquals(normParty("TRS"), "BRS");
  assertEquals(normParty(""), "Undecided");
  assertEquals(normParty("Congress"), "Congress");
});

Deno.test("IST dayKey: UTC evening is next IST calendar day", () => {
  assertEquals(dayKey("2026-08-21T19:00:00.000Z"), "2026-08-22");
  assertEquals(istCalendarDate("2026-08-21T18:29:00.000Z"), "2026-08-21");
  assertEquals(istCalendarDate("2026-08-21T18:31:00.000Z"), "2026-08-22");
  assertEquals(dayKey("2026-08-21"), "2026-08-21");
});

Deno.test("recordIndexOf reads nested answers", () => {
  assertEquals(recordIndexOf({ answers: { _recordIndex: 4 } }), 4);
  assertEquals(recordIndexOf({ record_index: 2 }), 2);
  assertEquals(recordIndexOf({ answers: {} }), null);
});

Deno.test("hasPower: Super Admin always, Client Admin by grant", () => {
  assertEquals(hasPower({ role: "super_admin" }, "can_review_data"), true);
  assertEquals(hasPower({ role: "admin", can_review_data: true }, "can_review_data"), true);
  assertEquals(hasPower({ role: "admin", can_review_data: false }, "can_review_data"), false);
  assertEquals(hasPower(null, "can_review_data"), false);
});
